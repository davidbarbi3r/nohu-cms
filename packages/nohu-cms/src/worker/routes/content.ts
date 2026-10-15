import { knownAssets, listFields } from '../../config';
import {
  normalizeValue,
  sameValue,
  validateValue,
  type StoredValue,
} from '../../fields';
import type { AdminRequest } from '../env';
import { fail, invalid, json, now, readJson } from '../http';
import { triggerRebuild } from '../publish';

/** Toutes les valeurs modifiées (les autres gardent leur valeur d'origine). */
export async function listContent({ env }: AdminRequest) {
  const { results } = await env.DB.prepare(
    'SELECT key, value FROM cms_content',
  ).all<{ key: string; value: string }>();

  const values: Record<string, unknown> = {};
  for (const row of results) {
    try {
      values[row.key] = JSON.parse(row.value);
    } catch {
      // Valeur illisible : l'admin affichera la valeur d'origine.
    }
  }
  return json({ values });
}

/**
 * Enregistre les valeurs d'une page. Corps : `{ values: { clé: valeur } }`
 * avec uniquement les champs modifiés. Une valeur identique à la valeur
 * d'origine efface la modification (la valeur d'origine reprend la main).
 */
export async function saveContent({
  request,
  env,
  config,
  params,
  email,
}: AdminRequest) {
  const pageId = params.page;
  if (!Object.hasOwn(config.pages, pageId)) return fail(404, 'Page inconnue.');

  const body = await readJson<{ values?: Record<string, unknown> }>(request);
  if (!body?.values || typeof body.values !== 'object') {
    return fail(400, 'Données invalides.');
  }

  const fields = new Map(
    listFields(config.pages, pageId).map((ref) => [ref.key, ref]),
  );
  const errors: Record<string, string> = {};
  const updates: { key: string; value: StoredValue; reset: boolean }[] = [];

  for (const [key, raw] of Object.entries(body.values)) {
    const ref = fields.get(key);
    if (!ref) {
      errors[key] = 'Champ inconnu.';
      continue;
    }
    const value = normalizeValue(ref.field, raw);
    const error = validateValue(ref.field, value, {
      assets: knownAssets(config),
    });
    if (error) {
      errors[key] = `« ${ref.field.label} » ${error}.`;
      continue;
    }
    updates.push({
      key,
      value,
      reset: sameValue(value, normalizeValue(ref.field, ref.field.default)),
    });
  }

  if (Object.keys(errors).length) return invalid(errors);
  if (!updates.length) {
    return json({ triggered: false, message: 'Rien à enregistrer.' });
  }

  const timestamp = now();
  await env.DB.batch(
    updates.map((update) =>
      update.reset
        ? env.DB.prepare('DELETE FROM cms_content WHERE key = ?1').bind(
            update.key,
          )
        : env.DB.prepare(
            `INSERT INTO cms_content (key, value, updated_at, updated_by)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value,
               updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
          ).bind(update.key, JSON.stringify(update.value), timestamp, email),
    ),
  );

  return json(await triggerRebuild(env, email));
}
