import nohuCms from 'nohu-cms/astro';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [nohuCms()],
  site: 'https://exemple.test',
  output: 'static',
  trailingSlash: 'never',
});
