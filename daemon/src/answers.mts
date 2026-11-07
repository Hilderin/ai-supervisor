/**
 * Réponses des tâches au propriétaire (tool `answer`).
 *
 * Une tâche peut envoyer une réponse visible dans le Superviseur :
 * `recordAnswer` la stocke en base (table task_answer), la flotte expose le
 * compteur de réponses non lues de chaque carte, et le panel de détails lit la
 * liste complète. `read_at` passe par « Got it » : la réponse cachée reste
 * consultable dans le journal réaffichable.
 *
 * Le tool appelant est identifié côté daemon : un sessionId qui n'est pas une
 * tâche connue est refusé (not_task), compagnon et chat de supervision inclus.
 */
import { db, getSupervisorSession, getTaskBrief, getTaskResume, getTaskState, logEvent } from './state.mts';
import { currentFleet } from './fleet.mts';

export interface AnswerRow {
  id: number;
  session_id: string;
  at: number;
  text: string;
  question: string | null;
  read_at: number | null;
}

const MAX_TEXT = 8000;
const MAX_QUESTION = 500;

/** Le sessionId est-il une tâche (top-level) connue du Superviseur ? */
export function isTaskSession(sessionId: string): boolean {
  if (!sessionId) return false;
  const supervisorId = getSupervisorSession()?.oc_session_id;
  if (supervisorId && sessionId === supervisorId) return false;
  // une session de travail a un brief, un état ou une ligne de reprise ; une
  // tâche ouverte par la flotte en est déjà au moins au premier poll
  if (getTaskBrief(sessionId)) return true;
  if (getTaskState(sessionId)) return true;
  if (getTaskResume(sessionId)) return true;
  return currentFleet().rows.some((r) => r.id === sessionId);
}

export class AnswerError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Enregistre une réponse du tool `answer`. La question rattachée est un
 * rappel textuel : le formulaire (question tool) vit côté OpenChamber et peut
 * disparaître, la réponse reste lisible sans lui.
 */
export function recordAnswer(sessionId: string, text: unknown, question?: unknown): AnswerRow {
  if (!isTaskSession(sessionId)) {
    throw new AnswerError('not_task : le tool answer est réservé aux sessions de tâche', 403);
  }
  const clean = String(text ?? '').trim();
  if (!clean) throw new AnswerError('texte requis : une réponse vide ne se lit nulle part');
  const attached = String(question ?? '').trim().slice(0, MAX_QUESTION) || null;
  const body = clean.slice(0, MAX_TEXT);
  const at = Date.now();
  const out = db.query(
    'INSERT INTO task_answer (session_id, at, text, question, read_at) VALUES (?,?,?,?,NULL) RETURNING id, session_id, at, text, question, read_at',
  ).get(sessionId, at, body, attached) as AnswerRow;
  logEvent(sessionId, 'reply', `a répondu au propriétaire : ${body.slice(0, 120)}`, {
    answerId: out.id,
    question: attached,
  });
  return out;
}

/** Compteur de réponses non lues par tâche (une seule requête, appelé par frame de flotte). */
export function unreadAnswerCounts(): Map<string, number> {
  const rows = db.query(
    'SELECT session_id, COUNT(*) c FROM task_answer WHERE read_at IS NULL GROUP BY session_id',
  ).all() as Array<{ session_id: string; c: number }>;
  return new Map(rows.map((r) => [r.session_id, r.c]));
}

/** Toutes les réponses d'une tâche, les plus anciennes d'abord. */
export function listAnswers(sessionId: string): AnswerRow[] {
  if (!sessionId) return [];
  return db.query(
    'SELECT id, session_id, at, text, question, read_at FROM task_answer WHERE session_id = ? ORDER BY at ASC, id ASC',
  ).all(sessionId) as AnswerRow[];
}

/**
 * « Got it » : marque lues les réponses non lues (toutes, ou les ids donnés).
 * Le compteur de la carte retombe à zéro ; le journal reste lisible.
 */
export function ackAnswers(sessionId: string, ids?: number[]): number {
  if (!ids?.length) {
    return db.query('UPDATE task_answer SET read_at = ? WHERE session_id = ? AND read_at IS NULL')
      .run(Date.now(), sessionId).changes;
  }
  const safe = ids.filter((n) => Number.isInteger(n) && n > 0);
  if (!safe.length) return 0;
  const marks = safe.map(() => '?').join(',');
  return db.query(
    `UPDATE task_answer SET read_at = ? WHERE session_id = ? AND read_at IS NULL AND id IN (${marks})`,
  ).run(Date.now(), sessionId, ...safe).changes;
}
