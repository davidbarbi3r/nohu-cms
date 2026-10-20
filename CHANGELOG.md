# Changelog

## Unreleased

- `init` : si la base D1 existe déjà, demander avant de la supprimer et de
  la remplacer. Sans un « oui » explicite, la base et ses données sont
  conservées.

## 0.1.1 — 2026-10-16

- `doctor` : un domaine redirigé vers un autre domaine du site (ex.
  `exemple.fr` → `www.exemple.fr`) n'est plus signalé comme « sans passer par
  Access ».
- Publication des versions sans jeton npm (Trusted Publisher, validation avec
  la double authentification).

## 0.1.0 — 2026-10-16

Première version publiée :

- `cms.config.ts` : pages, sections, collections ; champs `text`, `textarea`,
  `url`, `email`, `date`, `richtext`, `image`, `list`.
- Admin précompilée (`/admin`), générée depuis la config.
- Worker : API admin (Cloudflare Access + `ADMIN_EMAILS`), photos R2 en
  plusieurs largeurs, nettoyage quotidien, deploy hook.
- Build : `getContent`, `getEntries`, migrations D1 appliquées par la lib.
- CLI : `init`, `doctor`, `dev`, `migrate`, `set-hook`, `skill`.
- Skill Claude `nohu-cms-setup`.

Corrigé après un premier essai sur un vrai site (bun, Astro 6) :

- dépendances acceptant des versions plus anciennes (bun refuse par défaut
  les versions publiées depuis moins de 7 jours) ;
- `init` : `compatibility_date` un mois en arrière (un wrangler un peu ancien
  refuse une date plus récente que lui) ; import de l'intégration placé après
  les imports existants (`// @ts-check` reste en tête) ;
- une page et une collection peuvent porter le même nom.

Ajouté :

- images du projet comme valeurs d'origine (`asset('assets/…', alt)`),
  optimisées au build par `astro:assets`, avec vignette dans l'admin ; seules
  celles citées dans la config sont acceptées par le serveur ;
- option `hidden` pour les champs techniques (ancre, cadrage), qui suivent
  leur élément quand on réordonne une liste ;
- champ `select` (choix fermé, menu déroulant dans l'admin) ;
- `richtext` et `select` acceptés dans les éléments d'une liste ;
- `CmsImage` : plus de variante à la largeur d'origine d'une photo du projet.

Ajouté avant la publication :

- Suivi réel des mises en ligne (#17) : état du build Workers Builds dans
  l'admin (en cours, en ligne, échec), alerte d'échec via `ALERT_WEBHOOK_URL`
  (cron `*/10 * * * *`), vérifications correspondantes dans `doctor`.
- `nohu-cms setup` (#16) : mise en service Cloudflare avec un seul jeton
  (D1, R2, Access et sa règle, jetons et secrets de build et de suivi, branche
  de production sur demande), relançable sans risque ; `init` complète un
  `wrangler.jsonc` existant au lieu de s'arrêter.
- `nohu-cms dev` : le site reconstruit remplace l'ancien sans trou (une page
  rechargée pendant la reconstruction n'est plus introuvable).
