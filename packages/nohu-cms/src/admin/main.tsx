/**
 * Point d'entrée de l'admin (précompilée dans dist/admin). La page /admin,
 * injectée par l'intégration Astro, fournit la config du site en JSON.
 */
import { render } from 'preact';
import type { CmsConfig } from '../config';
import App from './App';
import './admin.css';

const source = document.getElementById('nohu-config');
const root = document.getElementById('nohu-admin');
if (source && root) {
  const config = JSON.parse(source.textContent ?? '{}') as CmsConfig;
  if (config.admin.brandColor) {
    document.documentElement.style.setProperty(
      '--brand',
      config.admin.brandColor,
    );
  }
  render(<App config={config} />, root);
}
