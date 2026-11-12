/**
 * Dispatch des tools criteria de l'agent principal (plugin superviseur-criteria).
 *
 * L'appelant est une tâche connue (isTaskSession, chat de supervision refusé).
 * Toute écriture passe par la machine à états de criteria.mts ; aucune autre
 * écriture du statut n'existe. Le jugement (validé, à corriger) appartient à
 * l'agent lui-même depuis criteria_set_status : plus de flux vérificateur.
 */
import { currentFleet } from './fleet.mts';
import {
  CriteriaError, addCriterion, criteriaCounts, listCriteria, removeCriterion,
  setStatusCriterion, submitEvidence, updateCriterion,
} from './criteria.mts';
import { getTaskBrief } from './state.mts';
import { isTaskSession } from './answers.mts';
import type { ToolResult } from './tools.mts';

/** Dossier du projet d'une tâche : brief, puis flotte. */
function projectDirOf(taskId: string): string | undefined {
  return getTaskBrief(taskId)?.project_dir
    ?? currentFleet().rows.find(r => r.id === taskId)?.dir
    ?? undefined;
}

function criteriaView(taskId: string, includeRemoved = false) {
  const rows = listCriteria(taskId, { includeRemoved });
  return { ok: true, criteria: rows, counts: criteriaCounts(rows) };
}

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
  try {
    switch (name) {
      case 'criteria_list':
        return criteriaView(taskId, args.include_removed === true);
      case 'criteria_add':
        addCriterion(taskId, {
          title: String(args.title ?? ''),
          detail: String(args.detail ?? ''),
          methods: args.methods,
        });
        return criteriaView(taskId);
      case 'criteria_remove':
        removeCriterion(taskId, ref);
        return criteriaView(taskId);
      case 'criteria_update':
        updateCriterion(taskId, ref, {
          title: args.title != null ? String(args.title) : undefined,
          detail: args.detail != null ? String(args.detail) : undefined,
          methods: args.methods,
        });
        return criteriaView(taskId);
      case 'criteria_to_validate':
        await submitEvidence(taskId, ref, args.evidence, projectDirOf(taskId));
        return criteriaView(taskId);
      case 'criteria_set_status': {
        const status = String(args.status ?? '').trim().toLowerCase();
        if (status !== 'validated' && status !== 'to_fix') {
          return {
            ok: false,
            error: 'invalid_status',
            message: 'status doit valoir « validated » (validé) ou « to_fix » (à corriger) ; « à valider » passe par criteria_to_validate avec une preuve',
          };
        }
        setStatusCriterion(
          taskId,
          ref,
          status,
          String(args.note ?? args.comment ?? args.reason ?? ''),
          projectDirOf(taskId),
        );
        return criteriaView(taskId);
      }
      default:
        return { ok: false, error: 'unknown_tool', message: name };
    }
  } catch (e) {
    if (e instanceof CriteriaError) {
      return { ok: false, error: e.code, message: e.message, criteria: listCriteria(taskId) };
    }
    return { ok: false, error: 'criteria_failed', message: String((e as Error)?.message ?? e) };
  }
}
