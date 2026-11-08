/**
 * Modèle propre à une tâche, réglable depuis le panneau de détail.
 *
 * Le réglage global `supervisor_pref.task_model` ne sert qu'aux nouvelles
 * tâches. Une tâche garde son modèle (`task_brief.model` et
 * `task_resume.model`), que la reprise automatique relit. Le changement passe
 * par la session vivante (`POST /api/session/:id/model`) : aucune session
 * n'est recréée.
 */

import { logEvent, getTaskModelStored, updateTaskModel } from './state.mts';
import {
  defaultModelRef, findModel, loadCatalog, modelLabel, modelPayload, type ModelOption,
} from './models.mts';

let base = '';
export function setBase(b: string) { base = b.replace(/\/$/, ''); }

async function jget(path: string, timeoutMs = 8000): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, { signal: ctl.signal });
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

async function postModel(sessionId: string, ref: string): Promise<boolean> {
  const payload = modelPayload(ref);
  if (!payload) return false;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(`${base}/api/session/${encodeURIComponent(sessionId)}/model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: payload }),
      signal: ctl.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally { clearTimeout(t); }
}

interface WireModel { providerID?: string; id?: string; }

/** Modèle effectif de la session de travail, ou null si la session ne le dit pas. */
async function effectiveModel(sessionId: string): Promise<string | null> {
  try {
    const body = await jget(`/api/session/${encodeURIComponent(sessionId)}`) as { data?: { model?: WireModel } };
    const m = body?.data?.model;
    return m?.providerID && m.id ? `${m.providerID}/${m.id}` : null;
  } catch {
    return null;
  }
}

export interface TaskModelInfo {
  sessionId: string;
  /** préférence propre à la tâche, null = défaut de la session */
  model: string | null;
  /** modèle réellement porté par la session */
  effective: string | null;
  /** nom lisible du modèle effectif, sinon de la préférence */
  name: string | null;
  models: ModelOption[];
  defaultModel: string | null;
}

export async function getTaskModelInfo(sessionId: string): Promise<TaskModelInfo> {
  const [catalog, defaultModel, effective] = await Promise.all([
    loadCatalog(),
    defaultModelRef(),
    effectiveModel(sessionId),
  ]);
  const stored = getTaskModelStored(sessionId);
  const name = await modelLabel(effective ?? stored);
  return {
    sessionId,
    model: stored,
    effective,
    name,
    models: catalog.models,
    defaultModel,
  };
}

export interface TaskModelResult {
  ok: boolean;
  error?: 'invalid_model' | 'no_default' | 'apply_failed';
  message?: string;
  info?: TaskModelInfo;
  /** false : appliqué à la session vivante, mais aucun brief/registre à mettre à jour */
  persisted?: boolean;
}

/**
 * Change le modèle d'une tâche. Une référence inconnue est refusée avant tout
 * appel : la session et la tâche restent intactes. Une valeur vide ramène la
 * tâche au défaut de la session (et efface la préférence).
 */
export async function setTaskModel(sessionId: string, requested?: string | null): Promise<TaskModelResult> {
  const clean = String(requested ?? '').trim();
  let target: string;
  let stored: string | null;
  if (!clean) {
    const def = await defaultModelRef();
    if (!def) {
      return { ok: false, error: 'no_default', message: 'aucun modèle par défaut connu : la tâche n’a pas été modifiée' };
    }
    target = def;
    stored = null;
  } else {
    const found = await findModel(clean);
    if (!found) {
      return {
        ok: false,
        error: 'invalid_model',
        message: `modèle « ${clean} » inconnu : la tâche n’a pas été modifiée.`,
      };
    }
    target = found.ref;
    stored = found.ref;
  }
  if (!(await postModel(sessionId, target))) {
    return {
      ok: false,
      error: 'apply_failed',
      message: 'modèle refusé par la session : la tâche n’a pas été modifiée.',
    };
  }
  const persisted = updateTaskModel(sessionId, stored);
  logEvent(sessionId, 'note',
    `modèle de la tâche : ${stored ?? `défaut (${target})`}${persisted ? '' : ' (non conservé : pas de brief)'}`);
  return { ok: true, info: await getTaskModelInfo(sessionId), persisted };
}
