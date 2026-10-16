/**
 * Faux API Cloudflare en mémoire, pour tester `nohu-cms setup` sans compte.
 * Il reproduit les formats relevés sur l'API réelle (enveloppe
 * `{ success, result, errors }`, chemins, codes 404) et garde un état que
 * les tests inspectent. D1 s'appuie sur une vraie base SQLite (node:sqlite).
 */
import { DatabaseSync } from 'node:sqlite';

export interface FakeCloudflareOptions {
  account?: string;
  /** Domaine d'équipe Zero Trust ; `null` = Zero Trust non activé. */
  teamDomain?: string | null;
  /** Worker existant (`null` = pas encore créé). */
  worker?: { name: string; tag: string; deployed: boolean } | null;
  /** Déclencheurs Workers Builds du Worker (vide = dépôt non connecté). */
  triggers?: {
    trigger_uuid: string;
    trigger_name: string;
    branch_includes: string[];
    branch_excludes: string[];
    build_command: string;
    deploy_command: string;
  }[];
}

type Json = Record<string, unknown>;

export function fakeCloudflare(options: FakeCloudflareOptions = {}) {
  const account = options.account ?? 'acc0123456789abcdef0123456789abc';
  const state = {
    account,
    databases: [] as { uuid: string; name: string; sqlite: DatabaseSync }[],
    buckets: new Set<string>(),
    teamDomain:
      options.teamDomain === undefined
        ? 'equipe.cloudflareaccess.com'
        : options.teamDomain,
    apps: [] as {
      id: string;
      aud: string;
      name: string;
      destinations: { type: string; uri: string }[];
      policies: {
        id: string;
        name: string;
        decision: string;
        include: Json[];
      }[];
    }[],
    tokens: [] as {
      id: string;
      name: string;
      value: string;
      permissions: string[];
    }[],
    worker:
      options.worker === undefined
        ? { name: 'mon-site', tag: 'tag-mon-site', deployed: true }
        : options.worker,
    secrets: new Map<string, string>(),
    triggers: (
      options.triggers ?? [
        {
          trigger_uuid: 'trig-prod',
          trigger_name: 'production',
          branch_includes: ['main'],
          branch_excludes: [],
          build_command: 'npm run build',
          deploy_command: 'npx wrangler deploy',
        },
        {
          trigger_uuid: 'trig-preview',
          trigger_name: 'Deploy non-production branches',
          branch_includes: ['*'],
          branch_excludes: ['main'],
          build_command: 'npm run build',
          deploy_command: 'npx wrangler versions upload',
        },
      ]
    ).map((trigger) => ({
      ...trigger,
      env: {} as Record<string, { value: string; is_secret: boolean }>,
    })),
    /** Toutes les requêtes reçues (méthode, chemin, corps). */
    requests: [] as { method: string; path: string; body: string }[],
  };

  const permissionGroups = [
    { id: 'pg-d1-read', name: 'D1 Read' },
    { id: 'pg-d1-write', name: 'D1 Write' },
    { id: 'pg-ci-read', name: 'Workers CI Read' },
    { id: 'pg-ci-write', name: 'Workers CI Write' },
  ];

  let counter = 0;
  const id = (prefix: string) => `${prefix}-${++counter}`;
  const ok = (result: unknown, status = 200) =>
    Response.json(
      { success: true, errors: [], messages: [], result },
      { status },
    );
  const fail = (status: number, message: string, code = 10000) =>
    Response.json(
      {
        success: false,
        errors: [{ code, message }],
        messages: [],
        result: null,
      },
      { status },
    );

  async function handle(
    method: string,
    path: string,
    body: Json | null,
  ): Promise<Response> {
    const A = `/accounts/${account}`;
    let match: RegExpMatchArray | null;

    if (method === 'GET' && path === '/accounts')
      return ok([{ id: account, name: 'Compte' }]);

    // D1
    if (path.startsWith(`${A}/d1/database`)) {
      if (
        method === 'GET' &&
        (match = path.match(/\/d1\/database\?name=(.+)$/))
      ) {
        const name = decodeURIComponent(match[1]);
        return ok(
          state.databases
            .filter((db) => db.name === name)
            .map(({ uuid, name }) => ({ uuid, name })),
        );
      }
      if (method === 'POST' && path === `${A}/d1/database`) {
        const db = {
          uuid: crypto.randomUUID(),
          name: String(body?.name),
          sqlite: new DatabaseSync(':memory:'),
        };
        state.databases.push(db);
        return ok({ uuid: db.uuid, name: db.name });
      }
      if (
        method === 'POST' &&
        (match = path.match(/\/d1\/database\/([^/]+)\/query$/))
      ) {
        const db = state.databases.find(
          (candidate) => candidate.uuid === match![1],
        );
        if (!db) return fail(404, 'Database not found', 7404);
        const sql = String(body?.sql);
        const params = (body?.params as unknown[]) ?? [];
        if (/^\s*select/i.test(sql)) {
          return ok([
            {
              results: db.sqlite.prepare(sql).all(...(params as never[])),
              success: true,
            },
          ]);
        }
        if (params.length) db.sqlite.prepare(sql).run(...(params as never[]));
        else db.sqlite.exec(sql);
        return ok([{ results: [], success: true }]);
      }
    }

    // R2
    if (
      (match = path.match(new RegExp(`^${A}/r2/buckets/([^/]+)$`))) &&
      method === 'GET'
    ) {
      return state.buckets.has(match[1])
        ? ok({ name: match[1] })
        : fail(404, 'The specified bucket does not exist.', 10006);
    }
    if (path === `${A}/r2/buckets` && method === 'POST') {
      state.buckets.add(String(body?.name));
      return ok({ name: body?.name });
    }

    // Access
    if (path === `${A}/access/organizations` && method === 'GET') {
      return state.teamDomain
        ? ok({ auth_domain: state.teamDomain })
        : fail(404, 'access.api.error.not_found', 12130);
    }
    if (path === `${A}/access/apps` && method === 'GET') return ok(state.apps);
    if (path === `${A}/access/apps` && method === 'POST') {
      const app = {
        id: id('app'),
        aud: `aud${'0'.repeat(58)}${counter}`.slice(0, 64),
        name: String(body?.name),
        destinations:
          (body?.destinations as { type: string; uri: string }[]) ?? [],
        policies: ((body?.policies as Json[]) ?? []).map((policy) => ({
          id: id('pol'),
          name: String(policy.name),
          decision: String(policy.decision),
          include: policy.include as Json[],
        })),
      };
      state.apps.push(app);
      return ok(app);
    }
    if (
      (match = path.match(
        new RegExp(`^${A}/access/apps/([^/]+)/policies/([^/]+)$`),
      )) &&
      method === 'PUT'
    ) {
      const app = state.apps.find((candidate) => candidate.id === match![1]);
      const policy = app?.policies.find(
        (candidate) => candidate.id === match![2],
      );
      if (!policy) return fail(404, 'not found');
      policy.include = body?.include as Json[];
      return ok(policy);
    }

    // Jetons de compte
    if (path === `${A}/tokens/permission_groups` && method === 'GET')
      return ok(permissionGroups);
    if (path === `${A}/tokens` && method === 'POST') {
      const groups = ((body?.policies as Json[]) ?? []).flatMap((policy) =>
        ((policy.permission_groups as { id: string }[]) ?? []).map(
          (group) => group.id,
        ),
      );
      const token = {
        id: id('tok'),
        name: String(body?.name),
        value: `secret-${id('val')}`,
        permissions: groups,
      };
      state.tokens.push(token);
      return ok({ id: token.id, name: token.name, value: token.value });
    }

    if (
      (match = path.match(new RegExp(`^${A}/tokens/([^/]+)$`))) &&
      method === 'DELETE'
    ) {
      state.tokens = state.tokens.filter((token) => token.id !== match![1]);
      return ok({ id: match[1] });
    }

    // Worker
    if (path === `${A}/workers/scripts` && method === 'GET') {
      return ok(
        state.worker ? [{ id: state.worker.name, tag: state.worker.tag }] : [],
      );
    }
    if (
      state.worker &&
      path === `${A}/workers/scripts/${state.worker.name}/secrets`
    ) {
      if (method === 'GET')
        return ok(
          [...state.secrets.keys()].map((name) => ({
            name,
            type: 'secret_text',
          })),
        );
      if (method === 'PUT') {
        if (!state.worker.deployed) {
          return fail(
            400,
            'Secrets cannot be added to a Worker that only has static assets.',
            10215,
          );
        }
        state.secrets.set(String(body?.name), String(body?.text));
        return ok({ name: body?.name, type: 'secret_text' });
      }
    }

    // Workers Builds
    if (
      state.worker &&
      path === `${A}/builds/workers/${state.worker.tag}/triggers` &&
      method === 'GET'
    ) {
      return ok(
        state.triggers.map((trigger) =>
          Object.fromEntries(
            Object.entries(trigger).filter(([key]) => key !== 'env'),
          ),
        ),
      );
    }
    if (
      (match = path.match(
        new RegExp(`^${A}/builds/triggers/([^/]+)/environment_variables$`),
      ))
    ) {
      const trigger = state.triggers.find(
        (candidate) => candidate.trigger_uuid === match![1],
      );
      if (!trigger) return fail(404, 'Not found', 12000);
      if (method === 'GET') {
        return ok(
          Object.fromEntries(
            Object.entries(trigger.env).map(([key, v]) => [
              key,
              { is_secret: v.is_secret, value: v.is_secret ? null : v.value },
            ]),
          ),
        );
      }
      if (method === 'PATCH') {
        for (const [key, value] of Object.entries(body ?? {})) {
          trigger.env[key] = value as { value: string; is_secret: boolean };
        }
        return ok({});
      }
    }
    if (
      (match = path.match(new RegExp(`^${A}/builds/triggers/([^/]+)$`))) &&
      method === 'PATCH'
    ) {
      const trigger = state.triggers.find(
        (candidate) => candidate.trigger_uuid === match![1],
      );
      if (!trigger) return fail(404, 'Not found', 12000);
      Object.assign(trigger, body);
      return ok(trigger);
    }

    return fail(404, `Route inconnue du faux API : ${method} ${path}`, 7003);
  }

  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (!url.href.startsWith('https://api.cloudflare.com/client/v4/')) {
      return new Response('hors API', { status: 400 });
    }
    if (
      new Headers(init?.headers).get('Authorization') !== 'Bearer jeton-setup'
    ) {
      return fail(403, 'Authentication error', 10000);
    }
    const path = url.pathname.replace('/client/v4', '') + url.search;
    const method = init?.method ?? 'GET';
    const raw = init?.body ? String(init.body) : '';
    state.requests.push({ method, path, body: raw });
    return handle(method, path, raw ? (JSON.parse(raw) as Json) : null);
  }) as typeof fetch;

  return { fetch: fetcher, state };
}
