/**
 * `nohu-cms setup` (issue #16) : mise en service Cloudflare de bout en bout
 * avec un seul jeton. Testé contre un faux API Cloudflare en mémoire.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setup, setupCommand } from '../src/cli/setup';
import { wranglerJsonc } from '../src/cli/templates';
import { readWranglerConfig } from '../src/content/wrangler';
import {
  fakeCloudflare,
  type FakeCloudflareOptions,
} from './helpers/cloudflare-api';

const ACCOUNT = 'acc0123456789abcdef0123456789abc';
const dirs: string[] = [];

function project(values: Partial<Parameters<typeof wranglerJsonc>[0]> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nohu-setup-'));
  dirs.push(dir);
  writeFileSync(
    join(dir, 'wrangler.jsonc'),
    wranglerJsonc({
      name: 'mon-site',
      title: 'Mon site',
      accountId: ACCOUNT,
      domains: ['exemple.fr', 'www.exemple.fr'],
      adminEmails: ['marie@exemple.fr', 'dev@exemple.fr'],
      databaseId: '00000000-0000-0000-0000-000000000000',
      teamDomain: '',
      aud: '',
      compatibilityDate: '2026-09-15',
      ...values,
    }),
  );
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

async function run(
  dir: string,
  cloudflare: ReturnType<typeof fakeCloudflare>,
  options = {},
) {
  const logs: string[] = [];
  const result = await setup({
    cwd: dir,
    token: 'jeton-setup',
    fetch: cloudflare.fetch,
    log: (line) => logs.push(line),
    ...options,
  });
  return { ...result, logs };
}

const fake = (options: FakeCloudflareOptions = {}) =>
  fakeCloudflare({ account: ACCOUNT, ...options });

describe('nohu-cms setup', () => {
  it('crée la base D1, applique les migrations et inscrit son id dans wrangler.jsonc', async () => {
    const dir = project();
    const cloudflare = fake();
    await run(dir, cloudflare);

    expect(cloudflare.state.databases).toHaveLength(1);
    const [db] = cloudflare.state.databases;
    expect(db.name).toBe('mon-site-cms');
    expect(readWranglerConfig(dir).databaseId).toBe(db.uuid);
    const tables = db.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining(['cms_content', 'cms_entries', 'cms_migrations']),
    );
    // Les commentaires de wrangler.jsonc sont conservés.
    expect(readFileSync(join(dir, 'wrangler.jsonc'), 'utf8')).toContain(
      '// Seule liste des comptes autorisés',
    );
  });

  it('crée le stockage R2 s’il manque, sans toucher à un stockage existant', async () => {
    const dir = project();
    const cloudflare = fake();
    await run(dir, cloudflare);
    expect([...cloudflare.state.buckets]).toEqual(['mon-site-media']);

    const creations = () =>
      cloudflare.state.requests.filter(
        (r) => r.method === 'POST' && r.path.endsWith('/r2/buckets'),
      ).length;
    const before = creations();
    await run(dir, cloudflare);
    expect(creations()).toBe(before);
  });

  it('protège l’admin avec Cloudflare Access et inscrit domaine d’équipe et AUD', async () => {
    const dir = project();
    const cloudflare = fake();
    await run(dir, cloudflare);

    expect(cloudflare.state.apps).toHaveLength(1);
    const [app] = cloudflare.state.apps;
    expect(app.destinations.map((d) => d.uri)).toEqual([
      'exemple.fr/admin',
      'exemple.fr/api/admin',
      'www.exemple.fr/admin',
      'www.exemple.fr/api/admin',
    ]);
    expect(app.policies[0].include).toEqual([
      { email: { email: 'marie@exemple.fr' } },
      { email: { email: 'dev@exemple.fr' } },
    ]);
    const wrangler = readWranglerConfig(dir);
    expect(wrangler.accessTeamDomain).toBe(
      'https://equipe.cloudflareaccess.com',
    );
    expect(wrangler.accessAud).toBe(app.aud);
  });

  it('réutilise l’application Access et resynchronise la liste des admins', async () => {
    const dir = project();
    const cloudflare = fake();
    await run(dir, cloudflare);
    const file = join(dir, 'wrangler.jsonc');
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace(
        'marie@exemple.fr,dev@exemple.fr',
        'marie@exemple.fr',
      ),
    );
    await run(dir, cloudflare);
    expect(cloudflare.state.apps).toHaveLength(1);
    expect(cloudflare.state.apps[0].policies[0].include).toEqual([
      { email: { email: 'marie@exemple.fr' } },
    ]);
  });

  it('explique comment activer Zero Trust s’il ne l’est pas', async () => {
    const dir = project();
    const { checks } = await run(dir, fake({ teamDomain: null }));
    const access = checks.find((check) => check.label.includes('Zero Trust'));
    expect(access?.level).toBe('error');
    expect(access?.fix).toMatch(/Zero Trust/);
  });

  it('pose les jetons de build et de suivi, sans jamais les afficher', async () => {
    const dir = project();
    const cloudflare = fake();
    const { logs } = await run(dir, cloudflare);

    const d1 = cloudflare.state.tokens.find((token) =>
      token.permissions.includes('pg-d1-write'),
    );
    const ci = cloudflare.state.tokens.find((token) =>
      token.permissions.includes('pg-ci-read'),
    );
    expect(d1 && ci).toBeTruthy();
    for (const trigger of cloudflare.state.triggers) {
      expect(trigger.env.CMS_API_TOKEN).toEqual({
        value: d1!.value,
        is_secret: true,
      });
    }
    expect(cloudflare.state.secrets.get('CMS_BUILDS_TOKEN')).toBe(ci!.value);
    const output = logs.join('\n');
    for (const token of cloudflare.state.tokens)
      expect(output).not.toContain(token.value);

    await run(dir, cloudflare);
    expect(cloudflare.state.tokens).toHaveLength(2);
  });

  it('Worker pas encore déployé : n’abandonne pas de jeton et demande de relancer', async () => {
    const dir = project();
    const cloudflare = fake({
      worker: { name: 'mon-site', tag: 'tag-mon-site', deployed: false },
    });
    const { checks } = await run(dir, cloudflare);
    expect(cloudflare.state.secrets.size).toBe(0);
    expect(
      cloudflare.state.tokens.some((token) =>
        token.permissions.includes('pg-ci-read'),
      ),
    ).toBe(false);
    const pending = checks.find((check) =>
      check.label.includes('CMS_BUILDS_TOKEN'),
    );
    expect(pending?.level).toBe('warn');
    expect(pending?.fix).toMatch(/premier déploiement/);
  });

  it('signale la branche de production sans la changer d’office', async () => {
    const dir = project();
    const cloudflare = fake({
      triggers: [
        {
          trigger_uuid: 'prod',
          trigger_name: 'prod',
          branch_includes: ['coming-soon'],
          branch_excludes: [],
          build_command: 'bun run build',
          deploy_command: 'npx wrangler deploy',
        },
        {
          trigger_uuid: 'preview',
          trigger_name: 'preview',
          branch_includes: ['*'],
          branch_excludes: ['coming-soon'],
          build_command: 'bun run build',
          deploy_command: 'npx wrangler versions upload',
        },
      ],
    });
    const { checks } = await run(dir, cloudflare);
    expect(
      checks.find((check) => check.label.startsWith('Branche de production')),
    ).toMatchObject({
      level: 'warn',
      label: 'Branche de production : coming-soon',
    });
    expect(cloudflare.state.triggers[0].branch_includes).toEqual([
      'coming-soon',
    ]);
  });

  it('change la branche de production sur demande explicite', async () => {
    const dir = project();
    const cloudflare = fake({
      triggers: [
        {
          trigger_uuid: 'prod',
          trigger_name: 'prod',
          branch_includes: ['coming-soon'],
          branch_excludes: [],
          build_command: 'bun run build',
          deploy_command: 'npx wrangler deploy',
        },
        {
          trigger_uuid: 'preview',
          trigger_name: 'preview',
          branch_includes: ['*'],
          branch_excludes: ['coming-soon'],
          build_command: 'bun run build',
          deploy_command: 'npx wrangler versions upload',
        },
      ],
    });
    await run(dir, cloudflare, { productionBranch: 'main' });
    expect(cloudflare.state.triggers[0].branch_includes).toEqual(['main']);
    expect(cloudflare.state.triggers[1].branch_excludes).toEqual(['main']);
  });

  it('guide la création du deploy hook, faute d’API', async () => {
    const dir = project();
    const { checks } = await run(dir, fake());
    const hook = checks.find((check) =>
      check.label.includes('DEPLOY_HOOK_URL'),
    );
    expect(hook?.level).toBe('warn');
    expect(hook?.fix).toMatch(/Deploy Hooks/);
    expect(hook?.fix).toMatch(/set-hook/);
  });

  it('Worker introuvable : explique comment connecter le dépôt', async () => {
    const dir = project();
    const { checks } = await run(dir, fake({ worker: null }));
    expect(
      checks.find((check) => check.label.includes('introuvable'))?.fix,
    ).toMatch(/Import a repository/);
  });

  it('un second passage ne modifie rien', async () => {
    const dir = project();
    const cloudflare = fake();
    await run(dir, cloudflare);
    cloudflare.state.secrets.set(
      'DEPLOY_HOOK_URL',
      'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/x',
    );
    const before = cloudflare.state.requests.length;
    await run(dir, cloudflare);
    const writes = cloudflare.state.requests
      .slice(before)
      .filter((r) => r.method !== 'GET' && !r.path.endsWith('/query'));
    expect(writes).toEqual([]);
  });

  it('retrouve le compte Cloudflare s’il manque dans wrangler.jsonc', async () => {
    const dir = project({ accountId: '00000000000000000000000000000000' });
    await run(dir, fake());
    expect(readWranglerConfig(dir).accountId).toBe(ACCOUNT);
  });

  it('commande : sans jeton, explique quel jeton créer et ses droits', async () => {
    const logs: string[] = [];
    const code = await setupCommand(
      [],
      {},
      { log: (line) => logs.push(line), cwd: project() },
    );
    expect(code).toBe(1);
    const output = logs.join('\n');
    for (const right of [
      'D1',
      'Workers R2 Storage',
      'Access: Apps and Policies',
      'Account API Tokens',
      'Workers CI',
      'Workers Scripts',
    ]) {
      expect(output).toContain(right);
    }
    expect(output).toContain('CLOUDFLARE_API_TOKEN');
  });

  it('commande : passe la branche de production et signale les erreurs bloquantes', async () => {
    const dir = project();
    const cloudflare = fake({ teamDomain: null });
    const code = await setupCommand(
      ['--production-branch', 'main'],
      { CLOUDFLARE_API_TOKEN: 'jeton-setup' },
      { log: () => {}, cwd: dir, fetch: cloudflare.fetch },
    );
    expect(code).toBe(1);
  });
});
