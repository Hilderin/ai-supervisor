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
  const v = verdictOf(id) as { resume?: string; confiance?: number; progress?: number; termine?: number; attend?: string; note?: string; at?: number } | null;
  if (!v) return undefined;
  return { resume: v.resume ?? undefined, confiance: v.confiance ?? undefined, progress: v.progress ?? undefined, termine: !!v.termine, attend: v.attend ?? undefined, note: v.note ?? undefined, at: v.at ?? undefined };
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
  resume?: string; confiance?: number; progress?: number; termine?: boolean; attend?: string; note?: string; at?: number;
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
    // fantômes et archivées : sans carte
    if (!meta) continue;
    if (meta.time?.archived) continue;
    // les sous-sessions/sous-agents (parentID) ne sont pas des tâches de flotte
    if (meta.parentID) continue;
    const pendingForms = (status.pending?.[id]?.forms ?? []).filter(f => f?.metadata?.kind === 'question');
    const pendingPermissions = status.pending?.[id]?.permissions ?? [];
    // le verdict appartient au tour précédent ? (prompt renvoyé depuis la dernière analyse)
    // → strip résumé/confiance/attend : la carte repasse en « Réflexion en cours »
    const supRaw = supOf(id);
    const sup = (supRaw && s.status === 'busy' && supRaw.at && s.turnStartedAt && supRaw.at < s.turnStartedAt)
      ? { at: supRaw.at }
      : supRaw;
    const row: FleetRow = {
      id,
      title: meta.title ?? id.slice(0, 18),
      status: s.status,
      dir: meta.location?.directory,
      sup,
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
    // clé stable: turnStartedAt (et non lastUpdateAt: les refresh de metadata d'OpenChamber
    // faisaient re-trier à chaque tick = les cartes se déplacaient et flicker à l'écran)
    return (b.turnStartedAt ?? 0) - (a.turnStartedAt ?? 0);
  });
  // TEMP: trace les bascules (qui surgit/disparaît entre deux polls)
  const sigNow = rows.map(r => r.id).join(',');
  if ((globalThis as { lastRowSig?: string }).lastRowSig && (globalThis as { lastRowSig?: string }).lastRowSig !== sigNow) {
    const prev = ((globalThis as { lastRowSig?: string }).lastRowSig).split(',').filter(Boolean);
    const added = rows.filter(r => !prev.includes(r.id)).map(r => (r.title ?? '').slice(0, 22));
    const dropped = prev.filter(id => !rows.some(r => r.id === id));
    if (added.length || dropped.length) console.log(`[fleet] rows ${prev.length} → ${rows.length} | + ${JSON.stringify(added)} | - ${JSON.stringify(dropped)}`);
  }
  (globalThis as { lastRowSig?: string }).lastRowSig = sigNow;
  return { at: Date.now(), rows, concern };
}

export async function pollOnce(): Promise<void> {
  try {
    const [status, sessions] = await Promise.all([
      jget('/api/sessions/status') as Promise<StatusPayload>,
      jget('/api/session?limit=200') as Promise<{ data?: OpenchamberSession[] }>,
    ]);
    if (Array.isArray(sessions?.data)) {
      sessionsIndex = new Map(sessions.data.map(s => [s.id, s]));
    }
    // un id inconnu de l'annuaire ? (fantôme du statut, ou session trop récente pour
    // l'annuaire du cycle — 15 s) on re-tire l'annuaire immédiatement avant de bâtir.
    const unknown = Object.keys(status.sessions ?? {}).some(id => !sessionsIndex.has(id));
    if (unknown) {
      try {
        const fresh = await jget('/api/session?limit=200') as { data?: OpenchamberSession[] };
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

/* --- SSE : l'événement pousse un poll immédiat (le poll 3 s reste le filet) --- */
import { ingestEvent } from './kicks.mts';

let sseBusy = false;          // reconnexion déjà planifiée
let pollDebounce: ReturnType<typeof setTimeout> | null = null;

function onEventLine(type: string, data: Record<string, unknown>) {
  ingestEvent({ type, data });
  const relevant = /^(session\.|permission\.|form\.|project\.|workspace\.|message\.)/.test(type);
  if (!relevant) return;
  if (pollDebounce) return;
  pollDebounce = setTimeout(() => { pollDebounce = null; void pollOnce(); }, 250);
}

export function startEventStream(): void {
  if (sseBusy) return; sseBusy = true;
  const ctl = new AbortController();
  (async () => {
    try {
      const res = await fetch(openchamberUrl('/api/event'), { signal: ctl.signal });
      const reader = res.body?.getReader();
      if (!reader) throw new Error('pas de stream');
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith('data: ')) continue;
          try {
            const frame = JSON.parse(line.slice(6)) as { type?: string; data?: Record<string, unknown> };
            onEventLine(String(frame.type), frame.data ?? {});
          } catch { /* frame partielle */ }
        }
      }
    } catch { /* fin de stream : reconnexion plus bas */ }
    ctl.abort();
    sseBusy = false;
    setTimeout(() => startEventStream(), 3000 + Math.floor(Math.random() * 2000));
  })();
}

export function startPolling(): void {
  void pollOnce();
  setInterval(() => void pollOnce(), POLL_FAST_MS);   // status + pending (probablement plus)
  setInterval(async () => {
    try { await jget('/api/session?limit=200').then((s: unknown) => {
      const list = (s as { data?: OpenchamberSession[] })?.data;
      if (Array.isArray(list)) sessionsIndex = new Map(list.map(x => [x.id, x]));
    }); } catch { /* annuaire lent, pas grave */ }
  }, POLL_SLOW_MS);
  startEventStream();   // événements → poll immédiat
}
