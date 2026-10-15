/**
 * Accès à D1 depuis Node (build, CLI) : à distance par l'API REST
 * Cloudflare, ou en local par la base de `wrangler dev`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWranglerConfig } from './wrangler';

export type Row = Record<string, unknown>;

export interface D1Client {
  readonly kind: 'remote' | 'local';
  /** Une requête (paramètres `?1`, `?2`…), renvoie les lignes. */
  query(sql: string, params?: unknown[]): Promise<Row[]>;
  /** Plusieurs instructions séparées par `;` (migrations). */
  exec(sql: string): Promise<void>;
}

const PLACEHOLDER_ID = '00000000-0000-0000-0000-000000000000';

export interface RemoteSettings {
  accountId: string;
  databaseId: string;
  token: string;
}

/** Compte et base lus dans wrangler.jsonc (ou l'environnement), jeton CMS_API_TOKEN. */
export function remoteSettings(cwd = process.cwd()): RemoteSettings {
  const wrangler = readWranglerConfig(cwd);
  const databaseId =
    process.env.CMS_D1_DATABASE_ID || wrangler.databaseId || '';
  return {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || wrangler.accountId || '',
    databaseId: databaseId === PLACEHOLDER_ID ? '' : databaseId,
    token: process.env.CMS_API_TOKEN ?? '',
  };
}

export const hasRemote = (settings: RemoteSettings) =>
  Boolean(settings.accountId && settings.databaseId && settings.token);

interface QueryPayload {
  success?: boolean;
  errors?: { message: string }[];
  result?: { results?: Row[] }[];
}

export function remoteClient(
  settings: RemoteSettings,
  fetcher: typeof fetch = fetch,
): D1Client {
  const call = async (body: unknown): Promise<QueryPayload> => {
    const response = await fetcher(
      `https://api.cloudflare.com/client/v4/accounts/${settings.accountId}/d1/database/${settings.databaseId}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    const payload = (await response
      .json()
      .catch(() => null)) as QueryPayload | null;
    if (!response.ok || !payload?.success) {
      const detail = payload?.errors?.map((error) => error.message).join(', ');
      throw new Error(
        `Requête D1 impossible (${response.status}) : ${detail || 'réponse invalide'}`,
      );
    }
    return payload;
  };
  return {
    kind: 'remote',
    async query(sql, params = []) {
      const payload = await call({ sql, params });
      return payload.result?.[0]?.results ?? [];
    },
    async exec(sql) {
      await call({ sql });
    },
  };
}

const wrangler = (args: string[], cwd: string) =>
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });

/** Littéral SQL d'un paramètre (wrangler en local n'accepte pas de paramètres). */
function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function inlineParams(sql: string, params: unknown[]): string {
  return sql.replace(/\?(\d+)/g, (_, index: string) =>
    literal(params[Number(index) - 1]),
  );
}

export function localClient(cwd = process.cwd()): D1Client {
  return {
    kind: 'local',
    async query(sql, params = []) {
      const output = wrangler(
        ['--json', '--command', inlineParams(sql, params)],
        cwd,
      );
      const parsed = JSON.parse(output) as { results?: Row[] }[];
      return parsed[0]?.results ?? [];
    },
    async exec(sql) {
      const dir = mkdtempSync(join(tmpdir(), 'nohu-cms-'));
      const file = join(dir, 'migration.sql');
      writeFileSync(file, sql);
      try {
        wrangler(['--file', file, '--yes'], cwd);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
