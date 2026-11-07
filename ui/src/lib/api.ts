import type { Delivery, Fleet, SupervisorState } from '../types';

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

export async function sendSupervisor(text: string): Promise<SupervisorState> {
  return postJson<SupervisorState>('/api/supervisor/send', { text });
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

export async function sendPrompt(sessionId: string, text: string): Promise<void> {
  await post('/api/fleet/send', { sessionId, text });
}

/** Fermer = retirer du Superviseur (pas d'archivage ; une activité future rouvre la carte). */
export async function closeConversation(sessionId: string, force = false): Promise<void> {
  await post('/api/fleet/done', { sessionId, force });
}

/** Annule un formulaire en attente : l'agent reprend sans réponse. */
export async function cancelQuestion(sessionId: string, formId: string, message?: string): Promise<void> {
  await post('/api/fleet/cancel-question', { sessionId, formId, message });
}
