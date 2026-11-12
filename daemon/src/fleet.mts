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
import { setBase as setResumeBase, resumeTick } from './resume.mts';
import { forgetFleetSeen, getSupervisorSession, listFleetSeen, upsertFleetSeen } from './state.mts';
import { SUPERVISOR_DIR } from './supervisor.mts';
import { getPlanSnapshot } from './plan.mts';
import { criteriaCounts, listCriteria, type CriteriaCounts } from './criteria.mts';
import { activityOf, activityTracker, type LiveActivity } from './activity.mts';
import { SessionIssueTracker, type SessionIssue } from './session-issues.mts';
const sessionIssues = new SessionIssueTracker();

export interface PendingForm {
  id: string; sessionID: string; title?: string;
  metadata?: { kind?: string };
  fields?: Array<{ key: string; title?: string; description?: string; type?: string; options?: Array<{ value: string; label: string; description?: string }>; custom?: boolean }>;
}
export interface FleetRow {
  id: string; title: string; status: string;
  issue?: SessionIssue;
  dir?: string;
  turnStartedAt?: number; lastUpdateAt?: number;
  busy?: number | null; idle?: number | null;
  pendingForms: PendingForm[]; pendingPermissions: unknown[];
  /** plan de la session de travail (`planwrite`) */
  plan?: { done: number; total: number; steps: Array<{ text: string; status: string }> };
  /** critères d'acceptation : comptes par état (la liste détaillée se charge à la demande) */
  criteria?: CriteriaCounts;
  /** ce que l'agent fait à l'instant (uniquement pendant un tour busy) */
  activity?: LiveActivity;
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
  setResumeBase(base);
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

/** Tri partagé des cartes : demandes en attente d'abord, busy ensuite, puis la
 *  clé stable turnStartedAt (et non lastUpdateAt : les refresh de metadata
 *  d'OpenChamber faisaient re-trier à chaque tick = cartes qui se déplacent et
 *  flicker à l'écran). Utilisé par buildFleet ET par la restauration. */
function sortFleetRows(rows: FleetRow[]): void {
  rows.sort((a, b) => {
    const wa = a.pendingForms.length + a.pendingPermissions.length;
    const wb = b.pendingForms.length + b.pendingPermissions.length;
    if (wb !== wa) return wb - wa;
    if (a.status !== b.status) return a.status === 'busy' ? -1 : 1;
    return (b.turnStartedAt ?? 0) - (a.turnStartedAt ?? 0);
  });
}

function buildFleet(status: StatusPayload): Fleet {
  const rows: FleetRow[] = [];
  let concern: string | null = null;
  const supervisorId = getSupervisorSession()?.oc_session_id;
  for (const [id, s] of Object.entries(status.sessions ?? {})) {
    const meta = sessionsIndex.get(id);
    // fantômes et archivées : sans carte
    if (!meta) continue;
    if (supervisorId && id === supervisorId) continue;
    // tout le dossier de supervision est hors flotte, y compris les anciennes
    // conversations de chat laissées dans OpenChamber
    if (meta.location?.directory === SUPERVISOR_DIR) continue;
    if (meta.time?.archived) continue;
    // les sous-sessions/sous-agents (parentID) ne sont pas des tâches de flotte
    if (meta.parentID) continue;
    const pendingForms = (status.pending?.[id]?.forms ?? []).filter(f => f?.metadata?.kind === 'question');
    const pendingPermissions = status.pending?.[id]?.permissions ?? [];
    const row: FleetRow = {
      id,
      title: meta.title ?? id.slice(0, 18),
      status: s.status,
      issue: sessionIssues.get(id),
      dir: meta.location?.directory,
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
  sortFleetRows(rows);
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

/* --- Registre du tableau : persister les cartes vues, restaurer les absentes ---
 *
 * /api/sessions/status d'OpenChamber est une carte EN MÉMOIRE : perdue au
 * redémarrage d'OpenChamber ou d'OpenCode (une session au repos ne réémet
 * jamais d'événement session.status), et expirée après 24 h
 * (SESSION_STATE_MAX_AGE_MS côté OpenChamber). Sans registre, fermer le
 * Superviseur (ou redémarrer OpenChamber) vide le tableau alors que les
 * conversations existent toujours.
 *
 * Chaque carte vue est notée dans `fleet_seen` (state.mts) ; celles absentes
 * du statut vivant sont remises au tableau tant que la conversation existe
 * encore (annuaire ou lecture directe), n'est pas archivée, pas une
 * sous-session, pas le chat de supervision et pas marquée terminée
 * (work=done : le bouton « Done » d'OpenChamber ou le « Terminé » du
 * Superviseur, qui écrit closed_at de toute façon).
 */

/** Cache des lectures directes (l'annuaire est paginé, une session peut en
 *  manquer) : évite un GET par carte restaurée à chaque tick. */
type MetaResolution = { kind: 'ok'; meta: OpenchamberSession } | { kind: 'gone' } | { kind: 'unknown' };
const directMetaCache = new Map<string, { at: number; kind: 'ok' | 'gone'; meta: OpenchamberSession | null }>();
const DIRECT_META_TTL_MS = 5 * 60_000;

async function resolveSessionMeta(id: string, directory: Map<string, OpenchamberSession>, now: number): Promise<MetaResolution> {
  const indexed = directory.get(id);
  if (indexed) return { kind: 'ok', meta: indexed };
  const cached = directMetaCache.get(id);
  if (cached && now - cached.at < DIRECT_META_TTL_MS) {
    return cached.kind === 'ok' && cached.meta ? { kind: 'ok', meta: cached.meta } : { kind: 'gone' };
  }
  try {
    const body = await jget(`/api/session/${encodeURIComponent(id)}`) as { data?: OpenchamberSession };
    const meta = body?.data ?? null;
    if (!meta?.id) return { kind: 'unknown' }; // 200 sans donnée : on ne décide rien
    directMetaCache.set(id, { at: now, kind: 'ok', meta });
    return { kind: 'ok', meta };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/→ 404/.test(msg)) {
      directMetaCache.set(id, { at: now, kind: 'gone', meta: null });
      return { kind: 'gone' };
    }
    return { kind: 'unknown' }; // instance injoignable : on ne supprime rien
  }
}

/** Note chaque carte du tableau dans le registre persistant. */
export function persistFleetSeen(fleet: Fleet, now = Date.now()): void {
  for (const row of fleet.rows) {
    upsertFleetSeen(row.id, {
      title: row.title,
      dir: row.dir ?? null,
      lastUpdateAt: row.lastUpdateAt ?? null,
      at: now,
    });
  }
}

/** Remet au tableau les conversations du registre absentes du statut vivant.
 *  Filtres identiques à buildFleet, revérifiés sur l'état COURANT de la session
 *  (annuaire, sinon lecture directe). Appelé AVANT l'enrichissement : une carte
 *  restaurée porte son plan et ses critères sur la même frame (anti-flicker). */
export async function restoreFleetRows(
  fleet: Fleet,
  status: StatusPayload,
  directory: Map<string, OpenchamberSession>,
  now = Date.now(),
): Promise<void> {
  const supervisorId = getSupervisorSession()?.oc_session_id;
  const liveIds = new Set(fleet.rows.map(r => r.id));
  const statusIds = new Set(Object.keys(status.sessions ?? {}));
  const restored: FleetRow[] = [];
  for (const entry of listFleetSeen()) {
    const id = entry.session_id;
    if (liveIds.has(id)) continue;
    // déjà dans le statut vivant mais sans annuaire (fantôme, page en retard) :
    // buildFleet en décide, on ne fabrique pas une carte « idle » fausse
    if (statusIds.has(id)) continue;
    const res = await resolveSessionMeta(id, directory, now);
    if (res.kind === 'gone') { forgetFleetSeen(id); continue; }
    if (res.kind === 'unknown') continue;
    const meta = res.meta;
    if (supervisorId && id === supervisorId) continue;
    if (meta.time?.archived) { forgetFleetSeen(id); continue; }
    if (meta.location?.directory === SUPERVISOR_DIR) continue;
    if (meta.parentID) continue;
    if (meta.metadata?.openchamber?.work?.state === 'done') continue;
    const pendingForms = (status.pending?.[id]?.forms ?? []).filter(f => f?.metadata?.kind === 'question');
    restored.push({
      id,
      title: meta.title ?? entry.title ?? id.slice(0, 18),
      status: 'idle',
      dir: meta.location?.directory,
      turnStartedAt: meta.time?.busy ?? undefined,
      lastUpdateAt: meta.time?.updated ?? meta.time?.idle ?? entry.last_update_at ?? entry.last_seen_at,
      busy: meta.time?.busy ?? null,
      idle: meta.time?.idle ?? null,
      pendingForms,
      pendingPermissions: status.pending?.[id]?.permissions ?? [],
    });
  }
  if (restored.length) {
    fleet.rows.push(...restored);
    sortFleetRows(fleet.rows);
  }
}

/** Pour les tests : vide les caches de lectures directes. */
export function resetFleetSeenCaches(): void {
  directMetaCache.clear();
}

/** Progression : uniquement le plan `planwrite` de la session de travail. */
async function enrichPlanProgress(fleet: Fleet): Promise<void> {
  // Séquentiel : un premier poll ne doit pas lancer 15 lectures de 80 messages
  // en parallèle sur OpenChamber (réponses vides / timeouts observés).
  for (const row of fleet.rows) {
    const snap = await getPlanSnapshot(row.id, row.lastUpdateAt);
    if (snap.total > 0) {
      row.plan = {
        done: snap.done,
        total: snap.total,
        steps: snap.items.map(i => ({ text: i.content, status: i.status })),
      };
    }
  }
}

/** Comptes critères par carte : enrichis avec le plan, jamais dans une frame
 *  intermédiaire (même garde anti-flicker que enrichPlanProgress). */
function enrichCriteriaCounts(fleet: Fleet): void {
  for (const row of fleet.rows) {
    const counts = criteriaCounts(listCriteria(row.id));
    if (counts.total > 0) row.criteria = counts;
  }
}

/**
 * Activité courante des cartes busy. Les événements SSE du tour alimentent le
 * tracker sans requête ; `activityOf` ne relit la conversation qu'en secours
 * (démarrage, coupure SSE, outil très long). Les sessions au repos n'exposent
 * jamais d'activité : le tracker est purgé au passage.
 */
async function enrichActivity(fleet: Fleet): Promise<void> {
  for (const row of fleet.rows) {
    const activity = await activityOf(row.id, row.status === 'busy');
    if (activity) row.activity = activity;
  }
}

async function runPoll(): Promise<void> {
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
    // Publier UNIQUEMENT des snapshots entièrement enrichis : entre buildFleet
    // et enrichPlanProgress, la flotte exposait des frames sans `plan` (progress
    // du verdict au lieu du plan). Cette fenêtre (~500 ms du fetch /message) était
    // échantillonnée par le SSE 500 ms et le poll 3 s de l'UI : barres qui se
    // relancent (38 % → 0 → 38 %) et section Plan du détail démontée/remontée.
    const fleet = buildFleet(status);
    // registre du tableau : noter les cartes vues, remettre celles que le
    // statut éphémère d'OpenChamber a perdues (redémarrage, expiration 24 h)
    persistFleetSeen(fleet);
    await restoreFleetRows(fleet, status, sessionsIndex);
    await enrichPlanProgress(fleet);
    enrichCriteriaCounts(fleet);
    await enrichActivity(fleet);
    cachedFleet = fleet;
    lastGood = Date.now();
    // auto-restart : une tâche armée dont la session a été détruite repart sur
    // une session neuve (modèle default courant), registre task_resume.
    // Les archivées ne comptent pas comme vivantes : être dans l'annuaire avec
    // time.archived n'est pas être vivante (sinon l'archive ressemble à un
    // contact et la reprise la traite comme vivante).
    const liveIds = new Set(
      [...sessionsIndex.values()].filter(s => !s.time?.archived).map(s => s.id),
    );
    void resumeTick(liveIds)
      .catch(() => { /* un tick raté réessaie au prochain poll */ });
  } catch {
    /* garde la dernière flotte connue, réessaie au prochain tick */
  }
}

/**
 * Un seul poll à la fois : GET /api/fleet, l'intervalle 3 s et les événements SSE
 * peuvent déclencher plusieurs cycles concurrents. Deux cycles qui se croisent
 * pouvaient publier des snapshots dans le désordre (même session avec deux états,
 * titre qui change, cartes fantômes). Les demandes concurrentes sont coalescées.
 */
let pollInFlight: Promise<void> | null = null;
let pollQueued = false;

export function pollOnce(): Promise<void> {
  if (pollInFlight) {
    pollQueued = true;
    return pollInFlight;
  }
  pollInFlight = runPoll().finally(() => {
    pollInFlight = null;
    if (pollQueued) {
      pollQueued = false;
      void pollOnce();
    }
  });
  return pollInFlight;
}

export function baseOk(): boolean { return base !== '' && lastGood > 0; }

/* --- SSE : l'événement pousse un poll immédiat (le poll 3 s reste le filet) --- */
import { ingestEvent } from './events.mts';

let sseBusy = false;          // reconnexion déjà planifiée
let pollDebounce: ReturnType<typeof setTimeout> | null = null;

function onEventLine(type: string, data: Record<string, unknown>) {
  sessionIssues.ingest({ type, data });
  activityTracker.ingest(type, data);
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
