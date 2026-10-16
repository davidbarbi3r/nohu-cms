/**
 * `nohu-cms setup` : mise en service Cloudflare de bout en bout avec un seul
 * jeton API. Chaque étape vérifie l'existant avant d'agir : relancer la
 * commande ne change rien à ce qui est déjà en place. Aucun secret n'est
 * affiché ni écrit sur disque (hors wrangler.jsonc, qui n'en contient pas).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { remoteClient } from '../content/d1';
import { migrate } from '../content/migrate';
import { readWranglerConfig } from '../content/wrangler';
import { CloudflareError, cloudflareApi } from './cloudflare';
import type { Check } from './doctor';
import { accessApplication, bucketName, databaseName } from './templates';
import { setJsoncString } from './wrangler-edit';

export interface SetupOptions {
  cwd?: string;
  /** Jeton API Cloudflare (voir README : droits nécessaires). */
  token: string;
  fetch?: typeof fetch;
  log?: (line: string) => void;
  /**
   * Branche à déployer en production. Sans cette option, la branche actuelle
   * est seulement signalée : la changer met le site en ligne.
   */
  productionBranch?: string;
}

const PLACEHOLDER_ID = '00000000-0000-0000-0000-000000000000';

interface Trigger {
  trigger_uuid: string;
  trigger_name: string;
  branch_includes: string[];
  branch_excludes: string[];
  deploy_command: string;
}

interface AccessApp {
  id: string;
  aud: string;
  name: string;
  destinations?: { uri?: string }[];
  policies?: {
    id: string;
    name: string;
    decision: string;
    include: unknown[];
  }[];
}

export async function setup(options: SetupOptions) {
  const cwd = options.cwd ?? process.cwd();
  const fetcher = options.fetch ?? fetch;
  const log = options.log ?? ((line: string) => console.info(line));
  const api = cloudflareApi(options.token, fetcher);
  const checks: Check[] = [];
  const file = join(cwd, 'wrangler.jsonc');
  let source = readFileSync(file, 'utf8');
  const save = (key: string, value: string) => {
    source = setJsoncString(source, key, value);
    writeFileSync(file, source);
  };

  const wrangler = readWranglerConfig(cwd);
  let accountId = wrangler.accountId ?? '';
  if (!/^[0-9a-f]{32}$/.test(accountId) || /^0+$/.test(accountId)) {
    const accounts = await api.get<{ id: string; name: string }[]>('/accounts');
    if (accounts.length !== 1) {
      throw new Error(
        `Le jeton donne accès à ${accounts.length} comptes : renseigne vars.CLOUDFLARE_ACCOUNT_ID dans wrangler.jsonc.`,
      );
    }
    accountId = accounts[0].id;
    save('CLOUDFLARE_ACCOUNT_ID', accountId);
  }
  const name = wrangler.name ?? '';
  const A = `/accounts/${accountId}`;

  // Base D1 : réutilisée si elle existe déjà sous ce nom.
  let databaseId = wrangler.databaseId ?? '';
  if (!databaseId || databaseId === PLACEHOLDER_ID) {
    const dbName = wrangler.databaseName || databaseName(name);
    const existing = await api.get<{ uuid: string }[]>(
      `${A}/d1/database?name=${encodeURIComponent(dbName)}`,
    );
    databaseId =
      existing[0]?.uuid ??
      (await api.post<{ uuid: string }>(`${A}/d1/database`, { name: dbName }))
        .uuid;
    save('database_id', databaseId);
    checks.push({ level: 'ok', label: `Base D1 « ${dbName} » créée` });
  }
  const applied = await migrate(
    remoteClient({ accountId, databaseId, token: options.token }, fetcher),
  );
  checks.push({
    level: 'ok',
    label: applied.length
      ? `Migrations appliquées : ${applied.join(', ')}`
      : 'Base D1 à jour',
  });

  // Stockage R2 des photos.
  const bucket = wrangler.bucketName || bucketName(name);
  try {
    await api.get(`${A}/r2/buckets/${bucket}`);
  } catch (error) {
    if (!(error instanceof CloudflareError) || error.status !== 404)
      throw error;
    await api.post(`${A}/r2/buckets`, { name: bucket });
    checks.push({ level: 'ok', label: `Stockage R2 « ${bucket} » créé` });
  }

  // Cloudflare Access : une application par site, règle = ADMIN_EMAILS.
  const emails = (wrangler.adminEmails ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);
  const organization = await api
    .get<{ auth_domain: string }>(`${A}/access/organizations`)
    .catch((error) => {
      if (error instanceof CloudflareError && error.status === 404) return null;
      throw error;
    });
  if (!organization) {
    checks.push({
      level: 'error',
      label: 'Cloudflare Zero Trust n’est pas activé sur ce compte',
      fix: 'Tableau de bord → Zero Trust : choisis un nom d’équipe (offre gratuite), puis relance npx nohu-cms setup.',
    });
  } else {
    const teamDomain = `https://${organization.auth_domain}`;
    const adminUris = wrangler.domains.flatMap((domain) => [
      `${domain}/admin`,
      `${domain}/api/admin`,
    ]);
    const include = emails.map((email) => ({ email: { email } }));
    const apps = await api.get<AccessApp[]>(`${A}/access/apps`);
    let app = apps.find((candidate) =>
      (candidate.destinations ?? []).some((destination) =>
        adminUris.includes(destination.uri ?? ''),
      ),
    );
    if (!app) {
      app = await api.post<AccessApp>(
        `${A}/access/apps`,
        accessApplication({
          name,
          title: name,
          accountId,
          domains: wrangler.domains,
          adminEmails: emails,
          databaseId,
          teamDomain,
          aud: '',
          compatibilityDate: '',
        }),
      );
      checks.push({
        level: 'ok',
        label: `Application Access « ${app.name} » créée`,
      });
    } else {
      const policy = app.policies?.[0];
      if (
        policy &&
        JSON.stringify(policy.include) !== JSON.stringify(include)
      ) {
        await api.put(`${A}/access/apps/${app.id}/policies/${policy.id}`, {
          name: policy.name,
          decision: policy.decision,
          include,
        });
        checks.push({
          level: 'ok',
          label: 'Règle Access mise à jour (ADMIN_EMAILS)',
        });
      }
    }
    if (wrangler.accessTeamDomain !== teamDomain)
      save('ACCESS_TEAM_DOMAIN', teamDomain);
    if (wrangler.accessAud !== app.aud) save('ACCESS_AUD', app.aud);
    checks.push({
      level: 'ok',
      label: `Admin protégée par Cloudflare Access (${organization.auth_domain})`,
    });
  }

  // Jetons et secrets : build (lecture/écriture D1) et suivi des builds.
  const createToken = async (label: string, permission: string) => {
    const groups = await api.get<{ id: string; name: string }[]>(
      `${A}/tokens/permission_groups`,
    );
    const group = groups.find((candidate) => candidate.name === permission);
    if (!group) throw new Error(`Droit « ${permission} » introuvable.`);
    return api.post<{ id: string; value: string }>(`${A}/tokens`, {
      name: `${name} — ${label} (nohu-cms)`,
      policies: [
        {
          effect: 'allow',
          resources: { [`com.cloudflare.api.account.${accountId}`]: '*' },
          permission_groups: [{ id: group.id }],
        },
      ],
    });
  };

  const scripts = await api.get<{ id: string; tag: string }[]>(
    `${A}/workers/scripts`,
  );
  const script = scripts.find((candidate) => candidate.id === name);
  if (!script) {
    checks.push({
      level: 'error',
      label: `Worker « ${name} » introuvable`,
      fix: 'Connecte le dépôt Git : Workers & Pages → Create → Import a repository (nom du Worker identique à « name » de wrangler.jsonc), puis relance npx nohu-cms setup.',
    });
  } else {
    const triggers = await api.get<Trigger[]>(
      `${A}/builds/workers/${script.tag}/triggers`,
    );
    const production = triggers.find((trigger) =>
      /wrangler deploy\b/.test(trigger.deploy_command),
    );
    if (!production) {
      checks.push({
        level: 'error',
        label: 'Aucun build de production (npx wrangler deploy)',
        fix: 'Worker → Paramètres → Builds : choisis une branche de production et la commande de déploiement « npx wrangler deploy ».',
      });
    } else if (
      options.productionBranch &&
      !production.branch_includes.includes(options.productionBranch)
    ) {
      const previous = production.branch_includes;
      await api.patch(`${A}/builds/triggers/${production.trigger_uuid}`, {
        branch_includes: [options.productionBranch],
      });
      for (const trigger of triggers) {
        if (trigger === production) continue;
        await api.patch(`${A}/builds/triggers/${trigger.trigger_uuid}`, {
          branch_excludes: [
            ...trigger.branch_excludes.filter(
              (branch) => !previous.includes(branch),
            ),
            options.productionBranch,
          ],
        });
      }
      checks.push({
        level: 'ok',
        label: `Branche de production : ${options.productionBranch} (au lieu de ${previous.join(', ')})`,
      });
    } else {
      const branches = production.branch_includes.join(', ');
      checks.push(
        ['main', 'master'].some((branch) =>
          production.branch_includes.includes(branch),
        )
          ? { level: 'ok', label: `Branche de production : ${branches}` }
          : {
              level: 'warn',
              label: `Branche de production : ${branches}`,
              fix: 'Pour déployer une autre branche (ex. main) : npx nohu-cms setup --production-branch main',
            },
      );
    }

    let buildToken: { value: string } | null = null;
    for (const trigger of triggers) {
      const variables = await api.get<Record<string, unknown>>(
        `${A}/builds/triggers/${trigger.trigger_uuid}/environment_variables`,
      );
      if ('CMS_API_TOKEN' in variables) continue;
      buildToken ??= await createToken('build', 'D1 Write');
      await api.patch(
        `${A}/builds/triggers/${trigger.trigger_uuid}/environment_variables`,
        { CMS_API_TOKEN: { value: buildToken.value, is_secret: true } },
      );
    }
    if (buildToken) {
      checks.push({
        level: 'ok',
        label: 'Secret de build CMS_API_TOKEN posé (D1 Write)',
      });
    }

    const secrets = await api.get<{ name: string }[]>(
      `${A}/workers/scripts/${name}/secrets`,
    );
    if (!secrets.some((secret) => secret.name === 'DEPLOY_HOOK_URL')) {
      checks.push({
        level: 'warn',
        label:
          'Secret DEPLOY_HOOK_URL absent : l’admin ne peut pas republier le site',
        fix: 'Cloudflare ne permet pas de créer le hook par l’API : Worker → Paramètres → Builds → Deploy Hooks → Add (branche de production), puis npx nohu-cms set-hook <url>.',
      });
    }
    if (!secrets.some((secret) => secret.name === 'CMS_BUILDS_TOKEN')) {
      const token = await createToken('suivi des builds', 'Workers CI Read');
      try {
        await api.put(`${A}/workers/scripts/${name}/secrets`, {
          name: 'CMS_BUILDS_TOKEN',
          text: token.value,
          type: 'secret_text',
        });
        checks.push({
          level: 'ok',
          label: 'Secret CMS_BUILDS_TOKEN posé (suivi des mises en ligne)',
        });
      } catch (error) {
        await api.delete(`${A}/tokens/${token.id}`);
        if (!(error instanceof CloudflareError) || error.status >= 500)
          throw error;
        checks.push({
          level: 'warn',
          label: 'Secret CMS_BUILDS_TOKEN pas encore posé',
          fix: 'Cloudflare refuse les secrets tant que le Worker ne sert que des fichiers statiques : relance npx nohu-cms setup après le premier déploiement.',
        });
      }
    }
  }

  for (const check of checks) {
    log(
      `${check.level === 'ok' ? '✓' : check.level === 'warn' ? '!' : '✖'} ${check.label}`,
    );
    if (check.fix) log(`    → ${check.fix}`);
  }
  return { checks };
}

/** Droits du jeton API demandé par `nohu-cms setup` (compte uniquement). */
export const SETUP_TOKEN_RIGHTS = [
  'Compte → D1 → Modifier',
  'Compte → Workers R2 Storage → Modifier',
  'Compte → Access: Apps and Policies → Modifier',
  'Compte → Account API Tokens → Modifier (crée les jetons du build et du suivi)',
  'Compte → Workers CI → Modifier (secrets de build, branche de production)',
  'Compte → Workers Scripts → Modifier (secrets du Worker)',
];

/**
 * `nohu-cms setup [--production-branch <branche>]` : jeton lu dans
 * CLOUDFLARE_API_TOKEN. Renvoie le code de sortie (1 si un point bloque).
 */
export async function setupCommand(
  args: string[],
  env: Record<string, string | undefined>,
  options: {
    cwd?: string;
    fetch?: typeof fetch;
    log?: (line: string) => void;
  } = {},
): Promise<number> {
  const log = options.log ?? ((line: string) => console.info(line));
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    log(
      [
        'Crée un jeton API (Mon profil → Jetons d’API → Créer un jeton personnalisé, ou Gérer le compte → Jetons d’API du compte) avec :',
        ...SETUP_TOKEN_RIGHTS.map((right) => `  • ${right}`),
        'puis lance : CLOUDFLARE_API_TOKEN=<jeton> npx nohu-cms setup',
        'Le jeton n’est ni affiché ni enregistré ; tu peux le supprimer une fois la mise en service terminée.',
      ].join('\n'),
    );
    return 1;
  }
  const index = args.indexOf('--production-branch');
  const { checks } = await setup({
    cwd: options.cwd,
    token,
    fetch: options.fetch,
    log,
    productionBranch: index >= 0 ? args[index + 1] : undefined,
  });
  log('\nVérifie ensuite le tout : npx nohu-cms doctor');
  return checks.some((check) => check.level === 'error') ? 1 : 0;
}
