/**
 * Construit l'admin (Preact + TipTap inclus) en un seul fichier JS et un CSS :
 * le site qui utilise nohu-cms n'a besoin ni de Preact ni de TipTap.
 */
import { build } from 'esbuild';

await build({
  entryPoints: { admin: 'src/admin/main.tsx' },
  outdir: 'dist/admin',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022', 'safari16'],
  jsx: 'automatic',
  jsxImportSource: 'preact',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});
