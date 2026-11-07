/**
 * La session de supervision du chat de gauche.
 *
 * C'est une session OpenChamber ordinaire, créée dans `~/.superviseur` avec
 * l'agent `superviseur-orchestrateur-<hash>`. Elle est exclue de la flotte et
 * du compagnon. Les messages vivent dans OpenChamber ; le daemon ne garde que
 * l'id, l'agent et la version.
 */
import { copyFileSync, existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureOrchestratorDefinition, getOrchestratorVersion, getSupervisorSession,
  logEvent, setSupervisorSession,
} from './state.mts';
import { messageText } from './messages.mts';

const here = dirname(fileURLToPath(import.meta.url));
export const SUPERVISOR_DIR = process.env.SUPERVISEUR_HOME ?? join(homedir(), '.superviseur');
const PLUGIN_SRC = join(here, '..', 'plugin', 'superviseur');

let base = '';
export function setBase(b: string) { base = b.replace(/\/$/, ''); }

/**
 * OpenChamber ouvre une session dans « In work » dès qu'un message lui est
 * envoyé. Le chat de supervision a son propre rail dans le Superviseur : on
 * retire ce marqueur pour qu'il ne s'invite pas dans le home d'OpenChamber.
 * Un envoi fait depuis OpenChamber le réactive, d'où le nettoyage après le tour.
 */
const QUIET_WORK = { openchamber: { work: null } };
const quieted = new Set<string>();

async function quietWork(id: string): Promise<void> {
  if (!id) return;
  await jpost(`/api/openchamber/sessions/${id}/metadata`, {
    directory: SUPERVISOR_DIR,
    patch: QUIET_WORK,
  }).catch(() => undefined);
}

async function quietWorkOnce(id: string): Promise<void> {
  if (!id || quieted.has(id)) return;
  quieted.add(id);
  await quietWork(id);
}

let homeCleaned = false;
let homeCleaning = false;

/**
 * Les anciennes conversations de supervision ont reçu le marqueur « In work »
 * au fil des messages. On le retire une fois pour tout le dossier : elles
 * restent dans le projet `~/.superviseur` (rien n'est déplacé ni supprimé),
 * mais elles ne s'invitent plus dans le home d'OpenChamber.
 */
async function quietSupervisorSessions(): Promise<void> {
  if (homeCleaned || homeCleaning) return;
  homeCleaning = true;
  try {
    const list = await jget('/api/session?limit=200') as {
      data?: Array<{
        id?: string;
        location?: { directory?: string };
        metadata?: { openchamber?: { work?: unknown } };
      }>;
    };
    const rows = (list.data ?? []).filter(s =>
      !!s.id && s.location?.directory === SUPERVISOR_DIR && !!s.metadata?.openchamber?.work);
    for (const s of rows) await quietWork(String(s.id));
    homeCleaned = true;
    if (rows.length) {
      logEvent('supervisor', 'note', `${rows.length} conversation(s) sortie(s) du home OpenChamber`);
    }
  } catch {
    /* best-effort : un prochain tick réessaie */
  } finally {
    homeCleaning = false;
  }
}

export interface SupervisorMessage {
  id: string;
  role: 'user' | 'assistant';
  at: number;
  text: string;
  tools: Array<{ name: string; status: string; label: string; ok?: boolean }>;
}

/** Message accepté pendant un tour : OpenChamber le livrera à la fin. */
export interface QueuedSupervisorMessage {
  id: string;
  text: string;
  at: number;
}

export interface SupervisorState {
  sessionId: string | null;
  status: 'idle' | 'busy' | 'unknown';
  agent: string | null;
  directory: string;
  messages: SupervisorMessage[];
  queued: QueuedSupervisorMessage[];
  error?: string;
}

interface WirePart {
  type?: string;
  text?: string;
  tool?: string;
  name?: string;
  state?: {
    status?: string;
    input?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    content?: unknown;
  };
}

interface WireMessage {
  id: string;
  type: string;
  time?: { created?: number };
  text?: string;
  payload?: { text?: string };
  content?: WirePart[];
}

async function jget(path: string, timeoutMs = 10000): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, { signal: ctl.signal });
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

async function jpost(path: string, body: unknown, timeoutMs = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return { status: res.status, ok: res.ok, data };
  } finally { clearTimeout(t); }
}

async function jdel(path: string, timeoutMs = 10000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, { method: 'DELETE', signal: ctl.signal });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return { status: res.status, ok: res.ok, data };
  } finally { clearTimeout(t); }
}

/** Le dossier de travail et le plugin projet-local des outils superviseur. */
export function ensureSupervisorWorkspace(): string {
  mkdirSync(SUPERVISOR_DIR, { recursive: true });
  const dst = join(SUPERVISOR_DIR, '.opencode', 'plugins', 'superviseur');
  mkdirSync(dst, { recursive: true });
  for (const file of ['index.js', 'package.json']) {
    const from = join(PLUGIN_SRC, file);
    const to = join(dst, file);
    // copie à chaque démarrage : le canonical du repo est la source, et OpenCode
    // ne suit pas forcément un symlink de plugin après un redémarrage
    try {
      copyFileSync(from, to);
    } catch {
      try { if (!existsSync(to)) symlinkSync(from, to); } catch { /* plugin absent : le chat reste utilisable sans outils */ }
    }
  }
  return SUPERVISOR_DIR;
}

async function sessionExists(id: string): Promise<boolean> {
  try {
    const list = await jget('/api/session?limit=200') as { data?: Array<{ id?: string; time?: { archived?: number } }> };
    const found = (list.data ?? []).find(s => s.id === id);
    return !!found && !found.time?.archived;
  } catch {
    return false;
  }
}

/**
 * OpenChamber met un dossier en pause tant que ses plugins/commandes ne sont
 * pas approuvés. Le dossier de supervision est créé par le daemon et ne contient
 * que notre plugin : on approuve son empreinte avant de créer la session.
 */
async function trustWorkspace(): Promise<void> {
  try {
    const info = await jget(`/api/opencode/trust?directory=${encodeURIComponent(SUPERVISOR_DIR)}`) as {
      trusted?: boolean; fingerprint?: string;
    };
    if (info.trusted || !info.fingerprint) return;
    await jpost('/api/opencode/trust', {
      directory: SUPERVISOR_DIR,
      fingerprint: info.fingerprint,
      trusted: true,
    });
    logEvent('supervisor', 'note', 'dossier de supervision approuvé');
  } catch { /* la session démarrera en pause ; l'UI affichera l'erreur */ }
}

async function createSupervisorSession(agent: string): Promise<string> {
  ensureSupervisorWorkspace();
  const out = await jpost('/api/openchamber/sessions', {
    title: 'Superviseur',
    directory: SUPERVISOR_DIR,
    agent,
  });
  const id = (out.data as { sessionId?: string })?.sessionId;
  if (!out.ok || !id) throw new Error(`création session superviseur → ${out.status}`);
  await quietWorkOnce(id);
  return id;
}

export async function ensureSupervisorSession(): Promise<{ id: string; agent: string }> {
  const version = getOrchestratorVersion();
  const agent = ensureOrchestratorDefinition(version);
  await trustWorkspace();
  void quietSupervisorSessions();
  const known = getSupervisorSession();
  if (known?.oc_session_id && known.agent === agent && known.version === version && await sessionExists(known.oc_session_id)) {
    // conversation existante : la sortir du home une fois par processus
    await quietWorkOnce(known.oc_session_id);
    return { id: known.oc_session_id, agent };
  }
  const id = await createSupervisorSession(agent);
  setSupervisorSession({ ocSessionId: id, agent, version, title: 'Superviseur' });
  logEvent('supervisor', 'note', `session de supervision #${id.slice(-6)} (${agent})`);
  return { id, agent };
}

function toolLabel(part: WirePart): {
  label: string;
  ok?: boolean;
  name: string;
  status: string;
  taskId?: string;
  title?: string;
  text?: string;
} {
  const name = String(part.tool ?? part.name ?? 'outil').replace(/:\d+$/, '');
  const status = String(part.state?.status ?? '');
  const meta = (part.state?.metadata ?? {}) as Record<string, unknown>;
  const ok = typeof meta.ok === 'boolean' ? meta.ok : undefined;
  let label = name;
  if (name === 'list_projects') label = 'a listé les projets';
  else if (name === 'list_tasks') label = 'a consulté la flotte';
  else if (name === 'get_task') label = 'a lu une tâche';
  else if (name === 'send_task') label = ok === false ? 'n’a pas pu envoyer le message' : 'a envoyé un message à une tâche';
  else if (name === 'close_task') label = ok === false ? 'n’a pas pu fermer la tâche' : 'a fermé une tâche';
  else if (name === 'start_task') {
    if (ok === false) label = `échec du lancement : ${String(meta.error ?? 'erreur inconnue')}`;
    else {
      const title = String(meta.title ?? meta.task?.title ?? '').trim();
      label = title ? `a lancé « ${title} »` : 'a lancé une tâche';
    }
  } else if (status === 'running') label = `utilise ${name}`;
  else if (status === 'failed' || status === 'error') label = `échec de ${name}`;
  // `send_task` : le titre et le texte complet servent au bloc « Envoyé à … ».
  // Le titre est résolu à l'affichage, pas figé ici.
  const send = name === 'send_task';
  const taskId = send && typeof meta.taskId === 'string' ? meta.taskId : undefined;
  const title = send && typeof meta.title === 'string' ? meta.title : undefined;
  const inputText = part.state?.input?.text;
  const text = send
    ? (typeof meta.text === 'string' ? meta.text : typeof inputText === 'string' ? inputText : undefined)
    : undefined;
  return { label, ok, name, status, taskId, title, text };
}

function toMessage(m: WireMessage): SupervisorMessage | null {
  if (m.type !== 'user' && m.type !== 'assistant') return null;
  const tools: SupervisorMessage['tools'] = [];
  for (const part of m.content ?? []) {
    if (part?.type === 'tool') {
      const t = toolLabel(part);
      tools.push({
        name: t.name,
        status: t.status,
        label: t.label,
        ok: t.ok,
        taskId: t.taskId,
        title: t.title,
        text: t.text,
      });
    }
  }
  const text = stripOwnerWrap(messageText(m).trim());
  if (!text && !tools.length) return null;
  return {
    id: m.id,
    role: m.type,
    at: m.time?.created ?? 0,
    text,
    tools,
  };
}

async function statusOf(id: string): Promise<'idle' | 'busy' | 'unknown'> {
  try {
    const s = await jget('/api/sessions/status') as { sessions?: Record<string, { status?: string }> };
    const v = s.sessions?.[id]?.status;
    return v === 'busy' ? 'busy' : v === 'idle' ? 'idle' : 'unknown';
  } catch { return 'unknown'; }
}

interface SessionMeta {
  id?: string;
  agent?: string;
  model?: { id?: string; providerID?: string; variant?: string };
}

async function sessionMeta(id: string): Promise<SessionMeta | null> {
  try {
    const body = await jget(`/api/session/${encodeURIComponent(id)}`) as { data?: SessionMeta };
    return body.data ?? null;
  } catch {
    return null;
  }
}

/** File d'attente OpenChamber de la session de supervision (survit à l'onglet fermé). */
async function queuedOf(id: string): Promise<QueuedSupervisorMessage[]> {
  try {
    const snap = await jget('/api/message-queue', 5000) as {
      sessions?: Array<{
        sessionId?: string;
        items?: Array<{ id?: string; text?: string; content?: string; createdAt?: number }>;
      }>;
    };
    const session = (snap.sessions ?? []).find(s => s.sessionId === id);
    return (session?.items ?? [])
      .map(item => ({
        id: String(item.id ?? ''),
        // la file porte le texte encadré : on l'affiche dépouillé
        text: stripOwnerWrap(String(item.text ?? item.content ?? '')),
        at: Number(item.createdAt ?? 0),
      }))
      .filter(item => !!item.id);
  } catch {
    return [];
  }
}

interface SendConfig {
  providerID: string;
  modelID: string;
  agent?: string;
  variant?: string;
}

/** La file OpenChamber exige le modèle ; on reprend celui de la session. */
async function sendConfigOf(id: string, fallbackAgent: string): Promise<SendConfig | null> {
  const meta = await sessionMeta(id);
  const providerID = meta?.model?.providerID;
  const modelID = meta?.model?.id;
  if (!providerID || !modelID) return null;
  return {
    providerID,
    modelID,
    agent: meta?.agent ?? fallbackAgent,
    ...(meta?.model?.variant ? { variant: meta.model.variant } : {}),
  };
}

let lastStatus: 'idle' | 'busy' | 'unknown' = 'unknown';

export async function getSupervisorState(): Promise<SupervisorState> {
  try {
    const { id, agent } = await ensureSupervisorSession();
    const [messages, status, queued] = await Promise.all([
      jget(`/api/session/${id}/message?limit=80&order=desc`) as Promise<{ data?: WireMessage[] }>,
      statusOf(id),
      queuedOf(id),
    ]);
    const list = (messages.data ?? [])
      .map(toMessage)
      .filter((m): m is SupervisorMessage => !!m)
      .sort((a, b) => a.at - b.at)
      .slice(-80);
    // un outil encore en cours (render en attente, etc.) signifie que le tour
    // n'est pas fini, même si le statut de session est déjà idle
    const toolRunning = list.some(m => m.tools.some(t => t.status === 'running' || t.status === 'pending'));
    // une session neuve n'existe pas encore dans /api/sessions/status : sans
    // outil en cours, elle est simplement prête, pas « en connexion ».
    const effective = toolRunning ? 'busy' : (status === 'unknown' ? 'idle' : status);
    // fin de tour : OpenChamber a pu rouvrir le marqueur « In work » après le send
    if (effective === 'idle' && lastStatus === 'busy') void quietWork(id);
    lastStatus = effective;
    return { sessionId: id, status: effective, agent, directory: SUPERVISOR_DIR, messages: list, queued };
  } catch (e) {
    return {
      sessionId: getSupervisorSession()?.oc_session_id ?? null,
      status: 'unknown',
      agent: getSupervisorSession()?.agent ?? null,
      directory: SUPERVISOR_DIR,
      messages: [],
      queued: [],
      error: String(e),
    };
  }
}

/**
 * Encadrement des messages du propriétaire envoyés dans le chat de supervision.
 * Il ne s'applique qu'aux envois du chat (sendSupervisor / queueSupervisor) :
 * les messages du daemon lui-même (ordres système, annulations vers les tâches)
 * ne passent pas par là.
 *
 * Préfixe UNIQUE combiné : remise à jour de la todolist + instructions du tool
 * `answer`. Il est appliqué à toutes les unités d'écriture du propriétaire
 * (chat de supervision ET panel d'une tâche existante), là où l'encadrement
 * existe déjà ; SuperviseurTodoList n'y touche pas.
 *
 * Le texte encadré part tel quel à OpenChamber, donc la bulle du chat le
 * porte aussi : `stripOwnerWrap` ne fait le retirer que pour l'affichage.
 */
export const OWNER_WRAP =
  "Nouvelle instruction de l\u2019utilisateur : mets ta todolist à jour au besoin ; "
  + "les réponses pour le propriétaire partent avec le tool `answer` (elles s\u2019affichent dans le Superviseur) :";

export function wrapOwnerPrompt(text: string): string {
  return `${OWNER_WRAP}\n\n${text}`;
}

export function stripOwnerWrap(text: string): string {
  const clean = String(text ?? '');
  if (!clean.startsWith(OWNER_WRAP)) return clean;
  return clean.slice(OWNER_WRAP.length).trim();
}

export async function sendSupervisor(text: string): Promise<SupervisorState> {
  const clean = String(text ?? '').trim();
  if (!clean) return getSupervisorState();
  const { id, agent } = await ensureSupervisorSession();
  const out = await jpost(`/api/openchamber/sessions/${id}/send`, {
    prompt: wrapOwnerPrompt(clean),
    agent,
    directory: SUPERVISOR_DIR,
  });
  if (!out.ok) throw new Error(`envoi superviseur → ${out.status}`);
  // règle OpenChamber : un message envoyé ouvre la session dans « In work ».
  // On la referme tout de suite, puis une seconde fois au cas où l'ouverture
  // arriverait après la réponse du send (elle est asynchrone côté OpenChamber).
  await quietWork(id);
  const late = setTimeout(() => { void quietWork(id); }, 2500);
  late.unref?.();
  logEvent('supervisor', 'note', `→ ${clean.slice(0, 120)}`);
  return getSupervisorState();
}

/**
 * Message écrit pendant un tour : la file OpenChamber le délivre quand la
 * session redevient idle, comme dans OpenChamber.
 */
export async function queueSupervisor(text: string): Promise<SupervisorState> {
  const clean = String(text ?? '').trim();
  if (!clean) return getSupervisorState();
  const { id, agent } = await ensureSupervisorSession();
  const sendConfig = await sendConfigOf(id, agent);
  if (!sendConfig) throw new Error('modèle du superviseur introuvable');
  const wrapped = wrapOwnerPrompt(clean);
  const out = await jpost(`/api/message-queue/sessions/${encodeURIComponent(id)}/items`, {
    directory: SUPERVISOR_DIR,
    item: { content: wrapped, text: wrapped, sendConfig },
  });
  if (!out.ok) throw new Error(`file d'attente superviseur → ${out.status}`);
  logEvent('supervisor', 'note', `file → ${clean.slice(0, 120)}`);
  return getSupervisorState();
}

export async function cancelQueuedSupervisor(itemId: string): Promise<SupervisorState> {
  const clean = String(itemId ?? '').trim();
  const id = getSupervisorSession()?.oc_session_id;
  if (!id || !clean) return getSupervisorState();
  const out = await jdel(`/api/message-queue/sessions/${encodeURIComponent(id)}/items/${encodeURIComponent(clean)}`);
  if (!out.ok) throw new Error(`retrait de la file superviseur → ${out.status}`);
  return getSupervisorState();
}

/** « Revenir à partir d'ici » : supprime les messages à partir de celui-ci. */
export async function revertSupervisor(messageId: string): Promise<SupervisorState> {
  const clean = String(messageId ?? '').trim();
  const id = getSupervisorSession()?.oc_session_id;
  if (!id || !clean) return getSupervisorState();
  if ((await statusOf(id)) === 'busy') await abortSupervisor();
  const stage = await jpost(`/api/session/${encodeURIComponent(id)}/revert/stage`, {
    messageID: clean,
  }, 20000);
  if (!stage.ok) throw new Error(`revert superviseur → ${stage.status}`);
  const commit = await jpost(`/api/session/${encodeURIComponent(id)}/revert/commit`, {}, 20000);
  if (!commit.ok) throw new Error(`revert commit superviseur → ${commit.status}`);
  await quietWork(id);
  logEvent('supervisor', 'note', `revert depuis ${clean.slice(-6)}`);
  return getSupervisorState();
}

export async function newSupervisorConversation(): Promise<SupervisorState> {
  const version = getOrchestratorVersion();
  const agent = ensureOrchestratorDefinition(version);
  const id = await createSupervisorSession(agent);
  setSupervisorSession({ ocSessionId: id, agent, version, title: 'Superviseur' });
  logEvent('supervisor', 'note', `nouvelle conversation #${id.slice(-6)}`);
  // session neuve : pas besoin de relire 80 messages ni le statut, elle est vide
  return { sessionId: id, status: 'idle', agent, directory: SUPERVISOR_DIR, messages: [], queued: [] };
}

export async function abortSupervisor(): Promise<void> {
  const id = getSupervisorSession()?.oc_session_id;
  if (!id) return;
  // best-effort : selon la version, l'interruption est exposée sous abort ou interrupt
  await jpost(`/api/session/${id}/abort`, {}).catch(() => undefined);
  await jpost(`/api/session/${id}/interrupt`, {}).catch(() => undefined);
}

export function isSupervisorSession(sessionId: string): boolean {
  return !!sessionId && getSupervisorSession()?.oc_session_id === sessionId;
}
