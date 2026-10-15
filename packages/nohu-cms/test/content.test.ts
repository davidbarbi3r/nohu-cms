import { afterEach, describe, expect, it, vi } from 'vitest';
import { collection, page, section } from '../src/config';
import type { D1Client, Row } from '../src/content/d1';
import {
  getContent,
  getEntries,
  getEntry,
  getEntryPath,
  sanitizeRichText,
  setContentDatabase,
} from '../src/content';
import { image, list, richtext, text, textarea } from '../src/fields';

const MEDIA = '/media/1a7e8f13-de35-4a8d-8cb0-2b59238e684f';

const makeConfig = () => ({
  admin: { title: 'Test' },
  pages: {
    accueil: page('Accueil', '/', {
      hero: section('Haut', {
        title: text('Titre', 'Bienvenue !'),
        intro: textarea('Intro', 'Texte'),
        tags: list(
          'Tags',
          {
            itemLabel: 'un tag',
            itemTitle: 'text',
            fields: { text: text('Texte') },
          },
          [{ text: 'a' }],
        ),
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
});

function fakeDb(tables: Record<string, Row[]>): D1Client {
  return {
    kind: 'local',
    async query(sql, params = []) {
      if (sql.includes('FROM cms_content')) return tables.content ?? [];
      if (sql.includes('FROM cms_entries')) {
        return (tables.entries ?? []).filter(
          (row) => row.collection === params[0] && row.status === 'published',
        );
      }
      return [];
    },
    async exec() {},
  };
}

const entryRow = (slug: string, publishedAt: string, data: object): Row => ({
  id: slug,
  collection: 'articles',
  slug,
  status: 'published',
  title: `Titre ${slug} ?`,
  published_at: publishedAt,
  data: JSON.stringify(data),
  created_at: '',
  updated_at: '',
  updated_by: '',
});

afterEach(() => setContentDatabase());

describe('getContent', () => {
  it('sans base : valeurs d’origine, typographie française', async () => {
    vi.stubEnv('CMS_SOURCE', 'defaults');
    const content = await getContent(makeConfig());
    expect(content.accueil.hero.title).toBe('Bienvenue !');
    expect(content.accueil.hero.tags).toEqual([{ text: 'a' }]);
    vi.unstubAllEnvs();
  });

  it('valeurs modifiées, valeurs invalides ou orphelines ignorées', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setContentDatabase(
      fakeDb({
        content: [
          { key: 'accueil.hero.title', value: JSON.stringify('Bonjour') },
          { key: 'accueil.hero.intro', value: JSON.stringify('') },
          { key: 'accueil.ancien.champ', value: JSON.stringify('x') },
        ],
      }),
    );
    const content = await getContent(makeConfig());
    expect(content.accueil.hero.title).toBe('Bonjour');
    expect(content.accueil.hero.intro).toBe('Texte');
    const logs = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logs).toContain('accueil.hero.intro');
    expect(logs).toContain("accueil.ancien.champ : ce champ n'existe plus");
    warn.mockRestore();
  });
});

describe('getEntries', () => {
  it('trie, nettoie le HTML et complète les champs manquants', async () => {
    const config = makeConfig();
    setContentDatabase(
      fakeDb({
        entries: [
          entryRow('ancien', '2026-01-01', { summary: 'A', body: '<p>a</p>' }),
          entryRow('recent', '2026-06-01', {
            summary: 'B',
            body: `<p onclick="x">b<script>alert(1)</script></p><img src="${MEDIA}/1280.webp" alt="ok"><img src="https://evil.test/x.png">`,
          }),
        ],
      }),
    );
    const entries = await getEntries(config, 'articles');
    expect(entries.map((entry) => entry.slug)).toEqual(['recent', 'ancien']);
    expect(entries[0].title).toBe('Titre recent ?');
    expect(entries[0].data.body).toBe(
      `<p>b</p><img src="${MEDIA}/1280.webp" alt="ok" loading="lazy" decoding="async" />`,
    );
    expect(entries[0].data.cover).toBeNull();
    expect((await getEntry(config, 'articles', 'ancien'))?.data.summary).toBe(
      'A',
    );
    expect(getEntryPath(config, 'articles', entries[0])).toBe('/blog/recent');
  });
});

describe('sanitizeRichText', () => {
  it('ajoute target/rel aux liens externes', () => {
    expect(
      sanitizeRichText(
        '<a href="https://x.fr">x</a><a href="javascript:1">y</a>',
      ),
    ).toBe(
      '<a href="https://x.fr" target="_blank" rel="noopener noreferrer">x</a><a>y</a>',
    );
  });
});
