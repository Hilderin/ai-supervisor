import type { FleetRow } from '../types';
import { isDone, isWaiting } from './fleet';
import type { Section } from './placement';

/**
 * États visibles (2026-11-12, plus de verdict de compagnon) :
 * waiting (question/permission), busy, done (déterministe : plan 100 % +
 * critères tous validés + au repos), warning (au repos, travail incomplet),
 * error et retry (signaux OpenCode).
 *
 * La section de placement (hystérésis EN COURS ↔ TERMINÉ, placement.ts) prime
 * quand elle est connue : l'état affiché suit la section, sans saut pendant la
 * stabilisation. L'ordre et la hauteur des cartes n'en dépendent jamais.
 */
export type CardState = 'waiting' | 'busy' | 'done' | 'warning' | 'error' | 'retry';

export function cardState(row: FleetRow, placement?: Section): CardState {
  if (isWaiting(row)) return 'waiting';
  if (row.issue?.state === 'error' || row.issue?.state === 'retry') return row.issue.state;
  if (row.status === 'busy') return 'busy';
  if (placement === 'done') return 'done';
  if (placement === 'running') return 'warning';
  return isDone(row) ? 'done' : 'warning';
}

/** Libellé de l'état ; l'attente distingue une question d'une permission. */
export function cardStateLabel(
  state: CardState,
  waitingKind?: 'form' | 'permission',
): string {
  if (state === 'waiting') return waitingKind === 'permission' ? 'permission demandée' : 'attend ta réponse';
  if (state === 'error') return 'Erreur OpenCode';
  if (state === 'retry') return 'Nouvel essai';
  if (state === 'busy') return 'travaille';
  if (state === 'done') return 'terminé';
  return 'à compléter';
}
