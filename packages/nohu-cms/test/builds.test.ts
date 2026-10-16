/**
 * État réel de la mise en ligne (issue #17) : le Worker suit le build
 * Workers Builds déclenché par le deploy hook et l'expose à l'admin.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkBuild,
  publishStatus,
  triggerRebuild,
} from '../src/worker/publish';
import { createCmsWorker } from '../src/worker';
import { fakeEnv } from './helpers/cloudflare';

const HOOK =
  'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/hook-1';
const ACCOUNT = 'acc123';
const BUILD = '032c260b-ffe4-4add-b12c-2f81e97f2448';

/** Faux API Cloudflare : deploy hook + lecture d'un build. */
function cloudflare(
  build: Record<string, unknown> | 'error' = { status: 'running' },
) {
  const calls: { url: string; auth: string | null; body?: string }[] = [];
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        auth: new Headers(init?.headers).get('Authorization'),
        body: init?.body ? String(init.body) : undefined,
      });
      if (url === HOOK) {
        return Response.json({ success: true, result: { build_uuid: BUILD } });
      }
      if (url.endsWith(`/accounts/${ACCOUNT}/builds/builds/${BUILD}`)) {
        if (build === 'error') return new Response('boom', { status: 500 });
        return Response.json({
          success: true,
          result: { build_uuid: BUILD, ...build },
        });
      }
      if (url === 'https://alerte.example/hook') return new Response('ok');
      return new Response('not found', { status: 404 });
    },
  );
  vi.stubGlobal('fetch', fetcher);
  return { calls };
}

const envWithBuilds = (extra = {}) =>
  fakeEnv({
    DEPLOY_HOOK_URL: HOOK,
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
    CMS_BUILDS_TOKEN: 'lecture-builds',
    ...extra,
  });

afterEach(() => vi.unstubAllGlobals());

describe('suivi du build de mise en ligne', () => {
  it('mémorise le build lancé par le deploy hook', async () => {
    cloudflare();
    const env = envWithBuilds();
    await triggerRebuild(env, 'edwige@example.com');
    const status = await publishStatus(env);
    expect(status.build?.uuid).toBe(BUILD);
  });

  it.each([
    [{ status: 'queued' }, 'pending'],
    [{ status: 'initializing' }, 'pending'],
    [{ status: 'running' }, 'running'],
    [{ status: 'stopped', build_outcome: 'success' }, 'success'],
    [{ status: 'stopped', build_outcome: 'fail' }, 'failure'],
    [{ status: 'stopped', build_outcome: 'cancelled' }, 'cancelled'],
  ])(
    'lit l’état du build sur l’API Workers Builds (%o → %s)',
    async (build, state) => {
      const { calls } = cloudflare(build);
      const env = envWithBuilds();
      await triggerRebuild(env, 'edwige@example.com');
      const status = await publishStatus(env);
      expect(status.build?.state).toBe(state);
      const lookup = calls.find((call) => call.url.includes('/builds/builds/'));
      expect(lookup?.auth).toBe('Bearer lecture-builds');
    },
  );

  it('reste prudent sans jeton de lecture ou si l’API échoue', async () => {
    cloudflare();
    const sansJeton = envWithBuilds({ CMS_BUILDS_TOKEN: undefined });
    await triggerRebuild(sansJeton, 'a@example.com');
    expect((await publishStatus(sansJeton)).build?.state).toBe('unknown');

    cloudflare('error');
    const env = envWithBuilds();
    await triggerRebuild(env, 'a@example.com');
    expect((await publishStatus(env)).build?.state).toBe('unknown');
  });

  it('mémorise un build terminé et la date de la dernière mise en ligne réussie', async () => {
    const { calls } = cloudflare({
      status: 'stopped',
      build_outcome: 'success',
      stopped_on: '2026-10-16T10:05:00.000Z',
    });
    const env = envWithBuilds();
    await triggerRebuild(env, 'a@example.com');
    expect((await publishStatus(env)).lastSuccessAt).toBe(
      '2026-10-16T10:05:00.000Z',
    );

    const lookups = () =>
      calls.filter((call) => call.url.includes('/builds/builds/')).length;
    const before = lookups();
    expect((await publishStatus(env)).build?.state).toBe('success');
    expect(lookups()).toBe(before);
  });

  it('alerte une seule fois quand le build échoue', async () => {
    const { calls } = cloudflare({ status: 'stopped', build_outcome: 'fail' });
    const env = envWithBuilds({
      ALERT_WEBHOOK_URL: 'https://alerte.example/hook',
    });
    await triggerRebuild(env, 'edwige@example.com');
    await checkBuild(env);
    await checkBuild(env);
    const alerts = calls.filter(
      (call) => call.url === 'https://alerte.example/hook',
    );
    expect(alerts).toHaveLength(1);
    const body = JSON.parse(alerts[0].body!);
    expect(body.text).toMatch(/échoué/);
    expect(body.content).toBe(body.text);
    expect(body.text).toContain(BUILD);
  });

  it('n’alerte pas quand le build réussit ou sans webhook', async () => {
    const { calls } = cloudflare({
      status: 'stopped',
      build_outcome: 'success',
    });
    const env = envWithBuilds({
      ALERT_WEBHOOK_URL: 'https://alerte.example/hook',
    });
    await triggerRebuild(env, 'a@example.com');
    await checkBuild(env);
    cloudflare({ status: 'stopped', build_outcome: 'fail' });
    const silent = envWithBuilds();
    await triggerRebuild(silent, 'a@example.com');
    await expect(checkBuild(silent)).resolves.toBeUndefined();
    expect(
      calls.some((call) => call.url === 'https://alerte.example/hook'),
    ).toBe(false);
  });

  it('le cron du Worker vérifie le build ; le nettoyage des photos reste quotidien', async () => {
    const { calls } = cloudflare({ status: 'stopped', build_outcome: 'fail' });
    const env = envWithBuilds({
      ALERT_WEBHOOK_URL: 'https://alerte.example/hook',
    });
    await triggerRebuild(env, 'a@example.com');
    await env.MEDIA.put(
      'media/1a7e8f13-de35-4a8d-8cb0-2b59238e684f/640.webp',
      'x',
    );
    env.MEDIA.objects.get(
      'media/1a7e8f13-de35-4a8d-8cb0-2b59238e684f/640.webp',
    )!.uploaded = new Date(Date.now() - 48 * 3600 * 1000);

    const worker = createCmsWorker({ admin: { title: 'Le Chat' }, pages: {} });
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => pending.push(p),
      passThroughOnException() {},
    };
    const run = async (cron: string) => {
      await worker.scheduled!(
        { cron, scheduledTime: Date.now(), noRetry() {} } as never,
        env,
        ctx as never,
      );
      await Promise.all(pending.splice(0));
    };

    await run('*/10 * * * *');
    expect(
      calls.filter((call) => call.url === 'https://alerte.example/hook'),
    ).toHaveLength(1);
    expect(
      JSON.parse(
        calls.find((call) => call.url === 'https://alerte.example/hook')!.body!,
      ).text,
    ).toMatch(/^Le Chat : /);
    expect(env.MEDIA.objects.size).toBe(1);

    await run('0 3 * * *');
    expect(env.MEDIA.objects.size).toBe(0);
  });
});
