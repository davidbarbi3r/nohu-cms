/**
 * `nohu-cms doctor` : vérifie la configuration d'un site, des fichiers
 * jusqu'à Cloudflare, et explique en français comment corriger chaque point.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { wranglerClient, type D1Client } from '../content/d1';
import { pendingMigrations } from '../content/migrate';
import { readWranglerConfig, type WranglerValues } from '../content/wrangler';

export type Level = 'ok' | 'warn' | 'error';

export interface Check {
  level: Level;
  label: string;
  /** Comment corriger (pour warn / error). */
  fix?: string;
}

const PLACEHOLDER_ID = '00000000-0000-0000-0000-000000000000';

const ok = (label: string): Check => ({ level: 'ok', label });
const warn = (label: string, fix: string): Check => ({
  level: 'warn',
  label,
  fix,
});
const error = (label: string, fix: string): Check => ({
  level: 'error',
  label,
  fix,
});

/** Vérifications sans réseau : fichiers du projet. */
export function checkFiles(cwd: string, wrangler: WranglerValues): Check[] {
  const checks: Check[] = [];
  const raw = wrangler.raw;
  if (!raw) {
    return [
      error(
        'wrangler.jsonc introuvable',
        'Lance « npx nohu-cms init » à la racine du projet.',
      ),
    ];
  }
  checks.push(ok(`wrangler.jsonc : Worker « ${raw.name ?? '?'} »`));

  if (!raw.main) {
    checks.push(
      error(
        'Pas de point d’entrée Worker (main)',
        'Ajoute "main": "worker/index.ts" dans wrangler.jsonc.',
      ),
    );
  } else if (!existsSync(join(cwd, raw.main))) {
    checks.push(
      error(
        `Point d’entrée ${raw.main} introuvable`,
        'Crée le Worker : export default createCmsWorker(config) (voir README).',
      ),
    );
  } else {
    const source = readFileSync(join(cwd, raw.main), 'utf8');
    checks.push(
      source.includes('createCmsWorker')
        ? ok(`Worker ${raw.main} : createCmsWorker`)
        : error(
            `${raw.main} n’utilise pas createCmsWorker`,
            'Exporte createCmsWorker(config) depuis nohu-cms/worker.',
          ),
    );
  }

  const first = raw.assets?.run_worker_first;
  const routed = Array.isArray(first) ? first : [];
  checks.push(
    routed.includes('/api/*') && routed.includes('/media/*')
      ? ok('Le Worker reçoit /api/* et /media/*')
      : error(
          'assets.run_worker_first incomplet',
          'Mets "run_worker_first": ["/api/*", "/media/*"] dans assets.',
        ),
  );

  checks.push(
    wrangler.databaseId && wrangler.databaseId !== PLACEHOLDER_ID
      ? ok(`Base D1 « ${wrangler.databaseName} » (binding DB)`)
      : error(
          'Base D1 manquante (binding DB)',
          'Crée-la : npx wrangler d1 create <nom>-cms, puis reporte database_id dans wrangler.jsonc.',
        ),
  );
  checks.push(
    wrangler.bucketName
      ? ok(`Stockage R2 « ${wrangler.bucketName} » (binding MEDIA)`)
      : error(
          'Stockage R2 manquant (binding MEDIA)',
          'Crée-le : npx wrangler r2 bucket create <nom>-media, puis ajoute r2_buckets dans wrangler.jsonc.',
        ),
  );
  checks.push(
    wrangler.accountId
      ? ok('CLOUDFLARE_ACCOUNT_ID renseigné')
      : error(
          'CLOUDFLARE_ACCOUNT_ID manquant',
          'Ajoute vars.CLOUDFLARE_ACCOUNT_ID (npx wrangler whoami) : le build en a besoin pour lire D1.',
        ),
  );

  const emails = (wrangler.adminEmails ?? '').split(',').filter(Boolean);
  checks.push(
    emails.length
      ? ok(`Admins autorisés : ${emails.join(', ')}`)
      : error(
          'ADMIN_EMAILS vide : personne ne peut se connecter',
          'Renseigne vars.ADMIN_EMAILS (emails séparés par des virgules).',
        ),
  );
  checks.push(
    wrangler.accessTeamDomain?.startsWith('https://') && wrangler.accessAud
      ? ok('Cloudflare Access configuré (ACCESS_TEAM_DOMAIN, ACCESS_AUD)')
      : error(
          'Cloudflare Access non configuré',
          'Crée l’application Access de l’admin, puis renseigne ACCESS_TEAM_DOMAIN (https://<équipe>.cloudflareaccess.com) et ACCESS_AUD dans wrangler.jsonc.',
        ),
  );
  checks.push(
    raw.triggers?.crons?.length
      ? ok('Nettoyage automatique des photos (cron)')
      : warn(
          'Pas de cron : les photos inutilisées ne seront jamais supprimées',
          'Ajoute "triggers": { "crons": ["0 3 * * *"] } dans wrangler.jsonc.',
        ),
  );
  checks.push(
    raw.triggers?.crons?.includes('*/10 * * * *')
      ? ok('Suivi des mises en ligne (cron toutes les 10 minutes)')
      : warn(
          'Pas de suivi des mises en ligne (cron toutes les 10 minutes)',
          'Ajoute "*/10 * * * *" à triggers.crons : le Worker vérifie alors le dernier build et alerte s’il échoue (ALERT_WEBHOOK_URL).',
        ),
  );
  checks.push(
    wrangler.domains.length
      ? ok(`Domaines : ${wrangler.domains.join(', ')}`)
      : warn(
          'Aucun domaine dans routes',
          'Ajoute les domaines du site (routes, custom_domain: true).',
        ),
  );

  const astroConfig = [
    'astro.config.mjs',
    'astro.config.ts',
    'astro.config.js',
  ].find((file) => existsSync(join(cwd, file)));
  checks.push(
    astroConfig &&
      readFileSync(join(cwd, astroConfig), 'utf8').includes('nohu-cms/astro')
      ? ok('Intégration Astro nohu-cms (page /admin)')
      : error(
          'Intégration Astro absente : pas de page /admin',
          "Dans astro.config : import nohuCms from 'nohu-cms/astro', puis integrations: [nohuCms()].",
        ),
  );
  checks.push(
    existsSync(join(cwd, 'cms.config.ts'))
      ? ok('cms.config.ts présent')
      : error('cms.config.ts introuvable', 'Crée la config avec defineCms().'),
  );

  const gitignore = existsSync(join(cwd, '.gitignore'))
    ? readFileSync(join(cwd, '.gitignore'), 'utf8').split('\n')
    : [];
  if (!gitignore.includes('.dev.vars')) {
    checks.push(
      warn(
        '.dev.vars n’est pas ignoré par Git',
        'Ajoute .dev.vars à .gitignore.',
      ),
    );
  }
  return checks;
}

export interface RemoteDeps {
  db: D1Client;
  /** Noms des secrets du Worker. */
  secrets: () => string[];
  fetch: typeof fetch;
  /** Jeton facultatif (droit Access: Apps and Policies Read) pour vérifier l'application Access. */
  token?: string;
}

/** Vérifications en ligne : base, secrets, protection effective de l'admin. */
export async function checkRemote(
  wrangler: WranglerValues,
  deps: RemoteDeps,
): Promise<Check[]> {
  const checks: Check[] = [];

  try {
    const pending = await pendingMigrations(deps.db, undefined, {
      readOnly: true,
    });
    checks.push(
      pending.length
        ? warn(
            `Migrations en attente : ${pending.map((m) => m.name).join(', ')}`,
            'Elles seront appliquées au prochain build, ou tout de suite : npx nohu-cms migrate --remote.',
          )
        : ok('Base D1 à jour'),
    );
  } catch (caught) {
    checks.push(
      error(
        'Base D1 inaccessible',
        `${(caught as Error).message.split('\n')[0]} — vérifie database_id et « npx wrangler login ».`,
      ),
    );
  }

  try {
    const secrets = deps.secrets();
    checks.push(
      secrets.includes('DEPLOY_HOOK_URL')
        ? ok('Secret DEPLOY_HOOK_URL posé (mise en ligne automatique)')
        : error(
            'Secret DEPLOY_HOOK_URL absent : les modifications ne seront pas mises en ligne',
            'Crée un deploy hook (Worker → Paramètres → Builds → Deploy Hooks), puis : npx nohu-cms set-hook <url>.',
          ),
    );
    if (!secrets.includes('CMS_BUILDS_TOKEN')) {
      checks.push(
        warn(
          'Secret CMS_BUILDS_TOKEN absent : l’admin ne peut pas suivre les mises en ligne',
          'npx nohu-cms setup le crée (jeton « Workers CI Read »), ou : npx wrangler secret put CMS_BUILDS_TOKEN.',
        ),
      );
    }
  } catch {
    checks.push(
      warn(
        'Secrets du Worker illisibles (Worker pas encore déployé ?)',
        'Déploie une première fois, puis relance doctor.',
      ),
    );
  }

  for (const domain of wrangler.domains) {
    try {
      const response = await deps.fetch(`https://${domain}/api/admin/me`, {
        redirect: 'manual',
      });
      const location = response.headers.get('location') ?? '';
      // Redirection vers un autre domaine du site (ex. exemple.fr → www) :
      // c'est ce domaine-là qui est vérifié.
      const target = URL.canParse(location) ? new URL(location).hostname : '';
      if (response.status === 200) {
        checks.push(
          error(
            `${domain}/api/admin répond sans connexion`,
            'Protège /admin et /api/admin avec l’application Access du site, IMMÉDIATEMENT.',
          ),
        );
      } else if (
        [301, 302, 303].includes(response.status) &&
        location.includes('cloudflareaccess.com')
      ) {
        checks.push(ok(`${domain}/api/admin protégé par Cloudflare Access`));
      } else if (
        [301, 302, 303, 307, 308].includes(response.status) &&
        target !== domain &&
        wrangler.domains.includes(target)
      ) {
        checks.push(ok(`${domain} redirige vers ${target}`));
      } else {
        checks.push(
          warn(
            `${domain}/api/admin répond ${response.status} sans passer par Access`,
            'L’API refuse quand même (jeton vérifié par le Worker), mais ajoute /api/admin aux destinations de l’application Access.',
          ),
        );
      }
    } catch {
      checks.push(
        warn(
          `${domain} injoignable`,
          'Le domaine n’est peut-être pas encore relié au Worker.',
        ),
      );
    }
  }

  if (deps.token && wrangler.accountId && wrangler.accessAud) {
    try {
      const response = await deps.fetch(
        `https://api.cloudflare.com/client/v4/accounts/${wrangler.accountId}/access/apps?per_page=1000`,
        { headers: { Authorization: `Bearer ${deps.token}` } },
      );
      const payload = (await response.json()) as {
        result?: {
          aud: string;
          name: string;
          domain?: string;
          destinations?: { uri?: string }[];
        }[];
      };
      const app = payload.result?.find(
        (candidate) => candidate.aud === wrangler.accessAud,
      );
      if (!app) {
        checks.push(
          error(
            'Aucune application Access ne correspond à ACCESS_AUD',
            'Copie l’« Application Audience (AUD) Tag » de l’application de ce site dans wrangler.jsonc.',
          ),
        );
      } else {
        const uris = new Set(
          [app.domain, ...(app.destinations ?? []).map((d) => d.uri)].filter(
            Boolean,
          ),
        );
        const missing = wrangler.domains
          .flatMap((domain) => [`${domain}/admin`, `${domain}/api/admin`])
          .filter((uri) => !uris.has(uri));
        checks.push(
          missing.length
            ? error(
                `Application Access « ${app.name} » : destinations manquantes`,
                `Ajoute : ${missing.join(', ')}`,
              )
            : ok(`Application Access « ${app.name} » couvre l’admin`),
        );
      }
    } catch {
      checks.push(
        warn(
          'Application Access non vérifiée',
          'Jeton CLOUDFLARE_API_TOKEN sans le droit « Access: Apps and Policies Read » ?',
        ),
      );
    }
  }
  return checks;
}

const ICONS: Record<Level, string> = { ok: '✓', warn: '!', error: '✖' };

export function report(checks: Check[], log = console.info): boolean {
  for (const check of checks) {
    log(`${ICONS[check.level]} ${check.label}`);
    if (check.fix) log(`    → ${check.fix}`);
  }
  const errors = checks.filter((check) => check.level === 'error').length;
  const warnings = checks.filter((check) => check.level === 'warn').length;
  log(
    `\n${errors ? `${errors} problème(s) à corriger` : 'Aucun problème bloquant'}${warnings ? `, ${warnings} avertissement(s)` : ''}.`,
  );
  return errors === 0;
}

export async function doctor(cwd = process.cwd()) {
  const wrangler = readWranglerConfig(cwd);
  console.info('\nnohu-cms doctor\n\nFichiers du projet');
  const checks = checkFiles(cwd, wrangler);
  report(checks);
  if (!wrangler.raw) {
    process.exitCode = 1;
    return;
  }
  console.info('\nCloudflare');
  const remote = await checkRemote(wrangler, {
    db: wranglerClient(cwd, 'remote'),
    secrets: () => {
      const output = execFileSync(
        'npx',
        ['wrangler', 'secret', 'list', '--format', 'json'],
        { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      return (JSON.parse(output) as { name: string }[]).map(
        (secret) => secret.name,
      );
    },
    fetch,
    token: process.env.CLOUDFLARE_API_TOKEN,
  });
  const healthy = report(remote) && checks.every((c) => c.level !== 'error');
  if (!healthy) process.exitCode = 1;
}
