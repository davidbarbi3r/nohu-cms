/** Config du site (cms.config.ts), transmise par la page /admin. */
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { CmsConfig } from '../config';

export const ConfigContext = createContext<CmsConfig>({
  admin: { title: '' },
  pages: {},
});

export const useConfig = () => useContext(ConfigContext);
