/** Applique les migrations de la lib qui manquent dans la base. */
import { MIGRATIONS, MIGRATIONS_TABLE, type Migration } from '../migrations';
import type { D1Client } from './d1';

export async function pendingMigrations(
  db: D1Client,
  migrations: Migration[] = MIGRATIONS,
): Promise<Migration[]> {
  await db.exec(MIGRATIONS_TABLE);
  const rows = await db.query('SELECT name FROM cms_migrations');
  const applied = new Set(rows.map((row) => String(row.name)));
  return migrations.filter((migration) => !applied.has(migration.name));
}

/** Renvoie le nom des migrations appliquées (vide si la base est à jour). */
export async function migrate(
  db: D1Client,
  migrations: Migration[] = MIGRATIONS,
): Promise<string[]> {
  const pending = await pendingMigrations(db, migrations);
  for (const migration of pending) {
    await db.exec(migration.sql);
    await db.query(
      'INSERT INTO cms_migrations (name, applied_at) VALUES (?1, ?2)',
      [migration.name, new Date().toISOString()],
    );
  }
  return pending.map((migration) => migration.name);
}
