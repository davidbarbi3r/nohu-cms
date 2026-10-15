import { MEDIA_SRC, referencedMedia } from '../../fields';
import { MAX_IMAGE_WIDTH, type MediaUpload } from '../../protocol';
import type { AdminRequest, CmsEnv } from '../env';
import { fail, json, now } from '../http';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_VARIANTS = 4;
const TYPES: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
};

/**
 * Envoi d'une photo (multipart). L'admin la redimensionne dans le navigateur
 * et envoie une variante par largeur : champs `variant-<largeur>` (WebP, ou
 * JPEG si le navigateur ne sait pas produire de WebP), plus `height`, la
 * hauteur de la plus grande variante.
 */
export async function uploadMedia({ request, env, email }: AdminRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, 'Envoi invalide.');
  }
  const variants: { width: number; file: File }[] = [];
  for (const [name, value] of form.entries()) {
    const match = /^variant-(\d{2,4})$/.exec(name);
    if (!match || !(value instanceof File)) continue;
    variants.push({ width: Number(match[1]), file: value });
  }
  const height = Number(form.get('height'));
  if (!variants.length) return fail(400, 'Aucune photo reçue.');
  if (variants.length > MAX_VARIANTS) return fail(400, 'Trop de variantes.');
  if (!Number.isInteger(height) || height < 1 || height > 10000) {
    return fail(400, 'Dimensions invalides.');
  }
  const type = variants[0].file.type;
  const extension = TYPES[type];
  if (!extension || variants.some((variant) => variant.file.type !== type)) {
    return fail(
      415,
      'Format non pris en charge : la photo doit être en WebP ou JPEG.',
    );
  }
  for (const variant of variants) {
    if (variant.width < 16 || variant.width > MAX_IMAGE_WIDTH) {
      return fail(400, 'Largeur de photo invalide.');
    }
    if (variant.file.size > MAX_BYTES) {
      return fail(413, 'Photo trop lourde (8 Mo maximum).');
    }
  }

  variants.sort((a, b) => a.width - b.width);
  const id = crypto.randomUUID();
  const srcset = variants.map((variant) => ({
    src: `/media/${id}/${variant.width}.${extension}`,
    width: variant.width,
  }));
  await Promise.all(
    variants.map((variant, index) =>
      env.MEDIA.put(srcset[index].src.slice(1), variant.file.stream(), {
        httpMetadata: { contentType: type },
        customMetadata: { uploadedBy: email },
      }),
    ),
  );
  const largest = srcset[srcset.length - 1];
  await env.DB.prepare(
    'INSERT INTO cms_media (id, width, height, srcset, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
  )
    .bind(id, largest.width, height, JSON.stringify(srcset), now(), email)
    .run();

  const result: MediaUpload = {
    id,
    src: largest.src,
    width: largest.width,
    height,
    srcset,
  };
  return json(result, { status: 201 });
}

/** Photos stockées dans R2, servies publiquement sur /media/*. */
export async function serveMedia(path: string, env: CmsEnv) {
  if (!MEDIA_SRC.test(path))
    return new Response('Introuvable', { status: 404 });
  const object = await env.MEDIA.get(path.slice(1));
  if (!object) return new Response('Introuvable', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  // Chaque photo a une adresse unique : elle ne change jamais.
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(object.body, { headers });
}

const ORPHAN_DELAY_MS = 24 * 60 * 60 * 1000;

/**
 * Supprime les photos qu'aucun contenu ni aucune entrée (brouillons compris,
 * HTML riche compris) n'utilise. Le délai de 24 h protège une photo envoyée
 * dans un formulaire pas encore enregistré.
 */
export async function removeOrphanMedia(env: CmsEnv, at = Date.now()) {
  const [content, entries] = await Promise.all([
    env.DB.prepare('SELECT value FROM cms_content').all<{ value: string }>(),
    env.DB.prepare('SELECT data FROM cms_entries').all<{ data: string }>(),
  ]);
  const used = new Set([
    ...content.results.flatMap((row) => referencedMedia(row.value)),
    ...entries.results.flatMap((row) => referencedMedia(row.data)),
  ]);
  const threshold = at - ORPHAN_DELAY_MS;

  const removed = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await env.MEDIA.list({ prefix: 'media/', cursor });
    const orphans = page.objects.filter((object) => {
      const id = object.key.split('/')[1];
      return !used.has(id) && object.uploaded.getTime() < threshold;
    });
    if (orphans.length) {
      await env.MEDIA.delete(orphans.map((object) => object.key));
      for (const object of orphans) removed.add(object.key.split('/')[1]);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  if (removed.size) {
    await env.DB.batch(
      [...removed].map((id) =>
        env.DB.prepare('DELETE FROM cms_media WHERE id = ?1').bind(id),
      ),
    );
  }
  return [...removed];
}
