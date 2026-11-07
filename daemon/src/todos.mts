/**
 * Plan de tâche : le `todowrite` (et son complément `todoupdate`, mise à jour
 * unitaire par numéro) de la session de travail est la seule source de la
 * progression. On lit le tool part dans les messages OpenChamber, jamais la
 * base OpenCode : la clé `kv` du plugin est interne et le tool part est la
 * surface stable déjà exposée par l'API.
 *
 * Le cache évite de relire 60 messages à chaque tick de flotte. Il est indexé
 * par session et invalidé par les événements `message.*` / fin de tour.
 */
import type { PlanStep } from './verdict.mts';

export type TodoStatus = 'pending' | 'in_progress' | 'completed';
export type TodoPriority = 'high' | 'medium' | 'low';

export interface TodoItem {
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
}

export interface TodoSnapshot {
  at: number;
  items: TodoItem[];
  done: number;
  total: number;
  /** 0..99 tant que le job n'est pas done ; 100 seulement si done. */
  progress: number | null;
  source: 'todowrite' | 'none';
}

interface WirePart {
  type?: string;
  tool?: string;
  name?: string;
  state?: {
    status?: string;
    input?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    output?: unknown;
  };
}

interface WireMessage {
  id?: string;
  type?: string;
  time?: { created?: number };
  content?: WirePart[];
}

const STATUSES = new Set<TodoStatus>(['pending', 'in_progress', 'completed']);
const PRIORITIES = new Set<TodoPriority>(['high', 'medium', 'low']);
const CACHE_TTL_MS = 5_000;
const MAX_MESSAGES = 80;

let base = '';
export function setBase(b: string) {
  base = b.replace(/\/$/, '');
}

const cache = new Map<string, { at: number; lastUpdateAt: number; value: TodoSnapshot }>();
const inFlight = new Map<string, Promise<TodoSnapshot>>();

const TODO_TOOLS = new Set(['todowrite', 'todoupdate']);

function isTodoTool(name: unknown): boolean {
  return TODO_TOOLS.has(String(name ?? '').trim().toLowerCase().replace(/:\d+$/, ''));
}

function asArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return [];
}

/** Normalise la liste brute du plugin (content/status/priority). */
export function normalizeTodos(raw: unknown): TodoItem[] {
  const out: TodoItem[] = [];
  for (const item of asArray(raw)) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const content = String(obj.content ?? '').trim();
    if (!content) continue;
    const status = String(obj.status ?? '').trim().toLowerCase() as TodoStatus;
    const priority = String(obj.priority ?? '').trim().toLowerCase() as TodoPriority;
    out.push({
      content: content.slice(0, 240),
      status: STATUSES.has(status) ? status : 'pending',
      priority: PRIORITIES.has(priority) ? priority : 'medium',
    });
  }
  return out;
}

function todosOfPart(part: WirePart): TodoItem[] {
  if (part?.type !== 'tool' || !isTodoTool(part.tool ?? part.name)) return [];
  const state = part.state ?? {};
  const meta = state.metadata ?? {};
  let raw = (meta as Record<string, unknown>).todos;
  if (raw == null) raw = state.input?.todos;
  if (raw == null) raw = state.output;
  return normalizeTodos(raw);
}

interface TodoExtraction {
  found: boolean;
  items: TodoItem[];
}

/** Dernier `todowrite` d'une fenêtre de messages, quel que soit l'ordre d'entrée. */
function findTodos(messages: WireMessage[]): TodoExtraction {
  const ordered = messages
    .map((message, index) => ({ message, index, at: message.time?.created ?? index }))
    .sort((a, b) => a.at - b.at);
  let found = false;
  let last: TodoItem[] = [];
  for (const { message } of ordered) {
    const parts = Array.isArray(message.content) ? message.content : [];
    for (const part of parts) {
      if (part?.type !== 'tool' || !isTodoTool(part.tool ?? part.name)) continue;
      found = true;
      last = todosOfPart(part);
    }
  }
  return { found, items: last };
}

export function extractTodos(messages: WireMessage[]): TodoItem[] {
  return findTodos(messages).items;
}

export function emptySnapshot(): TodoSnapshot {
  return { at: Date.now(), items: [], done: 0, total: 0, progress: null, source: 'none' };
}

export function snapshotOf(items: TodoItem[], at = Date.now()): TodoSnapshot {
  const done = items.filter(i => i.status === 'completed').length;
  const total = items.length;
  return {
    at,
    items,
    done,
    total,
    progress: total ? Math.min(99, Math.round((done / total) * 100)) : null,
    source: total ? 'todowrite' : 'none',
  };
}

export function todoPlan(snapshot: TodoSnapshot | null | undefined): PlanStep[] {
  if (!snapshot?.items.length) return [];
  return snapshot.items.map(i => ({ step: i.content, done: i.status === 'completed' }));
}

export function invalidateTodos(sessionId?: string) {
  if (sessionId) cache.delete(sessionId);
  else cache.clear();
}

async function fetchSnapshot(sessionId: string): Promise<TodoSnapshot> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`${base}/api/session/${sessionId}/message?limit=${MAX_MESSAGES}&order=desc`, {
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`message → ${res.status}`);
    const body = await res.json() as { data?: WireMessage[] };
    const extracted = findTodos(body.data ?? []);
    // Dernier todowrite sorti de la fenêtre de 80 messages : garder le dernier
    // plan connu plutôt que de faire clignoter la carte à zéro.
    if (!extracted.found) {
      const previous = cache.get(sessionId)?.value;
      if (previous?.total) return { ...previous, at: Date.now() };
    }
    return snapshotOf(extracted.items);
  } finally {
    clearTimeout(t);
  }
}

/**
 * Lecture du plan avec cache. `lastUpdateAt` vient de la flotte : tant qu'il ne
 * bouge pas, on garde le snapshot ; sinon on relit après le TTL.
 */
export function getTodoSnapshot(sessionId: string, lastUpdateAt?: number, force = false): Promise<TodoSnapshot> {
  const hit = cache.get(sessionId);
  const now = Date.now();
  if (!force && hit && lastUpdateAt != null && hit.lastUpdateAt === lastUpdateAt && now - hit.at < 30_000) {
    return Promise.resolve(hit.value);
  }
  if (!force && hit && now - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.value);

  const pending = inFlight.get(sessionId);
  if (pending) return pending;

  const p = fetchSnapshot(sessionId)
    .then((value) => {
      cache.set(sessionId, { at: Date.now(), lastUpdateAt: lastUpdateAt ?? 0, value });
      return value;
    })
    .catch(() => hit?.value ?? emptySnapshot())
    .finally(() => inFlight.delete(sessionId));
  inFlight.set(sessionId, p);
  return p;
}

/** Pour les tests : vide le cache et les requêtes en vol. */
export function resetTodoCache() {
  cache.clear();
  inFlight.clear();
}
