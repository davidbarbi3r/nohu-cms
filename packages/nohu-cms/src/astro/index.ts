/**
 * Intégration Astro : ajoute la page /admin, générée depuis cms.config.ts.
 *
 *   import nohuCms from 'nohu-cms/astro';
 *   export default defineConfig({ integrations: [nohuCms()] });
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { AstroIntegration } from 'astro';

export interface NohuCmsOptions {
  /** Chemin de la config, depuis la racine du projet. Défaut : `./cms.config.ts`. */
  config?: string;
  /** Adresse de l'admin. Défaut : `/admin` (à protéger par Cloudflare Access). */
  route?: string;
}

const VIRTUAL_ID = 'virtual:nohu-cms/config';

export default function nohuCms(
  options: NohuCmsOptions = {},
): AstroIntegration {
  return {
    name: 'nohu-cms',
    hooks: {
      'astro:config:setup': ({ config, injectRoute, updateConfig }) => {
        const root = fileURLToPath(config.root);
        const configPath = resolve(root, options.config ?? './cms.config.ts');
        // `nohu-cms dev` construit à côté puis remplace dist/ d'un coup.
        const outDir = process.env.NOHU_CMS_OUT_DIR;
        injectRoute({
          pattern: options.route ?? '/admin',
          entrypoint: 'nohu-cms/AdminPage.astro',
          prerender: true,
        });
        updateConfig({
          ...(outDir ? { outDir: new URL(`${outDir}/`, config.root) } : {}),
          vite: {
            plugins: [
              {
                name: 'nohu-cms:config',
                resolveId: (id) =>
                  id === VIRTUAL_ID ? `\0${VIRTUAL_ID}` : undefined,
                load: (id) =>
                  id === `\0${VIRTUAL_ID}`
                    ? `export { default } from ${JSON.stringify(configPath)};`
                    : undefined,
              },
            ],
            ssr: { noExternal: ['nohu-cms'] },
          },
        });
      },
    },
  };
}
