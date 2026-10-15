# nohu-cms

Admin de contenu pour sites **Astro statiques** hébergés sur **Cloudflare** :
textes, photos et articles modifiables par un client non technique, sans
serveur à maintenir.

- Le site reste 100 % statique. Chaque enregistrement dans l'admin relance le
  build (Workers Builds), qui relit la base et republie le site en 2 à 3
  minutes.
- Données dans **D1**, photos dans **R2** (redimensionnées dans le navigateur,
  servies avec `srcset`), connexion par **Cloudflare Access** (code reçu par
  email).
- L'admin se génère depuis un seul fichier, `cms.config.ts` : pages →
  sections → champs, et collections (articles, événements…).
- Chaque site a sa base, son stockage et son application Access : un client ne
  voit jamais un autre site.

```
Admin (/admin) ──► Worker du site : /api/admin ──► D1 (textes, articles)
                                │              └► R2 (photos, /media/*)
                                └► Deploy hook ──► Workers Builds
                                                   astro build (lit D1) ──► wrangler deploy
```

## Installation

Dans un site Astro existant (rendu statique) :

```bash
npm i nohu-cms
npm i -D wrangler @cloudflare/workers-types
npx wrangler login
npx nohu-cms init
```

`init` pose quelques questions (nom, domaines, emails des admins), crée la base
D1 et le stockage R2, l'application Access si tu fournis un jeton API, écrit
les fichiers du site, puis affiche les étapes restantes du tableau de bord
Cloudflare :

1. connecter le dépôt Git au Worker (Workers Builds : `npm run build`, puis
   `npx wrangler deploy`) ;
2. secret de build `CMS_API_TOKEN` : jeton API avec seulement « Compte → D1 →
   Edit » (le build lit la base et applique les migrations) ;
3. après le premier déploiement, créer un deploy hook et
   `npx nohu-cms set-hook <url>` ;
4. `npx nohu-cms doctor` pour tout vérifier.

Avec Claude Code, `npx nohu-cms skill` installe le skill **nohu-cms-setup**,
qui fait l'installation et transforme les textes en dur de tes pages en
contenus modifiables.

### Fichiers du site

```
cms.config.ts      contenus modifiables (defineCms)
astro.config.mjs   integrations: [nohuCms()]  → page /admin
worker/index.ts    export default createCmsWorker(config)
wrangler.jsonc     Worker, D1, R2, Access, ADMIN_EMAILS (généré par init)
.dev.vars          DEV_ADMIN_EMAIL pour l'admin locale (jamais commité)
```

## Déclarer le contenu

```ts
// cms.config.ts
import {
  collection,
  defineCms,
  image,
  list,
  page,
  richtext,
  section,
  text,
  textarea,
} from 'nohu-cms';

export default defineCms({
  admin: { title: 'Atelier Dupont', brandColor: '#2f5d50' },
  pages: {
    accueil: page('Accueil', '/', {
      hero: section('Haut de page', {
        title: text('Titre', 'Bienvenue', { max: 70 }),
        photo: image('Photo', { src: '/images/hero.jpg', alt: 'L’atelier' }),
      }),
      tarifs: section('Tarifs', {
        items: list(
          'Tarifs',
          {
            itemLabel: 'un tarif',
            itemTitle: 'name',
            fields: { name: text('Nom'), price: text('Prix') },
          },
          [{ name: 'Séance', price: '20 €' }],
        ),
      }),
    }),
  },
  collections: {
    articles: collection('Articles', {
      itemLabel: 'un article',
      path: '/blog/[slug]',
      fields: {
        summary: textarea('Résumé', '', { max: 220 }),
        cover: image('Photo de couverture'),
        body: richtext('Texte'),
      },
    }),
  },
});
```

| Champ                  | Valeur                                   | Notes                                            |
| ---------------------- | ---------------------------------------- | ------------------------------------------------ |
| `text`, `textarea`     | `string`                                 | `max`, `optional`, `help`                        |
| `url`, `email`, `date` | `string`                                 | validés ; date `AAAA-MM-JJ`                      |
| `richtext`             | HTML                                     | titres, listes, liens, photos ; nettoyé au build |
| `image`                | `{ src, alt, width?, height?, srcset? }` | `null` en valeur d'origine = facultative         |
| `list`                 | tableau d'objets                         | sous-champs `text`…`image`, `min`, `max`         |

Les valeurs écrites dans la config sont les **valeurs d'origine** : la base ne
stocke que ce qui en diffère. Changer une valeur d'origine met donc le site à
jour, sauf si le champ a été modifié dans l'admin.

Chaque entrée de collection a d'office `title`, `slug`, `status` (`draft` ou
`published`) et `publishedAt` ; ajouter un champ à une collection ne demande
aucune migration.

> Renommer ou supprimer un champ change sa clé de stockage
> (`page.section.champ`) : une valeur modifiée dans l'admin est alors ignorée,
> et le build l'écrit dans ses logs.

## Afficher le contenu

```astro
---
import config from '../../cms.config';
import { getContent, getEntries, getEntryPath } from 'nohu-cms/content';
import CmsImage from 'nohu-cms/components/CmsImage.astro';
import Lines from 'nohu-cms/components/Lines.astro';
import RichText from 'nohu-cms/components/RichText.astro';

const { accueil } = await getContent(config);
const articles = await getEntries(config, 'articles');
---

<h1>{accueil.hero.title}</h1>
<CmsImage image={accueil.hero.photo} sizes="100vw" loading="eager" />
{articles.map((a) => (
  <a href={getEntryPath(config, 'articles', a)}>{a.title}</a>
))}
```

- `getContent(config)` : tous les contenus, typés depuis la config.
- `getEntries(config, nom)` : entrées publiées, triées (`sort` de la
  collection : `date-desc` par défaut, `date-asc`, `title`).
- `getEntry(config, nom, slug)`, `getEntryPath(config, nom, entrée)`.
- Composants : `CmsImage` (srcset), `Lines` (retours à la ligne, `linkify`
  pour emails et téléphones), `RichText` (HTML déjà nettoyé).
- Utilitaires (`nohu-cms`) : `toParagraphs`, `formatDate`, `phoneHref`.

Le HTML des champs `richtext` passe par une liste blanche au build : seules les
mises en forme prévues et les photos envoyées dans l'admin (`/media/…`)
passent.

## Source du contenu au build

| `CMS_SOURCE` | Source                                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `d1`         | base de production (API REST, `CMS_API_TOKEN`) — choisi automatiquement si le compte, la base et le jeton sont connus |
| `local`      | base locale de `wrangler dev` (`nohu-cms dev`)                                                                        |
| `defaults`   | valeurs d'origine, aucune entrée (choisi sinon)                                                                       |

Sur Workers Builds, un build sans accès à D1 **échoue volontairement** : on ne
republie jamais les valeurs d'origine par-dessus les modifications.

## Admin locale

```bash
npm run dev:admin   # = nohu-cms dev
```

`http://localhost:8788/admin` : D1 et R2 locales, connexion simulée avec
`DEV_ADMIN_EMAIL` (`.dev.vars`, accepté uniquement sur localhost), et
reconstruction du site à chaque enregistrement, comme en production.

## Sécurité

- `/admin` et `/api/admin` sont protégés par l'application Cloudflare Access
  du site. Le Worker vérifie **en plus** la signature du jeton Access, son
  audience (`ACCESS_AUD`, propre au site) et l'email (`ADMIN_EMAILS`, seule
  liste des comptes autorisés).
- Les écritures envoyées depuis un autre site sont refusées (contrôle
  d'origine).
- Ajouter ou retirer un admin = modifier `ADMIN_EMAILS` **et** la règle de
  l'application Access.
- Les photos inutilisées depuis plus de 24 h sont supprimées chaque nuit
  (cron du Worker).

## Routes propres au site

```ts
export default createCmsWorker(config, {
  fetch: (request, env) =>
    new URL(request.url).pathname === '/api/contact'
      ? handleContact(request, env)
      : null,
});
```

Seuls les chemins de `assets.run_worker_first` atteignent le Worker.

## CLI

| Commande                               | Rôle                                                   |
| -------------------------------------- | ------------------------------------------------------ |
| `nohu-cms init [--dry-run]`            | installe nohu-cms dans le projet courant               |
| `nohu-cms doctor`                      | vérifie fichiers, base, secrets, protection de l'admin |
| `nohu-cms dev [--port 8788]`           | admin locale                                           |
| `nohu-cms migrate [--local\|--remote]` | applique les migrations                                |
| `nohu-cms set-hook <url>`              | secret `DEPLOY_HOOK_URL` du Worker                     |
| `nohu-cms skill`                       | copie le skill Claude dans `.claude/skills/`           |

## Mises à jour

`npm update nohu-cms`. Les nouvelles migrations de la base sont appliquées
automatiquement au build suivant (ou `npx nohu-cms migrate --remote`).

## Licence

MIT
