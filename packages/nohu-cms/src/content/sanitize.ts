/** Nettoyage du HTML de l'éditeur (liste blanche), au build uniquement. */
import sanitizeHtml from 'sanitize-html';
import { MEDIA_SRC } from '../fields';

/** Espaces insécables de la typographie française (avant ?!:;», après «). */
export function frenchSpacing(value: string): string {
  return value.replace(/ ([?!:;»])/g, ' $1').replace(/« /g, '« ');
}

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'em',
    'u',
    's',
    'h2',
    'h3',
    'ul',
    'ol',
    'li',
    'blockquote',
    'a',
    'hr',
    'img',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    // `loading` et `decoding` sont ajoutés par transformTags.
    img: ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowProtocolRelative: false,
  transformTags: {
    b: 'strong',
    i: 'em',
    a: (tagName, attribs) => {
      const external = /^https?:\/\//.test(attribs.href ?? '');
      return {
        tagName,
        attribs: external
          ? { ...attribs, target: '_blank', rel: 'noopener noreferrer' }
          : attribs,
      };
    },
    img: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, loading: 'lazy', decoding: 'async' },
    }),
  },
  textFilter: (text) => frenchSpacing(text),
  exclusiveFilter: (frame) =>
    (frame.tag === 'img' && !MEDIA_SRC.test(frame.attribs.src ?? '')) ||
    (frame.tag === 'p' && !frame.text.trim() && !frame.mediaChildren.length),
};

/** Seules les mises en forme prévues passent ; images uniquement depuis /media/. */
export const sanitizeRichText = (html: string) => sanitizeHtml(html, OPTIONS);
