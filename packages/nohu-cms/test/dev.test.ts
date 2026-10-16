/** Admin locale (`nohu-cms dev`) : remplacement du site reconstruit. */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { replaceDir } from '../src/cli/dev';

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'nohu-dev-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe('replaceDir', () => {
  it('remplace le site sans jamais supprimer une page qui existe encore', () => {
    const next = temp();
    const dist = temp();
    mkdirSync(join(dist, 'admin'));
    writeFileSync(join(dist, 'admin', 'index.html'), 'ancien');
    writeFileSync(join(dist, 'perime.html'), 'à retirer');
    mkdirSync(join(next, 'admin'));
    writeFileSync(join(next, 'admin', 'index.html'), 'nouveau');
    writeFileSync(join(next, 'nouvelle.html'), 'ajoutée');

    const removedBeforeCopy: string[] = [];
    replaceDir(next, dist, {
      onRemove: (path) => {
        if (!existsSync(join(dist, 'nouvelle.html')))
          removedBeforeCopy.push(path);
      },
    });

    expect(readFileSync(join(dist, 'admin', 'index.html'), 'utf8')).toBe(
      'nouveau',
    );
    expect(readFileSync(join(dist, 'nouvelle.html'), 'utf8')).toBe('ajoutée');
    expect(existsSync(join(dist, 'perime.html'))).toBe(false);
    // Rien n'est retiré avant que la nouvelle version soit copiée.
    expect(removedBeforeCopy).toEqual([]);
  });
});
