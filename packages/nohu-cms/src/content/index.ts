/**
 * Chargement du contenu au build (Node uniquement).
 *
 * Source des données, via la variable `CMS_SOURCE` :
 * - `d1`       : base D1 de production, par l'API REST Cloudflare. Compte et
 *                base lus dans wrangler.jsonc, jeton dans le secret de build
 *                CMS_API_TOKEN (droit D1 Edit : le build applique aussi les
 *                migrations en attente) ;
 * - `local`    : base D1 locale de `wrangler dev` (npx nohu-cms dev) ;
 * - `defaults` : valeurs d'origine de cms.config.ts, sans aucune entrée.
 * Sans `CMS_SOURCE`, `d1` est choisi si ces trois valeurs sont connues,
 * `defaults` sinon. Sur Workers Builds, un build sans D1 échoue : on ne
 * publie jamais les valeurs d'origine par-dessus les modifications.
 */
import {
  entryFromRow,
  entryPath,
  listFields,
  sortEntries,
  type CmsConfig,
  type CollectionName,
  type CollectionOf,
  type Content,
  type Entry,
  type EntryRow,
} from '../config';
import {
  normalizeValue,
  validateValue,
  type Field,
  type ImageValue,
  type StoredValue,
} from '../fields';
import {
  hasRemote,
  localClient,
  remoteClient,
  remoteSettings,
  type D1Client,
} from './d1';
import { migrate } from './migrate';
import { frenchSpacing, sanitizeRichText } from './sanitize';

export { frenchSpacing, sanitizeRichText } from './sanitize';
export type { Content, Entry } from '../config';

type Source = 'd1' | 'local' | 'defaults';

export function resolveSource(): Source {
  const requested = process.env.CMS_SOURCE;
  if (requested === 'd1' || requested === 'local' || requested === 'defaults') {
    return requested;
  }
  if (requested) {
    throw new Error(
      `[nohu-cms] CMS_SOURCE inconnu : « ${requested} » (d1, local, defaults).`,
    );
  }
  if (hasRemote(remoteSettings())) return 'd1';
  if (process.env.WORKERS_CI) {
    throw new Error(
      '[nohu-cms] Build Workers Builds sans accès à D1 : vérifie database_id et CLOUDFLARE_ACCOUNT_ID dans wrangler.jsonc, et le secret de build CMS_API_TOKEN (npx nohu-cms doctor).',
    );
  }
  return 'defaults';
}

interface Store {
  source: Source;
  db: D1Client | null;
  ready: Promise<void>;
}

let store: Store | undefined;

/** Connexion unique par build ; les migrations en attente sont appliquées d'abord. */
function getStore(): Store {
  if (store) return store;
  const source = resolveSource();
  console.info(`[nohu-cms] Source du contenu : ${source}`);
  const db =
    source === 'd1'
      ? remoteClient(remoteSettings())
      : source === 'local'
        ? localClient()
        : null;
  const ready = db
    ? migrate(db).then((applied) => {
        if (applied.length) {
          console.info(
            `[nohu-cms] Migrations appliquées : ${applied.join(', ')}`,
          );
        }
      })
    : Promise.resolve();
  store = { source, db, ready };
  return store;
}

async function query<T>(sql: string, params?: unknown[]): Promise<T[]> {
  const { db, ready } = getStore();
  if (!db) return [];
  await ready;
  return (await db.query(sql, params)) as T[];
}

const PLAIN_KINDS = new Set(['url', 'email', 'date']);

/** Mise en forme finale : typographie française, HTML nettoyé. */
function finalize(field: Field, value: StoredValue): StoredValue {
  if (field.kind === 'richtext') return sanitizeRichText(value as string);
  if (field.kind === 'image') {
    const image = value as ImageValue | null;
    return image && { ...image, alt: frenchSpacing(image.alt) };
  }
  if (field.kind === 'list') {
    return (value as Record<string, unknown>[]).map((item) =>
      Object.fromEntries(
        Object.entries(item).map(([subId, subValue]) => [
          subId,
          finalize(field.fields[subId], subValue as StoredValue),
        ]),
      ),
    ) as StoredValue;
  }
  return PLAIN_KINDS.has(field.kind) ? value : frenchSpacing(value as string);
}

/** Valeur stockée si elle respecte le champ, valeur d'origine sinon (avec un log). */
function resolveValue(
  field: Field,
  raw: unknown,
  where: string,
  draft = false,
): StoredValue {
  if (raw === undefined) return field.default as StoredValue;
  const candidate = normalizeValue(field, raw);
  const error = validateValue(field, candidate, { draft });
  if (!error) return candidate;
  console.warn(
    `[nohu-cms] Valeur ignorée pour ${where} (${error}), valeur d'origine utilisée.`,
  );
  return field.default as StoredValue;
}

const contentCache = new WeakMap<CmsConfig, Promise<unknown>>();

async function loadContent(config: CmsConfig) {
  const rows = await query<{ key: string; value: string }>(
    'SELECT key, value FROM cms_content',
  );
  const stored = new Map(
    rows.map((row) => [String(row.key), String(row.value)]),
  );
  const content: Record<string, Record<string, Record<string, unknown>>> = {};

  for (const ref of listFields(config.pages)) {
    let raw: unknown;
    const serialized = stored.get(ref.key);
    stored.delete(ref.key);
    if (serialized !== undefined) {
      try {
        raw = JSON.parse(serialized);
      } catch {
        console.warn(`[nohu-cms] Valeur illisible pour ${ref.key}, ignorée.`);
      }
    }
    content[ref.pageId] ??= {};
    content[ref.pageId][ref.sectionId] ??= {};
    content[ref.pageId][ref.sectionId][ref.fieldId] = finalize(
      ref.field,
      resolveValue(ref.field, raw, ref.key),
    );
  }
  for (const key of stored.keys()) {
    console.warn(
      `[nohu-cms] Valeur ignorée pour ${key} : ce champ n'existe plus dans cms.config.ts.`,
    );
  }
  return content;
}

/** Tous les textes du site (modifiés dans l'admin, ou d'origine). */
export function getContent<C extends CmsConfig>(
  config: C,
): Promise<Content<C>> {
  let promise = contentCache.get(config);
  if (!promise) {
    promise = loadContent(config);
    contentCache.set(config, promise);
  }
  return promise as Promise<Content<C>>;
}

const entriesCache = new WeakMap<CmsConfig, Map<string, Promise<Entry[]>>>();

async function loadEntries(config: CmsConfig, name: string): Promise<Entry[]> {
  const definition = config.collections?.[name];
  if (!definition) {
    throw new Error(`[nohu-cms] Collection inconnue : « ${name} ».`);
  }
  const rows = await query<EntryRow>(
    "SELECT * FROM cms_entries WHERE collection = ?1 AND status = 'published'",
    [name],
  );
  const entries = rows.map((row) => {
    const entry = entryFromRow(row);
    const raw = entry.data as Record<string, unknown>;
    entry.title = frenchSpacing(entry.title);
    entry.data = Object.fromEntries(
      Object.entries(definition.fields).map(([id, field]) => [
        id,
        finalize(
          field,
          resolveValue(field, raw[id], `${name}/${entry.slug}.${id}`, true),
        ),
      ]),
    ) as Entry['data'];
    return entry;
  });
  return sortEntries(entries, definition.sort);
}

type TypedEntry<C extends CmsConfig, N extends CollectionName<C>> = Entry<
  CollectionOf<C, N>
>;

/** Entrées publiées d'une collection, dans l'ordre de la collection. */
export function getEntries<C extends CmsConfig, N extends CollectionName<C>>(
  config: C,
  name: N,
): Promise<TypedEntry<C, N>[]> {
  let byName = entriesCache.get(config);
  if (!byName) {
    byName = new Map();
    entriesCache.set(config, byName);
  }
  let promise = byName.get(name);
  if (!promise) {
    promise = loadEntries(config, name);
    byName.set(name, promise);
  }
  return promise as Promise<TypedEntry<C, N>[]>;
}

/** Une entrée publiée par son slug, ou `undefined`. */
export async function getEntry<
  C extends CmsConfig,
  N extends CollectionName<C>,
>(config: C, name: N, slug: string): Promise<TypedEntry<C, N> | undefined> {
  return (await getEntries(config, name)).find((entry) => entry.slug === slug);
}

/** Adresse publique d'une entrée (`path` de la collection). */
export function getEntryPath<C extends CmsConfig>(
  config: C,
  name: CollectionName<C>,
  entry: Pick<Entry, 'slug'>,
): string {
  const definition = config.collections?.[name];
  if (!definition)
    throw new Error(`[nohu-cms] Collection inconnue : « ${name} ».`);
  return entryPath(definition, entry.slug);
}

/** Tests : remplace la base (ou revient à la résolution normale). */
export function setContentDatabase(db?: D1Client) {
  store = db ? { source: 'local', db, ready: Promise.resolve() } : undefined;
}
