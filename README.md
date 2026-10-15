# nohu-cms

Admin de contenu pour sites Astro statiques sur Cloudflare (Workers, D1, R2,
Access) : textes, images et articles modifiables par un client non technique.

- Package : [`packages/nohu-cms`](packages/nohu-cms) — documentation
  d'utilisation dans son [README](packages/nohu-cms/README.md).
- Site d'exemple : [`playground`](playground) (accueil + blog).
- Conception : [docs/specs/2026-10-15-nohu-cms-design.md](docs/specs/2026-10-15-nohu-cms-design.md).

## Développement

```bash
npm install
npm run build          # package (modules + admin précompilée)
npm test               # tests unitaires (vitest)
npm run test:e2e       # admin locale de bout en bout (Playwright, playground)
npm run lint && npm run check
```

Admin du playground en local : `cd playground && npx nohu-cms dev`, puis
http://localhost:8788/admin.

## Publier une version

1. Mettre à jour `CHANGELOG.md` et la version de `packages/nohu-cms/package.json`.
2. `git tag v0.1.0 && git push --tags` : le workflow `release` vérifie tout
   puis publie sur npm (secret `NPM_TOKEN` du dépôt, provenance activée ; le
   dépôt doit être public).
