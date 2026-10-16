import type { BuildState, PublishResult, PublishStatus } from '../protocol';
import type { CmsEnv } from './env';
import { now } from './http';

async function setMeta(env: CmsEnv, entries: Record<string, string>) {
  await env.DB.batch(
    Object.entries(entries).map(([key, value]) =>
      env.DB.prepare(
        'INSERT INTO cms_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ).bind(key, value),
    ),
  );
}

/**
 * Relance le build du site (deploy hook Workers Builds). Le build relit D1 :
 * la modification est en ligne quelques minutes plus tard. Si un build est
 * déjà en attente, Cloudflare ne le duplique pas.
 */
export async function triggerRebuild(
  env: CmsEnv,
  email: string,
): Promise<PublishResult> {
  if (!env.DEPLOY_HOOK_URL) {
    return {
      triggered: false,
      message:
        'Enregistré. La mise en ligne automatique n’est pas configurée (DEPLOY_HOOK_URL).',
    };
  }
  try {
    const response = await fetch(env.DEPLOY_HOOK_URL, { method: 'POST' });
    if (!response.ok) throw new Error(String(response.status));
    const payload = (await response.json().catch(() => null)) as {
      result?: { build_uuid?: string };
    } | null;
    await setMeta(env, {
      last_publish_at: now(),
      last_publish_by: email,
      last_build_uuid: payload?.result?.build_uuid ?? '',
      last_build_state: '',
    });
    return {
      triggered: true,
      message: 'Enregistré. Le site sera à jour d’ici deux à trois minutes.',
    };
  } catch {
    return {
      triggered: false,
      message:
        'Enregistré, mais la mise en ligne n’a pas pu être lancée. Réessaie avec « Republier le site ».',
    };
  }
}

interface BuildPayload {
  status?: string;
  build_outcome?: string | null;
  stopped_on?: string | null;
}

const TERMINAL: BuildState[] = ['success', 'failure', 'cancelled'];

/** Statut Workers Builds → état affiché dans l'admin. */
function buildState(build: BuildPayload): BuildState {
  if (build.status === 'queued' || build.status === 'initializing') {
    return 'pending';
  }
  if (build.status !== 'stopped') return 'running';
  if (build.build_outcome === 'success') return 'success';
  if (
    build.build_outcome === 'cancelled' ||
    build.build_outcome === 'canceled'
  ) {
    return 'cancelled';
  }
  return 'failure';
}

/** Build lu sur l'API Workers Builds (jeton « Workers CI Read »). */
async function fetchBuild(
  env: CmsEnv,
  uuid: string,
): Promise<{ state: BuildState; stoppedOn: string }> {
  const unknown = { state: 'unknown' as const, stoppedOn: '' };
  if (!env.CMS_BUILDS_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) return unknown;
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/builds/builds/${uuid}`,
      { headers: { Authorization: `Bearer ${env.CMS_BUILDS_TOKEN}` } },
    );
    if (!response.ok) return unknown;
    const payload = (await response.json()) as { result?: BuildPayload };
    if (!payload.result) return unknown;
    return {
      state: buildState(payload.result),
      stoppedOn: payload.result.stopped_on ?? '',
    };
  } catch {
    return unknown;
  }
}

async function readMeta(env: CmsEnv) {
  const { results } = await env.DB.prepare(
    "SELECT key, value FROM cms_meta WHERE key LIKE 'last_%'",
  ).all<{ key: string; value: string }>();
  return Object.fromEntries(
    results.map((row) => [row.key, row.value]),
  ) as Record<string, string | undefined>;
}

/**
 * Dernière publication et état du build qu'elle a lancé. Un build terminé
 * est mémorisé : l'API n'est plus interrogée pour lui.
 */
export async function publishStatus(env: CmsEnv): Promise<PublishStatus> {
  const meta = await readMeta(env);
  let build: PublishStatus['build'] = null;
  if (meta.last_build_uuid) {
    let state = meta.last_build_state as BuildState | undefined;
    if (!state || !TERMINAL.includes(state)) {
      const fetched = await fetchBuild(env, meta.last_build_uuid);
      state = fetched.state;
      if (TERMINAL.includes(state)) {
        const update: Record<string, string> = { last_build_state: state };
        if (state === 'success') {
          update.last_success_at = fetched.stoppedOn || now();
        }
        await setMeta(env, update);
        Object.assign(meta, update);
      }
    }
    build = { uuid: meta.last_build_uuid, state };
  }
  return {
    lastPublishAt: meta.last_publish_at ?? '',
    lastPublishBy: meta.last_publish_by ?? '',
    lastSuccessAt: meta.last_success_at ?? '',
    build,
  };
}

/**
 * Vérifie le dernier build (cron du Worker) : en cas d'échec, prévient une
 * seule fois via ALERT_WEBHOOK_URL. Le site affiche alors toujours la
 * version précédente.
 */
export async function checkBuild(env: CmsEnv, siteName = ''): Promise<void> {
  const status = await publishStatus(env);
  if (!status.build || status.build.state !== 'failure') return;
  if (!env.ALERT_WEBHOOK_URL) return;
  const meta = await readMeta(env);
  if (meta.last_build_alerted === status.build.uuid) return;
  const text = `${siteName ? `${siteName} : ` : ''}la mise en ligne du site a échoué (build ${status.build.uuid}, demandée par ${status.lastPublishBy || 'inconnu'}). Le site affiche encore la version précédente : regarde le journal du build dans Workers Builds.`;
  const response = await fetch(env.ALERT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, content: text }),
  }).catch(() => null);
  if (response?.ok) {
    await setMeta(env, { last_build_alerted: status.build.uuid });
  }
}
