import type { Fleet, FleetRow } from '../types';

/** Phrase d'activité quand aucun résumé n'est disponible pour le tour en cours. */
export const BUSY_BRIEF = 'Réflexion en cours...';

/** Le plan est-il présent et entièrement terminé ? */
export function planComplete(row: FleetRow): boolean {
  const plan = row.plan;
  return !!plan && plan.total > 0 && plan.done >= plan.total;
}

/** Tous les critères définis sont-ils validés ? (aucun critère = non, le travail n'est pas cadré) */
export function criteriaAllValidated(row: FleetRow): boolean {
  const crit = row.criteria;
  return !!crit && crit.total > 0 && crit.validated >= crit.total;
}

/**
 * Terminé est DÉTERMINISTE (2026-11-12, plus de compagnon) : le travail LLM
 * est arrêté, rien n'attend l'humain, le plan est à 100 % et tous les critères
 * sont validés. Un tour relancé (busy) reste en cours, quoi qu'il arrive.
 */
export function isDone(row: FleetRow): boolean {
  if (row.status === 'busy') return false;
  if (isWaiting(row)) return false;
  return planComplete(row) && criteriaAllValidated(row);
}

/** Au repos mais pas terminé proprement : plan incomplet, absent, ou critères non validés. */
export function isWarning(row: FleetRow): boolean {
  if (row.status === 'busy') return false;
  if (isWaiting(row)) return false;
  return !isDone(row);
}

export function isWaiting(row: FleetRow): boolean {
  return (row.pendingForms?.length ?? 0) > 0 || (row.pendingPermissions?.length ?? 0) > 0;
}

export function fmtAge(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return "à l'instant";
  const s = Math.round(ms / 1000);
  if (s < 10) return "à l'instant";
  if (s < 60) return `il y a ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

export function briefRow(row: FleetRow, waiting: boolean, now: number): string {
  if (waiting) {
    return (row.pendingForms?.length ?? 0) > 0 ? 'une question t’attend' : 'une permission t’attend';
  }
  if (row.status === 'busy') return BUSY_BRIEF;
  return 'tour terminé · ' + fmtAge(now - (row.lastUpdateAt ?? now));
}

/**
 * Libellé de progression : « 0/5 » est trompeur tant qu'aucune étape n'a
 * commencé, on annonce alors la taille du plan. Un plan terminé affiche 100 %.
 */
export function planLabel(
  plan: FleetRow['plan'],
  shownDone: boolean,
  progress: number,
): string {
  if (!plan || shownDone) return `${Math.round(progress)} %`;
  const steps = plan.steps ?? [];
  const started = plan.done > 0 || steps.some((step) => step.status === 'in_progress');
  return started ? `${plan.done}/${plan.total}` : `${plan.total} étapes`;
}

/**
 * Titre courant de la tâche destinataire d'un `send_task`. Le titre est
 * relu dans la flotte à l'affichage (un renommage reste donc correct) ; si la
 * tâche n'y est plus, un repli lisible remplace l'ancien titre stocké.
 */
export function taskTitleOf(
  fleet: Fleet | null,
  taskId?: string,
  storedTitle?: string,
): string {
  if (!taskId) return 'une tâche inconnue';
  const row = fleet?.rows.find((r) => r.id === taskId);
  if (row) return row.title;
  if (!fleet) return storedTitle || 'une tâche inconnue';
  return 'une tâche qui n’est plus dans la flotte';
}

export function dirName(dir?: string): string {
  if (!dir) return '';
  return dir.split('/').pop() ?? dir;
}
