import type { Delivery, Fleet } from '../types';

async function post(path: string, body: unknown): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
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
export async function closeConversation(sessionId: string): Promise<void> {
  await post('/api/fleet/done', { sessionId });
}
