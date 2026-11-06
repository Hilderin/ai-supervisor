import type { Delivery } from '../types';

/**
 * État d'affichage du bloc de livraison. Fonction pure pour couvrir les cas
 * sans DOM : chargement, aucune réponse, indisponible, contenu.
 */
export type DeliveryView = 'hidden' | 'loading' | 'empty' | 'error' | 'content';

export function deliveryView(args: {
  enabled: boolean;
  loading: boolean;
  error: boolean;
  delivery: Delivery | null;
  done: boolean;
}): DeliveryView {
  const { enabled, loading, error, delivery, done } = args;
  if (!enabled) return 'hidden';
  if (loading && !delivery) return 'loading';
  if (error || delivery?.state === 'unavailable') return 'error';
  if (!delivery || delivery.state === 'empty') return done ? 'empty' : 'hidden';
  return 'content';
}

/** Une réponse est « longue » au-delà de ce seuil (repliage « voir plus »). */
export function isLongDelivery(markdown: string | undefined): boolean {
  if (!markdown) return false;
  return markdown.length > 600 || markdown.split('\n').length > 10;
}
