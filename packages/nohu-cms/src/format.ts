/** `06 09 05 00 01` → `tel:+33609050001`. */
export function phoneHref(display: string): string {
  const digits = display.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return `tel:${digits}`;
  if (digits.startsWith('0')) return `tel:+33${digits.slice(1)}`;
  return `tel:${digits}`;
}

/** Découpe un texte en paragraphes (séparés par une ligne vide). */
export const toParagraphs = (value: string) =>
  value
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

export type Chunk =
  | { type: 'text'; value: string }
  | { type: 'link'; value: string; href: string }
  | { type: 'break' };

const LINKABLE =
  /([^\s@]+@[^\s@]+\.[a-z]{2,})|((?:\+33|0)\d(?:[\s.\u00a0]?\d{2}){4})/gi;

/**
 * Découpe une ligne en morceaux affichables : texte, retours à la ligne et,
 * si demandé, emails / téléphones transformés en liens.
 */
export function toChunks(value: string, linkify = false): Chunk[] {
  const chunks: Chunk[] = [];
  value.split('\n').forEach((line, index) => {
    if (index > 0) chunks.push({ type: 'break' });
    if (!linkify) {
      chunks.push({ type: 'text', value: line });
      return;
    }
    let cursor = 0;
    for (const match of line.matchAll(LINKABLE)) {
      const start = match.index ?? 0;
      if (start > cursor) {
        chunks.push({ type: 'text', value: line.slice(cursor, start) });
      }
      const [found, mail] = match;
      chunks.push({
        type: 'link',
        value: found,
        href: mail ? `mailto:${found}` : phoneHref(found),
      });
      cursor = start + found.length;
    }
    if (cursor < line.length) {
      chunks.push({ type: 'text', value: line.slice(cursor) });
    }
  });
  return chunks;
}

const longDate = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** `2026-11-14` → « 14 novembre 2026 » (chaîne vide si la date est invalide). */
export function formatDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? '' : longDate.format(parsed);
}
