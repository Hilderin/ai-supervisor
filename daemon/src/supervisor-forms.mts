/**
 * Lecture pure de `/api/sessions/status` pour la session de supervision :
 * statut et questions du tool `question`. Aucune dépendance à la base ni au
 * réseau, pour que la règle soit testable sans instance OpenChamber.
 */

export interface SupervisorFormField {
  key?: string;
  title?: string;
  description?: string;
  type?: string;
  options?: Array<{ value: string; label: string; description?: string }>;
  custom?: boolean;
}

/** Question en attente, telle que la carte du chat la dessine. */
export interface SupervisorPendingForm {
  id: string;
  sessionID?: string;
  title?: string;
  metadata?: { kind?: string; tool?: { messageID?: string; id?: string } };
  fields?: SupervisorFormField[];
}

export interface SupervisorStatusPayload {
  sessions?: Record<string, { status?: string }>;
  pending?: Record<string, { forms?: SupervisorPendingForm[] }>;
}

export type SupervisorStatus = 'idle' | 'busy' | 'unknown';

/** `busy` / `idle` seulement ; toute autre valeur (session absente) est inconnue. */
export function supervisorStatusOf(payload: SupervisorStatusPayload | null | undefined, sessionId: string): SupervisorStatus {
  const raw = payload?.sessions?.[sessionId]?.status;
  return raw === 'busy' ? 'busy' : raw === 'idle' ? 'idle' : 'unknown';
}

/**
 * Formulaires qui sont vraiment des questions : la permission et les autres
 * kinds ne deviennent jamais une carte répondable du chat.
 */
export function pendingQuestionsOf(
  payload: SupervisorStatusPayload | null | undefined,
  sessionId: string,
): SupervisorPendingForm[] {
  return (payload?.pending?.[sessionId]?.forms ?? []).filter(
    (form) => form?.metadata?.kind === 'question' && !!form.id,
  );
}
