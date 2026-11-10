import type { FleetRow } from '../types';

/**
 * Supervision opt-in (docs/analyses/mvp1/supervision-bascule.md) : une carte
 * sans état explicite (daemon ancien) est considérée supervisée ; seul
 * `supervised === false` porte le badge « Non supervisée » et l'action
 * d'activation dans le menu.
 */
export function isUnsupervised(row: FleetRow): boolean {
  return row.supervised === false;
}

/** Libellé de l'action du menu : activer pour une non supervisée, désactiver sinon. */
export function supervisionActionLabel(row: FleetRow): string {
  return isUnsupervised(row) ? 'Activer la supervision' : 'Désactiver la supervision';
}
