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
  /** Compte Cloudflare (wrangler.jsonc) : lecture de l'état des builds. */
  CLOUDFLARE_ACCOUNT_ID?: string;
  /** Secret : jeton « Workers CI Read », pour suivre le build lancé. */
  CMS_BUILDS_TOKEN?: string;
  /**
   * Secret facultatif : webhook appelé si une mise en ligne échoue (Slack,
   * Discord, ntfy… : corps JSON avec `text` et `content`).
   */
  ALERT_WEBHOOK_URL?: string;
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
