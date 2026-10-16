/**
 * Badge de publication de l'admin : traduit l'état de la dernière mise en
 * ligne (build Workers Builds) en un message pour la cliente.
 */
import { BUILD_DURATION_MS, type PublishStatus } from '../protocol';

export interface PublishBadge {
  tone: 'building' | 'ok' | 'error' | 'neutral';
  label: string;
  /** Explication affichée au survol / sous le badge. */
  help?: string;
  /** L'admin interroge à nouveau le Worker tant que c'est vrai. */
  poll: boolean;
  /** Proposer « Republier ». */
  canRepublish: boolean;
}

const dateTime = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

export function publishBadge(
  status: PublishStatus,
  now = Date.now(),
): PublishBadge {
  const state = status.build?.state;
  if (state === 'pending' || state === 'running') {
    return {
      tone: 'building',
      label: 'Mise à jour du site en cours (2 à 3 min)…',
      poll: true,
      canRepublish: false,
    };
  }
  if (state === 'failure' || state === 'cancelled') {
    return {
      tone: 'error',
      label: 'La dernière mise en ligne a échoué',
      help: 'Tes modifications sont bien enregistrées, mais le site affiche encore la version précédente. Réessaie avec « Republier » ; si l’échec se répète, préviens la personne qui gère le site.',
      poll: false,
      canRepublish: true,
    };
  }
  if (state === 'success') {
    return {
      tone: 'ok',
      label: status.lastSuccessAt
        ? `En ligne depuis le ${dateTime(status.lastSuccessAt)}`
        : 'En ligne',
      poll: false,
      canRepublish: true,
    };
  }
  // État inconnu (pas de jeton de lecture des builds) : estimation.
  const since = status.lastPublishAt
    ? now - new Date(status.lastPublishAt).getTime()
    : Infinity;
  if (since < BUILD_DURATION_MS) {
    return {
      tone: 'building',
      label: 'Mise à jour du site en cours (2 à 3 min)…',
      poll: true,
      canRepublish: false,
    };
  }
  return {
    tone: 'neutral',
    label: status.lastPublishAt
      ? `Dernière publication : ${dateTime(status.lastPublishAt)}`
      : 'Site publié',
    poll: false,
    canRepublish: true,
  };
}
