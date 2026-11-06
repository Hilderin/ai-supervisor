import type { FleetRow } from '../types';

/**
 * Le verdict appartient au tour précédent (un prompt a été renvoyé depuis l'analyse) :
 * le daemon a déjà retiré resume/confiance/attend, la carte repasse en « Réflexion en cours ».
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

/** TERMINÉ seulement si le verdict est postérieur au tour en cours. */
export function isDone(row: FleetRow): boolean {
  return (
    !!row.sup?.termine &&
    !(row.status === 'busy' && !!row.turnStartedAt && (row.sup?.at ?? 0) < row.turnStartedAt)
  );
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
  if (row.status === 'busy') return 'travaille';
  return 'tour terminé · ' + fmtAge(now - (row.lastUpdateAt ?? now));
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
