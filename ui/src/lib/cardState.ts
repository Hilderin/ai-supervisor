import type { FleetRow } from '../types';
import { isDone, isWaiting } from './fleet';
import type { Section } from './placement';

/**
 * Quatre états visibles. La section de placement ne sert qu'à la décoration :
 * l'ordre et la hauteur des cartes n'en dépendent jamais.
 */
export type CardState = 'waiting' | 'busy' | 'done' | 'idle';

export function cardState(row: FleetRow, placement?: Section): CardState {
  if (isWaiting(row)) return 'waiting';
  if (row.status === 'busy') return 'busy';
  if (placement === 'done') return 'done';
  if (placement === 'running' || placement === 'waiting') return 'idle';
  return isDone(row) ? 'done' : 'idle';
}

/** Libellé de l'état ; l'attente distingue une question d'une permission. */
export function cardStateLabel(
  state: CardState,
  waitingKind?: 'form' | 'permission',
): string {
  if (state === 'waiting') return waitingKind === 'permission' ? 'permission demandée' : 'attend ta réponse';
  if (state === 'busy') return 'travaille';
  if (state === 'done') return 'terminé';
  return 'fini, à valider';
}
