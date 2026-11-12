/**
 * Plan de tâche : le `planwrite` (et son complément `planupdate`, mise à jour
 * unitaire par numéro) de la session de travail est la seule source de la
 * progression. On lit le tool part dans les messages OpenChamber, jamais la
 * base OpenCode : la clé `kv` du plugin est interne et le tool part est la
 * surface stable déjà exposée par l'API.
 *
 * Renommage du 2026-11-07 (todo* → plan-*) : les sessions créées avant la
 * bascule portent des tool parts `todowrite`/`todoupdate`, le lecteur accepte
 * donc les deux générations de noms, et les deux clés de metadata
 * (`todos`, historique) et (`items`, nouvelle).
 *
 * Le cache évite de relire 60 messages à chaque tick de flotte. Il est indexé
 * par session et invalidé par les événements `message.*` / fin de tour.
 *
 * Leçon du 2026-11-12 (ses_e2fa0f250ffefiYkSzP55eg4ks) : le dernier planwrite
 * sortait de la fenêtre de lecture dès que le tour dépassait 80 messages, et
 * le repli « dernier plan connu » lisait un cache que events.mts vient de
 * vider à chaque événement message.* : plan à zéro au milieu du tour, sans
 * retour tant que l'agent ne refaisait pas un planwrite. Deux garde-fous :
 * fenêtre portée au plafond de l'API (200 messages) et repli lastKnown
 * (mémoire + table plan_known) que invalidatePlan ne touche jamais.
 */
import { db } from './state.mts';

export type PlanItemStatus = 'pending' | 'in_progress' | 'completed';
export type PlanItemPriority = 'high' | 'medium' | 'low';

/** Étape réduite du plan (cartes, tools) : texte + fait/pas fait. */
export interface PlanStep {
  step: string;
  done: boolean;
}

export interface PlanItem {
  content: string;
  status: PlanItemStatus;
  priority: PlanItemPriority;
}

export interface PlanSnapshot {
  at: number;
  items: PlanItem[];
  done: number;
  total: number;
  /** 0..99 tant que le job n'est pas done ; 100 seulement si done. */
  progress: number | null;
  source: 'planwrite' | 'todowrite' | 'none';
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

const STATUSES = new Set<PlanItemStatus>(['pending', 'in_progress', 'completed']);
const PRIORITIES = new Set<PlanItemPriority>(['high', 'medium', 'low']);
const CACHE_TTL_MS = 5_000;
/** Plafond du listing OpenChamber (au-delà : « Expected a value less than or
 *  equal to 200 »). Une fenêtre plus courte faisait sortir le dernier
 *  planwrite du plan des tours longs (leçon du 2026-11-12). */
const MAX_MESSAGES = 200;

let base = '';
export function setBase(b: string) {
  base = b.replace(/\/$/, '');
}

const cache = new Map<string, { at: number; lastUpdateAt: number; value: PlanSnapshot }>();
const inFlight = new Map<string, Promise<PlanSnapshot>>();

/**
 * Dernier plan connu par session, HORS cache TTL : invalidatePlan vide le cache
 * à chaque événement message.* (events.mts), il ne peut donc pas servir de
 * repli pendant un tour actif, exactement quand le planwrite sort de la
 * fenêtre de lecture. Persisté dans plan_known (state.mts) pour survivre au
 * redémarrage du daemon. Un plan ne disparaît jamais de lui-même : il n'est
 * remplacé que par un planwrite/planupdate, donc le dernier connu EST le plan
 * courant tant que la fenêtre ne le montre plus.
 */
const lastKnown = new Map<string, PlanSnapshot>();
const PLAN_KNOWN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Mémorise (et persiste) un plan fraîchement lu dans la fenêtre. */
function rememberPlan(sessionId: string, snap: PlanSnapshot): void {
  if (!snap.total) return;
  const previous = lastKnown.get(sessionId);
  if (previous && JSON.stringify(previous.items) === JSON.stringify(snap.items)) {
    lastKnown.set(sessionId, snap); // contenu inchangé : pas de réécriture de la base
    return;
  }
  lastKnown.set(sessionId, snap);
  try {
    db.run(
      'INSERT INTO plan_known (session_id, items, at) VALUES (?, ?, ?)'
      + ' ON CONFLICT(session_id) DO UPDATE SET items = excluded.items, at = excluded.at',
      [sessionId, JSON.stringify(snap.items), Date.now()],
    );
    db.run('DELETE FROM plan_known WHERE at < ?', [Date.now() - PLAN_KNOWN_TTL_MS]);
  } catch { /* la mémoire suffit si la base refuse */ }
}

/** Dernier plan connu : mémoire, puis table plan_known. */
function recallPlan(sessionId: string): PlanSnapshot | undefined {
  const memory = lastKnown.get(sessionId);
  if (memory) return memory;
  try {
    const row = db.query('SELECT items, at FROM plan_known WHERE session_id = ?').get(sessionId) as
      | { items: string; at: number }
      | null;
    if (!row) return undefined;
    const items = normalizePlanItems(JSON.parse(row.items));
    if (!items.length) return undefined;
    const snap = snapshotOf(items, row.at);
    lastKnown.set(sessionId, snap);
    return snap;
  } catch {
    return undefined;
  }
}

const PLAN_TOOLS = new Set(['planwrite', 'planupdate']);
/** sessions créées avant le renommage todo* → plan-* : tool parts anciens */
const LEGACY_PLAN_TOOLS = new Set(['todowrite', 'todoupdate']);

function isPlanTool(name: unknown): boolean {
  const n = String(name ?? '').trim().toLowerCase().replace(/:\d+$/, '');
  return PLAN_TOOLS.has(n) || LEGACY_PLAN_TOOLS.has(n);
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
export function normalizePlanItems(raw: unknown): PlanItem[] {
  const out: PlanItem[] = [];
  for (const item of asArray(raw)) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const content = String(obj.content ?? '').trim();
    if (!content) continue;
    const status = String(obj.status ?? '').trim().toLowerCase() as PlanItemStatus;
    const priority = String(obj.priority ?? '').trim().toLowerCase() as PlanItemPriority;
    out.push({
      content: content.slice(0, 240),
      status: STATUSES.has(status) ? status : 'pending',
      priority: PRIORITIES.has(priority) ? priority : 'medium',
    });
  }
  return out;
}

function itemsOfPart(part: WirePart): PlanItem[] {
  if (part?.type !== 'tool' || !isPlanTool(part.tool ?? part.name)) return [];
  const state = part.state ?? {};
  const meta = state.metadata ?? {};
  // `items` (plugin superviseur-plan) ou `todos` (plugin superviseur-todolist,
  // sessions d'avant le renommage)
  let raw = (meta as Record<string, unknown>).items;
  if (raw == null) raw = (meta as Record<string, unknown>).todos;
  if (raw == null) raw = state.input?.items;
  if (raw == null) raw = state.input?.todos;
  if (raw == null) raw = state.output;
  return normalizePlanItems(raw);
}

/** Dernier `planwrite` d'une fenêtre de messages, quel que soit l'ordre d'entrée. */
function findPlanItems(messages: WireMessage[]): PlanItem[] {
  const ordered = messages
    .map((message, index) => ({ message, index, at: message.time?.created ?? index }))
    .sort((a, b) => a.at - b.at);
  let last: PlanItem[] = [];
  for (const { message } of ordered) {
    const parts = Array.isArray(message.content) ? message.content : [];
    for (const part of parts) {
      if (part?.type !== 'tool' || !isPlanTool(part.tool ?? part.name)) continue;
      last = itemsOfPart(part);
    }
  }
  return last;
}

export function extractPlanItems(messages: WireMessage[]): PlanItem[] {
  return findPlanItems(messages);
}

export function emptySnapshot(): PlanSnapshot {
  return { at: Date.now(), items: [], done: 0, total: 0, progress: null, source: 'none' };
}

export function snapshotOf(items: PlanItem[], at = Date.now()): PlanSnapshot {
  const done = items.filter(i => i.status === 'completed').length;
  const total = items.length;
  return {
    at,
    items,
    done,
    total,
    progress: total ? Math.min(99, Math.round((done / total) * 100)) : null,
    source: total ? 'planwrite' : 'none',
  };
}

export function planStepsOf(snapshot: PlanSnapshot | null | undefined): PlanStep[] {
  if (!snapshot?.items.length) return [];
  return snapshot.items.map(i => ({ step: i.content, done: i.status === 'completed' }));
}

export function invalidatePlan(sessionId?: string) {
  if (sessionId) cache.delete(sessionId);
  else cache.clear();
}

async function fetchSnapshot(sessionId: string): Promise<PlanSnapshot> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`${base}/api/session/${sessionId}/message?limit=${MAX_MESSAGES}&order=desc`, {
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`message → ${res.status}`);
    const body = await res.json() as { data?: WireMessage[] };
    const items = findPlanItems(body.data ?? []);
    if (items.length) {
      const snap = snapshotOf(items);
      rememberPlan(sessionId, snap);
      return snap;
    }
    // Dernier planwrite sorti de la fenêtre de lecture : garder le dernier plan
    // connu plutôt que de faire clignoter la carte à zéro. Le repli lit
    // lastKnown (mémoire puis base) et JAMAIS le cache TTL : events.mts
    // l'invalide à chaque message du tour, il était donc toujours vide au
    // moment du repli (plan disparu de ses_e2fa0f2, leçon du 2026-11-12).
    const remembered = recallPlan(sessionId);
    if (remembered?.total) return { ...remembered, at: Date.now() };
    return snapshotOf([]);
  } finally {
    clearTimeout(t);
  }
}

/**
 * Lecture du plan avec cache. `lastUpdateAt` vient de la flotte : tant qu'il ne
 * bouge pas, on garde le snapshot ; sinon on relit après le TTL.
 */
export function getPlanSnapshot(sessionId: string, lastUpdateAt?: number, force = false): Promise<PlanSnapshot> {
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
    .catch(() => {
      // instance injoignable ou lecture avortée : dernier plan connu (mémoire
      // puis base), jamais un plan à zéro à cause d'un accident réseau
      const remembered = recallPlan(sessionId);
      if (remembered?.total) return remembered;
      return hit?.value ?? emptySnapshot();
    })
    .finally(() => inFlight.delete(sessionId));
  inFlight.set(sessionId, p);
  return p;
}

/** Pour les tests : vide le cache, le repli mémoire et les requêtes en vol.
 *  (La table plan_known, elle, survit : c'est le but.) */
export function resetPlanCache() {
  cache.clear();
  lastKnown.clear();
  inFlight.clear();
}
