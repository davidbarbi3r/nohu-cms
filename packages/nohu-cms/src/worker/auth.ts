import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { CmsEnv as Env } from './env';

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Comptes autorisés : variable ADMIN_EMAILS de wrangler.jsonc, seule source. */
const allowedEmails = (env: Env) =>
  (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

const isLocalhost = (request: Request) =>
  ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname);

function accessToken(request: Request): string | null {
  const header = request.headers.get('Cf-Access-Jwt-Assertion');
  if (header) return header;
  const cookie = request.headers.get('Cookie') ?? '';
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export type AuthResult =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403 | 500; error: string };

/**
 * Identifie l'admin. En production, /admin et /api/admin sont derrière
 * Cloudflare Access : on vérifie la signature du jeton Access, puis que
 * l'email fait partie de la liste autorisée (double protection).
 */
export async function authenticate(
  request: Request,
  env: Env,
  /** Tests : clés de signature à la place de celles d'Access. */
  keys?: JWTVerifyGetKey,
): Promise<AuthResult> {
  const allowed = allowedEmails(env);

  if (env.DEV_ADMIN_EMAIL && isLocalhost(request)) {
    const email = env.DEV_ADMIN_EMAIL.toLowerCase();
    return allowed.includes(email)
      ? { ok: true, email }
      : {
          ok: false,
          status: 403,
          error: 'Email de développement non autorisé.',
        };
  }

  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return {
      ok: false,
      status: 500,
      error:
        'Cloudflare Access n’est pas configuré (ACCESS_TEAM_DOMAIN, ACCESS_AUD).',
    };
  }

  const token = accessToken(request);
  if (!token) {
    return { ok: false, status: 401, error: 'Connexion requise.' };
  }

  const issuer = env.ACCESS_TEAM_DOMAIN.replace(/\/$/, '');
  let remote = jwksCache.get(issuer);
  if (!keys && !remote) {
    remote = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksCache.set(issuer, remote);
  }
  const jwks = (keys ?? remote) as JWTVerifyGetKey;

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: env.ACCESS_AUD,
    });
    const email = String(payload.email ?? '').toLowerCase();
    if (!email || !allowed.includes(email)) {
      return {
        ok: false,
        status: 403,
        error: `Le compte ${email || 'inconnu'} n’a pas accès à l’admin.`,
      };
    }
    return { ok: true, email };
  } catch {
    return {
      ok: false,
      status: 401,
      error: 'Session expirée, reconnecte-toi.',
    };
  }
}
