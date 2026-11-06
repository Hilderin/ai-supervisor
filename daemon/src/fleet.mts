/**
 * Fleet : lecture continue de l'instance OpenChamber locale.
 * - poll GET /api/sessions/status toutes les 3 s (statuts + pending forms/permissions)
 * - poll GET /api/session (annuaire des sessions) toutes les 15 s (léger)
 * - SSE /api/event pour les transitions instantanées (optionnel : simple re-poll trigger)
 */
const POLL_SLOW_MS = 15_000;
const POLL_FAST_MS = 3_000;

/** les sessions de type quelconque (annuaire) */
export interface OpenchamberSession {
  id: string; title?: string; agent?: string; parentID?: string;
  projectID?: string; time?: Record<string, number>;
  location?: { directory?: string };
  tokens?: Record<string, number>; outcome?: string;
  metadata?: { openchamber?: { work?: { state?: string }, turn?: { durationMs?: number } } };
}
import { companionTick, verdictOf } from './companion.mts';

function supOf(id: string): Verdict | undefined {
  const v = verdictOf(id) as { resume?: string; confiance?: number; progress?: number; termine?: number; attend?: string; at?: number } | null;
  if (!v) return undefined;
  return { resume: v.resume ?? undefined, confiance: v.confiance ?? undefined, progress: v.progress ?? undefined, termine: !!v.termine, attend: v.attend ?? undefined, at: v.at ?? undefined };
}
export interface PendingForm {
  id: string; sessionID: string; title?: string;
  metadata?: { kind?: string };
  fields?: Array<{ key: string; title?: string; description?: string; type?: string; options?: Array<{ value: string; label: string; description?: string }>; custom?: boolean }>;
}
export interface FleetRow {
  id: string; title: string; status: string;
  dir?: string;
  sup?: Verdict;
  turnStartedAt?: number; lastUpdateAt?: number;
  busy?: number | null; idle?: number | null;
  pendingForms: PendingForm[]; pendingPermissions: unknown[];
}
export interface Verdict {
  resume?: string; confiance?: number; progress?: number; termine?: boolean; attend?: string; at?: number;
}
export interface Fleet {
  at: number; rows: FleetRow[]; concern: string | null;
}

let base = '';
let cachedFleet: Fleet = { at: 0, rows: [], concern: null };
let sessionsIndex: Map<string, OpenchamberSession> = new Map();
let lastGood = 0;

export function openchamberUrl(path: string) { return `${base}${path}`; }
export function currentFleet(): Fleet { return cachedFleet; }
export function setBase(b: string) {
  base = b.endsWith('/') ? b.slice(0, -1) : b;
}

async function jget(path: string, timeoutMs = 6000): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(openchamberUrl(path), { signal: ctl.signal });
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

interface StatusPayload {
  sessions?: Record<string, { status: string; lastUpdateAt: number; turnStartedAt?: number }>;
  pending?: Record<string, { permissions?: unknown[]; forms?: PendingForm[] }>;
}

function buildFleet(status: StatusPayload): Fleet {
  const rows: FleetRow[] = [];
  let concern: string | null = null;
  for (const [id, s] of Object.entries(status.sessions ?? {})) {
    const meta = sessionsIndex.get(id);
    // fantômes : id connu du statut mais absent de l'annuaire (session supprimée) → on n'affiche pas
    if (!meta) continue;
    // les sous-sessions/sous-agents (parentID) ne sont pas des tâches de flotte
    if (meta.parentID) continue;    const pendingForms = (status.pending?.[id]?.forms ?? []).filter(f => f?.metadata?.kind === 'question');
    const pendingPermissions = status.pending?.[id]?.permissions ?? [];
     const row: FleetRow = {
      id,
      title: meta.title ?? id.slice(0, 18),
      status: s.status,
      dir: meta.location?.directory,
      sup: supOf(id),
      turnStartedAt: s.turnStartedAt,
      lastUpdateAt: s.lastUpdateAt,
      busy: meta?.time?.busy ?? null,
      idle: meta?.time?.idle ?? null,
      pendingForms, pendingPermissions,
    };
    if (pendingForms.length || pendingPermissions.length) {
      if (!concern) {
        const f = pendingForms[0];
        concern = f
          ? `${row.title} — ${f.fields?.[0]?.title ?? 'question'}`
          : `${row.title} — permission demandée`;
      }
    }
    rows.push(row);
  }
  rows.sort((a, b) => {
    const wa = a.pendingForms.length + a.pendingPermissions.length;
    const wb = b.pendingForms.length + b.pendingPermissions.length;
    if (wb !== wa) return wb - wa;
    if (a.status !== b.status) return a.status === 'busy' ? -1 : 1;
    return (b.lastUpdateAt ?? 0) - (a.lastUpdateAt ?? 0);
  });
  return { at: Date.now(), rows, concern };
}

export async function pollOnce(): Promise<void> {
  try {
    const [status, sessions] = await Promise.all([
      jget('/api/sessions/status') as Promise<StatusPayload>,
      jget('/api/session') as Promise<{ data?: OpenchamberSession[] }>,
    ]);
    if (Array.isArray(sessions?.data)) {
      sessionsIndex = new Map(sessions.data.map(s => [s.id, s]));
    }
    // un id inconnu de l'annuaire ? (fantôme du statut, ou session trop récente pour
    // l'annuaire du cycle — 15 s) on re-tire l'annuaire immédiatement avant de bâtir.
    const unknown = Object.keys(status.sessions ?? {}).some(id => !sessionsIndex.has(id));
    if (unknown) {
      try {
        const fresh = await jget('/api/session') as { data?: OpenchamberSession[] };
        if (Array.isArray(fresh?.data)) sessionsIndex = new Map(fresh.data.map(s => [s.id, s]));
      } catch { /* garde l'ancien annuaire */ }
    }
    cachedFleet = buildFleet(status);
    lastGood = Date.now();
    // le compagnon juge les sessions nouvelles (idle) ou périodiquement (busy)
    companionTick([...sessionsIndex.values()], status.sessions ?? {});
  } catch {
    /* garde la dernière flotte connue, réessaie au prochain tick */
  }
}

export function baseOk(): boolean { return base !== '' && lastGood > 0; }

export function startPolling(): void {
  void pollOnce();
  setInterval(() => void pollOnce(), POLL_FAST_MS);   // status + pending (probablement plus)
  setInterval(async () => {
    try { await jget('/api/session').then((s: unknown) => {
      const list = (s as { data?: OpenchamberSession[] })?.data;
      if (Array.isArray(list)) sessionsIndex = new Map(list.map(x => [x.id, x]));
    }); } catch { /* annuaire lent, pas grave */ }
  }, POLL_SLOW_MS);
}
