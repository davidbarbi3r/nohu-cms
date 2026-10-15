/**
 * Worker du site : fichiers statiques (dist/), API de l'admin (/api/admin/*)
 * et photos (/media/*). Voir nohu-cms.
 */
import { createCmsWorker } from 'nohu-cms/worker';
import config from '../cms.config';

export default createCmsWorker(config);
