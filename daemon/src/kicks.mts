/**
 * Kicks du compagnon, alimentés par les événements SSE d'OpenChamber
 * (module neutre : évite les imports circulaires entre fleet et companion).
 *   'session.inbox.enqueued'                         → kick start (nouveau prompt)
 *   'session.execution.succeeded|failed|interrupted' → kick end (fin de tour)
 *
 * C'est aussi le point d'invalidation du cache de livraison : tout ce qui peut
 * changer le dernier message d'une session passe par ici.
 */
import { deliveryEventRelevant, invalidateDelivery } from './delivery.mts';
import { invalidatePlan } from './plan.mts';
import { verifierKick } from './verifier-kicks.mts';

const kicks = new Map<string, { start: boolean; end: boolean }>();

export function kick(sid: string, kind: 'start' | 'end') {
  const k = kicks.get(sid) ?? { start: false, end: false };
  if (kind === 'start') k.start = true; else k.end = true;
  kicks.set(sid, k);
}

export function takeKick(sid: string): { start: boolean; end: boolean } | undefined {
  const k = kicks.get(sid);
  if (k) kicks.delete(sid);
  return k;
}

export interface EventFrame { type?: string; data?: Record<string, unknown> }

/** pousse la frame SSE dans les kicks et invalide la livraison concernée */
export function ingestEvent(frame: EventFrame): void {
  const type = String(frame.type ?? '');
  const data = frame.data ?? {};
  const sid = String((data as { sessionID?: string }).sessionID ?? '');
  // un événement sans sessionID exploitable vide tout le cache : mieux vaut
  // une lecture fraîche qu'une carte figée sur une ancienne réponse
  if (deliveryEventRelevant(type)) invalidateDelivery(sid || undefined);
  if (/^message\./.test(type) || /^session\.(text\.|step\.ended$|idle$)/.test(type)) {
    invalidatePlan(sid || undefined);
  }
  if (!sid) return;
  if (type === 'session.inbox.enqueued') kick(sid, 'start');
  else if (/^session\.execution\.(succeeded|failed|interrupted)$/.test(type) || type === 'session.idle') {
    kick(sid, 'end');
    verifierKick(sid, 'turn');   // le vérificateur juge les preuves déposées pendant le tour
  }
}
