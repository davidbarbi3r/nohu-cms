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
