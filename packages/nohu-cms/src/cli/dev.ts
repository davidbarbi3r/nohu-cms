/**
 * Admin en local, au plus près de la production :
 * - base D1 et photos R2 locales (dossier .wrangler/) ;
 * - `wrangler dev` sert le Worker (site construit + API admin) ;
 * - chaque enregistrement dans l'admin appelle un « deploy hook » local qui
 *   reconstruit le site (comme Workers Builds en production).
 */
import { spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { localClient } from '../content/d1';
import { migrate } from '../content/migrate';

export interface DevOptions {
  port: number;
  cwd?: string;
}

const NEXT_DIR = '.wrangler/nohu-cms-next';

function run(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} ${args.join(' ')} → ${code}`)),
    );
  });
}

/** Variables de .dev.vars (`--var` fait ignorer ce fichier par wrangler). */
export function readDevVars(cwd: string): string[] {
  const file = join(cwd, '.dev.vars');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => line.replace('=', ':'));
}

export async function dev({ port, cwd = process.cwd() }: DevOptions) {
  const hookPort = port + 2;
  const env = { ...process.env, CMS_SOURCE: 'local' };
  const vars = readDevVars(cwd);
  if (!vars.some((entry) => entry.startsWith('DEV_ADMIN_EMAIL:'))) {
    console.warn(
      '[nohu-cms] DEV_ADMIN_EMAIL manquant dans .dev.vars : l’admin locale refusera la connexion.',
    );
  }

  mkdirSync(join(cwd, 'dist'), { recursive: true });
  const applied = await migrate(localClient(cwd));
  if (applied.length) {
    console.info(`[nohu-cms] Migrations locales : ${applied.join(', ')}`);
  }

  let building = false;
  let queued = false;
  const build = async () => {
    if (building) {
      queued = true;
      return;
    }
    building = true;
    console.info('\n[nohu-cms] Reconstruction du site…');
    try {
      await run('npx', ['astro', 'build'], {
        cwd,
        env: { ...env, NOHU_CMS_OUT_DIR: NEXT_DIR },
      });
      const dist = join(cwd, 'dist');
      for (const entry of readdirSync(dist)) {
        rmSync(join(dist, entry), { recursive: true, force: true });
      }
      cpSync(join(cwd, NEXT_DIR), dist, { recursive: true });
      console.info(`[nohu-cms] Site à jour → http://localhost:${port}/admin`);
    } catch (error) {
      console.error('[nohu-cms] Échec du build :', (error as Error).message);
    } finally {
      building = false;
      if (queued) {
        queued = false;
        void build();
      }
    }
  };

  createServer((request, response) => {
    if (request.method === 'POST') void build();
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"ok":true}');
  }).listen(hookPort, '127.0.0.1');

  const worker = spawn(
    'npx',
    [
      'wrangler',
      'dev',
      '--port',
      String(port),
      // Sans ça, wrangler présente les requêtes comme venant du domaine de
      // production (routes de wrangler.jsonc) et la connexion locale est refusée.
      '--local-upstream',
      `localhost:${port}`,
      '--var',
      ...vars,
      `DEPLOY_HOOK_URL:http://127.0.0.1:${hookPort}/rebuild`,
    ],
    { cwd, stdio: 'inherit', env },
  );
  worker.on('exit', (code) => process.exit(code ?? 0));
  process.on('SIGINT', () => worker.kill('SIGINT'));

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await fetch(`http://localhost:${port}/`);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  await build();
}
