# nohu-cms — spec de conception

Date : 2026-10-15 · Statut : validée

## 1. Objectif

Reproduire en moins d'une heure, sur n'importe quel site Astro statique, le
système d'admin mis en place pour Gao Mata : textes, images et articles
modifiables par un client non technique, stockés dans D1 et R2, avec
reconstruction automatique du site sur Cloudflare.

- **Pour qui** : sites vitrines de clients non techniques ; 5+ sites à un an
  (offre récurrente). Utilisable par d'autres développeurs (open source).
- **Distribution** : package npm public `nohu-cms` (licence MIT), versionné en
  semver. Un correctif de la lib arrive sur un site par `npm update`.
- **Gao Mata** : n'est pas migré. Il sert de référence et de source de code à
  extraire (voir §12).

### Critères de réussite

1. Sur un site Astro existant, `npx nohu-cms init` + les étapes manuelles
   affichées suffisent à avoir un `/admin` fonctionnel en production en < 1 h.
2. Un site client ne contient que : `cms.config.ts`, ses pages, un Worker de
   3 lignes, `wrangler.jsonc`. Aucune copie du code de l'admin ou de l'API.
3. Ajouter un champ (page ou collection) = une ligne dans `cms.config.ts`,
   sans migration SQL ni formulaire à écrire.
4. Le package publié ne contient aucune valeur liée à un compte Cloudflare
   (vérifié par un test).
5. Chaque site est isolé : un admin du site A ne peut ni lire ni écrire sur
   le site B, même si les deux sont sur le même compte Cloudflare.

### Hors v1

Multilingue (contenu et interface : l'admin est en français, tutoiement),
admin centralisée multi-sites, aperçu avant publication, rôles, historique des
versions, médiathèque navigable, tables SQL propres au site.

## 2. Ce que contient un site client

```
cms.config.ts      defineCms({ admin, pages, collections })
astro.config.mjs   integrations: [nohuCms()]
worker/index.ts    export default createCmsWorker(config)
wrangler.jsonc     généré par `init` (bindings, Access, ADMIN_EMAILS, cron)
.dev.vars          DEV_ADMIN_EMAIL (local uniquement, généré par `init`)
src/pages/…        getContent(config), getEntries(config, 'articles'), <CmsImage>
```

Exemple :

```ts
// cms.config.ts
import { defineCms, page, section, collection, text, textarea, richtext, image, date, list } from 'nohu-cms';

export default defineCms({
  admin: { title: 'Atelier Dupont', brandColor: '#2f5d50' },
  pages: {
    accueil: page('Accueil', '/', {
      hero: section('Haut de page', {
        title: text('Titre', 'Bienvenue', { max: 70 }),
        photo: image('Photo', { src: '/images/hero.jpg', alt: 'Atelier vu de la rue' }),
      }),
    }),
  },
  collections: {
    articles: collection('Articles', {
      itemLabel: 'un article',
      path: '/blog/[slug]',
      fields: {
        summary: textarea('Résumé', '', { max: 220 }),
        cover: image('Photo de couverture', null, { optional: true }),
        body: richtext('Texte'),
      },
    }),
  },
});
```

```astro
---
import config from '../../cms.config';
import { getContent } from 'nohu-cms/content';
import CmsImage from 'nohu-cms/components/CmsImage.astro';
const content = await getContent(config);
---
<h1>{content.accueil.hero.title}</h1>
<CmsImage image={content.accueil.hero.photo} sizes="100vw" />
```

`getContent(config)` est typé par inférence sur la config : pas de génération
de code.

## 3. Modèle de contenu

Repris de `src/cms/fields.ts` de Gao Mata, étendu.

| Type        | Valeur                                       | Notes |
| ----------- | -------------------------------------------- | ----- |
| `text`      | string                                       | `max` |
| `textarea`  | string                                       | `max`, rendu avec `<Lines>` / `toParagraphs()` |
| `richtext`  | HTML (string)                                | éditeur TipTap, nettoyé au build (`sanitizeRichText`) |
| `url`       | string                                       | validé |
| `email`     | string                                       | validé |
| `date`      | `AAAA-MM-JJ`                                 | |
| `image`     | `{ src, alt, width?, height?, mediaId? }`    | voir §5 |
| `list`      | tableau d'objets de champs scalaires/`image` | `itemLabel`, `itemTitle`, `min`, `max` |

Options communes : `help`, `optional`, `max`.

- **Pages** : `page(label, path | null, sections)` → `section(label, fields, help?)`.
  Clé de stockage `page.section.champ` (identique à Gao Mata).
- **Collections** : `collection(label, { itemLabel, path, fields, sort? })`.
  Chaque entrée a d'office : `id`, `title`, `slug` (généré depuis le titre,
  modifiable), `status` (`draft` | `published`), `publishedAt`, plus les
  champs déclarés. `path` sert aux liens « Voir sur le site » de l'admin et à
  `getEntryPath()`.
- La config est sérialisable (pas de fonctions) : elle est transmise telle
  quelle à l'admin et au Worker. La validation dépend du type de champ et vit
  dans la lib (`validateValue`, partagée build / admin / Worker).
- **Renommer / supprimer un champ** : l'ancienne valeur stockée est ignorée et
  le build l'écrit dans ses logs (`[nohu-cms] valeur ignorée : …`), comme Gao
  Mata. Documenté dans le README.

## 4. Stockage D1

Migrations livrées dans le package (`nohu-cms/migrations`). Les migrations de la
lib sont uniquement additives ; une nouvelle migration = version mineure au
minimum, documentée dans le CHANGELOG.

```sql
cms_content (key TEXT PK, value TEXT, updated_at, updated_by)
  -- seulement les valeurs différentes de la valeur d'origine ; JSON pour list/image
cms_entries (id TEXT PK, collection TEXT, slug TEXT, status TEXT CHECK (draft|published),
             title TEXT, published_at TEXT, data TEXT /* JSON */, created_at, updated_at, updated_by,
             UNIQUE (collection, slug))
cms_media   (id TEXT PK, width INT, height INT, created_at, created_by)
cms_meta    (key TEXT PK, value TEXT)  -- dernière publication
cms_migrations (name TEXT PK, applied_at TEXT)
```

Les migrations sont appliquées par la lib elle-même (§4 bis) : pas de
`migrations_dir` dans `wrangler.jsonc`.

## 5. Images

- **Upload** (admin) : le navigateur redimensionne la photo (code de
  `CoverUpload.tsx`) en WebP, 3 largeurs : 640, 1280, 2048 (sans agrandir).
  `POST /api/admin/media` reçoit les variantes ; le Worker les écrit dans R2
  sous `media/<id>/<largeur>.webp` et crée la ligne `cms_media`.
- **Diffusion** : `/media/*` servi par le Worker depuis R2 (bucket privé),
  `Cache-Control: immutable` (code de `worker/routes/media.ts`).
- **Rendu** : `<CmsImage image sizes loading?>` produit `<img srcset>` avec
  `width`/`height` (pas de décalage de mise en page). Une image d'origine
  (`src` dans `public/`) est rendue telle quelle.
- **Texte riche** : l'éditeur peut insérer une image (même flux d'upload) ;
  `sanitizeRichText` n'autorise `<img>` que si `src` commence par `/media/`.
- **Nettoyage** : un cron du Worker (quotidien) supprime de R2 et de
  `cms_media` les médias qu'aucune valeur de `cms_content` ni de
  `cms_entries` (y compris le HTML riche) ne référence, après 24 h (logique de
  `removeOrphanCovers`).

## 6. Worker

```ts
// worker/index.ts du site
import config from '../cms.config';
import { createCmsWorker } from 'nohu-cms/worker';
export default createCmsWorker(config);
// option : createCmsWorker(config, { fetch: (req, env, ctx) => … }) pour des routes propres au site
```

`createCmsWorker` renvoie `{ fetch, scheduled }` :

- `/api/admin/*` : contrôle d'origine sur les écritures → `authenticate()`
  (jeton Access vérifié avec `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD`, puis email
  dans `ADMIN_EMAILS` ; `DEV_ADMIN_EMAIL` accepté uniquement sur localhost) →
  routeur. Code repris de `worker/index.ts` et `worker/auth.ts`.
- `/media/*` : lecture R2.
- reste : handler du site s'il existe, sinon `env.ASSETS`.
- `scheduled` : nettoyage des médias (§5).

Routes :

```
GET    /me
GET    /content                       PUT /content/:page
GET    /entries/:collection           POST /entries/:collection
GET    /entries/:collection/:id       PUT /entries/:collection/:id   DELETE /entries/:collection/:id
POST   /media
GET    /publish                       POST /publish
```

Toute écriture est revalidée côté serveur avec la config. Après chaque
enregistrement, le Worker appelle `DEPLOY_HOOK_URL` (code de
`worker/publish.ts`).

**Isolation** : chaque site a sa D1, son R2, son application Access (donc son
`ACCESS_AUD`) et sa liste `ADMIN_EMAILS`. Un jeton Access émis pour le site A
est refusé par le site B (audience différente).

## 7. Build

`nohu-cms/content` (Node, build uniquement) généralise `src/cms/load.ts` :

- Source `CMS_SOURCE` : `d1` (API REST Cloudflare, jeton de build
  `CMS_API_TOKEN` en lecture D1 ; compte et base lus dans `wrangler.jsonc`),
  `local` (D1 locale de wrangler), `defaults` (valeurs d'origine, aucune
  entrée).
- Sur Workers Builds (`WORKERS_CI`), un build sans accès à D1 échoue : on ne
  republie jamais les valeurs d'origine par-dessus les modifications.
- Une seule lecture de D1 par build (cache au niveau du processus).
- API : `getContent(config)`, `getEntries(config, collection, { includeDrafts? })`,
  `getEntry(config, collection, slug)`, `getEntryPath(config, collection, entry)`.
- Le HTML riche est nettoyé (`sanitizeRichText`, liste blanche) avant d'être
  renvoyé.
- Composants : `CmsImage.astro`, `Lines.astro`, `RichText.astro` ;
  utilitaire `toParagraphs()`.

## 8. Admin

- Application Preact **précompilée** dans le package (`dist/admin/*.js|css`,
  Preact et TipTap inclus) : le site n'a pas besoin de l'intégration Preact.
- L'intégration `nohuCms({ config: './cms.config.ts' })` injecte la route
  `/admin` (page Astro du package qui sérialise la config et charge l'admin).
  Le site est statique : la page est générée au build comme les autres.
- Interface générée depuis la config : un menu par page et par collection ;
  formulaires de sections ; listes repliables ; liste des entrées (brouillon /
  publié, date) ; formulaire d'entrée ; upload d'image avec glisser-déposer.
- Personnalisation par site : `admin.title`, `admin.brandColor`, `admin.logo?`.
- On garde le niveau d'exigence de Gao Mata : libellés simples, aides sous les
  champs, compteurs `max`, confirmation avant suppression, avertissement avant
  de quitter sans enregistrer, bouton « Republier », état de la dernière
  publication. Code repris de `src/admin/` et `admin.css`.

## 9. CLI `nohu-cms`

- **`init`** (dans un projet Astro existant) :
  1. vérifie `wrangler whoami` (sinon demande `npx wrangler login`) et lit
     l'account ID ;
  2. demande : nom du site, domaines, emails des admins ;
  3. crée D1 (`<site>-cms`) et R2 (`<site>-media`) via wrangler ;
  4. lit le domaine d'équipe Zero Trust du compte (s'il n'existe pas : explique
     comment l'activer, gratuit) et crée l'application Access + la règle
     d'emails via l'API (jeton demandé à la volée, jamais écrit sur disque) ;
     sans jeton, affiche les étapes du tableau de bord ;
  5. écrit `wrangler.jsonc`, `cms.config.ts` (exemple), `worker/index.ts`,
     `.dev.vars`, scripts npm, ajoute l'intégration dans `astro.config.mjs` ;
  6. applique les migrations en local et à distance ;
  7. affiche la checklist restante : connecter le dépôt à Workers Builds,
     secret de build `CMS_API_TOKEN`, deploy hook puis
     `npx nohu-cms set-hook <url>` (pose le secret `DEPLOY_HOOK_URL`).
  Toutes les valeurs de compte vont dans les fichiers du site, jamais ailleurs.
- **`doctor`** : vérifie, avec un diagnostic en français pour chaque point :
  bindings D1/R2, migrations à jour, variables Access présentes, application
  Access couvrant `/admin` et `/api/admin` de chaque domaine avec la bonne
  audience, `ADMIN_EMAILS` non vide, secret `DEPLOY_HOOK_URL` posé, réponse
  401/403 de `/api/admin/me` sans jeton, cohérence config ↔ valeurs stockées
  (clés ignorées).
- **`dev`** : admin en local (port de `scripts/dev-admin.mjs`) : D1/R2 locales,
  `wrangler dev`, rebuild à chaque enregistrement.
- **`migrate [--local|--remote]`**, **`set-hook <url>`**.
- **`skill`** : copie le skill Claude (§10) dans `.claude/skills/` du projet.

## 10. Skill Claude `nohu-cms-setup`

Livré dans le package (`skills/nohu-cms-setup/SKILL.md`). Il :

1. lance `npx nohu-cms init` et accompagne les étapes manuelles ;
2. fait la partie qui demande du jugement : repère les textes et images en dur
   dans les pages existantes, propose un `cms.config.ts` (pages, sections,
   libellés et aides compréhensibles par un client non technique), remplace
   les textes en dur par `getContent()` ;
3. propose les collections utiles (articles, événements…) et leurs pages ;
4. termine par `npm run build` et `npx nohu-cms doctor`.

Il contient aussi les règles de maintenance (équivalent de la section
« Règles » du CLAUDE.md de Gao Mata) à recopier dans le CLAUDE.md du site.

## 11. Repo, tests, publication

```
~/dev/nohu-cms/
  packages/nohu-cms/   src/{fields,config,content,worker,admin,cli,components}, migrations/, skills/
  playground/          site Astro d'exemple (accueil + blog), valeurs factices
  docs/                specs, guide d'installation
```

- npm workspaces, TypeScript, ESLint/Prettier comme Gao Mata.
- **vitest** : validation des champs, sérialisation de la config, chargement
  (`defaults`/`local`), `sanitizeRichText`, routeur et `authenticate()`
  (jetons Access signés en test, mauvaise audience refusée), nettoyage des
  médias.
- **Playwright** sur le playground en mode `dev` : modifier un texte, publier
  un article avec image, vérifier le rendu après rebuild ; accessibilité de
  l'admin (axe).
- **Test d'absence de données de compte** : le tarball `npm pack` ne contient
  ni account ID, ni AUD, ni domaine d'équipe, ni email.
- GitHub Actions : lint + tests sur chaque PR ; publication npm (provenance)
  sur tag `v*`. CHANGELOG tenu à la main.

## 12. Reprise depuis Gao Mata

| Gao Mata                                  | nohu-cms                                  |
| ----------------------------------------- | ----------------------------------------- |
| `src/cms/fields.ts`                       | `fields` (+ `richtext`, `date`, `image`)  |
| `src/cms/load.ts`                         | `content` (config en paramètre, entrées)  |
| `src/cms/workshops.ts`                    | remplacé par les collections génériques   |
| `src/cms/publish.ts`, `worker/*`          | `worker` (routes génériques)              |
| `src/admin/*` (sauf `Workshops.tsx`)      | `admin` ; `Workshops.tsx` → `EntryEditor` générique |
| `scripts/dev-admin.mjs`                   | `cli dev`                                 |
| `docs/admin.md`                           | `init` + `doctor` + guide d'installation  |

## 13. Spikes (levés le 2026-10-15)

| #  | Question | Résultat | Décision |
| -- | -------- | -------- | -------- |
| S1 | Créer un deploy hook par l'API ? | Non documenté : seul le déclenchement (`POST /workers/builds/deploy_hooks/{uuid}`) l'est. | Étape manuelle dans le tableau de bord, puis `npx nohu-cms set-hook <url>`. |
| S2 | Jeton disponible pendant la commande de build Workers Builds ? | Non garanti par la doc (seuls `CI`, `WORKERS_CI*` sont listés). | Migrateur propre à la lib (§4 bis) via l'API REST D1 avec `CMS_API_TOKEN` (D1 Edit). |
| S3 | `migrations_dir` dans `node_modules` ? | Rendu inutile par S2. | Pas de `migrations_dir` : la lib applique ses migrations elle-même. |
| S4 | Application + règle Access par l'API ? | Oui : `POST /accounts/{id}/access/apps` (droit « Access: Apps and Policies Write »), domaine d'équipe via `GET /accounts/{id}/access/organizations`. | `init` le fait si un jeton est fourni, sinon affiche les étapes. |

### §4 bis — Migrateur

- Les migrations sont des fichiers SQL embarqués dans le package
  (`migrations/0001_init.sql`, …), suivis dans la table `cms_migrations
  (name TEXT PK, applied_at TEXT)`.
- Exécuteurs : distant (API REST D1 `/accounts/{id}/d1/database/{db}/query`,
  jeton `CMS_API_TOKEN`) et local (`wrangler d1 execute DB --local`).
- Le build (source `d1` ou `local`) applique les migrations en attente avant
  de lire le contenu. `npx nohu-cms migrate [--local|--remote]` fait de même à
  la demande. Le jeton de build `CMS_API_TOKEN` demande donc le droit
  **D1 Edit** (et non plus seulement lecture).
- Cela remplace la vérification `schema_version` du §4.
