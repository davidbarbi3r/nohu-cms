/**
 * Migrations SQL de la base D1, appliquées par la lib elle-même (build et
 * `npx nohu-cms migrate`). Elles sont uniquement additives : ne jamais
 * modifier une migration publiée, en ajouter une nouvelle.
 */
export interface Migration {
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    name: '0001_init',
    sql: `
CREATE TABLE IF NOT EXISTS cms_content (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cms_entries (
  id TEXT PRIMARY KEY,
  collection TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  title TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  UNIQUE (collection, slug)
);
CREATE INDEX IF NOT EXISTS cms_entries_listing ON cms_entries (collection, status, published_at);
CREATE TABLE IF NOT EXISTS cms_media (
  id TEXT PRIMARY KEY,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  srcset TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cms_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);`,
  },
];

export const MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS cms_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
)`;
