import { describe, expect, it } from 'vitest';
import { inlineParams, remoteClient, type D1Client } from '../src/content/d1';
import { migrate } from '../src/content/migrate';

function fakeDb() {
  const applied: string[] = [];
  const executed: string[] = [];
  const db: D1Client = {
    kind: 'local',
    async query(sql, params = []) {
      if (sql.startsWith('SELECT name'))
        return applied.map((name) => ({ name }));
      if (sql.startsWith('INSERT INTO cms_migrations'))
        applied.push(String(params[0]));
      return [];
    },
    async exec(sql) {
      executed.push(sql);
    },
  };
  return { db, applied, executed };
}

describe('migrateur', () => {
  it('applique les migrations manquantes une seule fois', async () => {
    const { db, applied, executed } = fakeDb();
    const migrations = [
      { name: '0001_a', sql: 'CREATE TABLE a (x)' },
      { name: '0002_b', sql: 'CREATE TABLE b (x)' },
    ];
    expect(await migrate(db, migrations)).toEqual(['0001_a', '0002_b']);
    expect(await migrate(db, migrations)).toEqual([]);
    expect(applied).toEqual(['0001_a', '0002_b']);
    expect(
      executed.filter((sql) => sql.startsWith('CREATE TABLE a')),
    ).toHaveLength(1);
  });

  it('échappe les paramètres pour wrangler en local', () => {
    expect(inlineParams('SELECT ?1, ?2, ?3', ["l'été", 3, null])).toBe(
      "SELECT 'l''été', 3, NULL",
    );
  });

  it('interroge l’API REST D1 et signale les erreurs', async () => {
    const calls: unknown[] = [];
    const ok = remoteClient(
      { accountId: 'acc', databaseId: 'db', token: 't' },
      async (input, init) => {
        calls.push([input, JSON.parse(String(init?.body))]);
        return Response.json({
          success: true,
          result: [{ results: [{ a: 1 }] }],
        });
      },
    );
    expect(await ok.query('SELECT ?1', ['x'])).toEqual([{ a: 1 }]);
    expect(calls[0]).toEqual([
      'https://api.cloudflare.com/client/v4/accounts/acc/d1/database/db/query',
      { sql: 'SELECT ?1', params: ['x'] },
    ]);

    const failing = remoteClient(
      { accountId: 'acc', databaseId: 'db', token: 't' },
      async () =>
        Response.json(
          { success: false, errors: [{ message: 'Unauthorized' }] },
          { status: 403 },
        ),
    );
    await expect(failing.query('SELECT 1')).rejects.toThrow(
      /403.*Unauthorized/,
    );
  });
});
