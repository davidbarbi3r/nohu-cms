/**
 * `nohu-cms init` : installe nohu-cms dans un projet Astro existant.
 *
 * Fait le déterministe (fichiers, base D1, stockage R2, application Access si
 * un jeton est fourni, migrations) puis affiche les étapes restantes du
 * tableau de bord Cloudflare. L'accès D1 et l'activation de R2 sont vérifiés
 * avant toute question et toute création. Toutes les valeurs liées au compte
 * vont dans les fichiers du site (wrangler.jsonc), jamais ailleurs.
 */
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { slugify } from '../config';
import { wranglerClient, type Exec } from '../content/d1';
import { parseJsonc } from '../content/jsonc';
import { migrate } from '../content/migrate';
import type { WranglerFile } from '../content/wrangler';
import {
  accessApplication,
  addIntegration,
  bucketName,
  cmsConfig,
  databaseName,
  devVars,
  mergeWrangler,
  workerIndex,
  workerTsconfig,
  wranglerJsonc,
  type SiteSettings,
} from './templates';

export interface InitDeps {
  ask: (question: string, fallback?: string) => Promise<string>;
  /** Lance une commande et renvoie sa sortie. */
  exec: Exec;
  fetch: typeof fetch;
  log: (message: string) => void;
}

export interface InitOptions {
  dryRun?: boolean;
  cwd?: string;
  deps?: Partial<InitDeps>;
}

const PLACEHOLDER_ID = '00000000-0000-0000-0000-000000000000';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const ACCOUNT_ID = /\b[0-9a-f]{32}\b/g;

/** Questions dans le terminal ; réponses lues d'un bloc si l'entrée est un pipe. */
function terminalPrompt() {
  let rl: ReturnType<typeof createInterface> | undefined;
  let piped: Promise<string[]> | undefined;
  const readPiped = async () => {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    return input.split('\n');
  };
  return {
    async ask(question: string, fallback?: string) {
      const prompt = `? ${question}${fallback ? ` (${fallback})` : ''} : `;
      let answer: string;
      if (process.stdin.isTTY) {
        rl ??= createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        answer = await rl.question(prompt);
      } else {
        piped ??= readPiped();
        answer = (await piped).shift() ?? '';
        console.info(`${prompt}${answer}`);
      }
      return answer.trim() || fallback || '';
    },
    close: () => rl?.close(),
  };
}

function defaultDeps(cwd: string): InitDeps & { close: () => void } {
  const prompt = terminalPrompt();
  return {
    ask: prompt.ask,
    close: prompt.close,
    exec: (command, args) =>
      execFileSync(command, args, {
        cwd,
        encoding: 'utf8',
        stdio: ['inherit', 'pipe', 'pipe'],
      }),
    fetch,
    log: (message) => console.info(message),
  };
}

function wranglerDetail(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error);
  const failed = error as {
    stdout?: unknown;
    stderr?: unknown;
    message?: unknown;
  };
  const text = [failed.stdout, failed.stderr]
    .map((part) =>
      typeof part === 'string'
        ? part
        : part instanceof Uint8Array
          ? new TextDecoder().decode(part)
          : '',
    )
    .filter(Boolean)
    .join('\n')
    .trim();
  return text || String(failed.message ?? error);
}

/** Liste D1 et buckets R2 : échoue avant de créer quoi que ce soit. */
function ensureD1AndR2Access(deps: InitDeps, accountId: string) {
  deps.log('• Vérification de l’accès D1 et de R2…');
  const problems: string[] = [];
  try {
    deps.exec('npx', ['wrangler', 'd1', 'list', '--json']);
  } catch (error) {
    problems.push(
      `D1 inaccessible avec cette session wrangler.\n${wranglerDetail(error)}\nRelance « npx wrangler login » avec un compte qui a le droit D1.`,
    );
  }
  try {
    deps.exec('npx', ['wrangler', 'r2', 'bucket', 'list']);
  } catch (error) {
    const detail = wranglerDetail(error);
    problems.push(
      /10042|enable R2/i.test(detail)
        ? `R2 n’est pas activé sur ce compte. Active-le : https://dash.cloudflare.com/${accountId}/r2\nPuis relance npx nohu-cms init.\n${detail}`
        : `R2 inaccessible avec cette session wrangler.\n${detail}`,
    );
  }
  if (problems.length) {
    throw new Error(
      `Vérification Cloudflare interrompue, rien n’a été créé.\n\n${problems.join('\n\n')}`,
    );
  }
}

function readPackageName(cwd: string) {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    return { name: String(pkg.name ?? ''), pkg };
  } catch {
    return { name: '', pkg: null };
  }
}

const list = (value: string) =>
  value
    .split(/[,\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

interface CloudflareResult<T> {
  success: boolean;
  result: T;
  errors?: { message: string }[];
}

async function cloudflare<T>(
  deps: InitDeps,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await deps.fetch(
    `https://api.cloudflare.com/client/v4${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
  );
  const payload = (await response
    .json()
    .catch(() => null)) as CloudflareResult<T> | null;
  if (!response.ok || !payload?.success) {
    const detail = payload?.errors?.map((error) => error.message).join(', ');
    throw new Error(`API Cloudflare ${path} (${response.status}) : ${detail}`);
  }
  return payload.result;
}

export async function init(options: InitOptions = {}) {
  const cwd = options.cwd ?? process.cwd();
  const deps = { ...defaultDeps(cwd), ...options.deps };
  try {
    return await run(cwd, deps, Boolean(options.dryRun));
  } finally {
    deps.close();
  }
}

async function run(cwd: string, deps: InitDeps, dryRun: boolean) {
  const { log } = deps;
  const todo: string[] = [];

  // 1. Projet Astro
  const { name: packageName, pkg } = readPackageName(cwd);
  const astroConfig = [
    'astro.config.mjs',
    'astro.config.ts',
    'astro.config.js',
  ].find((file) => existsSync(join(cwd, file)));
  if (!pkg || !astroConfig) {
    throw new Error(
      'Lance cette commande à la racine d’un projet Astro (package.json et astro.config.* introuvables).',
    );
  }
  // Site déjà sur Cloudflare : sa config est complétée, pas remplacée.
  const wranglerPath = join(cwd, 'wrangler.jsonc');
  const existing = existsSync(wranglerPath)
    ? (parseJsonc(readFileSync(wranglerPath, 'utf8')) as WranglerFile)
    : null;
  log(dryRun ? '\nnohu-cms init (simulation)\n' : '\nnohu-cms init\n');

  // 2. Compte Cloudflare
  let accountId = PLACEHOLDER_ID.replace(/-/g, '');
  if (!dryRun) {
    let whoami: string;
    try {
      whoami = deps.exec('npx', ['wrangler', 'whoami']);
    } catch {
      throw new Error(
        'wrangler n’est pas connecté. Lance « npx wrangler login » puis recommence.',
      );
    }
    const accounts = [...new Set(whoami.match(ACCOUNT_ID) ?? [])];
    if (!accounts.length) {
      throw new Error(
        'Aucun compte Cloudflare trouvé : lance « npx wrangler login ».',
      );
    }
    accountId =
      accounts.length === 1
        ? accounts[0]
        : await deps.ask(
            `Plusieurs comptes Cloudflare (${accounts.join(', ')}). Account ID à utiliser`,
            accounts[0],
          );
    ensureD1AndR2Access(deps, accountId);
  }

  // 3. Questions
  const title = await deps.ask(
    'Nom du site (affiché dans l’admin)',
    packageName || 'Mon site',
  );
  const name = slugify(
    await deps.ask(
      'Nom technique du Worker (minuscules et tirets)',
      existing?.name || slugify(packageName || title),
    ),
  );
  const domains = list(
    await deps.ask(
      'Domaine(s) du site, séparés par des virgules (ex. exemple.fr, www.exemple.fr)',
    ),
  ).map((domain) => domain.replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
  const adminEmails = list(
    await deps.ask('Email(s) des personnes qui modifieront le site'),
  );
  if (!domains.length) throw new Error('Il faut au moins un domaine.');
  if (!adminEmails.length) throw new Error('Il faut au moins un email admin.');

  const site: SiteSettings = {
    name,
    title,
    accountId,
    domains,
    adminEmails,
    databaseId: PLACEHOLDER_ID,
    teamDomain: '',
    aud: '',
    // Un mois en arrière : le runtime local d'un wrangler un peu ancien
    // refuse une date plus récente que lui.
    compatibilityDate: new Date(Date.now() - 30 * 86_400_000)
      .toISOString()
      .slice(0, 10),
  };

  // 4. Base D1 et stockage R2
  if (dryRun) {
    log(`• créerait la base D1 « ${databaseName(name)} »`);
    log(`• créerait le stockage R2 « ${bucketName(name)} »`);
  } else {
    log(`• Création de la base D1 « ${databaseName(name)} »…`);
    const created = deps.exec('npx', [
      'wrangler',
      'd1',
      'create',
      databaseName(name),
    ]);
    const id = created.match(UUID)?.[0];
    if (!id) {
      throw new Error(
        `Identifiant de la base introuvable dans la réponse de wrangler :\n${created}`,
      );
    }
    site.databaseId = id;
    log(`• Création du stockage R2 « ${bucketName(name)} »…`);
    deps.exec('npx', ['wrangler', 'r2', 'bucket', 'create', bucketName(name)]);
  }

  // 5. Cloudflare Access
  const token = dryRun
    ? ''
    : await deps.ask(
        'Jeton API Cloudflare avec le droit « Access: Apps and Policies Edit » pour créer la protection de /admin (Entrée pour le faire à la main)',
      );
  if (token) {
    const organization = await cloudflare<{ auth_domain: string }>(
      deps,
      token,
      `/accounts/${accountId}/access/organizations`,
    ).catch(() => null);
    if (!organization?.auth_domain) {
      todo.push(
        'Activer Cloudflare Zero Trust (gratuit) : tableau de bord → Zero Trust, choisir un nom d’équipe. Puis relancer la création de l’application Access (voir ci-dessous).',
      );
    } else {
      site.teamDomain = `https://${organization.auth_domain}`;
      const app = await cloudflare<{ aud: string }>(
        deps,
        token,
        `/accounts/${accountId}/access/apps`,
        { method: 'POST', body: JSON.stringify(accessApplication(site)) },
      );
      site.aud = app.aud;
      log(`• Application Access « Admin ${title} » créée.`);
    }
  }
  if (!site.aud) {
    todo.push(
      [
        `Protéger l’admin avec Cloudflare Access : Zero Trust → Access → Applications → Add an application → Self-hosted.`,
        `  Nom : Admin ${title} ; destinations : ${domains.flatMap((domain) => [`${domain}/admin`, `${domain}/api/admin`]).join(', ')}`,
        `  Règle : Allow, Emails = ${adminEmails.join(', ')} (connexion par code reçu par email).`,
        `  Puis reporter dans wrangler.jsonc : ACCESS_TEAM_DOMAIN (https://<équipe>.cloudflareaccess.com) et ACCESS_AUD (« Application Audience (AUD) Tag »).`,
      ].join('\n'),
    );
  }

  // 6. Fichiers du site
  const write = (file: string, content: string) => {
    const path = join(cwd, file);
    if (existsSync(path)) {
      log(`• ${file} existe déjà : laissé tel quel.`);
      return;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    log(`• ${file} écrit.`);
  };
  if (existing) {
    const backup = 'wrangler.jsonc.avant-nohu-cms';
    copyFileSync(wranglerPath, join(cwd, backup));
    writeFileSync(
      wranglerPath,
      `// Complété par nohu-cms init (ancienne version : ${backup}).\n// Vérifier la configuration : npx nohu-cms doctor\n${JSON.stringify(mergeWrangler(existing, site), null, 2)}\n`,
    );
    log(`• wrangler.jsonc complété (copie de l’original : ${backup}).`);
  } else {
    write('wrangler.jsonc', wranglerJsonc(site));
  }
  const customMain =
    existing?.main && existing.main !== 'worker/index.ts'
      ? existing.main
      : null;
  if (customMain) {
    todo.push(
      `Ton Worker ${customMain} existe déjà : fais-lui exporter createCmsWorker(config, { fetch: ton gestionnaire actuel }) (import depuis nohu-cms/worker), pour ajouter l’API de l’admin sans perdre tes routes.`,
    );
  }
  write('cms.config.ts', cmsConfig(title));
  if (!customMain) {
    write('worker/index.ts', workerIndex);
    write('worker/tsconfig.json', workerTsconfig);
  }
  write('.dev.vars', devVars(adminEmails[0]));
  write('.dev.vars.example', devVars(adminEmails[0]));

  const gitignore = join(cwd, '.gitignore');
  const ignored = existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : '';
  const missing = ['.dev.vars', '.wrangler/'].filter(
    (entry) => !ignored.split('\n').includes(entry),
  );
  if (missing.length) {
    appendFileSync(
      gitignore,
      `${ignored.endsWith('\n') || !ignored ? '' : '\n'}${missing.join('\n')}\n`,
    );
    log(`• .gitignore : ${missing.join(', ')} ajouté(s).`);
  }

  const astroPath = join(cwd, astroConfig);
  const updated = addIntegration(readFileSync(astroPath, 'utf8'));
  if (updated) {
    writeFileSync(astroPath, updated);
    log(`• ${astroConfig} : intégration nohu-cms ajoutée.`);
  } else {
    todo.push(
      `Ajouter l’intégration dans ${astroConfig} : import nohuCms from 'nohu-cms/astro'; puis integrations: [nohuCms()].`,
    );
  }

  pkg.scripts = {
    ...pkg.scripts,
    'dev:admin': pkg.scripts?.['dev:admin'] ?? 'nohu-cms dev',
    'db:migrate:remote':
      pkg.scripts?.['db:migrate:remote'] ?? 'nohu-cms migrate --remote',
    'cms:doctor': pkg.scripts?.['cms:doctor'] ?? 'nohu-cms doctor',
  };
  writeFileSync(join(cwd, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  log('• package.json : scripts dev:admin, db:migrate:remote, cms:doctor.');
  const installed = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!installed.wrangler || !installed['@cloudflare/workers-types']) {
    todo.unshift(
      'Installer les outils Cloudflare : npm i -D wrangler @cloudflare/workers-types',
    );
  }

  // 7. Migrations
  if (!dryRun) {
    log('• Création des tables (local et Cloudflare)…');
    await migrate(wranglerClient(cwd, 'local', deps.exec));
    await migrate(wranglerClient(cwd, 'remote', deps.exec));
  }

  // 8. Étapes restantes
  todo.push(
    [
      'Connecter le dépôt Git au Worker : Workers & Pages → Create → Import a repository.',
      '  Commande de build : npm run build ; commande de déploiement : npx wrangler deploy.',
    ].join('\n'),
    [
      'Terminer la mise en service Cloudflare (Access, secrets CMS_API_TOKEN et CMS_BUILDS_TOKEN, branche de production) :',
      '  CLOUDFLARE_API_TOKEN=<jeton> npx nohu-cms setup   (sans jeton, la commande liste les droits nécessaires)',
    ].join('\n'),
    [
      'Après le premier déploiement : Worker → Paramètres → Builds → Deploy Hooks → créer un hook sur la branche principale, puis :',
      '  npx nohu-cms set-hook <URL du hook>',
    ].join('\n'),
    'Vérifier le tout : npx nohu-cms doctor',
  );
  log('\nÉtapes restantes :');
  todo.forEach((step, index) => log(`\n${index + 1}. ${step}`));
  log(
    `\nAdmin locale : npm run dev:admin, puis http://localhost:8788/admin (connecté en tant que ${adminEmails[0]}).\n`,
  );
  return { site, todo };
}
