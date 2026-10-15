/** Config du site (cms.config.ts) et aperçus des images, transmis par la page /admin. */
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { CmsConfig } from '../config';

export const ConfigContext = createContext<CmsConfig>({
  admin: { title: '' },
  pages: {},
});

export const useConfig = () => useContext(ConfigContext);

/** Vignettes des images du projet (`asset:…` → adresse générée au build). */
export const PreviewContext = createContext<Record<string, string>>({});

/** Adresse affichable d'une image, y compris une image du projet. */
export function usePreview() {
  const previews = useContext(PreviewContext);
  return (src: string) =>
    previews[src] ?? (src.startsWith('asset:') ? '' : src);
}
