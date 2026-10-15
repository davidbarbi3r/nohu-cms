/** Fichiers écrits par `nohu-cms init` dans le projet du site. */

export interface SiteSettings {
  /** Nom du Worker et préfixe des ressources (minuscules, tirets). */
  name: string;
  title: string;
  accountId: string;
  domains: string[];
  adminEmails: string[];
  databaseId: string;
  teamDomain: string;
  aud: string;
  compatibilityDate: string;
}

export const databaseName = (name: string) => `${name}-cms`;
export const bucketName = (name: string) => `${name}-media`;

export function wranglerJsonc(site: SiteSettings): string {
  const routes = site.domains
    .map((domain) => `    { "pattern": "${domain}", "custom_domain": true },`)
    .join('\n');
  return `// Worker « ${site.name} » : site statique (dist/) + API de l'admin nohu-cms.
// Vérifier la configuration : npx nohu-cms doctor
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "${site.name}",
  "main": "worker/index.ts",
  "compatibility_date": "${site.compatibilityDate}",
  "compatibility_flags": ["global_fetch_strictly_public"],
  "routes": [
${routes}
  ],
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    // Le Worker ne s'exécute d'abord que pour l'API et les photos ;
    // tout le reste est servi directement comme fichier statique.
    "run_worker_first": ["/api/*", "/media/*"],
  },
  "observability": { "enabled": true },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "${databaseName(site.name)}",
      "database_id": "${site.databaseId}",
    },
  ],
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "${bucketName(site.name)}" }],
  // Nettoyage quotidien des photos qui ne servent plus.
  "triggers": { "crons": ["0 3 * * *"] },
  "vars": {
    // Seule liste des comptes autorisés dans l'admin (à garder identique à la règle Access).
    "ADMIN_EMAILS": "${site.adminEmails.join(',')}",
    // Domaine d'équipe Cloudflare Access (Zero Trust).
    "ACCESS_TEAM_DOMAIN": "${site.teamDomain}",
    // « Application Audience (AUD) Tag » de l'application Access de ce site (non secret).
    "ACCESS_AUD": "${site.aud}",
    // Compte Cloudflare : lu par le build pour interroger D1.
    "CLOUDFLARE_ACCOUNT_ID": "${site.accountId}",
  },
}
`;
}

export function cmsConfig(title: string): string {
  return `/**
 * Contenus modifiables dans l'admin (/admin). Les valeurs écrites ici sont
 * les valeurs d'origine : l'admin ne stocke que ce qui en diffère.
 * Lire dans une page : \`const content = await getContent(config)\`.
 */
import {
  collection,
  defineCms,
  image,
  page,
  richtext,
  section,
  text,
  textarea,
} from 'nohu-cms';

export default defineCms({
  admin: { title: ${JSON.stringify(title)} },
  pages: {
    accueil: page('Accueil', '/', {
      hero: section('Haut de page', {
        title: text('Titre', ${JSON.stringify(title)}, { max: 70 }),
        intro: textarea('Introduction', 'Une phrase pour présenter le site.'),
      }),
    }),
  },
  collections: {
    articles: collection('Articles', {
      itemLabel: 'un article',
      path: '/blog/[slug]',
      fields: {
        summary: textarea('Résumé', '', {
          max: 220,
          help: 'Deux ou trois phrases, affichées dans la liste des articles.',
        }),
        cover: image('Photo de couverture'),
        body: richtext('Texte'),
      },
    }),
  },
});
`;
}

export const workerIndex = `/**
 * Worker du site : fichiers statiques (dist/), API de l'admin (/api/admin/*)
 * et photos (/media/*). Voir nohu-cms.
 */
import { createCmsWorker } from 'nohu-cms/worker';
import config from '../cms.config';

export default createCmsWorker(config);
`;

export const workerTsconfig = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["./**/*.ts", "../cms.config.ts"]
}
`;

export const devVars = (email: string) =>
  `# Admin locale (npx nohu-cms dev). Jamais commité.
# Email simulé : la connexion Cloudflare Access est contournée sur localhost
# uniquement, et l'email doit figurer dans ADMIN_EMAILS (wrangler.jsonc).
DEV_ADMIN_EMAIL=${email}
`;

/** Ajoute l'intégration dans astro.config.* ; `null` si le fichier ne s'y prête pas. */
export function addIntegration(source: string): string | null {
  if (source.includes('nohu-cms/astro')) return source;
  // Après le dernier import : les commentaires de tête (// @ts-check) restent en tête.
  const statement = "import nohuCms from 'nohu-cms/astro';\n";
  const imports = [...source.matchAll(/^import .+;?$/gm)];
  const last = imports[imports.length - 1];
  const at = last ? last.index! + last[0].length + 1 : 0;
  const withImport = source.slice(0, at) + statement + source.slice(at);
  if (/integrations\s*:\s*\[/.test(source)) {
    return withImport.replace(
      /integrations\s*:\s*\[/,
      (match) => `${match}nohuCms(), `,
    );
  }
  if (/defineConfig\(\s*\{/.test(source)) {
    return withImport.replace(
      /defineConfig\(\s*\{/,
      (match) => `${match}\n  integrations: [nohuCms()],`,
    );
  }
  return null;
}

/** Corps de la création de l'application Access (API Cloudflare). */
export function accessApplication(site: SiteSettings) {
  return {
    type: 'self_hosted',
    name: `Admin ${site.title}`,
    domain: `${site.domains[0]}/admin`,
    destinations: site.domains.flatMap((domain) => [
      { type: 'public', uri: `${domain}/admin` },
      { type: 'public', uri: `${domain}/api/admin` },
    ]),
    session_duration: '24h',
    app_launcher_visible: false,
    policies: [
      {
        name: `Admins ${site.title}`,
        decision: 'allow',
        include: site.adminEmails.map((email) => ({ email: { email } })),
      },
    ],
  };
}
