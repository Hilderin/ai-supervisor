/**
 * Ingestion des événements SSE d'OpenChamber : invalidation des caches de
 * livraison et de plan. (Les kicks du compagnon et du vérificateur ont été
 * retirés avec les sous-agents, décision du 2026-11-12.)
 */
import { deliveryEventRelevant, invalidateDelivery } from './delivery.mts';
import { invalidatePlan } from './plan.mts';
import { invalidateCriteria } from './criteria.mts';
import { invalidateAnswers } from './answers.mts';

export interface EventFrame { type?: string; data?: Record<string, unknown> }

/** invalide la livraison, le plan, les critères et les réponses concernés par la frame SSE */
export function ingestEvent(frame: EventFrame): void {
  const type = String(frame.type ?? '');
  const data = frame.data ?? {};
  const sid = String((data as { sessionID?: string }).sessionID ?? '');
  // un événement sans sessionID exploitable vide tout le cache : mieux vaut
  // une lecture fraîche qu'une carte figée sur une ancienne réponse
  if (deliveryEventRelevant(type)) invalidateDelivery(sid || undefined);
  if (/^message\./.test(type) || /^session\.(text\.|step\.ended$|idle$)/.test(type)) {
    invalidatePlan(sid || undefined);
    invalidateCriteria(sid || undefined);
    invalidateAnswers(sid || undefined);
  }
}
