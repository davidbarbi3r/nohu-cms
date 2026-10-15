/**
 * CLI nohu-cms : installation et maintenance d'un site.
 *
 *   npx nohu-cms init        installe nohu-cms dans un projet Astro existant
 *   npx nohu-cms doctor      vérifie la configuration (locale et Cloudflare)
 *   npx nohu-cms dev         admin en local (D1/R2 locales, rebuild auto)
 *   npx nohu-cms migrate     applique les migrations (--local ou --remote)
 *   npx nohu-cms set-hook    enregistre l'URL du deploy hook (secret du Worker)
 *   npx nohu-cms skill       copie le skill Claude dans .claude/skills/
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wranglerClient } from '../content/d1';
import { migrate } from '../content/migrate';
import { dev } from './dev';
import { doctor } from './doctor';
import { init } from './init';

const HELP = `nohu-cms — admin de contenu pour sites Astro sur Cloudflare

Commandes :
  init [--dry-run]          installe nohu-cms dans le projet Astro courant
  doctor                    vérifie la configuration du site
  dev [--port 8788]         admin en local sur http://localhost:8788/admin
  migrate [--local|--remote] applique les migrations de la base D1
  set-hook <url>            enregistre l'URL du deploy hook Workers Builds
  skill                     copie le skill Claude « nohu-cms-setup » dans .claude/skills/
`;

const packageRoot = () =>
  join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function option(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(argv: string[]) {
  const [command, ...args] = argv;
  switch (command) {
    case 'init':
      return init({ dryRun: args.includes('--dry-run') });
    case 'doctor':
      return doctor();
    case 'dev':
      return dev({ port: Number(option(args, '--port') ?? 8788) });
    case 'migrate': {
      const target = args.includes('--remote') ? 'remote' : 'local';
      const applied = await migrate(wranglerClient(process.cwd(), target));
      console.info(
        applied.length
          ? `Migrations appliquées (${target}) : ${applied.join(', ')}`
          : `Base ${target} déjà à jour.`,
      );
      return;
    }
    case 'set-hook': {
      const url = args[0];
      if (
        !url ||
        !/^https:\/\/api\.cloudflare\.com\/.+deploy_hooks\//.test(url)
      ) {
        throw new Error(
          'Donne l’URL du deploy hook : Worker → Paramètres → Builds → Deploy Hooks (https://api.cloudflare.com/…/deploy_hooks/…).',
        );
      }
      execFileSync('npx', ['wrangler', 'secret', 'put', 'DEPLOY_HOOK_URL'], {
        input: url,
        stdio: ['pipe', 'inherit', 'inherit'],
      });
      return;
    }
    case 'skill': {
      const source = join(packageRoot(), 'skills', 'nohu-cms-setup');
      const target = join(process.cwd(), '.claude', 'skills', 'nohu-cms-setup');
      if (!existsSync(source))
        throw new Error('Skill introuvable dans le package.');
      cpSync(source, target, { recursive: true });
      console.info(`Skill copié dans ${target}`);
      return;
    }
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.info(HELP);
      return;
    default:
      console.error(`Commande inconnue : ${command}\n\n${HELP}`);
      process.exitCode = 1;
  }
}

main(process.argv.slice(2)).catch((error: Error) => {
  console.error(`\n✖ ${error.message}`);
  process.exitCode = 1;
});
