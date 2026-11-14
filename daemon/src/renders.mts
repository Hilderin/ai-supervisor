/**
 * Rendus OpenChamber produits par une tâche (tool `openchamber_render`).
 *
 * Même mécanisme que les réponses au propriétaire (answers.mts), décidé le
 * 2026-11-14 : le rendu vit dans le tool part de la session (page HTML ou
 * source openui-lang), le daemon le MOISSONNE dans la table `task_render`
 * (dédoublonné par `part_key`) et la table reste le store des lecteurs
 * (compteur de non-vus, panel de détails, bouton « Vu », migration de session).
 *
 * Le rendu survit à la destruction de la session : la reprise moissonne
 * l'ancienne session avant de la remplacer (resume.mts), comme pour les
 * réponses. Aucun appel daemon n'est nécessaire côté agent : le Superviseur
 * fermé, rien n'est perdu, le prochain moissonnage rattrape.
 */
import { db, logEvent } from './state.mts';
import { renderContentOf } from './delivery.mts';

export type RenderKind = 'html' | 'ui';

export interface RenderRow {
  id: number;
  session_id: string;
  at: number;
  title: string;
  kind: RenderKind;
  /** page HTML (kind html) ou source openui-lang (kind ui) */
  content: string;
  read_at: number | null;
}

const CACHE_TTL_MS = 5_000;
/** Plafond du listing OpenChamber (au-delà : refus) : même fenêtre que les
 *  lecteurs de plan, de critères et de réponses. */
const MAX_MESSAGES = 200;

interface WirePart {
  type?: string;
  tool?: string;
  name?: string;
  state?: {
    status?: string;
    input?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
}

interface WireMessage {
  id?: string;
  type?: string;
  time?: { created?: number };
  content?: WirePart[];
}

export interface RenderDraft {
  partKey: string;
  at: number;
  title: string;
  kind: RenderKind;
  content: string;
}

let base = '';
export function setBase(b: string) {
  base = b.replace(/\/$/, '');
}

/** Rendus d'un tool part de la fenêtre, ordonnés comme le fil. */
export function extractRenders(messages: WireMessage[], sessionId: string): RenderDraft[] {
  const out: RenderDraft[] = [];
  for (const message of messages) {
    const parts = Array.isArray(message.content) ? message.content : [];
    const messageKey = String(message.id ?? `t${message.time?.created ?? 0}`);
    const at = Number(message.time?.created) || Date.now();
    parts.forEach((part, index) => {
      const hit = renderContentOf(part);
      if (!hit) return;
      out.push({
        partKey: `${sessionId}:${messageKey}:${index}`,
        at,
        title: hit.title,
        kind: hit.kind,
        content: hit.content,
      });
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

/* --- Cache de moissonnage --- */

const cache = new Map<string, { at: number; lastUpdateAt: number }>();
const inFlight = new Map<string, Promise<void>>();

export function invalidateRenders(sessionId?: string) {
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
    for (const draft of extractRenders(body.data ?? [], sessionId)) {
      const changes = db.query(
        'INSERT OR IGNORE INTO task_render (session_id, at, title, kind, content, read_at, part_key) VALUES (?,?,?,?,?,NULL,?)',
      ).run(sessionId, draft.at, draft.title, draft.kind, draft.content, draft.partKey).changes;
      // journal : une seule fois, à la première moisson du rendu
      if (changes) {
        logEvent(sessionId, 'render', `a produit un rendu : ${draft.title.slice(0, 120)}`, {
          kind: draft.kind,
        });
      }
    }
  } finally {
    clearTimeout(t);
  }
}

/**
 * Moissonne les tool parts `openchamber_render` de la session dans task_render.
 * Idempotent (part_key unique) ; `lastUpdateAt` vient de la flotte : tant qu'il
 * ne bouge pas, le moissonnage est sauté. Un échec réseau ne perd rien : la
 * table garde l'état déjà moissonné.
 */
export async function harvestRenders(sessionId: string, lastUpdateAt?: number): Promise<void> {
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

/** Compteur de rendus non vus par tâche (une seule requête, appelé par frame de flotte). */
export function unreadRenderCounts(): Map<string, number> {
  const rows = db.query(
    'SELECT session_id, COUNT(*) c FROM task_render WHERE read_at IS NULL GROUP BY session_id',
  ).all() as Array<{ session_id: string; c: number }>;
  return new Map(rows.map((r) => [r.session_id, r.c]));
}

/** Tous les rendus d'une tâche, les plus anciens d'abord (table). */
export function listRenders(sessionId: string): RenderRow[] {
  if (!sessionId) return [];
  return db.query(
    'SELECT id, session_id, at, title, kind, content, read_at FROM task_render WHERE session_id = ? ORDER BY at ASC, id ASC',
  ).all(sessionId) as RenderRow[];
}

/** Rendus à jour : moissonnage puis lecture (panel de détails). */
export async function getRenders(sessionId: string): Promise<RenderRow[]> {
  await harvestRenders(sessionId);
  return listRenders(sessionId);
}

/**
 * « Vu » : marque vus les rendus non vus (tous, ou les ids donnés). Le compteur
 * de la carte retombe à zéro ; le rendu reste dans « rendus antérieurs ».
 */
export function ackRenders(sessionId: string, ids?: number[]): number {
  if (!ids?.length) {
    return db.query('UPDATE task_render SET read_at = ? WHERE session_id = ? AND read_at IS NULL')
      .run(Date.now(), sessionId).changes;
  }
  const safe = ids.filter((n) => Number.isInteger(n) && n > 0);
  if (!safe.length) return 0;
  const marks = safe.map(() => '?').join(',');
  return db.query(
    `UPDATE task_render SET read_at = ? WHERE session_id = ? AND read_at IS NULL AND id IN (${marks})`,
  ).run(Date.now(), sessionId, ...safe).changes;
}
