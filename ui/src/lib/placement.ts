import type { FleetRow } from '../types';
import { isDone, isWaiting } from './fleet';

export type Section = 'waiting' | 'running' | 'done';

export interface Placement {
  section: Section;
  /** section visée mais pas encore stable */
  candidate?: Section;
  /** horodatage du début du candidat (avec candidate) */
  since?: number;
  /** tour observé au moment du placement */
  turn?: number;
}

/**
 * Délai de stabilisation avant de déplacer une carte entre EN COURS et TERMINÉ.
 * L'état est déterministe (plan 100 % + critères validés + au repos) mais il
 * peut rebondir quand l'agent ajoute un critère ou une étape à la fin : sans ce
 * délai, la carte saute de section et décale les titres au-dessus (flicker connu).
 */
export const SECTION_HYSTERESIS_MS = 8000;

/**
 * Calcule le placement stable des cartes.
 * Immédiat : attente (question/permission), job busy, nouveau tour.
 * Stabilisé : passage EN COURS ↔ TERMINÉ (hystérésis).
 */
export function updatePlacements(
  previous: Record<string, Placement>,
  rows: FleetRow[],
  now: number,
  hysteresisMs = SECTION_HYSTERESIS_MS,
): Record<string, Placement> {
  const next: Record<string, Placement> = {};

  for (const row of rows) {
    const want: Section = isWaiting(row) ? 'waiting' : isDone(row) ? 'done' : 'running';
    const prev = previous[row.id];

    if (!prev) {
      next[row.id] = { section: want, turn: row.turnStartedAt };
      continue;
    }

    const newTurn = row.turnStartedAt !== prev.turn;
    if (newTurn || want === 'waiting' || prev.section === 'waiting' || (row.status === 'busy' && want === 'running')) {
      next[row.id] = { section: want, turn: row.turnStartedAt };
      continue;
    }

    if (want === prev.section) {
      next[row.id] = { section: prev.section, turn: row.turnStartedAt };
      continue;
    }

    const since = prev.candidate === want ? (prev.since ?? now) : now;
    if (now - since >= hysteresisMs) {
      next[row.id] = { section: want, turn: row.turnStartedAt };
    } else {
      next[row.id] = { section: prev.section, candidate: want, since, turn: row.turnStartedAt };
    }
  }

  return next;
}
