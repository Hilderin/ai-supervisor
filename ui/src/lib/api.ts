import type { Criterion, CriteriaCounts, Delivery, Fleet, SupervisorConfig, SupervisorConfigWarning, SupervisorProject, SupervisorState, TaskAnswer, TaskModelInfo, TaskModelSaveResult } from '../types';
import type { ComposerAttachment } from './attachments';

async function post(path: string, body: unknown): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null) as { error?: string; message?: string; question?: string } | null;
    throw new Error(data?.question ?? data?.message ?? data?.error ?? `${path} → ${res.status}`);
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchSupervisor(): Promise<SupervisorState> {
  const res = await fetch('/api/supervisor', { cache: 'no-store' });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as SupervisorState;
}

export async function fetchSupervisorProjects(): Promise<SupervisorProject[]> {
  const res = await fetch('/api/supervisor/projects', { cache: 'no-store' });
  if (!res.ok) throw new Error(String(res.status));
  const body = (await res.json()) as { projects?: SupervisorProject[] };
  return body.projects ?? [];
}

/** Catalogue (modèles, providers, agents) et préférences enregistrées. */
export async function fetchSupervisorConfig(): Promise<SupervisorConfig> {
  const res = await fetch('/api/supervisor/config', { cache: 'no-store' });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as SupervisorConfig;
}

export interface ConfigSaveResult {
  config: SupervisorConfig;
  warnings: SupervisorConfigWarning[];
  applied: { sessionId: string | null; agent: string | null; model: string | null; applied: boolean; error?: string };
}

/** Enregistre et applique à chaud (agent et modèle du chat, compagnons vivants). */
export async function saveSupervisorConfig(
  input: Record<string, string | null>,
): Promise<ConfigSaveResult> {
  const res = await fetch('/api/supervisor/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({})) as Partial<ConfigSaveResult> & { error?: string };
  if (!res.ok || !body.config) throw new Error(body.error ?? `${res.status}`);
  return {
    config: body.config,
    warnings: body.warnings ?? [],
    applied: body.applied ?? { sessionId: null, agent: null, model: null, applied: false },
  };
}

export async function updateSupervisorMode(
  mode: 'pilot' | 'investigation',
  projectDirectory: string | null,
): Promise<{ mode: 'pilot' | 'investigation'; projectDirectory: string | null }> {
  const res = await fetch('/api/supervisor/mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, projectDirectory }),
  });
  const body = await res.json().catch(() => ({})) as { mode?: 'pilot' | 'investigation'; projectDirectory?: string | null; message?: string; error?: string };
  if (!res.ok) throw new Error(body.message ?? body.error ?? `${res.status}`);
  return { mode: body.mode ?? mode, projectDirectory: body.projectDirectory ?? projectDirectory };
}

export async function sendSupervisor(text: string, attachments: ComposerAttachment[] = []): Promise<SupervisorState> {
  return postJson<SupervisorState>('/api/supervisor/send', { text, attachments });
}

/** Message pendant un tour : file OpenChamber, livrée à la fin. */
export async function queueSupervisor(text: string, attachments: ComposerAttachment[] = []): Promise<SupervisorState> {
  return postJson<SupervisorState>('/api/supervisor/queue', { text, attachments });
}

export async function cancelQueuedSupervisor(itemId: string): Promise<SupervisorState> {
  return postJson<SupervisorState>('/api/supervisor/queue/cancel', { itemId });
}

/** « Revenir à partir d'ici » : supprime les messages à partir de celui-ci. */
export async function revertSupervisor(messageId: string): Promise<SupervisorState> {
  return postJson<SupervisorState>('/api/supervisor/revert', { messageId });
}

export async function newSupervisor(): Promise<SupervisorState> {
  return postJson<SupervisorState>('/api/supervisor/new', {});
}

export async function abortSupervisor(): Promise<void> {
  await post('/api/supervisor/abort', {});
}

export async function fetchFleet(): Promise<Fleet> {
  const res = await fetch('/api/fleet', { cache: 'no-store' });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as Fleet;
}

/** Dernier résultat de l'agent, à la demande (pas dans les frames de flotte). */
export async function fetchDelivery(sessionId: string, signal?: AbortSignal): Promise<Delivery> {
  const res = await fetch(`/api/fleet/delivery?sessionId=${encodeURIComponent(sessionId)}`, {
    cache: 'no-store',
    signal,
  });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as Delivery;
}

/** Réponse à un formulaire : objet complet { qN: valeur }, multiselect = tableau. */
export async function replyForm(
  sessionId: string,
  formId: string,
  answer: Record<string, unknown>,
): Promise<void> {
  await post('/api/fleet/reply', { sessionId, formId, answer });
}

export async function replyPermission(
  sessionId: string,
  requestID: string,
  decision = 'once',
): Promise<void> {
  await post('/api/fleet/reply', { sessionId, requestID, decision });
}

export async function sendPrompt(sessionId: string, text: string, attachments: ComposerAttachment[] = []): Promise<void> {
  await post('/api/fleet/send', { sessionId, text, attachments });
}

/** Fermer = retirer du Superviseur (pas d'archivage ; une activité future rouvre la carte). */
export async function closeConversation(sessionId: string, force = false): Promise<void> {
  await post('/api/fleet/done', { sessionId, force });
}

/** Réponses au propriétaire de cette tâche (lues et non lues), les plus anciennes d'abord. */
export async function fetchAnswers(sessionId: string, signal?: AbortSignal): Promise<TaskAnswer[]> {
  const res = await fetch(`/api/fleet/answers?sessionId=${encodeURIComponent(sessionId)}`, {
    cache: 'no-store',
    signal,
  });
  if (!res.ok) throw new Error(String(res.status));
  const body = (await res.json()) as { answers?: TaskAnswer[] };
  return body.answers ?? [];
}

/** « Got it » : marque lues les réponses (toutes par défaut, sinon les ids donnés). */
export async function ackAnswers(sessionId: string, ids?: number[]): Promise<void> {
  await post('/api/fleet/answers/ack', { sessionId, ids });
}

/** Annule un formulaire en attente : l'agent reprend sans réponse. */
export async function cancelQuestion(sessionId: string, formId: string, message?: string): Promise<void> {
  await post('/api/fleet/cancel-question', { sessionId, formId, message });
}

/** Modèle propre à une tâche : préférence, modèle effectif et catalogue. */
export async function fetchTaskModel(sessionId: string, signal?: AbortSignal): Promise<TaskModelInfo> {
  const res = await fetch(`/api/fleet/model?sessionId=${encodeURIComponent(sessionId)}`, {
    cache: 'no-store',
    signal,
  });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as TaskModelInfo;
}

/** Change le modèle de la tâche ; un refus (modèle inconnu) revient dans le résultat. */
export async function saveTaskModel(sessionId: string, model: string | null): Promise<TaskModelSaveResult> {
  const res = await fetch('/api/fleet/model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, model }),
  });
  const body = await res.json().catch(() => ({})) as TaskModelSaveResult;
  if (!res.ok) {
    return {
      ok: false,
      error: body.error ?? `${res.status}`,
      message: body.message ?? 'changement de modèle impossible',
    };
  }
  return { ok: true, info: body.info, persisted: body.persisted };
}

/** Liste détaillée des critères de la tâche, à la demande (la flotte ne transporte que les comptes). */
export async function fetchCriteria(sessionId: string, signal?: AbortSignal): Promise<{ criteria: Criterion[]; counts: CriteriaCounts }> {
  const res = await fetch(`/api/fleet/criteria?sessionId=${encodeURIComponent(sessionId)}`, {
    cache: 'no-store',
    signal,
  });
  if (!res.ok) throw new Error(String(res.status));
  const body = (await res.json()) as { criteria?: Criterion[]; counts?: CriteriaCounts };
  return { criteria: body.criteria ?? [], counts: body.counts ?? { total: 0, todo: 0, toValidate: 0, toFix: 0, validated: 0 } };
}
