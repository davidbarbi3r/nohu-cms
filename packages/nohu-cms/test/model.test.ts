import { describe, expect, it } from 'vitest';
import {
  checkConfig,
  cleanEntryInput,
  collection,
  defineCms,
  emptyEntry,
  page,
  section,
  slugify,
  validateEntry,
} from '../src/config';
import {
  asset,
  collectAssets,
  image,
  list,
  referencedMedia,
  richtext,
  text,
  textarea,
  url,
  validateValue,
  date,
} from '../src/fields';
import { formatDate } from '../src/format';

const MEDIA = '/media/1a7e8f13-de35-4a8d-8cb0-2b59238e684f';

const articles = collection('Articles', {
  itemLabel: 'un article',
  path: '/blog/[slug]',
  fields: {
    summary: textarea('Résumé', '', { max: 220 }),
    cover: image('Photo'),
    body: richtext('Texte'),
    source: url('Source', '', { optional: true }),
  },
});

const config = {
  admin: { title: 'Site test', brandColor: '#2f5d50' },
  pages: {
    accueil: page('Accueil', '/', {
      hero: section('Haut de page', {
        title: text('Titre', 'Bienvenue', { max: 70 }),
        photo: image('Photo', { src: '/images/hero.jpg', alt: 'Un atelier' }),
        tarifs: list(
          'Tarifs',
          {
            itemLabel: 'un tarif',
            itemTitle: 'label',
            fields: { label: text('Nom'), price: text('Prix') },
          },
          [{ label: 'Séance', price: '20 €' }],
        ),
      }),
    }),
  },
  collections: { articles },
};

describe('config', () => {
  it('accepte une config valide, y compris une page et une collection de même nom', () => {
    expect(checkConfig(config)).toEqual([]);
    expect(
      checkConfig({
        ...config,
        pages: { ...config.pages, articles: page('Liste', '/blog', {}) },
      }),
    ).toEqual([]);
    expect(defineCms(config)).toBe(config);
  });

  it('signale les erreurs de structure', () => {
    const broken = {
      admin: { title: '', brandColor: 'vert' },
      pages: {
        accueil: page('Accueil', 'sans-slash', {
          hero: section('Haut', {
            title: text('Titre', '', { max: 5 }),
            tarifs: list(
              'Tarifs',
              {
                itemLabel: 'un tarif',
                itemTitle: 'inconnu' as 'label',
                fields: { label: text('Nom') },
              },
              [{ label: 'x', extra: 'y' } as { label: string }],
            ),
          }),
        }),
      },
      collections: {
        blog: collection('Blog', {
          itemLabel: 'un article',
          path: '/blog',
          fields: { title: text('Titre') },
        }),
      },
    };
    const problems = checkConfig(broken).join('\n');
    expect(problems).toContain('admin.title manquant');
    expect(problems).toContain('brandColor');
    expect(problems).toContain('doit commencer par /');
    expect(problems).toContain(
      "accueil.hero.title : valeur d'origine invalide",
    );
    expect(problems).toContain('itemTitle « inconnu » inconnu');
    expect(problems).toContain('exactement les sous-champs');
    expect(problems).toContain('path doit contenir [slug]');
    expect(problems).toContain('collections.blog.title : nom réservé');
    expect(() => defineCms(broken)).toThrow(/cms.config.ts invalide/);
  });
});

describe('champs', () => {
  it('valide les textes, liens, dates', () => {
    expect(validateValue(text('T'), '')).toMatch(/vide/);
    expect(validateValue(text('T', '', { optional: true }), '')).toBeNull();
    expect(validateValue(url('L'), 'exemple.fr')).toMatch(/lien/);
    expect(validateValue(url('L'), 'https://exemple.fr')).toBeNull();
    expect(validateValue(date('D'), '2026-02-30')).toMatch(/date/);
    expect(validateValue(date('D'), '2026-02-28')).toBeNull();
  });

  it('valide les images', () => {
    const field = image('Photo');
    expect(validateValue(field, null)).toMatch(/obligatoire/);
    expect(
      validateValue(image('P', null, { optional: true }), null),
    ).toBeNull();
    expect(validateValue(field, { src: '/a.jpg', alt: '' })).toMatch(
      /description/,
    );
    expect(
      validateValue(field, { src: 'https://x.fr/a.jpg', alt: 'a' }),
    ).toMatch(/adresse/);
    expect(validateValue(field, { src: '/../secret', alt: 'a' })).toMatch(
      /adresse/,
    );
    expect(
      validateValue(field, {
        src: `${MEDIA}/2048.webp`,
        alt: 'a',
        width: 2048,
        height: 1365,
        srcset: [
          { src: `${MEDIA}/640.webp`, width: 640 },
          { src: `${MEDIA}/2048.webp`, width: 2048 },
        ],
      }),
    ).toBeNull();
    expect(
      validateValue(field, {
        src: `${MEDIA}/2048.webp`,
        alt: 'a',
        srcset: [{ src: '/media/autre/640.webp', width: 640 }],
      }),
    ).toMatch(/variantes/);
  });

  it('accepte les images du projet, limitées à celles de la config', () => {
    const field = image('Photo');
    const grange = asset('src/assets/photos/Grange 3.JPEG', 'La grange');
    expect(grange.src).toBe('asset:assets/photos/Grange 3.JPEG');
    expect(validateValue(field, grange)).toBeNull();
    expect(
      validateValue(field, { src: 'asset:../secret.jpg', alt: 'x' }),
    ).toMatch(/adresse/);
    expect(validateValue(field, { src: 'asset:/etc/x.jpg', alt: 'x' })).toMatch(
      /adresse/,
    );
    const known = new Set([grange.src]);
    expect(validateValue(field, grange, { assets: known })).toBeNull();
    expect(
      validateValue(field, asset('assets/autre.jpg', 'x'), { assets: known }),
    ).toMatch(/inconnue/);
    const withList = list(
      'Activités',
      {
        itemLabel: 'une activité',
        itemTitle: 'titre',
        fields: { titre: text('Titre'), photo: image('Photo') },
      },
      [{ titre: 'A', photo: grange }],
    );
    expect(
      validateValue(
        withList,
        [{ titre: 'B', photo: asset('assets/x.jpg', 'x') }],
        { assets: known },
      ),
    ).toMatch(/inconnue/);
    expect([...collectAssets({ pages: { a: withList } })]).toEqual([
      grange.src,
    ]);
  });

  it('retrouve les médias cités, y compris dans du HTML', () => {
    const html = `<p>x</p><img src="${MEDIA}/1280.webp" alt="">`;
    expect(referencedMedia(JSON.stringify({ body: html }))).toEqual([
      '1a7e8f13-de35-4a8d-8cb0-2b59238e684f',
    ]);
  });
});

describe('entrées', () => {
  it('un brouillon peut être incomplet, une entrée publiée non', () => {
    const draft = {
      ...emptyEntry(articles),
      title: 'Mon article',
      slug: 'mon-article',
    };
    expect(validateEntry(articles, draft)).toEqual({});

    const errors = validateEntry(articles, { ...draft, status: 'published' });
    expect(Object.keys(errors).sort()).toEqual(
      ['data.body', 'data.cover', 'data.summary'].sort(),
    );
    expect(errors['data.cover']).toMatch(/obligatoire pour publier/);
  });

  it('nettoie les données reçues', () => {
    const input = cleanEntryInput(articles, {
      title: '  L’été à Limoges ',
      status: 'published',
      data: {
        summary: 'Résumé',
        inconnu: 'x',
        cover: { src: '/a.jpg', alt: ' A ', hack: 1 },
      },
    });
    expect(input?.slug).toBe('l-ete-a-limoges');
    expect(input?.data).toEqual({
      summary: 'Résumé',
      cover: { src: '/a.jpg', alt: 'A' },
      body: '',
      source: '',
    });
  });

  it('slugify et dates', () => {
    expect(slugify('Fly & Zen Pyjama : spécial pleine lune')).toBe(
      'fly-zen-pyjama-special-pleine-lune',
    );
    expect(formatDate('2026-11-14')).toBe('14 novembre 2026');
  });
});
