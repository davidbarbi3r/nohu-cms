/** Lecture des valeurs non secrètes de wrangler.jsonc (compte, base D1). */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface WranglerValues {
  name?: string;
  accountId?: string;
  databaseId?: string;
  databaseName?: string;
  bucketName?: string;
  adminEmails?: string;
  accessTeamDomain?: string;
  accessAud?: string;
}

const pick = (source: string, key: string) =>
  source.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`))?.[1];

export function readWranglerConfig(cwd = process.cwd()): WranglerValues {
  const file = ['wrangler.jsonc', 'wrangler.json']
    .map((name) => join(cwd, name))
    .find((path) => existsSync(path));
  if (!file) return {};
  const source = readFileSync(file, 'utf8');
  return {
    name: pick(source, 'name'),
    accountId:
      pick(source, 'CLOUDFLARE_ACCOUNT_ID') ?? pick(source, 'account_id'),
    databaseId: pick(source, 'database_id'),
    databaseName: pick(source, 'database_name'),
    bucketName: pick(source, 'bucket_name'),
    adminEmails: pick(source, 'ADMIN_EMAILS'),
    accessTeamDomain: pick(source, 'ACCESS_TEAM_DOMAIN'),
    accessAud: pick(source, 'ACCESS_AUD'),
  };
}
