/**
 * Préparation d'une photo dans le navigateur : redimensionnée en plusieurs
 * largeurs (WebP, ou JPEG si le navigateur ne sait pas produire de WebP),
 * puis envoyée au Worker qui la range dans R2.
 */
import { IMAGE_WIDTHS, MAX_IMAGE_WIDTH, type MediaUpload } from '../protocol';
import { api } from './api';

export const ACCEPTED_IMAGES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
];

/** Largeurs standard plus petites que la photo, plus sa propre largeur (plafonnée). */
export function targetWidths(naturalWidth: number): number[] {
  const largest = Math.min(naturalWidth, MAX_IMAGE_WIDTH);
  return [...IMAGE_WIDTHS.filter((width) => width < largest * 0.9), largest];
}

const encode = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('conversion'))),
      type,
      quality,
    ),
  );

async function render(
  bitmap: ImageBitmap,
  widths: number[],
  type: string,
  quality: number,
) {
  const variants: { width: number; blob: Blob }[] = [];
  for (const width of widths) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.round((bitmap.height * width) / bitmap.width);
    canvas
      .getContext('2d')!
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    variants.push({ width, blob: await encode(canvas, type, quality) });
  }
  return variants;
}

export async function uploadImage(file: File): Promise<MediaUpload> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: 'from-image',
  });
  try {
    const widths = targetWidths(bitmap.width);
    const largest = widths[widths.length - 1];
    let variants = await render(bitmap, widths, 'image/webp', 0.82);
    let extension = 'webp';
    // Certains navigateurs ignorent le WebP et produisent du PNG : JPEG alors.
    if (variants.some((variant) => variant.blob.type !== 'image/webp')) {
      variants = await render(bitmap, widths, 'image/jpeg', 0.85);
      extension = 'jpg';
    }
    const form = new FormData();
    for (const variant of variants) {
      form.append(
        `variant-${variant.width}`,
        variant.blob,
        `${variant.width}.${extension}`,
      );
    }
    form.append(
      'height',
      String(Math.round((bitmap.height * largest) / bitmap.width)),
    );
    return await api.uploadMedia(form);
  } finally {
    bitmap.close();
  }
}

/** Variante la plus adaptée à un texte (≤ 1280 px), pour l'éditeur riche. */
export const inlineVariant = (upload: MediaUpload) =>
  [...upload.srcset].reverse().find((variant) => variant.width <= 1280) ??
  upload.srcset[0];
