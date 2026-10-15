---
name: nohu-cms-setup
description: Installe nohu-cms (admin de contenu Astro + Cloudflare D1/R2/Access) dans un site Astro existant, transforme les textes et images écrits en dur dans les pages en contenus modifiables (cms.config.ts), propose les collections utiles, puis vérifie tout avec doctor. À utiliser quand l'utilisateur veut « ajouter un admin », « rendre les textes modifiables », « installer nohu-cms » ou reproduire l'admin d'un autre site sur un projet Astro.
---

# Installer nohu-cms sur un site Astro

nohu-cms ajoute à un site Astro **statique** une page `/admin` où un client non
technique modifie les textes, les photos et des articles. Les données vivent
dans D1 (base) et R2 (photos) ; chaque enregistrement relance le build
Workers Builds, qui régénère le site. Lire le README du package
(`node_modules/nohu-cms/README.md`) pour le détail.

Le travail se fait en quatre temps. Annoncer chaque étape à l'utilisateur, en
français, et ne jamais inventer une valeur de compte Cloudflare.

## 1. Préalables

- Le projet est un site Astro en rendu statique (`output: 'static'`, ou par
  défaut). Si le site utilise un adaptateur serveur, s'arrêter et en parler.
- `npm i nohu-cms` et `npm i -D wrangler @cloudflare/workers-types`.
- `npx wrangler whoami` doit afficher un compte ; sinon demander à
  l'utilisateur de lancer `! npx wrangler login`.

## 2. `npx nohu-cms init`

La commande est interactive : la lancer **dans le terminal de l'utilisateur**
(`! npx nohu-cms init`), car elle pose des questions et peut demander un jeton.
Elle demande : nom du site, nom technique du Worker, domaine(s), email(s) des
admins, puis un jeton API facultatif (« Access: Apps and Policies Edit ») pour
créer la protection de `/admin`.

Elle crée la base D1 et le stockage R2, écrit `wrangler.jsonc`,
`cms.config.ts` (exemple), `worker/index.ts`, `.dev.vars`, ajoute
l'intégration dans `astro.config.*` et les scripts npm, applique les
migrations, puis affiche les **étapes restantes** (Access si pas de jeton,
connexion du dépôt à Workers Builds, secret de build `CMS_API_TOKEN`, deploy
hook). Recopier ces étapes à l'utilisateur sous forme de checklist.

Si `wrangler.jsonc` existe déjà (site déjà sur Cloudflare), `init` s'arrête :
ajouter alors à la main les blocs `d1_databases` (binding `DB`), `r2_buckets`
(binding `MEDIA`), `assets.run_worker_first: ["/api/*", "/media/*"]`,
`triggers.crons` et les `vars` (`ADMIN_EMAILS`, `ACCESS_TEAM_DOMAIN`,
`ACCESS_AUD`, `CLOUDFLARE_ACCOUNT_ID`), en gardant ce qui existe.

## 3. Rendre le contenu modifiable

C'est la partie qui demande du jugement. Pour chaque page de `src/pages/` :

1. Repérer les textes visibles écrits en dur : titres, paragraphes, boutons,
   légendes, textes alternatifs, listes (tarifs, FAQ, témoignages), liens et
   coordonnées. Les micro-textes techniques (libellés d'accessibilité, états
   de chargement) peuvent rester dans le code.
2. Les déclarer dans `cms.config.ts`, rangés comme l'admin les affichera :
   `page(libellé, chemin, { section(libellé, { champs }) })`. Une entrée
   `page('Éléments communs', null, …)` pour l'en-tête, le pied de page et les
   coordonnées.
3. Choisir le bon type :
   - `text` (une ligne, `max` pour les titres), `textarea` (plusieurs lignes),
     `richtext` (mise en forme : titres, listes, liens, photos), `url`,
     `email`, `date`, `image` (chemin dans `public/` + description),
   - `list(libellé, { itemLabel, itemTitle, fields }, valeurs)` pour les
     éléments répétés ; chaque valeur d'origine a exactement les sous-champs
     déclarés.
4. Écrire des libellés et des aides (`help`) **compréhensibles par une
   personne non technique**, en français simple et en tutoiement : dire où le
   texte apparaît et ce qu'il faut y mettre.
5. La valeur d'origine de chaque champ est le texte actuel de la page :
   copier-coller exact, rien à réécrire.
6. Dans la page : `const content = await getContent(config)` (import de
   `nohu-cms/content` et de `../cms.config`), puis remplacer chaque texte par
   sa valeur. Composants : `Lines` (retours à la ligne, `linkify` pour emails
   et téléphones), `RichText` (champ `richtext`), `CmsImage` (champ `image`,
   avec `sizes`). `toParagraphs()` pour un `textarea` à plusieurs paragraphes.
7. Proposer les **collections** utiles au site (articles, événements,
   réalisations…) : `collection(libellé, { itemLabel, path: '/blog/[slug]',
fields })`, puis créer la page liste (`getEntries`) et la page détail
   (`getStaticPaths` + `getEntries`). Chaque entrée a déjà `title`, `slug`,
   `status` et `publishedAt`.

Après chaque page : `npm run build` doit passer et la page doit être
identique à avant (les valeurs d'origine sont les textes actuels).

## 4. Vérifier

- `npm run build`, puis `npm run dev:admin` et ouvrir
  `http://localhost:8788/admin` : modifier un texte, enregistrer, vérifier
  que la page se met à jour.
- `npx nohu-cms doctor` : corriger chaque point en ✖.
- Ajouter au `CLAUDE.md` du site la section ci-dessous.

## Règles à recopier dans le CLAUDE.md du site

```markdown
## Contenu modifiable (nohu-cms)

- Aucun texte éditorial en dur dans les pages : tout texte visible se déclare
  dans `cms.config.ts` et se lit avec `await getContent(config)`.
- Ajouter un texte = un champ dans la bonne section de `cms.config.ts`, avec
  un libellé et une aide compréhensibles par le client. L'admin génère le
  formulaire toute seule.
- Renommer ou supprimer un champ change sa clé (`page.section.champ`) : une
  modification faite dans l'admin est alors ignorée (le build l'écrit dans
  ses logs). Prévenir, et reporter la valeur si besoin :
  `npx wrangler d1 execute DB --remote --command "SELECT * FROM cms_content"`.
- Collections : ajouter un champ ne demande aucune migration.
- HTML des champs `richtext` : toujours via `getContent` / `getEntries`
  (déjà nettoyé) et `<RichText>`, jamais d'autre HTML venant de la base.
- Comptes admin : `ADMIN_EMAILS` dans `wrangler.jsonc` ET la règle de
  l'application Cloudflare Access.
- Après une modification : `npm run build`, puis `npx nohu-cms doctor` si la
  configuration Cloudflare a changé.
```
