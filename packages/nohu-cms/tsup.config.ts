import { defineConfig } from 'tsup';

/** Modules Node / Worker du package. L'admin est construite à part (scripts/build-admin.mjs). */
export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      'content/index': 'src/content/index.ts',
      'worker/index': 'src/worker/index.ts',
      'astro/index': 'src/astro/index.ts',
    },
    format: 'esm',
    dts: true,
    clean: true,
    target: 'es2022',
    external: ['astro', 'virtual:nohu-cms/config'],
  },
  {
    entry: { 'cli/index': 'src/cli/index.ts' },
    format: 'esm',
    platform: 'node',
    target: 'node20',
    banner: { js: '#!/usr/bin/env node' },
  },
]);
