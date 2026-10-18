# Contribuer à nohu-cms

Merci de vouloir contribuer ! Ce guide explique comment signaler un problème,
proposer une modification et faire en sorte qu'elle soit acceptée rapidement.

> _English: issues and pull requests in English are welcome. The project's
> docs and user-facing strings are in French: keep any text shown to users in
> French, and the reviewer will help with wording if needed._

## Sommaire

- [Façons de contribuer](#façons-de-contribuer)
- [Signaler une faille de sécurité](#signaler-une-faille-de-sécurité)
- [Mettre en place l'environnement](#mettre-en-place-lenvironnement)
- [Principes du projet](#principes-du-projet)
- [Conventions de code](#conventions-de-code)
- [Tests](#tests)
- [Proposer une pull request](#proposer-une-pull-request)
- [Licence](#licence)

## Façons de contribuer

- **Signaler un bug** : ouvrez une
  [issue](https://github.com/davidbarbi3r/nohu-cms/issues) avec :
  - la version de nohu-cms, d'Astro, de wrangler et de Node (ou bun) ;
  - la commande lancée et sa sortie complète (masquez jetons, emails et
    identifiants de compte) ;
  - ce que vous attendiez et ce qui s'est passé.
- **Proposer une fonctionnalité ou un changement de comportement** : ouvrez
  d'abord une issue pour en discuter, avant d'écrire le code. Ça évite une
  pull request refusée parce que l'approche ne correspond pas au projet.
- **Corriger un bug, améliorer la doc** : une pull request directe convient
  pour une correction courte et évidente. Les issues
  [`good first issue`](https://github.com/davidbarbi3r/nohu-cms/labels/good%20first%20issue)
  sont un bon point de départ.

Le projet est maintenu par une seule personne : une réponse peut prendre
quelques jours.

## Signaler une faille de sécurité

**N'ouvrez pas d'issue publique.** Utilisez le signalement privé de GitHub :
onglet **Security** du dépôt, puis **Report a vulnerability**. Décrivez le
problème et comment le reproduire ; vous aurez une réponse avant toute
publication du correctif.

Sont concernés en particulier : contournement de Cloudflare Access ou de
`ADMIN_EMAILS`, accès d'un site aux données d'un autre, injection HTML dans
le contenu publié, fuite d'un jeton ou d'un secret.

## Mettre en place l'environnement

Prérequis : Node ≥ 20 (la CI utilise Node 22) et npm.

```bash
git clone https://github.com/davidbarbi3r/nohu-cms.git
cd nohu-cms
npm install
npm run build          # package (modules + admin précompilée)
npm test               # tests unitaires (vitest)
```

Avant d'ouvrir une pull request, lancez ce que la CI vérifie :

```bash
npm run format:check && npm run lint && npm run build && npm run check && npm test
```

Pour une modification de l'admin, lancez aussi les tests de bout en bout
(Playwright, sur le site d'exemple) :

```bash
npx playwright install chromium   # la première fois
npm run test:e2e
```

Pour voir l'admin en local : `cd playground && npx nohu-cms dev`, puis
http://localhost:8788/admin. Aucun compte Cloudflare n'est nécessaire.

### Structure du dépôt

| Dossier                         | Contenu                                           |
| ------------------------------- | ------------------------------------------------- |
| `packages/nohu-cms/src/admin`   | application d'admin (précompilée au build)        |
| `packages/nohu-cms/src/worker`  | API admin, photos R2, crons                       |
| `packages/nohu-cms/src/astro`   | intégration Astro                                 |
| `packages/nohu-cms/src/content` | lecture au build, D1, migrations                  |
| `packages/nohu-cms/src/cli`     | `init`, `setup`, `doctor`, `dev`, `migrate`…      |
| `packages/nohu-cms/skills`      | skill Claude `nohu-cms-setup`                     |
| `packages/nohu-cms/test`        | tests unitaires                                   |
| `playground`                    | site d'exemple et tests de bout en bout           |
| `docs/specs`                    | conception : la référence du comportement attendu |

## Principes du projet

Ces règles guident la revue. Une pull request qui s'en écarte doit expliquer
pourquoi.

- **Toute commande se relance sans danger.** `init` et `setup` vérifient ce
  qui existe avant d'agir : une ressource Cloudflare déjà là (base D1, bucket
  R2, application Access) est réutilisée, pas recréée. Une commande
  interrompue doit pouvoir être relancée et aller au bout.
- **Rien de destructif.** Le CLI ne supprime pas de ressource Cloudflare ni de
  contenu. Un fichier existant est complété ou sauvegardé avant d'être
  modifié.
- **Aucun secret affiché ni écrit sur disque.** Les jetons sont demandés à la
  volée ou lus dans l'environnement. Les valeurs de compte (account ID, ids
  D1…) vont dans les fichiers du site, jamais ailleurs.
- **L'admin s'adresse à une personne non technique.** Libellés, aides et
  messages d'erreur en français simple, sans jargon.
- **Le site reste statique.** Le Worker ne sert que l'API de l'admin et les
  photos.
- **Peu de dépendances.** Toute nouvelle dépendance se discute dans l'issue
  avant la pull request.

Le comportement attendu de chaque partie est décrit dans
[`docs/specs`](docs/specs). Si votre modification change ce comportement,
mettez à jour la spec et le
[README du package](packages/nohu-cms/README.md) dans la même pull request.

## Conventions de code

Le formatage (Prettier) et le lint (ESLint) sont vérifiés par la CI :
`npm run format` corrige le formatage. Au-delà :

- **Langue.** Textes visibles par l'utilisateur, commentaires et noms de
  tests en français. Noms de variables, de fonctions et messages de commit en
  anglais.
- **Messages du CLI.** Les commandes à lancer sont citées entre guillemets
  français : `Relance « npx nohu-cms init »`. Un message d'erreur dit ce qui
  ne va pas et quoi faire ensuite.
- **Sortie des outils externes.** Quand une commande wrangler échoue,
  n'affichez que la première ligne utile de sa sortie, pas la sortie entière
  (voir `doctor.ts`). Préférez les codes d'erreur structurés (champ `code` de
  l'API Cloudflare) à la recherche de texte dans une sortie.
- **Erreurs.** Une classe d'erreur se nomme `…Error` (ex. `CloudflareError`).
  Évitez les exceptions pour le déroulement normal : une ressource qui existe
  déjà n'est pas une erreur.
- **Simple d'abord.** Pas d'abstraction ni d'option pour un besoin qui
  n'existe pas encore.

## Tests

- Tests unitaires avec [vitest](https://vitest.dev), dans
  `packages/nohu-cms/test`.
- **Aucun appel réel** au réseau, à Cloudflare ou à wrangler. Le CLI reçoit
  ses dépendances (`deps.exec`, `deps.ask`, `fetch`…) : les tests passent des
  versions simulées. Réutilisez les helpers déjà présents dans le fichier de
  test plutôt que d'en recopier.
- **Un bug corrigé = un test** qui échouait avant la correction.
- Un test couvre un comportement, pas une implémentation : son nom dit ce que
  l'utilisateur observe (`'réutilise la base D1 existante'`).
- Une modification de l'admin s'accompagne d'un test de bout en bout dans
  `playground/tests` quand c'est pertinent.

## Proposer une pull request

1. Forkez le dépôt et créez une branche depuis `main`
   (`fix/init-existing-d1`, `feat/select-field`…).
2. Une pull request = un sujet. Deux corrections indépendantes font deux
   pull requests ; deux pull requests qui touchent le même problème gagnent à
   n'en faire qu'une.
3. Écrivez des messages de commit en anglais, à l'impératif, qui décrivent le
   changement : `Reuse an existing D1 database during init`.
4. Dans la description :
   - le problème et l'issue liée (`Closes #12`) ;
   - ce qui change pour l'utilisateur ;
   - comment vous l'avez vérifié (tests ajoutés, essai sur un vrai compte).
5. **Ne modifiez ni `CHANGELOG.md` ni le numéro de version** : le mainteneur
   les met à jour au moment de la publication. Ça évite les conflits entre
   pull requests.
6. La CI doit passer. Le mainteneur peut demander des changements ou
   reprendre de petits détails lui-même avant la fusion.

Les contributions écrites avec l'aide d'outils d'IA sont acceptées. Vous en
restez l'auteur : vous devez comprendre le code proposé, l'avoir relu et
testé.

## Licence

En contribuant, vous acceptez que votre contribution soit publiée sous la
[licence MIT](LICENSE) du projet.
