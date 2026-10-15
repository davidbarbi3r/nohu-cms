/**
 * Le package publié ne doit contenir aucune valeur liée à un compte
 * Cloudflare : identifiant de compte, audience Access, domaine d'équipe,
 * email réel. Chaque site garde ces valeurs dans son propre wrangler.jsonc.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

const ALLOWED_EMAIL_DOMAINS = /@(example\.(com|test)|exemple\.(fr|test))$/;
const ALLOWED_TEAMS = new Set(['mon-equipe', 'exemple']);

function packedFiles(): string[] {
  const output = execFileSync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  );
  const [result] = JSON.parse(output) as { files: { path: string }[] }[];
  return result.files.map((file) => file.path);
}

describe('package publié', () => {
  const files = packedFiles();

  it('contient le code construit, les composants et le skill', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'dist/index.js',
        'dist/worker/index.js',
        'dist/content/index.js',
        'dist/astro/index.js',
        'dist/cli/index.js',
        'dist/admin/admin.js',
        'dist/admin/admin.css',
        'astro/AdminPage.astro',
        'components/CmsImage.astro',
        'skills/nohu-cms-setup/SKILL.md',
      ]),
    );
    expect(files.some((file) => file.startsWith('src/'))).toBe(false);
    expect(files.some((file) => file.startsWith('test/'))).toBe(false);
  });

  it('ne contient aucune donnée de compte', () => {
    const problems: string[] = [];
    for (const file of files) {
      if (!/\.(js|ts|astro|md|json|css)$/.test(file)) continue;
      const source = readFileSync(join(root, file), 'utf8');
      for (const match of source.matchAll(
        /(?<![0-9a-zA-Z])[0-9a-f]{32}(?![0-9a-zA-Z])/g,
      )) {
        if (!/^0+$/.test(match[0]))
          problems.push(`${file} : identifiant ${match[0]}`);
      }
      for (const match of source.matchAll(
        /(?<![0-9a-zA-Z])[0-9a-f]{64}(?![0-9a-zA-Z])/g,
      )) {
        problems.push(`${file} : audience ${match[0]}`);
      }
      for (const match of source.matchAll(
        /https?:\/\/([a-z0-9-]+)\.cloudflareaccess\.com/g,
      )) {
        if (!ALLOWED_TEAMS.has(match[1]))
          problems.push(`${file} : équipe ${match[1]}`);
      }
      for (const match of source.matchAll(
        /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
      )) {
        if (!ALLOWED_EMAIL_DOMAINS.test(match[0]))
          problems.push(`${file} : email ${match[0]}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
