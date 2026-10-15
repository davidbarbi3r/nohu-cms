import type { CmsConfig } from '../config';

/** Liaisons et variables du Worker (wrangler.jsonc généré par `nohu-cms init`). */
export interface CmsEnv {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA: R2Bucket;
  /** Emails autorisés dans l'admin, séparés par des virgules. */
  ADMIN_EMAILS?: string;
  /** Domaine d'équipe Cloudflare Access, ex. https://mon-equipe.cloudflareaccess.com */
  ACCESS_TEAM_DOMAIN?: string;
  /** « Application Audience (AUD) Tag » de l'application Access du site. */
  ACCESS_AUD?: string;
  /** Développement local uniquement : email simulé, ignoré hors localhost. */
  DEV_ADMIN_EMAIL?: string;
  /** Secret : deploy hook Workers Builds, appelé après chaque modification. */
  DEPLOY_HOOK_URL?: string;
}

/** Ce que reçoit chaque route de l'API admin. */
export interface AdminRequest {
  request: Request;
  env: CmsEnv;
  ctx: ExecutionContext;
  config: CmsConfig;
  params: Record<string, string>;
  email: string;
}
