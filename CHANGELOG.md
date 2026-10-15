# Changelog

## 0.1.0 — non publiée

Première version :

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
  leur élément quand on réordonne une liste.
