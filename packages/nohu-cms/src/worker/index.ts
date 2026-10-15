/**
 * Worker d'un site nohu-cms. Le site est statique (fichiers servis par
 * ASSETS) ; le Worker ne s'exécute d'abord que pour /api/* et /media/*
 * (`assets.run_worker_first` dans wrangler.jsonc).
 *
 *   import config from '../cms.config';
 *   import { createCmsWorker } from 'nohu-cms/worker';
 *   export default createCmsWorker(config);
 */
import type { CmsConfig } from '../config';
import { authenticate } from './auth';
import type { AdminRequest, CmsEnv } from './env';
import { fail, json } from './http';
import { publishStatus, triggerRebuild } from './publish';
import { listContent, saveContent } from './routes/content';
import {
  createEntry,
  deleteEntry,
  listEntries,
  readEntry,
  updateEntry,
} from './routes/entries';
import { removeOrphanMedia, serveMedia, uploadMedia } from './routes/media';

export type { AdminRequest, CmsEnv } from './env';
export { removeOrphanMedia } from './routes/media';

type Handler = (input: AdminRequest) => Promise<Response> | Response;

/**
 * Routes de l'API admin : méthode, chemin (`:param`), traitement. Toutes
 * passent par `authenticate()` et, pour les écritures, par le contrôle
 * d'origine : ne pas créer de route d'écriture ailleurs.
 */
const ADMIN_ROUTES: [string, string, Handler][] = [
  ['GET', '/me', ({ email }) => json({ email })],
  ['GET', '/content', listContent],
  ['PUT', '/content/:page', saveContent],
  ['GET', '/entries/:collection', listEntries],
  ['POST', '/entries/:collection', createEntry],
  ['GET', '/entries/:collection/:id', readEntry],
  ['PUT', '/entries/:collection/:id', updateEntry],
  ['DELETE', '/entries/:collection/:id', deleteEntry],
  ['POST', '/media', uploadMedia],
  ['GET', '/publish', async ({ env }) => json(await publishStatus(env))],
  [
    'POST',
    '/publish',
    async ({ env, email }) => json(await triggerRebuild(env, email)),
  ],
];

/** Route correspondant à la requête, ou la raison de l'échec. */
function matchRoute(method: string, path: string) {
  const parts = path.split('/').filter(Boolean);
  let pathExists = false;
  for (const [routeMethod, pattern, handler] of ADMIN_ROUTES) {
    const expected = pattern.split('/').filter(Boolean);
    if (expected.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const matches = expected.every((segment, index) => {
      if (segment.startsWith(':')) {
        try {
          params[segment.slice(1)] = decodeURIComponent(parts[index]);
        } catch {
          return false;
        }
        return true;
      }
      return segment === parts[index];
    });
    if (!matches) continue;
    if (routeMethod === method) return { handler, params };
    pathExists = true;
  }
  return pathExists ? 'wrong-method' : null;
}

/**
 * API admin : refus des requêtes d'écriture envoyées depuis un autre site,
 * puis identification (Cloudflare Access + liste ADMIN_EMAILS).
 */
async function handleAdmin(
  request: Request,
  env: CmsEnv,
  ctx: ExecutionContext,
  config: CmsConfig,
  path: string,
) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) {
      return fail(403, 'Requête refusée.');
    }
  }
  const auth = await authenticate(request, env);
  if (!auth.ok) return fail(auth.status, auth.error);

  const route = matchRoute(request.method, path);
  if (!route) return fail(404, 'Adresse inconnue.');
  if (route === 'wrong-method') return fail(405, 'Méthode non autorisée.');
  try {
    return await route.handler({
      request,
      env,
      ctx,
      config,
      params: route.params,
      email: auth.email,
    });
  } catch (error) {
    console.error('[nohu-cms]', request.method, path, error);
    return fail(500, 'Erreur du serveur. Réessaie dans un instant.');
  }
}

export interface CmsWorkerOptions<E extends CmsEnv> {
  /**
   * Routes propres au site, appelées avant les fichiers statiques. Renvoyer
   * `null` / `undefined` pour laisser passer. Seuls les chemins listés dans
   * `assets.run_worker_first` atteignent le Worker.
   */
  fetch?: (
    request: Request,
    env: E,
    ctx: ExecutionContext,
  ) => Response | null | undefined | Promise<Response | null | undefined>;
}

export function createCmsWorker<E extends CmsEnv = CmsEnv>(
  config: CmsConfig,
  options: CmsWorkerOptions<E> = {},
): ExportedHandler<E> {
  return {
    async fetch(request, env, ctx) {
      const { pathname } = new URL(request.url);
      if (pathname.startsWith('/api/admin/')) {
        return handleAdmin(
          request,
          env,
          ctx,
          config,
          pathname.slice('/api/admin'.length),
        );
      }
      if (pathname.startsWith('/media/') && request.method === 'GET') {
        return serveMedia(pathname, env);
      }
      const custom = await options.fetch?.(request, env, ctx);
      if (custom) return custom;
      if (pathname.startsWith('/api/') || pathname.startsWith('/media/')) {
        return new Response('Introuvable', { status: 404 });
      }
      return env.ASSETS.fetch(request);
    },
    async scheduled(_controller, env, ctx) {
      ctx.waitUntil(
        removeOrphanMedia(env).then((removed) => {
          if (removed.length) {
            console.info(
              `[nohu-cms] Photos inutilisées supprimées : ${removed.length}`,
            );
          }
        }),
      );
    },
  };
}
