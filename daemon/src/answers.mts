/**
 * Réponses des tâches au propriétaire (tool `answer`).
 *
 * Migration « réponses natives session » (décision du propriétaire,
 * 2026-11-13, même pattern que les critères) : la réponse vit dans le tool
 * part de la session (metadata {ok, at, text, question} rendu par le plugin
 * superviseur-task, AUCUN appel daemon). Ce module MOISSONNE ces tool parts
 * dans la table `task_answer` (dédoublonnés par `part_key`) : la table reste
 * le store des lecteurs (compteur de non-lues, panel de détails, « Got it »,
 * migration de session), et l'historique des réponses survit à la destruction
 * de la session (la reprise moissonne l'ancienne session avant de la remplacer).
 *
 * Le daemon n'est plus écrivain de la réponse elle-même : il est lecteur,
 * avec écriture miroir à la lecture (comme criteria_known). La garde
 * `isTaskSession` disparaît avec l'ancien flux : une session hors flotte qui
 * répondrait n'afficherait ses réponses nulle part.
 *
 * La réponse cachée reste consultable dans le journal réaffichable (`read_at`
 * passe par « Got it »).
 */
import { db, logEvent } from './state.mts';

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

const CACHE_TTL_MS = 5_000;
/** Plafond du listing OpenChamber (au-delà : refus) : même fenêtre que les
 *  lecteurs de plan et de critères. */
const MAX_MESSAGES = 200;

interface WirePart {
  type?: string;
  tool?: string;
  name?: string;
  state?: {
    status?: string;
    metadata?: Record<string, unknown>;
  };
}

interface WireMessage {
  id?: string;
  type?: string;
  time?: { created?: number };
  content?: WirePart[];
}

interface AnswerDraft {
  partKey: string;
  at: number;
  text: string;
  question: string | null;
}

let base = '';
export function setBase(b: string) {
  base = b.replace(/\/$/, '');
}

/** Réponses nouvelles format d'un tool part (metadata {ok, at, text, question}). */
function answersOfPart(part: WirePart, sessionId: string, messageKey: string, partIndex: number): AnswerDraft[] {
  if (part?.type !== 'tool' || String(part.tool ?? part.name ?? '').trim().toLowerCase() !== 'answer') return [];
  const meta = (part.state?.metadata ?? {}) as Record<string, unknown>;
  const text = String(meta.text ?? '').trim();
  if (!text) return []; // ancien format (réponse daemon) ou partiel : ignoré
  const at = Number(meta.at) || Date.now();
  const question = meta.question != null ? String(meta.question).trim().slice(0, MAX_QUESTION) || null : null;
  return [{
    partKey: `${sessionId}:${messageKey}:${partIndex}`,
    at,
    text: text.slice(0, MAX_TEXT),
    question,
  }];
}

/** Toutes les réponses d'une fenêtre de messages, ordonnées comme le fil. */
export function extractAnswers(messages: WireMessage[], sessionId: string): AnswerDraft[] {
  const out: AnswerDraft[] = [];
  for (const message of messages) {
    const parts = Array.isArray(message.content) ? message.content : [];
    const messageKey = String(message.id ?? `t${message.time?.created ?? 0}`);
    parts.forEach((part, index) => {
      const draft = answersOfPart(part, sessionId, messageKey, index)[0];
      if (draft) out.push(draft);
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

/* --- Cache de moissonnage --- */

const cache = new Map<string, { at: number; lastUpdateAt: number }>();
const inFlight = new Map<string, Promise<void>>();

export function invalidateAnswers(sessionId?: string) {
  if (sessionId) cache.delete(sessionId);
  else cache.clear();
}

async function fetchAndStore(sessionId: string): Promise<void> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`${base}/api/session/${sessionId}/message?limit=${MAX_MESSAGES}&order=desc`, {
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`message → ${res.status}`);
    const body = await res.json() as { data?: WireMessage[] };
    for (const draft of extractAnswers(body.data ?? [], sessionId)) {
      const changes = db.query(
        'INSERT OR IGNORE INTO task_answer (session_id, at, text, question, read_at, part_key) VALUES (?,?,?,?,NULL,?)',
      ).run(sessionId, draft.at, draft.text, draft.question, draft.partKey).changes;
      // journal : une seule fois, à la première moisson de la réponse
      if (changes) {
        logEvent(sessionId, 'reply', `a répondu au propriétaire : ${draft.text.slice(0, 120)}`, {
          question: draft.question,
        });
      }
    }
  } finally {
    clearTimeout(t);
  }
}

/**
 * Moissonne les tool parts `answer` de la session dans task_answer. Idempotent
 * (part_key unique) ; `lastUpdateAt` vient de la flotte : tant qu'il ne bouge
 * pas, le moissonnage est sauté. Un échec réseau ne perd rien : la table garde
 * l'état déjà moissonné.
 */
export async function harvestAnswers(sessionId: string, lastUpdateAt?: number): Promise<void> {
  if (!sessionId) return;
  const hit = cache.get(sessionId);
  const now = Date.now();
  if (hit && lastUpdateAt != null && hit.lastUpdateAt === lastUpdateAt && now - hit.at < 30_000) return;
  if (hit && now - hit.at < CACHE_TTL_MS) return;

  const pending = inFlight.get(sessionId);
  if (pending) return pending;

  const p = fetchAndStore(sessionId)
    .then(() => {
      cache.set(sessionId, { at: Date.now(), lastUpdateAt: lastUpdateAt ?? 0 });
    })
    .catch(() => {
      // instance injoignable : la table garde l'état déjà moissonné, la
      // prochaine frame retentera
    })
    .finally(() => inFlight.delete(sessionId));
  inFlight.set(sessionId, p);
  return p;
}

/* --- Lecteurs (table) --- */

/** Compteur de réponses non lues par tâche (une seule requête, appelé par frame de flotte). */
export function unreadAnswerCounts(): Map<string, number> {
  const rows = db.query(
    'SELECT session_id, COUNT(*) c FROM task_answer WHERE read_at IS NULL GROUP BY session_id',
  ).all() as Array<{ session_id: string; c: number }>;
  return new Map(rows.map((r) => [r.session_id, r.c]));
}

/** Toutes les réponses d'une tâche, les plus anciennes d'abord (table). */
export function listAnswers(sessionId: string): AnswerRow[] {
  if (!sessionId) return [];
  return db.query(
    'SELECT id, session_id, at, text, question, read_at FROM task_answer WHERE session_id = ? ORDER BY at ASC, id ASC',
  ).all(sessionId) as AnswerRow[];
}

/** Réponses à jour : moissonnage puis lecture (panel de détails). */
export async function getAnswers(sessionId: string): Promise<AnswerRow[]> {
  await harvestAnswers(sessionId);
  return listAnswers(sessionId);
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
