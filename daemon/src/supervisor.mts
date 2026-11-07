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

export interface SupervisorMessage {
  id: string;
  role: 'user' | 'assistant';
  at: number;
  text: string;
  tools: Array<{ name: string; status: string; label: string; ok?: boolean }>;
}

export interface SupervisorState {
  sessionId: string | null;
  status: 'idle' | 'busy' | 'unknown';
  agent: string | null;
  directory: string;
  messages: SupervisorMessage[];
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
  return id;
}

export async function ensureSupervisorSession(): Promise<{ id: string; agent: string }> {
  const version = getOrchestratorVersion();
  const agent = ensureOrchestratorDefinition(version);
  await trustWorkspace();
  const known = getSupervisorSession();
  if (known?.oc_session_id && known.agent === agent && known.version === version && await sessionExists(known.oc_session_id)) {
    return { id: known.oc_session_id, agent };
  }
  const id = await createSupervisorSession(agent);
  setSupervisorSession({ ocSessionId: id, agent, version, title: 'Superviseur' });
  logEvent('supervisor', 'note', `session de supervision #${id.slice(-6)} (${agent})`);
  return { id, agent };
}

function toolLabel(part: WirePart): { label: string; ok?: boolean; name: string; status: string } {
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
  return { label, ok, name, status };
}

function toMessage(m: WireMessage): SupervisorMessage | null {
  if (m.type !== 'user' && m.type !== 'assistant') return null;
  const tools: SupervisorMessage['tools'] = [];
  for (const part of m.content ?? []) {
    if (part?.type === 'tool') {
      const t = toolLabel(part);
      tools.push({ name: t.name, status: t.status, label: t.label, ok: t.ok });
    }
  }
  const text = messageText(m).trim();
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

export async function getSupervisorState(): Promise<SupervisorState> {
  try {
    const { id, agent } = await ensureSupervisorSession();
    const [messages, status] = await Promise.all([
      jget(`/api/session/${id}/message?limit=80&order=desc`) as Promise<{ data?: WireMessage[] }>,
      statusOf(id),
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
    return { sessionId: id, status: effective, agent, directory: SUPERVISOR_DIR, messages: list };
  } catch (e) {
    return {
      sessionId: getSupervisorSession()?.oc_session_id ?? null,
      status: 'unknown',
      agent: getSupervisorSession()?.agent ?? null,
      directory: SUPERVISOR_DIR,
      messages: [],
      error: String(e),
    };
  }
}

export async function sendSupervisor(text: string): Promise<SupervisorState> {
  const clean = String(text ?? '').trim();
  if (!clean) return getSupervisorState();
  const { id, agent } = await ensureSupervisorSession();
  const out = await jpost(`/api/openchamber/sessions/${id}/send`, {
    prompt: clean,
    agent,
    directory: SUPERVISOR_DIR,
  });
  if (!out.ok) throw new Error(`envoi superviseur → ${out.status}`);
  logEvent('supervisor', 'note', `→ ${clean.slice(0, 120)}`);
  return getSupervisorState();
}

export async function newSupervisorConversation(): Promise<SupervisorState> {
  const version = getOrchestratorVersion();
  const agent = ensureOrchestratorDefinition(version);
  const id = await createSupervisorSession(agent);
  setSupervisorSession({ ocSessionId: id, agent, version, title: 'Superviseur' });
  logEvent('supervisor', 'note', `nouvelle conversation #${id.slice(-6)}`);
  // session neuve : pas besoin de relire 80 messages ni le statut, elle est vide
  return { sessionId: id, status: 'idle', agent, directory: SUPERVISOR_DIR, messages: [] };
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
