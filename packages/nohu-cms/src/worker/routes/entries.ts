import {
  cleanEntryInput,
  entryFromRow,
  knownAssets,
  sortEntries,
  validateEntry,
  type CmsConfig,
  type CollectionDef,
  type EntryInput,
  type EntryRow,
} from '../../config';
import type { AdminRequest, CmsEnv } from '../env';
import { fail, invalid, json, now, readJson } from '../http';
import { triggerRebuild } from '../publish';

const SLUG_TAKEN = 'Cette adresse est déjà utilisée par une autre entrée.';

const DRAFT_ONLY = {
  triggered: false,
  message: 'Brouillon enregistré. Il n’apparaît pas sur le site.',
};

const isPublished = (entry: Pick<EntryInput, 'status'>) =>
  entry.status === 'published';

/** Un brouillon qui reste brouillon ne change rien au site public. */
const publishIfVisible = (env: CmsEnv, email: string, visible: boolean) =>
  visible ? triggerRebuild(env, email) : Promise.resolve(DRAFT_ONLY);

function collectionOf({ config, params }: AdminRequest): CollectionDef | null {
  const collections = config.collections ?? {};
  return Object.hasOwn(collections, params.collection)
    ? collections[params.collection]
    : null;
}

async function getEntry(env: CmsEnv, collection: string, id: string) {
  const row = await env.DB.prepare(
    'SELECT * FROM cms_entries WHERE collection = ?1 AND id = ?2',
  )
    .bind(collection, id)
    .first<EntryRow>();
  return row ? entryFromRow(row) : null;
}

async function checkEntry(
  config: CmsConfig,
  env: CmsEnv,
  collection: string,
  definition: CollectionDef,
  input: EntryInput,
  currentId = '',
) {
  const errors = validateEntry(definition, input, knownAssets(config));
  if (!errors.slug) {
    const clash = await env.DB.prepare(
      'SELECT 1 FROM cms_entries WHERE collection = ?1 AND slug = ?2 AND id != ?3',
    )
      .bind(collection, input.slug, currentId)
      .first();
    if (clash) errors.slug = SLUG_TAKEN;
  }
  return errors;
}

/** Date de publication posée au moment où l'entrée est publiée. */
const withPublishDate = (input: EntryInput): EntryInput =>
  isPublished(input) && !input.publishedAt
    ? { ...input, publishedAt: now().slice(0, 10) }
    : input;

/** Écrit l'entrée ; renvoie une réponse d'erreur si le slug est déjà pris. */
async function write(statement: D1PreparedStatement): Promise<Response | null> {
  try {
    await statement.run();
    return null;
  } catch (error) {
    if (String(error).includes('UNIQUE constraint failed')) {
      return invalid({ slug: SLUG_TAKEN });
    }
    throw error;
  }
}

export async function listEntries(input: AdminRequest) {
  const definition = collectionOf(input);
  if (!definition) return fail(404, 'Collection inconnue.');
  const { results } = await input.env.DB.prepare(
    'SELECT * FROM cms_entries WHERE collection = ?1',
  )
    .bind(input.params.collection)
    .all<EntryRow>();
  return json({
    entries: sortEntries(results.map(entryFromRow), definition.sort),
  });
}

export async function readEntry(input: AdminRequest) {
  if (!collectionOf(input)) return fail(404, 'Collection inconnue.');
  const entry = await getEntry(
    input.env,
    input.params.collection,
    input.params.id,
  );
  return entry ? json({ entry }) : fail(404, 'Entrée introuvable.');
}

export async function createEntry(request: AdminRequest) {
  const { env, params, email } = request;
  const definition = collectionOf(request);
  if (!definition) return fail(404, 'Collection inconnue.');
  const cleaned = cleanEntryInput(definition, await readJson(request.request));
  if (!cleaned) return fail(400, 'Données invalides.');
  const input = withPublishDate(cleaned);
  const errors = await checkEntry(
    request.config,
    env,
    params.collection,
    definition,
    input,
  );
  if (Object.keys(errors).length) return invalid(errors);

  const id = crypto.randomUUID();
  const timestamp = now();
  const conflict = await write(
    env.DB.prepare(
      `INSERT INTO cms_entries
         (id, collection, slug, status, title, published_at, data, created_at, updated_at, updated_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9)`,
    ).bind(
      id,
      params.collection,
      input.slug,
      input.status,
      input.title,
      input.publishedAt,
      JSON.stringify(input.data),
      timestamp,
      email,
    ),
  );
  if (conflict) return conflict;

  const publish = await publishIfVisible(env, email, isPublished(input));
  return json({ id, ...publish }, { status: 201 });
}

export async function updateEntry(request: AdminRequest) {
  const { env, params, email } = request;
  const definition = collectionOf(request);
  if (!definition) return fail(404, 'Collection inconnue.');
  const previous = await getEntry(env, params.collection, params.id);
  if (!previous) return fail(404, 'Entrée introuvable.');

  const cleaned = cleanEntryInput(definition, await readJson(request.request));
  if (!cleaned) return fail(400, 'Données invalides.');
  const input = withPublishDate(cleaned);
  const errors = await checkEntry(
    request.config,
    env,
    params.collection,
    definition,
    input,
    previous.id,
  );
  if (Object.keys(errors).length) return invalid(errors);

  const conflict = await write(
    env.DB.prepare(
      `UPDATE cms_entries
       SET slug = ?1, status = ?2, title = ?3, published_at = ?4, data = ?5,
         updated_at = ?6, updated_by = ?7
       WHERE id = ?8`,
    ).bind(
      input.slug,
      input.status,
      input.title,
      input.publishedAt,
      JSON.stringify(input.data),
      now(),
      email,
      previous.id,
    ),
  );
  if (conflict) return conflict;

  const visible = isPublished(input) || isPublished(previous);
  const publish = await publishIfVisible(env, email, visible);
  return json({ id: previous.id, ...publish });
}

export async function deleteEntry(request: AdminRequest) {
  const { env, params, email } = request;
  if (!collectionOf(request)) return fail(404, 'Collection inconnue.');
  const previous = await getEntry(env, params.collection, params.id);
  if (!previous) return fail(404, 'Entrée introuvable.');

  await env.DB.prepare('DELETE FROM cms_entries WHERE id = ?1')
    .bind(previous.id)
    .run();

  const publish = isPublished(previous)
    ? await triggerRebuild(env, email)
    : { triggered: false, message: 'Brouillon supprimé.' };
  return json({ deleted: true, ...publish });
}
