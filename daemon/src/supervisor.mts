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
  ensureOrchestratorDefinition, getOrchestratorVersion, getSupervisorMode, getSupervisorSession,
  logEvent, setSupervisorSession,
} from './state.mts';
import { messageText } from './messages.mts';
import { pendingQuestionsOf, supervisorStatusOf, type SupervisorPendingForm } from './supervisor-forms.mts';
import { toPromptFiles, toQueueAttachments } from './attachments.mts';
import { defaultModelRef, modelLabel, modelPayload } from './models.mts';
import { chatAgentRef, chatModelRef } from './prefs.mts';

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

export type { SupervisorPendingForm } from './supervisor-forms.mts';

/** Message accepté pendant un tour : OpenChamber le livrera à la fin. */
export interface QueuedSupervisorMessage {
  id: string;
  text: string;
  at: number;
}

export interface SupervisorModelInfo {
  /** référence `provider/model` */
  ref: string;
  providerID: string;
  modelID: string;
  /** nom lisible du catalogue, la référence si le catalogue manque */
  name: string;
}

export interface SupervisorState {
  sessionId: string | null;
  status: 'idle' | 'busy' | 'unknown';
  agent: string | null;
  /** modèle effectif de la conversation (visible dans l'en-tête) */
  model?: SupervisorModelInfo | null;
  directory: string;
  mode: 'pilot' | 'investigation';
  projectDirectory: string | null;
  messages: SupervisorMessage[];
  queued: QueuedSupervisorMessage[];
  /** questions du tool `question` encore sans réponse */
  pendingForms: SupervisorPendingForm[];
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

/**
 * Session vivante, lue par id : ni supprimée ni archivée. Une lecture directe
 * évite le listing paginé, où la session de supervision peut manquer (et une
 * absence passagère suffisait à créer une nouvelle conversation).
 */
async function liveSessionMeta(id: string): Promise<SessionMeta | null> {
  const meta = await sessionMeta(id);
  if (!meta?.id || meta.time?.archived) return null;
  return meta;
}

/**
 * Que faire de la conversation de supervision ?
 * Un changement de version du prompt ne doit JAMAIS la remplacer : la
 * conversation est conservée et son agent bascule en place sur le nom versionné
 * (`POST /api/session/:id/agent`), qui charge le nouveau prompt.
 */
export function supervisorSessionAction(p: {
  exists: boolean;
  sessionAgent: string | null;
  agent: string;
}): 'create' | 'switch' | 'reuse' {
  if (!p.exists) return 'create';
  return p.sessionAgent === p.agent ? 'reuse' : 'switch';
}

/** Bascule l'agent d'une session vivante : l'historique et les messages restent. */
async function switchSessionAgent(id: string, agent: string): Promise<boolean> {
  try {
    const out = await jpost(`/api/session/${encodeURIComponent(id)}/agent`, { agent });
    return out.ok;
  } catch {
    return false;
  }
}

/**
 * Une session ouverte par l'API sans prompt n'a ni agent ni modèle (le champ
 * `agent` de la création n'est appliqué qu'avec un prompt). Le prompt v2 ne
 * les choisit pas : on les pose ici avant d'envoyer, sinon un chat « Nettoyé »
 * repartirait sur l'agent par défaut, voire sans modèle.
 *
 * Le modèle du chat suit la préférence explicite quand elle existe (y compris
 * pour revenir en arrière), sinon le comportement d'origine est conservé : on
 * ne remplit un modèle absent qu'avec le défaut d'OpenChamber.
 */
async function applySessionSetup(id: string, agent: string): Promise<void> {
  let meta: { data?: { agent?: string; model?: { id?: string; providerID?: string } } } | null = null;
  try {
    meta = await jget(`/api/session/${encodeURIComponent(id)}`) as {
      data?: { agent?: string; model?: { id?: string; providerID?: string } };
    };
  } catch { /* session neuve ou lecture impossible : les writes diront */ }
  if (meta?.data?.agent !== agent) await switchSessionAgent(id, agent);
  const current = meta?.data?.model;
  const currentRef = current?.id && current.providerID ? `${current.providerID}/${current.id}` : '';
  const pref = await chatModelRef();
  if (!pref && currentRef) return;
  const ref = pref ?? await defaultModelRef();
  if (!ref || ref === currentRef) return;
  await setSessionModel(id, ref, pref ? 'préférence du chat' : 'défaut');
}

/** Pose le modèle d'une session vivante ; en cas de refus, replie sur le défaut. */
async function setSessionModel(id: string, ref: string, origin: 'préférence du chat' | 'défaut'): Promise<boolean> {
  const payload = modelPayload(ref);
  if (!payload) return false;
  try {
    const out = await jpost(`/api/session/${encodeURIComponent(id)}/model`, { model: payload });
    if (out.ok) return true;
    if (origin === 'préférence du chat') {
      // une préférence morte ne doit pas bloquer un envoi : on revient au défaut
      const fallback = await defaultModelRef();
      if (fallback && fallback !== ref) {
        const fallbackPayload = modelPayload(fallback);
        if (fallbackPayload) {
          const retry = await jpost(`/api/session/${encodeURIComponent(id)}/model`, { model: fallbackPayload });
          if (retry.ok) {
            logEvent('supervisor', 'note', `modèle ${ref} refusé : repli sur ${fallback}`);
            return true;
          }
        }
      }
      logEvent('supervisor', 'note', `modèle ${ref} refusé, session laissée sur son modèle courant`);
    }
    return false;
  } catch {
    return false;
  }
}

function sameDirectory(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
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
  await applySessionSetup(id, agent);
  await quietWorkOnce(id);
  return id;
}

/**
 * Les polls du chat et un envoi peuvent demander la session en même temps :
 * sans ce verrou, deux appels concurrents pouvaient créer deux conversations.
 */
let supervisorQueue: Promise<unknown> = Promise.resolve();
function serializedSupervisor<T>(task: () => Promise<T>): Promise<T> {
  const run = supervisorQueue.then(task, task);
  supervisorQueue = run.then(() => undefined, () => undefined);
  return run;
}

/** Échec de bascule déjà journalisé : éviter un log par poll. */
let lastSwitchFailure = '';

async function ensureSupervisorSessionOnce(): Promise<{
  id: string;
  agent: string;
  model: SessionMeta['model'] | null;
}> {
  const version = getOrchestratorVersion();
  const orchestrator = ensureOrchestratorDefinition(version);
  // l'agent choisi dans la config remplace l'orchestrateur ; sans choix, le
  // nom versionné du repo reste la référence (cache de prompt par nom)
  const agent = (await chatAgentRef()) ?? orchestrator;
  await trustWorkspace();
  void quietSupervisorSessions();
  const known = getSupervisorSession();
  const knownId = known?.oc_session_id ?? '';
  const meta = knownId ? await liveSessionMeta(knownId) : null;
  const action = supervisorSessionAction({
    exists: !!meta?.id,
    sessionAgent: meta?.agent ?? null,
    agent,
  });
  if (action === 'create' || !knownId) {
    const id = await createSupervisorSession(agent);
    setSupervisorSession({ ocSessionId: id, agent, version, title: 'Superviseur' });
    logEvent('supervisor', 'note', `session de supervision #${id.slice(-6)} (${agent})`);
    return { id, agent, model: (await sessionMeta(id))?.model ?? null };
  }
  // conversation existante : la sortir du home une fois par processus
  await quietWorkOnce(knownId);
  let effectiveAgent = agent;
  if (action === 'switch') {
    const switched = await switchSessionAgent(knownId, agent);
    if (switched) {
      lastSwitchFailure = '';
      logEvent('supervisor', 'note', `conversation #${knownId.slice(-6)} basculée sur ${agent}`);
    } else {
      // ne jamais remplacer la conversation : elle garde son agent courant
      effectiveAgent = meta?.agent ?? agent;
      const key = `${knownId}:${agent}`;
      if (lastSwitchFailure !== key) {
        lastSwitchFailure = key;
        logEvent('supervisor', 'note', `bascule d’agent impossible sur #${knownId.slice(-6)}, conversation conservée`);
      }
    }
  }
  if (!known || known.agent !== effectiveAgent || known.version !== version) {
    setSupervisorSession({
      ocSessionId: knownId, agent: effectiveAgent, version, title: known?.title ?? 'Superviseur',
    });
  }
  return { id: knownId, agent: effectiveAgent, model: meta?.model ?? null };
}

export function ensureSupervisorSession(): Promise<{
  id: string;
  agent: string;
  model: SessionMeta['model'] | null;
}> {
  return serializedSupervisor(ensureSupervisorSessionOnce);
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
  else if (name === 'read_project') label = 'a lu un fichier du projet';
  else if (name === 'glob_project') label = 'a repéré des fichiers du projet';
  else if (name === 'grep_project') label = 'a cherché dans le projet';
  else if (name === 'send_task') label = ok === false ? 'n’a pas pu envoyer le message' : 'a envoyé un message à une tâche';
  else if (name === 'close_task') label = ok === false ? 'n’a pas pu fermer la tâche' : 'a fermé une tâche';
  else if (name === 'start_task') {
    if (ok === false) label = `échec du lancement : ${String(meta.error ?? 'erreur inconnue')}`;
    else {
      const title = String(meta.title ?? meta.task?.title ?? '').trim();
      label = title ? `a lancé « ${title} »` : 'a lancé une tâche';
    }
  } else if (name === 'question') {
    label = status === 'running' || status === 'pending' ? 'pose une question' : 'a posé une question';
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
  return (await statusSnapshot(id)).status;
}

interface StatusSnapshot {
  status: 'idle' | 'busy' | 'unknown';
  forms: SupervisorPendingForm[];
}

/** Statut + questions en attente, en une seule lecture de /api/sessions/status. */
async function statusSnapshot(id: string): Promise<StatusSnapshot> {
  try {
    const s = await jget('/api/sessions/status') as {
      sessions?: Record<string, { status?: string }>;
      pending?: Record<string, { forms?: SupervisorPendingForm[] }>;
    };
    return { status: supervisorStatusOf(s, id), forms: pendingQuestionsOf(s, id) };
  } catch {
    return { status: 'unknown', forms: [] };
  }
}

interface SessionMeta {
  id?: string;
  agent?: string;
  model?: { id?: string; providerID?: string; variant?: string };
  location?: { directory?: string };
  time?: { archived?: number };
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
    const { id, agent, model } = await ensureSupervisorSession();
    const [messages, snapshot, queued] = await Promise.all([
      jget(`/api/session/${id}/message?limit=80&order=desc`) as Promise<{ data?: WireMessage[] }>,
      statusSnapshot(id),
      queuedOf(id),
    ]);
    const status = snapshot.status;
    const pendingForms = snapshot.forms;
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
    const mode = getSupervisorMode();
    const modelInfo: SupervisorModelInfo | null = model?.id && model.providerID
      ? {
          ref: `${model.providerID}/${model.id}`,
          providerID: model.providerID,
          modelID: model.id,
          name: (await modelLabel(`${model.providerID}/${model.id}`)) ?? model.id,
        }
      : null;
    return {
      sessionId: id, status: effective, agent, model: modelInfo, directory: SUPERVISOR_DIR,
      mode: mode.mode, projectDirectory: mode.projectDir, messages: list, queued, pendingForms,
    };
  } catch (e) {
    return {
      sessionId: getSupervisorSession()?.oc_session_id ?? null,
      status: 'unknown',
      agent: getSupervisorSession()?.agent ?? null,
      model: null,
      directory: SUPERVISOR_DIR,
      mode: getSupervisorMode().mode,
      projectDirectory: getSupervisorMode().projectDir,
      messages: [],
      queued: [],
      pendingForms: [],
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
 * Préfixe UNIQUE combiné : remise à jour du plan + instructions du tool
 * `answer`. Il est appliqué à toutes les unités d'écriture du propriétaire
 * (chat de supervision ET panel d'une tâche existante), là où l'encadrement
 * existe déjà ; SuperviseurPlan n'y touche pas.
 *
 * Le texte encadré part tel quel à OpenChamber, donc la bulle du chat le
 * porte aussi : `stripOwnerWrap` ne fait le retirer que pour l'affichage.
 */
export const OWNER_WRAP =
  "Nouvelle instruction de l\u2019utilisateur : mets ton plan à jour au besoin ; "
  + "définis ou mets à jour tes critères d\u2019acceptation (criteria_add, criteria_to_validate : "
  + "le vérificateur du Superviseur juge tes preuves) ; "
  + "les réponses pour le propriétaire partent avec le tool `answer` (elles s\u2019affichent dans le Superviseur) :";

export function wrapOwnerPrompt(text: string): string {
  return `${OWNER_WRAP}\n\n${text}`;
}

const PILOT_WRAP = 'Mode Piloter : tu peux cadrer et lancer des tâches selon tes règles habituelles.';
const INVESTIGATION_WRAP = 'Mode Investigation : lecture seule du projet sélectionné, sans création de tâche ni modification de fichier.';

export function wrapSupervisorPrompt(text: string, mode: 'pilot' | 'investigation', projectDirectory: string | null): string {
  if (mode === 'investigation' && projectDirectory) return wrapInvestigationPrompt(text, projectDirectory);
  return `${OWNER_WRAP}\n\n${PILOT_WRAP}\n\n${text}`;
}

export function wrapInvestigationPrompt(text: string, projectDirectory: string): string {
  return `${INVESTIGATION_WRAP}\nProjet sélectionné : ${projectDirectory}\n\n${text}`;
}

export function stripOwnerWrap(text: string): string {
  const clean = String(text ?? '');
  if (clean.startsWith(INVESTIGATION_WRAP)) {
    const userText = clean.indexOf('\n\n');
    return userText >= 0 ? clean.slice(userText + 2).trim() : '';
  }
  if (!clean.startsWith(OWNER_WRAP)) return clean;
  const body = clean.slice(OWNER_WRAP.length).trim();
  if (body.startsWith(PILOT_WRAP)) {
    const userText = body.indexOf('\n\n');
    return userText >= 0 ? body.slice(userText + 2).trim() : '';
  }
  return body;
}

export async function sendSupervisor(text: string, rawAttachments: unknown = []): Promise<SupervisorState> {
  const clean = String(text ?? '').trim();
  const files = toPromptFiles(rawAttachments);
  if (!clean && !files.length) return getSupervisorState();
  const { id, agent } = await ensureSupervisorSession();
  await applySessionSetup(id, agent);
  const mode = getSupervisorMode();
  const prompt = wrapSupervisorPrompt(clean || 'Voir la pièce jointe.', mode.mode, mode.projectDir);
  // le prompt v2 porte les pièces jointes ; l'agent est déjà sur la session
  // (ensureSupervisorSession le bascule en place), le champ `agent` n'existe
  // pas sur cette route.
  const out = await jpost(`/api/session/${encodeURIComponent(id)}/prompt`, {
    text: prompt,
    ...(files.length ? { files } : {}),
  });
  if (!out.ok) throw new Error(`envoi superviseur → ${out.status}`);
  // règle OpenChamber : un message envoyé ouvre la session dans « In work ».
  // On la referme tout de suite, puis une seconde fois au cas où l'ouverture
  // arriverait après la réponse du send (elle est asynchrone côté OpenChamber).
  await quietWork(id);
  const late = setTimeout(() => { void quietWork(id); }, 2500);
  late.unref?.();
  logEvent('supervisor', 'note', `→ ${clean.slice(0, 120)}${files.length ? ` (+${files.length} fichier${files.length > 1 ? 's' : ''})` : ''}`);
  return getSupervisorState();
}

/**
 * Message écrit pendant un tour : la file OpenChamber le délivre quand la
 * session redevient idle, comme dans OpenChamber.
 */
export async function queueSupervisor(text: string, rawAttachments: unknown = []): Promise<SupervisorState> {
  const clean = String(text ?? '').trim();
  const attachments = toQueueAttachments(rawAttachments);
  if (!clean && !attachments.length) return getSupervisorState();
  const { id, agent } = await ensureSupervisorSession();
  await applySessionSetup(id, agent);
  const mode = getSupervisorMode();
  const sendConfig = await sendConfigOf(id, agent);
  if (!sendConfig) throw new Error('modèle du superviseur introuvable');
  const wrapped = wrapSupervisorPrompt(clean || 'Voir la pièce jointe.', mode.mode, mode.projectDir);
  const out = await jpost(`/api/message-queue/sessions/${encodeURIComponent(id)}/items`, {
    directory: SUPERVISOR_DIR,
    item: {
      content: wrapped,
      text: wrapped,
      sendConfig,
      ...(attachments.length ? { attachments } : {}),
    },
  });
  if (!out.ok) throw new Error(`file d'attente superviseur → ${out.status}`);
  logEvent('supervisor', 'note', `file → ${clean.slice(0, 120)}${attachments.length ? ` (+${attachments.length} fichier${attachments.length > 1 ? 's' : ''})` : ''}`);
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

export function newSupervisorConversation(): Promise<SupervisorState> {
  return serializedSupervisor(async () => {
    const version = getOrchestratorVersion();
    const agent = (await chatAgentRef()) ?? ensureOrchestratorDefinition(version);
    const id = await createSupervisorSession(agent);
    setSupervisorSession({ ocSessionId: id, agent, version, title: 'Superviseur' });
    logEvent('supervisor', 'note', `nouvelle conversation #${id.slice(-6)}`);
    // session neuve : pas besoin de relire 80 messages ni le statut, elle est vide
    const mode = getSupervisorMode();
    const model = (await sessionMeta(id))?.model ?? null;
    const modelInfo: SupervisorModelInfo | null = model?.id && model.providerID
      ? {
          ref: `${model.providerID}/${model.id}`,
          providerID: model.providerID,
          modelID: model.id,
          name: (await modelLabel(`${model.providerID}/${model.id}`)) ?? model.id,
        }
      : null;
    return {
      sessionId: id, status: 'idle' as const, agent, model: modelInfo, directory: SUPERVISOR_DIR,
      mode: mode.mode, projectDirectory: mode.projectDir, messages: [], queued: [], pendingForms: [],
    };
  });
}

/**
 * Applique à chaud la configuration du chat à la conversation courante :
 * agent et modèle changent en place (`POST /api/session/:id/agent|model`),
 * l'historique et l'id restent. Appelé par `POST /api/supervisor/config`.
 * Si la conversation n'existe pas encore, rien n'est créé : la préférence
 * sera appliquée au prochain `ensureSupervisorSession`.
 */
export async function applySupervisorChatConfig(): Promise<{
  sessionId: string | null;
  agent: string | null;
  model: string | null;
  applied: boolean;
  error?: string;
}> {
  return serializedSupervisor(async () => {
    const known = getSupervisorSession();
    const id = known?.oc_session_id ?? '';
    if (!id) return { sessionId: null, agent: null, model: null, applied: false };
    const meta = await liveSessionMeta(id);
    if (!meta?.id) {
      return {
        sessionId: null, agent: null, model: null, applied: false,
        error: 'la conversation courante n’est plus vivante',
      };
    }
    const version = getOrchestratorVersion();
    const agent = (await chatAgentRef()) ?? ensureOrchestratorDefinition(version);
    let applied = true;
    let error: string | undefined;
    if (meta.agent !== agent) {
      const switched = await switchSessionAgent(id, agent);
      if (!switched) {
        applied = false;
        error = 'changement d’agent impossible pour l’instant (tour en cours ?)';
      }
    }
    // le modèle voulu : préférence explicite, sinon défaut d'OpenChamber (un
    // retour au défaut doit aussi ramener la session au modèle par défaut)
    const ref = (await chatModelRef()) ?? await defaultModelRef();
    if (ref) {
      const current = meta.model?.id && meta.model.providerID
        ? `${meta.model.providerID}/${meta.model.id}` : '';
      const payload = modelPayload(ref);
      if (payload && current !== ref) {
        const ok = await jpost(`/api/session/${encodeURIComponent(id)}/model`, { model: payload })
          .then(out => out.ok).catch(() => false);
        if (!ok) {
          applied = false;
          error = error ?? 'changement de modèle impossible pour l’instant (tour en cours ?)';
        }
      }
    }
    // l'agent stocké doit refléter la session réelle, pas le souhait
    const fresh = await sessionMeta(id);
    const effectiveAgent = fresh?.agent ?? meta.agent ?? agent;
    setSupervisorSession({
      ocSessionId: id, agent: effectiveAgent, version, title: known?.title ?? 'Superviseur',
    });
    logEvent('supervisor', 'note',
      `config chat appliquée : agent ${effectiveAgent}${ref ? `, modèle ${ref}` : ''}${applied ? '' : ' (partiel)'}`);
    return {
      sessionId: id, agent: effectiveAgent, model: ref, applied,
      ...(error ? { error } : {}),
    };
  });
}

export async function abortSupervisor(): Promise<void> {
  const id = getSupervisorSession()?.oc_session_id;
  if (!id) return;
  // best-effort : selon la version, l'interruption est exposée sous abort ou interrupt
  await jpost(`/api/session/${id}/abort`, {}).catch(() => undefined);
  await jpost(`/api/session/${id}/interrupt`, {}).catch(() => undefined);
}

export async function isSupervisorBusy(): Promise<boolean> {
  const id = getSupervisorSession()?.oc_session_id;
  if (!id) return false;
  try {
    const snapshot = await jget('/api/sessions/status') as { sessions?: Record<string, { status?: string }> };
    const status = snapshot.sessions?.[id]?.status;
    if (status === 'busy') return true;
    const messages = await jget(`/api/session/${encodeURIComponent(id)}/message?limit=80&order=desc`) as { data?: WireMessage[] };
    const toolRunning = (messages.data ?? []).some(message => (message.content ?? []).some(part =>
      part.type === 'tool' && (part.state?.status === 'running' || part.state?.status === 'pending')));
    const queue = await jget('/api/message-queue') as {
      sessions?: Array<{ sessionId?: string; items?: unknown[] }>;
    };
    const queued = (queue.sessions ?? []).find(session => session.sessionId === id)?.items ?? [];
    return toolRunning || queued.length > 0 || (status !== undefined && status !== 'idle');
  } catch {
    // En cas de statut invérifiable, ne pas changer la frontière d'outils à l'aveugle.
    return true;
  }
}

/**
 * Une conversation de supervision = la session courante, ou n'importe quelle
 * conversation vivante du dossier `~/.superviseur`. Les conversations passées
 * (Nettoyer, ancienne version) restent utilisables dans OpenChamber : leurs
 * outils ne doivent pas être refusés parce que le pointeur a bougé.
 */
export async function isSupervisorSession(sessionId: string): Promise<boolean> {
  if (!sessionId) return false;
  if (getSupervisorSession()?.oc_session_id === sessionId) return true;
  const meta = await liveSessionMeta(sessionId);
  return sameDirectory(meta?.location?.directory, SUPERVISOR_DIR);
}
