/**
 * Critères d'acceptation : LECTURE de l'état porté par la session.
 *
 * Migration « critères natifs session » (décision du propriétaire, 2026-11-13) :
 * la machine à états vit dans le plugin superviseur-criteria (state.js), l'état
 * dans le storage du plugin ; chaque tool criteria rend la liste complète dans
 * le metadata de son résultat ({ok, criteria, counts}). Ce module lit ce
 * metadata dans les tool parts des messages OpenChamber, EXACTEMENT comme
 * plan.mts lit `planwrite` : le daemon n'est plus écrivain, il est lecteur.
 *
 * - Le tool part porteur est le DERNIER tool criteria de la fenêtre (tout tool
 *   criteria rend la liste complète, quel que soit le tool).
 * - Cache par session (TTL + garde lastUpdateAt), coalescing des lectures en
 *   vol ; invalidé par events.mts sur chaque `message.*` (comme le plan).
 * - Repli « dernier état connu » : mémoire + table criteria_known, JAMAIS le
 *   cache TTL (leçon plan ses_e2fa0f2 : invalidatePlan vide le cache à chaque
 *   message du tour, le repli devait survivre à la fenêtre de 200 messages).
 *   Le miroir sert aussi à la reprise automatique (seed de la session neuve).
 * - Journal : à chaque lecture fraîche, les transitions (statut par ref) sont
 *   journalisées en diff contre le miroir précédent ; une première lecture ne
 *   journalise rien (pas de raz-le-bol de transitions historiques).
 *
 * Les types (CriterionRow, EvidenceItem, CriteriaCounts) restent identiques :
 * l'UI et /api/fleet/criteria ne changent pas de forme.
 */
import { db, logEvent } from './state.mts';

export type CriterionStatus = 'todo' | 'to_validate' | 'to_fix' | 'validated';

export const METHODS = [
  'unit_test', 'e2e', 'browser_nav', 'screenshot', 'human', 'text',
  'code_excerpt', 'artifact', 'command', 'diff', 'doc',
] as const;
export type EvidenceKind = (typeof METHODS)[number];

export interface EvidenceItem {
  kind: EvidenceKind;
  text: string;
  path?: string;
  start_line?: number;
  line_count?: number;
  at: number;
}

export interface CriterionRow {
  id: number;
  task_id: string;
  ref: string;
  title: string;
  detail: string | null;
  methods: string[];
  status: CriterionStatus;
  evidence: EvidenceItem[];
  review: string | null;
  review_at: number | null;
  created_at: number;
  updated_at: number;
  /** version du contenu (preuve, jugement ou modification) */
  version: number;
  validated_at: number | null;
  /** version du travail examiné à la validation : JSON {commit?, at} */
  validated_work: string | null;
  removed_at: number | null;
}

export interface CriteriaCounts {
  total: number; todo: number; toValidate: number; toFix: number; validated: number;
}

export interface CriteriaSnapshot {
  at: number;
  criteria: CriterionRow[];
  counts: CriteriaCounts;
}

const STATUSES = new Set<CriterionStatus>(['todo', 'to_validate', 'to_fix', 'validated']);
const METHOD_SET = new Set<string>(METHODS);

const CACHE_TTL_MS = 5_000;
/** Plafond du listing OpenChamber (au-delà : « Expected a value less than or
 *  equal to 200 ») : même fenêtre que le lecteur de plan. */
const MAX_MESSAGES = 200;
const KNOWN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Tools du plugin superviseur-criteria : chacun rend la liste complète. */
const CRITERIA_TOOLS = new Set([
  'criteria_list', 'criteria_add', 'criteria_remove', 'criteria_update',
  'criteria_to_validate', 'criteria_set_status', 'criteria_import',
]);

interface WirePart {
  type?: string;
  tool?: string;
  name?: string;
  state?: {
    status?: string;
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

let base = '';
export function setBase(b: string) {
  base = b.replace(/\/$/, '');
}

/* --- Normalisation (miroir du plugin, volontairement dupliquée : le daemon
       ne doit pas dépendre du code du plugin) --- */

function asArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).criteria)) {
    return (raw as { criteria: unknown[] }).criteria;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return [];
}

function normalizeEvidence(raw: unknown): EvidenceItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const kind = String(obj.kind ?? '').trim().toLowerCase();
  const text = String(obj.text ?? '').trim();
  if (!METHOD_SET.has(kind) || !text) return null;
  const out: EvidenceItem = { kind: kind as EvidenceKind, text: text.slice(0, 2000), at: Number(obj.at) || 0 };
  if (obj.path) out.path = String(obj.path);
  if (obj.start_line != null) out.start_line = Number(obj.start_line);
  if (obj.line_count != null) out.line_count = Number(obj.line_count);
  return out;
}

function normalizeCriterion(raw: unknown, taskId: string, id: number): CriterionRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const ref = String(obj.ref ?? '').trim();
  const title = String(obj.title ?? '').trim();
  if (!ref || !title) return null;
  let rawMethods: unknown = obj.methods;
  if (typeof rawMethods === 'string') {
    // ancienne table `criteria` (archive pré-migration) : methods en JSON
    try { rawMethods = JSON.parse(rawMethods); } catch { rawMethods = []; }
  }
  const methods = Array.isArray(rawMethods)
    ? [...new Set(rawMethods.map(m => String(m ?? '').trim().toLowerCase()).filter(m => METHOD_SET.has(m)))]
    : [];
  if (methods.length === 0) return null;
  const status = String(obj.status ?? '').trim().toLowerCase() as CriterionStatus;
  const created = Number(obj.created_at) || Date.now();
  return {
    id,
    task_id: taskId,
    ref,
    title: title.slice(0, 200),
    detail: obj.detail != null ? String(obj.detail).slice(0, 2000) : null,
    methods,
    status: STATUSES.has(status) ? status : 'todo',
    evidence: asArray(obj.evidence).map(normalizeEvidence).filter((e): e is EvidenceItem => e != null),
    review: obj.review != null ? String(obj.review).slice(0, 500) : null,
    review_at: obj.review_at != null ? Number(obj.review_at) : null,
    created_at: created,
    updated_at: Number(obj.updated_at) || created,
    version: Number(obj.version) || 0,
    validated_at: obj.validated_at != null ? Number(obj.validated_at) : null,
    validated_work: obj.validated_work != null ? String(obj.validated_work) : null,
    removed_at: obj.removed_at != null ? Number(obj.removed_at) : null,
  };
}

/** Coerce la liste brute d'un tool part en CriterionRow[], retraits filtrés. */
export function normalizeCriteria(raw: unknown, taskId: string): CriterionRow[] {
  const out: CriterionRow[] = [];
  let id = 1;
  for (const item of asArray(raw)) {
    const row = normalizeCriterion(item, taskId, id);
    if (!row) continue;
    id += 1;
    out.push(row);
  }
  return out.filter(r => r.removed_at == null);
}

export function criteriaCounts(rows: CriterionRow[]): CriteriaCounts {
  const c: CriteriaCounts = { total: rows.length, todo: 0, toValidate: 0, toFix: 0, validated: 0 };
  for (const r of rows) {
    if (r.status === 'todo') c.todo++;
    else if (r.status === 'to_validate') c.toValidate++;
    else if (r.status === 'to_fix') c.toFix++;
    else if (r.status === 'validated') c.validated++;
  }
  return c;
}

const STATUS_LABEL: Record<CriterionStatus, string> = {
  todo: 'à faire',
  to_validate: 'à valider',
  to_fix: 'à corriger',
  validated: 'validé',
};
export function statusLabel(s: CriterionStatus): string { return STATUS_LABEL[s]; }

/* --- Extraction du tool part --- */

function isCriteriaTool(name: unknown): boolean {
  return CRITERIA_TOOLS.has(String(name ?? '').trim().toLowerCase().replace(/:\d+$/, ''));
}

function criteriaOfPart(part: WirePart, taskId: string): CriterionRow[] {
  if (part?.type !== 'tool' || !isCriteriaTool(part.tool ?? part.name)) return [];
  const state = part.state ?? {};
  const meta = (state.metadata ?? {}) as Record<string, unknown>;
  let raw = meta.criteria;
  if (raw == null) raw = state.output;
  return normalizeCriteria(raw, taskId);
}

/** Dernier tool criteria d'une fenêtre de messages, quel que soit l'ordre d'entrée. */
export function extractCriteria(messages: WireMessage[], taskId: string): CriterionRow[] {
  const ordered = messages
    .map((message, index) => ({ message, at: message.time?.created ?? index }))
    .sort((a, b) => a.at - b.at);
  let last: CriterionRow[] = [];
  for (const { message } of ordered) {
    const parts = Array.isArray(message.content) ? message.content : [];
    for (const part of parts) {
      if (part?.type !== 'tool' || !isCriteriaTool(part.tool ?? part.name)) continue;
      // tout tool criteria rend la liste complète, y compris vide : le dernier
      // fait foi (une liste vidée doit remplacer une ancienne liste pleine)
      last = criteriaOfPart(part, taskId);
    }
  }
  return last;
}

/* --- Cache, miroir et journal --- */

const cache = new Map<string, { at: number; lastUpdateAt: number; value: CriteriaSnapshot }>();
const inFlight = new Map<string, Promise<CriteriaSnapshot>>();

/**
 * Dernier état connu par session, HORS cache TTL : invalidateCriteria vide le
 * cache à chaque événement message.* (events.mts), il ne peut donc pas servir
 * de repli pendant un tour actif. Persisté dans criteria_known (state.mts)
 * pour survivre au redémarrage du daemon ET à la destruction de la session
 * (la reprise automatique s'en sert pour réinjecter les critères).
 */
const lastKnown = new Map<string, CriteriaSnapshot>();

function rememberCriteria(sessionId: string, snap: CriteriaSnapshot): void {
  if (!snap.criteria.length) return;
  const previous = lastKnown.get(sessionId);
  lastKnown.set(sessionId, snap);
  // journal : diff contre le miroir précédent (une première lecture ne
  // journalise rien)
  if (previous) logTransitions(sessionId, previous.criteria, snap.criteria);
  try {
    db.run(
      'INSERT INTO criteria_known (session_id, criteria, at) VALUES (?, ?, ?)'
      + ' ON CONFLICT(session_id) DO UPDATE SET criteria = excluded.criteria, at = excluded.at',
      [sessionId, JSON.stringify(snap.criteria), Date.now()],
    );
    db.run('DELETE FROM criteria_known WHERE at < ?', [Date.now() - KNOWN_TTL_MS]);
  } catch { /* la mémoire suffit si la base refuse */ }
}

/** Journal des transitions de statut (le daemon n'est plus écrivain, il observe). */
function logTransitions(sessionId: string, before: CriterionRow[], after: CriterionRow[]): void {
  const old = new Map(before.map(r => [r.ref, r]));
  for (const row of after) {
    const prev = old.get(row.ref);
    if (!prev || prev.status === row.status) continue;
    const note = row.review ? ` : ${row.review.slice(0, 120)}` : '';
    logEvent(sessionId, 'criteria', `${row.ref} : ${prev.status} → ${row.status}${note}`, {
      ref: row.ref, from: prev.status, to: row.status, source: 'agent',
    });
  }
}

function recallCriteria(sessionId: string): CriteriaSnapshot | undefined {
  const memory = lastKnown.get(sessionId);
  if (memory) return memory;
  try {
    const row = db.query('SELECT criteria, at FROM criteria_known WHERE session_id = ?').get(sessionId) as
      | { criteria: string; at: number }
      | null;
    if (!row) return undefined;
    const criteria = normalizeCriteria(JSON.parse(row.criteria), sessionId);
    if (!criteria.length) return undefined;
    const snap = snapshotOf(criteria, row.at);
    lastKnown.set(sessionId, snap);
    return snap;
  } catch {
    return undefined;
  }
}

function snapshotOf(criteria: CriterionRow[], at = Date.now()): CriteriaSnapshot {
  return { at, criteria, counts: criteriaCounts(criteria) };
}

export function invalidateCriteria(sessionId?: string) {
  if (sessionId) cache.delete(sessionId);
  else cache.clear();
}

async function fetchSnapshot(sessionId: string): Promise<CriteriaSnapshot> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`${base}/api/session/${sessionId}/message?limit=${MAX_MESSAGES}&order=desc`, {
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`message → ${res.status}`);
    const body = await res.json() as { data?: WireMessage[] };
    const criteria = extractCriteria(body.data ?? [], sessionId);
    if (criteria.length) {
      const snap = snapshotOf(criteria);
      rememberCriteria(sessionId, snap);
      return snap;
    }
    // Dernier tool criteria sorti de la fenêtre de lecture : garder le dernier
    // état connu plutôt que de faire clignoter la carte à zéro (leçon plan du
    // 2026-11-12). Le repli lit lastKnown (mémoire puis base), JAMAIS le cache.
    const remembered = recallCriteria(sessionId);
    if (remembered?.criteria.length) return { ...remembered, at: Date.now() };
    return snapshotOf([]);
  } finally {
    clearTimeout(t);
  }
}

/**
 * Lecture des critères avec cache. `lastUpdateAt` vient de la flotte : tant
 * qu'il ne bouge pas, on garde le snapshot ; sinon on relit après le TTL.
 */
export function getCriteriaSnapshot(sessionId: string, lastUpdateAt?: number, force = false): Promise<CriteriaSnapshot> {
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
      // instance injoignable ou lecture avortée : dernier état connu (mémoire
      // puis base), jamais des critères à zéro à cause d'un accident réseau
      const remembered = recallCriteria(sessionId);
      if (remembered?.criteria.length) return remembered;
      return hit?.value ?? snapshotOf([]);
    })
    .finally(() => inFlight.delete(sessionId));
  inFlight.set(sessionId, p);
  return p;
}

export async function readCriteria(sessionId: string, lastUpdateAt?: number): Promise<CriterionRow[]> {
  const snap = await getCriteriaSnapshot(sessionId, lastUpdateAt);
  return snap.criteria;
}

/**
 * Critères pour la reprise automatique : le dernier état connu de la session
 * perdue (miroir criteria_known), puis repli sur l'ancienne table `criteria`
 * (tâches créées avant la migration, jamais relues par le lecteur).
 * La session perdue pouvant être détruite, le miroir est la seule source fiable.
 */
export function criteriaForResume(sessionId: string): CriterionRow[] {
  const known = recallCriteria(sessionId);
  if (known?.criteria.length) return known.criteria;
  try {
    const rows = db.query('SELECT * FROM criteria WHERE task_id = ? ORDER BY id ASC').all(sessionId) as Array<Record<string, unknown>>;
    return normalizeCriteria(rows, sessionId).filter(r => r.removed_at == null);
  } catch {
    return [];
  }
}

/** Pour les tests : vide le cache, le repli mémoire et les requêtes en vol.
 *  (La table criteria_known, elle, survit : c'est le but.) */
export function resetCriteriaCache() {
  cache.clear();
  lastKnown.clear();
  inFlight.clear();
}
