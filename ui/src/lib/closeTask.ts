import { closeConversation } from './api';
import type { FleetRow } from '../types';

/** Question encore ouverte, pour l'avertissement avant fermeture. */
export function closeQuestionOf(row: FleetRow): string {
  const form = row.pendingForms?.[0];
  const permission = row.pendingPermissions?.[0];
  if (form) {
    return form.fields?.[0]?.description ?? form.fields?.[0]?.title ?? form.title ?? 'cette question';
  }
  return permission ? 'une permission' : '';
}

/**
 * Fermeture humaine : retire la carte du Superviseur, sans archiver ni toucher
 * au verdict du compagnon. Une activité ultérieure dans OpenChamber la rouvre.
 */
export async function closeTask(
  row: FleetRow,
  closeSession: (id: string) => void,
  force = false,
): Promise<void> {
  await closeConversation(row.id, force);
  closeSession(row.id);
}
