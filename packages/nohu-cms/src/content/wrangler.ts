/** Lecture des valeurs non secrètes de wrangler.jsonc (compte, base D1, Access…). */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonc } from './jsonc';

export interface WranglerFile {
  name?: string;
  main?: string;
  account_id?: string;
  routes?: ({ pattern: string; custom_domain?: boolean } | string)[];
  assets?: {
    directory?: string;
    binding?: string;
    run_worker_first?: string[] | boolean;
  };
  d1_databases?: {
    binding: string;
    database_name?: string;
    database_id?: string;
  }[];
  r2_buckets?: { binding: string; bucket_name?: string }[];
  triggers?: { crons?: string[] };
  vars?: Record<string, string>;
}

export interface WranglerValues {
  file?: string;
  raw?: WranglerFile;
  name?: string;
  accountId?: string;
  databaseId?: string;
  databaseName?: string;
  bucketName?: string;
  adminEmails?: string;
  accessTeamDomain?: string;
  accessAud?: string;
  /** Domaines servis par le Worker (routes de wrangler.jsonc). */
  domains: string[];
}

export function readWranglerConfig(cwd = process.cwd()): WranglerValues {
  const file = ['wrangler.jsonc', 'wrangler.json']
    .map((name) => join(cwd, name))
    .find((path) => existsSync(path));
  if (!file) return { domains: [] };
  const raw = parseJsonc(readFileSync(file, 'utf8')) as WranglerFile;
  const db = raw.d1_databases?.find((entry) => entry.binding === 'DB');
  const bucket = raw.r2_buckets?.find((entry) => entry.binding === 'MEDIA');
  const vars = raw.vars ?? {};
  return {
    file,
    raw,
    name: raw.name,
    accountId: vars.CLOUDFLARE_ACCOUNT_ID || raw.account_id,
    databaseId: db?.database_id,
    databaseName: db?.database_name,
    bucketName: bucket?.bucket_name,
    adminEmails: vars.ADMIN_EMAILS,
    accessTeamDomain: vars.ACCESS_TEAM_DOMAIN,
    accessAud: vars.ACCESS_AUD,
    domains: (raw.routes ?? [])
      .map((route) => (typeof route === 'string' ? route : route.pattern))
      .map((pattern) => pattern.replace(/\/\*$/, '').replace(/^\*\.?/, ''))
      .filter(Boolean),
  };
}
