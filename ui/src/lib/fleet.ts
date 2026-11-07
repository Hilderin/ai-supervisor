import type { Fleet, FleetRow } from '../types';

/** Phrase d'activité quand aucun résumé n'est disponible pour le tour en cours. */
export const BUSY_BRIEF = 'Réflexion en cours...';

/**
 * Le verdict appartient au tour précédent (un prompt a été renvoyé depuis l'analyse) :
 * le daemon a déjà retiré resume/confiance/attend, la carte repasse en « Réflexion en cours... ».
 */
export function isStaleTurn(row: FleetRow): boolean {
  return (
    row.status === 'busy' &&
    !!row.sup &&
    !!row.turnStartedAt &&
    !!row.sup.at &&
    row.sup.at < row.turnStartedAt
  );
}

/**
 * TERMINÉ seulement si le travail LLM est arrêté ET si le verdict est postérieur au tour en cours.
 * Un job relancé garde le verdict « done » du tour précédent, et le compagnon peut même le
 * reconfirmer pendant le nouveau tour (verdict frais mais travail visible) : busy est prioritaire.
 */
export function isDone(row: FleetRow): boolean {
  if (row.status === 'busy') return false;
  if (!row.sup?.termine) return false;
  return !(!!row.turnStartedAt && (row.sup.at ?? 0) < row.turnStartedAt);
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
  todo: FleetRow['todo'],
  shownDone: boolean,
  progress: number,
): string {
  if (!todo || shownDone) return `${Math.round(progress)} %`;
  const steps = todo.steps ?? [];
  const started = todo.done > 0 || steps.some((step) => step.status === 'in_progress');
  return started ? `${todo.done}/${todo.total}` : `${todo.total} étapes`;
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

export function confidenceLevel(conf: number | null): number {
  if (conf == null) return 0;
  return conf < 0.35 ? 1 : conf < 0.7 ? 2 : 3;
}

export function confidenceColor(conf: number | null): string | null {
  if (conf == null) return null;
  return conf < 0.35 ? '#d95f5f' : conf < 0.7 ? '#d19a2f' : '#2b9f6a';
}
