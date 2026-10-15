/** Doublures en mémoire de D1 (sur node:sqlite) et R2, pour tester le Worker. */
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from '../../src/migrations';
import type { CmsEnv } from '../../src/worker/env';

class Statement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: unknown[] = [],
  ) {}
  bind(...params: unknown[]) {
    return new Statement(this.db, this.sql, params);
  }
  private stmt() {
    return this.db.prepare(this.sql);
  }
  async first<T>() {
    return (this.stmt().get(...(this.params as never[])) ?? null) as T | null;
  }
  async all<T>() {
    return { results: this.stmt().all(...(this.params as never[])) as T[] };
  }
  async run() {
    this.stmt().run(...(this.params as never[]));
    return { success: true };
  }
}

export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  for (const migration of MIGRATIONS) db.exec(migration.sql);
  return {
    sqlite: db,
    prepare: (sql: string) => new Statement(db, sql),
    async batch(statements: Statement[]) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  } as unknown as D1Database & { sqlite: DatabaseSync };
}

interface Stored {
  body: Uint8Array;
  contentType?: string;
  uploaded: Date;
}

export function fakeR2() {
  const objects = new Map<string, Stored>();
  const bucket = {
    objects,
    async put(
      key: string,
      value: ReadableStream | ArrayBuffer | string,
      options?: { httpMetadata?: { contentType?: string } },
    ) {
      const body = new Uint8Array(await new Response(value).arrayBuffer());
      objects.set(key, {
        body,
        contentType: options?.httpMetadata?.contentType,
        uploaded: new Date(),
      });
    },
    async get(key: string) {
      const stored = objects.get(key);
      if (!stored) return null;
      return {
        body: new Response(stored.body as BodyInit).body,
        httpEtag: '"etag"',
        writeHttpMetadata(headers: Headers) {
          if (stored.contentType)
            headers.set('Content-Type', stored.contentType);
        },
      };
    },
    async list({ prefix = '' }: { prefix?: string; cursor?: string }) {
      return {
        objects: [...objects.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, stored]) => ({ key, uploaded: stored.uploaded })),
        truncated: false,
      };
    },
    async delete(keys: string | string[]) {
      for (const key of [keys].flat()) objects.delete(key);
    },
  };
  return bucket as unknown as R2Bucket & { objects: Map<string, Stored> };
}

export function fakeEnv(overrides: Partial<CmsEnv> = {}) {
  const DB = fakeD1();
  const MEDIA = fakeR2();
  const env = {
    ASSETS: {
      fetch: async () => new Response('statique'),
    } as unknown as Fetcher,
    DB,
    MEDIA,
    ADMIN_EMAILS: 'admin@example.com',
    DEV_ADMIN_EMAIL: 'admin@example.com',
    ...overrides,
  };
  return env as CmsEnv & { DB: typeof DB; MEDIA: typeof MEDIA };
}

export const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;
