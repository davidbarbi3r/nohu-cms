/** Contrat entre l'API du Worker et l'admin. */
import type { ImageVariant } from './fields';

export interface PublishResult {
  triggered: boolean;
  message: string;
}

export interface PublishStatus {
  /** Dernière reconstruction demandée (ISO), vide si jamais. */
  lastPublishAt: string;
  lastPublishBy: string;
}

/** Durée typique d'un build Workers Builds, pour l'indicateur de l'admin. */
export const BUILD_DURATION_MS = 3 * 60 * 1000;

/** Largeurs des variantes produites à l'envoi d'une photo. */
export const IMAGE_WIDTHS = [640, 1280, 2048] as const;
export const MAX_IMAGE_WIDTH = 2048;

/** Réponse de `POST /api/admin/media`. */
export interface MediaUpload {
  id: string;
  /** Plus grande variante. */
  src: string;
  width: number;
  height: number;
  srcset: ImageVariant[];
}

/** Erreur renvoyée par l'API : message en français, et détail par champ. */
export interface ApiErrorBody {
  error: string;
  fields?: Record<string, string>;
}
