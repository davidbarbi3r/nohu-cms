/** Badge de publication de l'admin (issue #17) : ce que voit la cliente. */
import { describe, expect, it } from 'vitest';
import { publishBadge } from '../src/admin/publish-badge';
import type { PublishStatus } from '../src/protocol';

const NOW = Date.parse('2026-10-16T10:00:00.000Z');

const status = (overrides: Partial<PublishStatus>): PublishStatus => ({
  lastPublishAt: '2026-10-16T09:59:00.000Z',
  lastPublishBy: 'edwige@example.com',
  lastSuccessAt: '2026-10-15T08:00:00.000Z',
  build: null,
  ...overrides,
});

describe('badge de publication', () => {
  it('build en cours : message d’attente, et l’admin interroge à nouveau', () => {
    for (const state of ['pending', 'running'] as const) {
      const badge = publishBadge(status({ build: { uuid: 'b', state } }), NOW);
      expect(badge).toMatchObject({ tone: 'building', poll: true });
      expect(badge.label).toMatch(/en cours/);
    }
  });

  it('build réussi : date de la dernière mise en ligne réussie', () => {
    const badge = publishBadge(
      status({
        build: { uuid: 'b', state: 'success' },
        lastSuccessAt: '2026-10-16T09:58:00.000Z',
      }),
      NOW,
    );
    expect(badge).toMatchObject({ tone: 'ok', poll: false });
    expect(badge.label).toMatch(/^En ligne/);
  });

  it('build en échec : alerte claire et invitation à republier', () => {
    const badge = publishBadge(
      status({ build: { uuid: 'b', state: 'failure' } }),
      NOW,
    );
    expect(badge).toMatchObject({
      tone: 'error',
      poll: false,
      canRepublish: true,
    });
    expect(badge.label).toMatch(/échoué/);
    expect(badge.help).toMatch(/version précédente/);
  });

  it('build annulé : même traitement qu’un échec', () => {
    const badge = publishBadge(
      status({ build: { uuid: 'b', state: 'cancelled' } }),
      NOW,
    );
    expect(badge.tone).toBe('error');
  });

  it('état inconnu : estimation à partir de l’heure de la demande (comportement historique)', () => {
    const recent = publishBadge(
      status({ build: { uuid: 'b', state: 'unknown' } }),
      NOW,
    );
    expect(recent).toMatchObject({ tone: 'building', poll: true });
    const old = publishBadge(
      status({ lastPublishAt: '2026-10-16T09:00:00.000Z', build: null }),
      NOW,
    );
    expect(old.tone).toBe('neutral');
    expect(old.label).toMatch(/^Dernière publication/);
  });

  it('jamais publié', () => {
    const badge = publishBadge(status({ lastPublishAt: '', build: null }), NOW);
    expect(badge).toMatchObject({
      tone: 'neutral',
      label: 'Site publié',
      poll: false,
    });
  });
});
