import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from 'jose';
import { describe, expect, it } from 'vitest';
import { collection, page, section } from '../src/config';
import { image, richtext, text, textarea } from '../src/fields';
import { authenticate } from '../src/worker/auth';
import { createCmsWorker, removeOrphanMedia } from '../src/worker';
import { ctx, fakeEnv } from './helpers/cloudflare';

const config = {
  admin: { title: 'Test' },
  pages: {
    accueil: page('Accueil', '/', {
      hero: section('Haut', {
        title: text('Titre', 'Bienvenue', { max: 20 }),
        photo: image('Photo', { src: '/hero.jpg', alt: 'Hero' }),
      }),
    }),
  },
  collections: {
    articles: collection('Articles', {
      itemLabel: 'un article',
      path: '/blog/[slug]',
      fields: {
        summary: textarea('Résumé'),
        cover: image('Photo'),
        body: richtext('Texte'),
      },
    }),
  },
};

const worker = createCmsWorker(config);
const BASE = 'http://localhost:8788';

async function call(
  env: ReturnType<typeof fakeEnv>,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] =
      'application/json';
  }
  const response = await worker.fetch!(
    new Request(`${BASE}${path}`, init) as never,
    env,
    ctx,
  );
  return {
    status: response.status,
    body: (await response.json().catch(() => null)) as any,
  };
}

describe('authentification', () => {
  const issuer = 'https://equipe.cloudflareaccess.com';
  const request = (token: string) =>
    new Request('https://site.fr/api/admin/me', {
      headers: { 'Cf-Access-Jwt-Assertion': token },
    });

  async function setup() {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k', alg: 'RS256' };
    const keys = createLocalJWKSet({ keys: [jwk] });
    const sign = (claims: { aud: string; email: string }) =>
      new SignJWT({ email: claims.email })
        .setProtectedHeader({ alg: 'RS256', kid: 'k' })
        .setIssuer(issuer)
        .setAudience(claims.aud)
        .setExpirationTime('1h')
        .sign(privateKey);
    const env = fakeEnv({
      ACCESS_TEAM_DOMAIN: issuer,
      ACCESS_AUD: 'aud-site-a',
      DEV_ADMIN_EMAIL: undefined,
    });
    return { keys, sign, env };
  }

  it('accepte un jeton du bon site pour un email autorisé', async () => {
    const { keys, sign, env } = await setup();
    const token = await sign({ aud: 'aud-site-a', email: 'Admin@example.com' });
    expect(await authenticate(request(token), env, keys)).toEqual({
      ok: true,
      email: 'admin@example.com',
    });
  });

  it('refuse un jeton émis pour un autre site (autre audience)', async () => {
    const { keys, sign, env } = await setup();
    const token = await sign({ aud: 'aud-site-b', email: 'admin@example.com' });
    expect(await authenticate(request(token), env, keys)).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it('refuse un email absent de ADMIN_EMAILS', async () => {
    const { keys, sign, env } = await setup();
    const token = await sign({
      aud: 'aud-site-a',
      email: 'intrus@example.com',
    });
    expect(await authenticate(request(token), env, keys)).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it('ignore l’email de développement hors localhost', async () => {
    const env = fakeEnv();
    const response = await worker.fetch!(
      new Request('https://site.fr/api/admin/me') as never,
      env,
      ctx,
    );
    expect(response.status).toBe(500); // Access non configuré : tout est refusé.
  });
});

describe('API admin', () => {
  it('refuse une écriture envoyée depuis un autre site', async () => {
    const env = fakeEnv();
    const result = await call(
      env,
      'PUT',
      '/api/admin/content/accueil',
      { values: {} },
      {
        Origin: 'https://pirate.example',
      },
    );
    expect(result.status).toBe(403);
  });

  it('enregistre, valide et réinitialise les textes', async () => {
    const env = fakeEnv();
    const invalid = await call(env, 'PUT', '/api/admin/content/accueil', {
      values: { 'accueil.hero.title': 'x'.repeat(30), 'accueil.autre.x': 'y' },
    });
    expect(invalid.status).toBe(422);
    expect(Object.keys(invalid.body.fields)).toEqual([
      'accueil.hero.title',
      'accueil.autre.x',
    ]);

    await call(env, 'PUT', '/api/admin/content/accueil', {
      values: { 'accueil.hero.title': 'Bonjour' },
    });
    expect((await call(env, 'GET', '/api/admin/content')).body.values).toEqual({
      'accueil.hero.title': 'Bonjour',
    });

    await call(env, 'PUT', '/api/admin/content/accueil', {
      values: { 'accueil.hero.title': 'Bienvenue' },
    });
    expect((await call(env, 'GET', '/api/admin/content')).body.values).toEqual(
      {},
    );
    expect(
      (await call(env, 'PUT', '/api/admin/content/inconnue', { values: {} }))
        .status,
    ).toBe(404);
  });

  it('crée, publie, modifie et supprime une entrée', async () => {
    const env = fakeEnv();
    const draft = await call(env, 'POST', '/api/admin/entries/articles', {
      title: 'Mon premier article',
      data: { summary: 'Résumé' },
    });
    expect(draft.status).toBe(201);
    expect(draft.body.message).toMatch(/Brouillon/);

    const incomplete = await call(
      env,
      'PUT',
      `/api/admin/entries/articles/${draft.body.id}`,
      {
        title: 'Mon premier article',
        status: 'published',
        data: { summary: 'Résumé' },
      },
    );
    expect(incomplete.status).toBe(422);
    expect(Object.keys(incomplete.body.fields).sort()).toEqual([
      'data.body',
      'data.cover',
    ]);

    const published = await call(
      env,
      'PUT',
      `/api/admin/entries/articles/${draft.body.id}`,
      {
        title: 'Mon premier article',
        status: 'published',
        data: {
          summary: 'Résumé',
          body: '<p>Texte</p>',
          cover: { src: '/a.jpg', alt: 'A' },
        },
      },
    );
    expect(published.status).toBe(200);
    expect(published.body.message).toMatch(/DEPLOY_HOOK_URL/);

    const read = await call(
      env,
      'GET',
      `/api/admin/entries/articles/${draft.body.id}`,
    );
    expect(read.body.entry).toMatchObject({
      slug: 'mon-premier-article',
      status: 'published',
      publishedAt: new Date().toISOString().slice(0, 10),
    });

    const clash = await call(env, 'POST', '/api/admin/entries/articles', {
      title: 'Autre',
      slug: 'mon-premier-article',
    });
    expect(clash.body.fields.slug).toMatch(/déjà utilisée/);

    expect(
      (await call(env, 'GET', '/api/admin/entries/articles')).body.entries,
    ).toHaveLength(1);
    expect(
      (
        await call(
          env,
          'DELETE',
          `/api/admin/entries/articles/${draft.body.id}`,
        )
      ).body.deleted,
    ).toBe(true);
    expect((await call(env, 'GET', '/api/admin/entries/inconnue')).status).toBe(
      404,
    );
  });

  it('méthode et adresse inconnues', async () => {
    const env = fakeEnv();
    expect((await call(env, 'DELETE', '/api/admin/content')).status).toBe(405);
    expect((await call(env, 'GET', '/api/admin/nope')).status).toBe(404);
  });
});

describe('médias', () => {
  async function upload(env: ReturnType<typeof fakeEnv>, type = 'image/webp') {
    const form = new FormData();
    form.set('variant-640', new File([new Uint8Array(10)], 'a', { type }));
    form.set('variant-1280', new File([new Uint8Array(20)], 'b', { type }));
    form.set('height', '853');
    const response = await worker.fetch!(
      new Request(`${BASE}/api/admin/media`, {
        method: 'POST',
        body: form,
      }) as never,
      env,
      ctx,
    );
    return { status: response.status, body: (await response.json()) as any };
  }

  it('stocke les variantes et les sert sur /media', async () => {
    const env = fakeEnv();
    const { status, body } = await upload(env);
    expect(status).toBe(201);
    expect(body).toMatchObject({ width: 1280, height: 853 });
    expect(body.srcset.map((v: { width: number }) => v.width)).toEqual([
      640, 1280,
    ]);
    expect(env.MEDIA.objects.size).toBe(2);

    const served = await worker.fetch!(
      new Request(`${BASE}${body.src}`) as never,
      env,
      ctx,
    );
    expect(served.status).toBe(200);
    expect(served.headers.get('Cache-Control')).toContain('immutable');
    const unknown = await worker.fetch!(
      new Request(`${BASE}/media/autre%2F..%2Fsecret.webp`) as never,
      env,
      ctx,
    );
    expect(unknown.status).toBe(404);
  });

  it('refuse les formats inattendus', async () => {
    expect((await upload(fakeEnv(), 'image/svg+xml')).status).toBe(415);
  });

  it('supprime les photos inutilisées depuis plus de 24 h', async () => {
    const env = fakeEnv();
    const used = (await upload(env)).body;
    const unused = (await upload(env)).body;
    await call(env, 'POST', '/api/admin/entries/articles', {
      title: 'Avec photo',
      data: { body: `<img src="${used.srcset[0].src}">` },
    });
    expect(await removeOrphanMedia(env)).toEqual([]); // trop récent
    const later = Date.now() + 25 * 60 * 60 * 1000;
    expect(await removeOrphanMedia(env, later)).toEqual([unused.id]);
    expect(
      [...env.MEDIA.objects.keys()].every((key) => key.includes(used.id)),
    ).toBe(true);
  });

  it('laisse passer les fichiers statiques et les routes du site', async () => {
    const env = fakeEnv();
    const custom = createCmsWorker(config, {
      fetch: (request) =>
        new URL(request.url).pathname === '/api/contact'
          ? new Response('ok')
          : null,
    });
    const page = await custom.fetch!(
      new Request(`${BASE}/`) as never,
      env,
      ctx,
    );
    expect(await page.text()).toBe('statique');
    const contact = await custom.fetch!(
      new Request(`${BASE}/api/contact`) as never,
      env,
      ctx,
    );
    expect(await contact.text()).toBe('ok');
  });
});
