/**
 * Dispatch des tools criteria de l'agent principal (plugin superviseur-criteria).
 *
 * L'appelant est une tâche connue (isTaskSession, compagnon et chat refusés).
 * Toute écriture passe par la machine à états de criteria.mts ; aucune autre
 * écriture du statut n'existe. Approve/reject ne sont PAS dispatchables ici :
 * ils n'existent que dans le flux daemon/vérificateur.
 */
import { currentFleet } from './fleet.mts';
import {
  CriteriaError, addCriterion, criteriaCounts, listCriteria, removeCriterion,
  submitEvidence, updateCriterion,
} from './criteria.mts';
import { getTaskBrief } from './state.mts';
import { isTaskSession } from './answers.mts';
import { verifierKick } from './verifier-kicks.mts';
import type { ToolResult } from './tools.mts';

/** Dossier du projet d'une tâche : brief, puis flotte. */
function projectDirOf(taskId: string): string | undefined {
  return getTaskBrief(taskId)?.project_dir
    ?? currentFleet().rows.find(r => r.id === taskId)?.dir
    ?? undefined;
}

function criteriaView(taskId: string) {
  const rows = listCriteria(taskId);
  return { ok: true, criteria: rows, counts: criteriaCounts(rows) };
}

/** Rejet d'un critère : il reste en « à corriger » jusqu'à une nouvelle preuve ;
 *  la machine à états ne prévoit pas de retour « à faire » direct. */

export interface CriteriaToolCall {
  name: string;
  args: Record<string, unknown>;
}

export async function runCriteriaTool(name: string, callerSessionId: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (process.env.SUPERVISEUR_CRITERIA === 'off') {
    return { ok: false, error: 'disabled', message: 'le flux critères est désactivé' };
  }
  if (!isTaskSession(callerSessionId)) {
    return { ok: false, error: 'not_task', message: 'tools criteria réservés aux sessions de tâche' };
  }
  const taskId = callerSessionId;
  const ref = String(args.ref ?? '').trim();
  /** add/remove/update/to_validate déclenchent une nouvelle phase de validation. */
  const kickVerifier = () => verifierKick(taskId, 'criteria');
  try {
    switch (name) {
      case 'criteria_list':
        return criteriaView(taskId);
      case 'criteria_add':
        addCriterion(taskId, {
          title: String(args.title ?? ''),
          detail: String(args.detail ?? ''),
          methods: args.methods,
        });
        kickVerifier();
        return criteriaView(taskId);
      case 'criteria_remove':
        removeCriterion(taskId, ref);
        kickVerifier();
        return criteriaView(taskId);
      case 'criteria_update':
        updateCriterion(taskId, ref, {
          title: args.title != null ? String(args.title) : undefined,
          detail: args.detail != null ? String(args.detail) : undefined,
          methods: args.methods,
        });
        kickVerifier();
        return criteriaView(taskId);
      case 'criteria_to_validate':
        await submitEvidence(taskId, ref, args.evidence, projectDirOf(taskId));
        kickVerifier();
        return criteriaView(taskId);
      default:
        // approve et reject ne passent PAS par ici : transitions daemon/vérificateur
        return { ok: false, error: 'unknown_tool', message: name };
    }
  } catch (e) {
    if (e instanceof CriteriaError) {
      return { ok: false, error: e.code, message: e.message, criteria: listCriteria(taskId) };
    }
    return { ok: false, error: 'criteria_failed', message: String((e as Error)?.message ?? e) };
  }
}
