/**
 * Point d'entrée de l'admin (précompilée dans dist/admin). La page /admin,
 * injectée par l'intégration Astro, fournit en JSON la config du site et les
 * vignettes des images du projet.
 */
import { render } from 'preact';
import type { CmsConfig } from '../config';
import App from './App';
import './admin.css';

const source = document.getElementById('nohu-config');
const root = document.getElementById('nohu-admin');
if (source && root) {
  const { config, previews } = JSON.parse(source.textContent ?? '{}') as {
    config: CmsConfig;
    previews: Record<string, string>;
  };
  if (config.admin.brandColor) {
    document.documentElement.style.setProperty(
      '--brand',
      config.admin.brandColor,
    );
  }
  render(<App config={config} previews={previews} />, root);
}
