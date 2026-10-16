import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkFiles, checkRemote, type Check } from '../src/cli/doctor';
import { init } from '../src/cli/init';
import { addIntegration, wranglerJsonc } from '../src/cli/templates';
import type { D1Client } from '../src/content/d1';
import { parseJsonc } from '../src/content/jsonc';
import { readWranglerConfig } from '../src/content/wrangler';

const dirs: string[] = [];
function astroProject() {
  const dir = mkdtempSync(join(tmpdir(), 'nohu-cli-'));
  dirs.push(dir);
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'mon-site', dependencies: { astro: '^7.0.0' } }),
  );
  writeFileSync(
    join(dir, 'astro.config.mjs'),
    "import { defineConfig } from 'astro/config';\n\nexport default defineConfig({\n  site: 'https://exemple.fr',\n});\n",
  );
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const answers = (...values: string[]) => {
  const queue = [...values];
  return async (_question: string, fallback?: string) =>
    queue.shift() || fallback || '';
};

const levels = (checks: Check[]) =>
  Object.fromEntries(checks.map((check) => [check.label, check.level]));

describe('jsonc', () => {
  it('ignore commentaires et virgules finales, garde les // dans les chaînes', () => {
    expect(
      parseJsonc(
        '{\n // commentaire\n "url": "https://x.fr", /* bloc */ "a": [1, 2,],\n}',
      ),
    ).toEqual({ url: 'https://x.fr', a: [1, 2] });
  });
});

describe('init --dry-run', () => {
  it('écrit les fichiers du site sans toucher à Cloudflare', async () => {
    const dir = astroProject();
    const calls: string[] = [];
    const { todo } = await init({
      dryRun: true,
      cwd: dir,
      deps: {
        ask: answers(
          'Mon Site',
          '',
          'exemple.fr, www.exemple.fr',
          'Marie@Exemple.fr',
        ),
        exec: (command, args) => {
          calls.push([command, ...args].join(' '));
          return '';
        },
        log: () => {},
      },
    });
    expect(calls).toEqual([]);

    const wrangler = readWranglerConfig(dir);
    expect(wrangler.name).toBe('mon-site');
    expect(wrangler.domains).toEqual(['exemple.fr', 'www.exemple.fr']);
    expect(wrangler.adminEmails).toBe('marie@exemple.fr');
    expect(wrangler.raw?.assets?.run_worker_first).toEqual([
      '/api/*',
      '/media/*',
    ]);
    expect(wrangler.raw?.triggers?.crons).toEqual([
      '0 3 * * *',
      '*/10 * * * *',
    ]);
    expect(wrangler.databaseName).toBe('mon-site-cms');
    expect(wrangler.bucketName).toBe('mon-site-media');

    expect(readFileSync(join(dir, 'astro.config.mjs'), 'utf8')).toContain(
      "import nohuCms from 'nohu-cms/astro';",
    );
    expect(readFileSync(join(dir, 'astro.config.mjs'), 'utf8')).toContain(
      'integrations: [nohuCms()],',
    );
    expect(readFileSync(join(dir, 'worker/index.ts'), 'utf8')).toContain(
      'createCmsWorker(config)',
    );
    expect(readFileSync(join(dir, '.dev.vars'), 'utf8')).toContain(
      'DEV_ADMIN_EMAIL=marie@exemple.fr',
    );
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain(
      '.dev.vars',
    );
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.scripts['dev:admin']).toBe('nohu-cms dev');
    expect(todo.join('\n')).toContain('Cloudflare Access');
    expect(todo.join('\n')).toContain('CMS_API_TOKEN');
  });

  it('complète un wrangler.jsonc existant sans perdre ses réglages', async () => {
    const dir = astroProject();
    const original = `// Site déjà sur Cloudflare
{
  "name": "site-existant",
  "compatibility_date": "2026-09-02",
  "routes": [{ "pattern": "exemple.fr", "custom_domain": true }],
  "assets": { "directory": "./dist" },
  "vars": { "PLAUSIBLE": "oui" },
}
`;
    writeFileSync(join(dir, 'wrangler.jsonc'), original);
    const { todo } = await init({
      dryRun: true,
      cwd: dir,
      deps: {
        ask: answers('Mon Site', '', 'exemple.fr', 'marie@exemple.fr'),
        log: () => {},
      },
    });
    const wrangler = readWranglerConfig(dir);
    expect(wrangler.name).toBe('site-existant');
    expect(wrangler.raw?.compatibility_date).toBe('2026-09-02');
    expect(wrangler.raw?.vars?.PLAUSIBLE).toBe('oui');
    expect(wrangler.raw?.main).toBe('worker/index.ts');
    expect(wrangler.raw?.assets).toMatchObject({
      directory: './dist',
      binding: 'ASSETS',
      run_worker_first: ['/api/*', '/media/*'],
    });
    expect(wrangler.databaseName).toBe('site-existant-cms');
    expect(wrangler.bucketName).toBe('site-existant-media');
    expect(wrangler.raw?.triggers?.crons).toEqual([
      '0 3 * * *',
      '*/10 * * * *',
    ]);
    expect(wrangler.adminEmails).toBe('marie@exemple.fr');
    expect(
      readFileSync(join(dir, 'wrangler.jsonc.avant-nohu-cms'), 'utf8'),
    ).toBe(original);
    expect(todo.join('\n')).not.toMatch(/point d’entrée/);
  });

  it('signale un point d’entrée Worker existant au lieu de l’écraser', async () => {
    const dir = astroProject();
    writeFileSync(
      join(dir, 'wrangler.jsonc'),
      '{ "name": "site", "main": "src/worker.ts", "routes": [{ "pattern": "exemple.fr", "custom_domain": true }] }',
    );
    const { todo } = await init({
      dryRun: true,
      cwd: dir,
      deps: {
        ask: answers('Site', '', 'exemple.fr', 'a@exemple.fr'),
        log: () => {},
      },
    });
    expect(readWranglerConfig(dir).raw?.main).toBe('src/worker.ts');
    expect(todo.join('\n')).toMatch(/src\/worker\.ts/);
    expect(todo.join('\n')).toMatch(/createCmsWorker/);
  });

  it('crée D1, R2 et l’application Access avec un jeton', async () => {
    const dir = astroProject();
    const calls: string[] = [];
    const requests: { url: string; body?: unknown }[] = [];
    await init({
      cwd: dir,
      deps: {
        ask: answers(
          'Mon Site',
          'mon-site',
          'exemple.fr',
          'marie@exemple.fr',
          'jeton',
        ),
        exec: (command, args) => {
          calls.push(args.join(' '));
          if (args[1] === 'whoami')
            return '│ Mon compte │ 0123456789abcdef0123456789abcdef │';
          if (args[2] === 'create' && args[1] === 'd1') {
            return '"database_id": "11111111-2222-4333-8444-555555555555"';
          }
          if (args[1] === 'd1' && args[2] === 'execute') {
            return args.includes('--json') ? '[{"results": []}]' : '';
          }
          return '';
        },
        fetch: (async (url: string, init?: RequestInit) => {
          requests.push({
            url,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          const result = url.endsWith('/organizations')
            ? { auth_domain: 'mon-equipe.cloudflareaccess.com' }
            : { aud: 'a'.repeat(64) };
          return Response.json({ success: true, result });
        }) as typeof fetch,
        log: () => {},
      },
    });
    expect(calls).toContain('wrangler d1 create mon-site-cms');
    expect(calls).toContain('wrangler r2 bucket create mon-site-media');
    expect(requests[1].body).toMatchObject({
      type: 'self_hosted',
      destinations: [
        { type: 'public', uri: 'exemple.fr/admin' },
        { type: 'public', uri: 'exemple.fr/api/admin' },
      ],
      policies: [
        {
          decision: 'allow',
          include: [{ email: { email: 'marie@exemple.fr' } }],
        },
      ],
    });
    const wrangler = readWranglerConfig(dir);
    expect(wrangler.accountId).toBe('0123456789abcdef0123456789abcdef');
    expect(wrangler.databaseId).toBe('11111111-2222-4333-8444-555555555555');
    expect(wrangler.accessTeamDomain).toBe(
      'https://mon-equipe.cloudflareaccess.com',
    );
    expect(wrangler.accessAud).toBe('a'.repeat(64));
  });
});

describe('templates', () => {
  it('ajoute l’import après les imports existants, sans déplacer // @ts-check', () => {
    const source =
      "// @ts-check\nimport { defineConfig } from 'astro/config';\nimport react from '@astrojs/react';\n\nexport default defineConfig({ integrations: [react()] });\n";
    expect(addIntegration(source)).toBe(
      "// @ts-check\nimport { defineConfig } from 'astro/config';\nimport react from '@astrojs/react';\nimport nohuCms from 'nohu-cms/astro';\n\nexport default defineConfig({ integrations: [nohuCms(), react()] });\n",
    );
  });

  it('ajoute l’intégration à une liste existante', () => {
    expect(
      addIntegration(
        "import x from 'x';\nexport default defineConfig({ integrations: [x()] });",
      ),
    ).toContain('integrations: [nohuCms(), x()]');
    expect(addIntegration('module.exports = {}')).toBeNull();
  });
});

describe('doctor', () => {
  it('signale chaque problème d’une config incomplète', () => {
    const dir = astroProject();
    writeFileSync(
      join(dir, 'wrangler.jsonc'),
      wranglerJsonc({
        name: 'mon-site',
        title: 'Mon site',
        accountId: '',
        domains: ['exemple.fr'],
        adminEmails: [],
        databaseId: '00000000-0000-0000-0000-000000000000',
        teamDomain: '',
        aud: '',
        compatibilityDate: '2026-10-15',
      }),
    );
    const checks = levels(checkFiles(dir, readWranglerConfig(dir)));
    expect(checks['Base D1 manquante (binding DB)']).toBe('error');
    expect(checks['CLOUDFLARE_ACCOUNT_ID manquant']).toBe('error');
    expect(checks['ADMIN_EMAILS vide : personne ne peut se connecter']).toBe(
      'error',
    );
    expect(checks['Cloudflare Access non configuré']).toBe('error');
    expect(checks['Point d’entrée worker/index.ts introuvable']).toBe('error');
    expect(checks['Intégration Astro absente : pas de page /admin']).toBe(
      'error',
    );
    expect(checks['Le Worker reçoit /api/* et /media/*']).toBe('ok');
    expect(
      checks['Suivi des mises en ligne (cron toutes les 10 minutes)'],
    ).toBe('ok');
  });

  it('alerte si l’API admin répond sans connexion', async () => {
    const db: D1Client = {
      kind: 'remote',
      query: async (sql) =>
        sql.includes('sqlite_master')
          ? [{ name: 'cms_migrations' }]
          : [{ name: '0001_init' }],
      exec: async () => {},
    };
    const checks = await checkRemote(
      { domains: ['ouvert.fr', 'protege.fr'] },
      {
        db,
        secrets: () => [],
        fetch: (async (url: string) =>
          url.includes('ouvert.fr')
            ? new Response('{}', { status: 200 })
            : new Response(null, {
                status: 302,
                headers: {
                  location:
                    'https://mon-equipe.cloudflareaccess.com/cdn-cgi/access/login',
                },
              })) as typeof fetch,
      },
    );
    const result = levels(checks);
    expect(result['Base D1 à jour']).toBe('ok');
    expect(result['ouvert.fr/api/admin répond sans connexion']).toBe('error');
    expect(result['protege.fr/api/admin protégé par Cloudflare Access']).toBe(
      'ok',
    );
    expect(
      result[
        'Secret DEPLOY_HOOK_URL absent : les modifications ne seront pas mises en ligne'
      ],
    ).toBe('error');
    expect(
      result[
        'Secret CMS_BUILDS_TOKEN absent : l’admin ne peut pas suivre les mises en ligne'
      ],
    ).toBe('warn');
  });
});

describe('doctor : suivi des mises en ligne', () => {
  it('signale un wrangler.jsonc sans cron de suivi', () => {
    const dir = astroProject();
    const source = wranglerJsonc({
      name: 'mon-site',
      title: 'Mon site',
      accountId: 'a'.repeat(32),
      domains: ['exemple.fr'],
      adminEmails: ['a@exemple.fr'],
      databaseId: '11111111-2222-4333-8444-555555555555',
      teamDomain: 'https://equipe.cloudflareaccess.com',
      aud: 'b'.repeat(64),
      compatibilityDate: '2026-10-01',
    }).replace(', "*/10 * * * *"', '');
    writeFileSync(join(dir, 'wrangler.jsonc'), source);
    const checks = levels(checkFiles(dir, readWranglerConfig(dir)));
    expect(
      checks['Pas de suivi des mises en ligne (cron toutes les 10 minutes)'],
    ).toBe('warn');
  });
});
