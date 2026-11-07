/**
 * Outils du chat de supervision.
 *
 * Toute la logique d'écriture est ici, côté daemon. Le plugin OpenCode ne fait
 * que transmettre l'appel et le `sessionID` de l'appelant. Les lectures d'état
 * utilisent la même flotte enrichie que l'UI ; en mode Investigation, les
 * lectures de fichiers sont bornées au seul projet choisi côté serveur.
 * `start_task` crée une session top-level, jamais un sous-agent.
 */
import { realpath } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { currentFleet, openchamberUrl, pollOnce, type FleetRow } from './fleet.mts';
import { getDelivery } from './delivery.mts';
import { getTodoSnapshot, todoPlan } from './todos.mts';
import { globProjectFiles, grepProjectFiles, readProjectFile } from './investigation.mts';
import { modeDenial } from './investigation-policy.mts';
import {
  armTaskResume, getTaskState, getTaskBrief, getSupervisorMode, listTaskBriefs, logEvent,
  putTaskBrief, reviveTaskResume, setSupervisorMode, upsertTaskState,
} from './state.mts';
import { isSupervisorBusy, isSupervisorSession, SUPERVISOR_DIR, wrapOwnerPrompt } from './supervisor.mts';

export interface ToolResult {
  ok: boolean;
  [key: string]: unknown;
}

interface ProjectRow {
  id?: string;
  canonical?: string;
  time?: { active?: number };
}

interface Project {
  id: string;
  name: string;
  directory: string;
  lastUsedAt: number;
}

const MAX_TASKS = Number(process.env.SUPERVISEUR_MAX_TASKS ?? 8);
/** garde locale : deux start_task simultanés ne doivent pas créer deux doublons */
const creating = new Set<string>();

async function jget(path: string, timeoutMs = 10000): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(openchamberUrl(path), { signal: ctl.signal });
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

async function jpost(path: string, body: unknown, timeoutMs = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(openchamberUrl(path), {
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

async function jdelete(path: string, timeoutMs = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(openchamberUrl(path), { method: 'DELETE', signal: ctl.signal });
    return { status: res.status, ok: res.ok };
  } finally { clearTimeout(t); }
}

function formText(form: { fields?: Array<{ title?: string; description?: string }>; title?: string } | undefined): string {
  return (form?.fields?.[0]?.description ?? form?.fields?.[0]?.title ?? form?.title ?? 'Une question').slice(0, 240);
}

const CANCEL_MESSAGE = "L'utilisateur a répondu par un message direct dans le chat de supervision.";

export interface PendingInfo {
  forms: Array<{ id: string; text: string }>;
  permissions: number;
}

/**
 * Lecture directe de /api/sessions/status pour la session ciblée. La flotte
 * peut être en retard d'un poll : une question créée à l'instant ne doit pas
 * échapper au garde-fou de fermeture.
 */
export async function pendingFor(sessionId: string): Promise<PendingInfo> {
  const st = await jget('/api/sessions/status') as {
    pending?: Record<string, {
      forms?: Array<{ id?: string; title?: string; metadata?: { kind?: string }; fields?: Array<{ title?: string; description?: string }> }>;
      permissions?: unknown[];
    }>;
  };
  const p = st.pending?.[sessionId];
  const forms = (p?.forms ?? [])
    .filter(f => f?.metadata?.kind === 'question')
    .map(f => ({ id: String(f.id ?? ''), text: formText(f) }))
    .filter(f => f.id);
  return { forms, permissions: p?.permissions?.length ?? 0 };
}

/** Annule les formulaires en attente : c'est le geste « j'envoie un message à la place ». */
export async function cancelPendingForms(sessionId: string, formIds: string[], message = CANCEL_MESSAGE): Promise<{ ok: boolean; cancelled: string[]; error?: string }> {
  const cancelled: string[] = [];
  for (const formId of formIds) {
    if (!formId) continue;
    const res = await jdelete(`/api/session/${sessionId}/form/${formId}?message=${encodeURIComponent(message)}`);
    if (!res.ok) return { ok: false, cancelled, error: `annulation formulaire ${formId} → ${res.status}` };
    cancelled.push(formId);
  }
  return { ok: true, cancelled };
}

function expandPath(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2));
  return isAbsolute(p) ? p : resolve(p);
}

function projectName(dir: string): string {
  return basename(dir) || dir;
}

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function projects(): Promise<Project[]> {
  const raw = await jget('/api/project') as ProjectRow[];
  return (Array.isArray(raw) ? raw : [])
    .filter(p => p && p.canonical && String(p.canonical) !== SUPERVISOR_DIR)
    .map(p => ({
      id: String(p.id ?? p.canonical),
      name: projectName(String(p.canonical)),
      directory: String(p.canonical),
      lastUsedAt: Number(p.time?.active ?? 0),
    }))
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

export async function supervisorProjects(): Promise<Project[]> {
  return projects();
}

export async function configureSupervisorMode(mode: unknown, projectDirectory: unknown) {
  if (mode !== 'pilot' && mode !== 'investigation') return { ok: false, error: 'invalid_mode' };
  if (await isSupervisorBusy()) return { ok: false, error: 'supervisor_busy', message: 'attends la fin du tour avant de changer de mode' };
  const requested = String(projectDirectory ?? '').trim();
  let selected: Project | undefined;
  if (requested) selected = (await projects()).find(p => p.directory === requested);
  if (requested && !selected) return { ok: false, error: 'unknown_project' };
  if (selected && !(await safeInvestigationProject(selected.directory))) {
    return { ok: false, error: 'protected_project', message: 'ce dossier ne peut pas être utilisé pour une investigation' };
  }
  if (mode === 'investigation' && !selected) return { ok: false, error: 'project_required', message: 'choisis un projet pour enquêter' };
  const current = getSupervisorMode();
  const directory = selected?.directory ?? current.projectDir;
  setSupervisorMode(mode, directory);
  return { ok: true, mode, projectDirectory: directory };
}

async function safeInvestigationProject(directory: string): Promise<boolean> {
  try {
    const [root, protectedRoot] = await Promise.all([realpath(directory), realpath(SUPERVISOR_DIR)]);
    const rel = relative(protectedRoot, root);
    const insideProtected = rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
    return !insideProtected;
  } catch { return false; }
}

async function investigationDirectory(): Promise<string | null> {
  const setting = getSupervisorMode();
  if (setting.mode !== 'investigation' || !setting.projectDir) return null;
  // Réconcilier à chaque appel avec le catalogue OpenChamber : le dossier n'est
  // jamais fourni librement par le modèle et ne peut pas être changé via les args.
  const selected = (await projects()).find(project => project.directory === setting.projectDir);
  if (!selected || !(await safeInvestigationProject(selected.directory))) return null;
  return selected.directory;
}

async function resolveProject(ref: string): Promise<{ project?: Project; error?: string; candidates?: Project[] }> {
  const value = String(ref ?? '').trim();
  if (!value) return { error: 'unknown_project' };
  const list = await projects();
  const direct = list.filter(p => p.id === value || p.directory === value || p.directory === expandPath(value));
  if (direct.length === 1) return { project: direct[0] };
  if (direct.length > 1) return { error: 'ambiguous_project', candidates: direct };
  const byName = list.filter(p => p.name.toLowerCase() === value.toLowerCase());
  if (byName.length === 1) return { project: byName[0] };
  if (byName.length > 1) return { error: 'ambiguous_project', candidates: byName };
  const prefix = list.filter(p => p.name.toLowerCase().startsWith(value.toLowerCase()));
  if (prefix.length === 1) return { project: prefix[0] };
  if (!list.length) return { error: 'unknown_project' };
  return { error: 'unknown_project', candidates: list.slice(0, 8) };
}

function sectionOf(row: FleetRow): 'waiting' | 'running' | 'done' {
  if (row.pendingForms?.length || row.pendingPermissions?.length) return 'waiting';
  if (row.sup?.termine && row.status !== 'busy') return 'done';
  return 'running';
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normTitle(s: string): string {
  return stripAccents(String(s ?? '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function taskView(row: FleetRow) {
  const snap = await getTodoSnapshot(row.id, row.lastUpdateAt);
  const task = getTaskState(row.id) as { closed_at?: number } | null;
  const waiting = row.pendingForms?.[0]?.fields?.[0]?.title
    ?? row.pendingForms?.[0]?.title
    ?? row.sup?.attend
    ?? null;
  return {
    id: row.id,
    title: row.title,
    section: sectionOf(row),
    status: row.status,
    summary: row.sup?.resume ?? '',
    next: row.sup?.next ?? '',
    waiting,
    project: row.dir ? projectName(row.dir) : '',
    directory: row.dir ?? '',
    ageMin: row.lastUpdateAt ? Math.max(0, Math.round((Date.now() - row.lastUpdateAt) / 60000)) : null,
    progress: snap.total ? { done: snap.done, total: snap.total } : null,
    closed: !!task?.closed_at,
  };
}

function findTask(ref: string): { row?: FleetRow; error?: string; candidates?: Array<{ id: string; title: string }> } {
  const value = String(ref ?? '').trim();
  if (!value) return { error: 'unknown_task' };
  const rows = currentFleet().rows;
  const direct = rows.filter(r => r.id === value || r.id.endsWith(value));
  if (direct.length === 1) return { row: direct[0] };
  if (direct.length > 1) return { error: 'ambiguous_task', candidates: direct.map(r => ({ id: r.id, title: r.title })) };
  const exact = rows.filter(r => normTitle(r.title) === normTitle(value));
  if (exact.length === 1) return { row: exact[0] };
  if (exact.length > 1) return { error: 'ambiguous_task', candidates: exact.map(r => ({ id: r.id, title: r.title })) };
  const partial = rows.filter(r => normTitle(r.title).includes(normTitle(value)));
  if (partial.length === 1) return { row: partial[0] };
  if (partial.length > 1) return { error: 'ambiguous_task', candidates: partial.map(r => ({ id: r.id, title: r.title })) };
  return { error: 'unknown_task' };
}

function composePrompt(p: {
  goal: string;
  doneCriteria: string[];
  constraints: string[];
  context?: string;
  project: string;
}): string {
  const lines = [
    `Objectif : ${p.goal}`,
    '',
    'Critères de réussite :',
    ...(p.doneCriteria.length ? p.doneCriteria.map(c => `- ${c}`) : ['- L’objectif est atteint et vérifié.']),
    '',
    'Contraintes :',
    ...(p.constraints.length ? p.constraints.map(c => `- ${c}`) : ['- Aucune contrainte supplémentaire.']),
  ];
  if (p.context) lines.push('', 'Contexte :', p.context);
  lines.push(
    '',
    'Plan : tiens ta todolist à jour en continu (pas de limite au nombre d\'éléments) : une liste séquentielle d\'étapes, découpées par petits incréments, posée et modifiée avec `todowrite`.',
    'Marque chaque étape `in_progress` quand tu la commences et `completed` quand elle est finie, en mettant à jour l\'élément par son numéro avec `todoupdate` plutôt qu\'en réécrivant toute la liste.',
    'Utilise `todoread` après une compaction.',
    'Réponse au propriétaire : dès qu\'une information attendue par le propriétaire est prête (réponse à la consigne, point à valider, résultat demandé), envoie-la avec le tool `answer` : elle s\'affiche dans le Superviseur, rendue en markdown (titres, listes, gras quand la réponse le justifie, sans forcer la longueur) ; si la réponse rattache à une question posée, passe cette question dans le champ `question`.',
    'Le propriétaire ne lit PAS la conversation de la tâche (ni le rendu `openchamber_render`, ni un tableau laissé dans la session) : la réponse doit tenir debout seule, et tout tableau ou classement utile est reproduit en markdown dans le texte de `answer`, jamais renvoyé au chat.',
    'Pose les questions avec le tool `question` : le formulaire s\'affiche dans le Superviseur ; une question posée en texte dans la conversation n\'arrive jamais au propriétaire.',
    'N\'en envoie pas sans attente du propriétaire : une validation de rendu ou un commentaire de confort n\'est pas une réponse, le rendu se vérifie avec le build, les tests ou la flotte.',
    'L\'usage (rappel) est aussi dans les messages du propriétaire ; ce tool n\'est pas pour le bilan final, qui continue de s\'écrire à la fin de la session.',
    'Bilan : à la fin, écris un court bilan (fait, reste, décisions) dans ton dernier message.',
  );
  return lines.join('\n');
}

function activeCount(): number {
  const rows = currentFleet().rows;
  return rows.filter(r => {
    const st = getTaskState(r.id) as { closed_at?: number } | null;
    if (st?.closed_at) return false;
    if (r.sup?.termine && r.status !== 'busy') return false;
    return true;
  }).length;
}

export async function listProjects(): Promise<ToolResult> {
  const list = await projects();
  return {
    ok: true,
    projects: list.map(p => ({
      id: p.id,
      name: p.name,
      directory: p.directory,
      lastUsedAt: p.lastUsedAt,
    })),
  };
}

export async function listTasks(args: { section?: string; include_closed?: boolean } = {}): Promise<ToolResult> {
  await pollOnce();
  const section = String(args.section ?? 'all');
  const includeClosed = args.include_closed === true;
  const rows = currentFleet().rows;
  const views = await Promise.all(rows.map(taskView));
  const filtered = views.filter(v => {
    if (!includeClosed && v.closed) return false;
    if (section === 'all') return true;
    return v.section === section;
  }).slice(0, 20);
  return { ok: true, tasks: filtered, count: filtered.length };
}

export async function getTask(args: { task?: string } = {}): Promise<ToolResult> {
  await pollOnce();
  const found = findTask(String(args.task ?? ''));
  if (!found.row) return { ok: false, error: found.error ?? 'unknown_task', candidates: found.candidates ?? [] };
  const row = found.row;
  const view = await taskView(row);
  const brief = getTaskBrief(row.id);
  // get_task est une lecture à la demande : ne pas servir un plan vieux de 5 s
  const snap = await getTodoSnapshot(row.id, row.lastUpdateAt, true);
  const delivery = await getDelivery(row.id).catch(() => null);
  return {
    ok: true,
    task: {
      ...view,
      goal: brief?.goal ?? null,
      doneCriteria: parseList(brief?.done_criteria),
      constraints: parseList(brief?.constraints),
      todos: todoPlan(snap),
      confidence: row.sup?.confiance ?? null,
      confidenceReason: row.sup?.note ?? '',
      delivery: delivery?.markdown ? delivery.markdown.slice(0, 2000) : '',
    },
  };
}

export async function startTask(args: {
  title?: string; goal?: string; project?: string;
  done_criteria?: unknown; constraints?: unknown; agent?: string; model?: string; context?: string;
} = {}): Promise<ToolResult> {
  await pollOnce();
  const title = String(args.title ?? '').trim().slice(0, 80);
  const goal = String(args.goal ?? '').trim().slice(0, 2000);
  if (!title || !goal) return { ok: false, error: 'invalid', message: 'titre et goal requis' };

  const projectRef = String(args.project ?? '').trim();
  const resolved = await resolveProject(projectRef);
  if (!resolved.project) {
    return {
      ok: false,
      error: resolved.error ?? 'unknown_project',
      message: resolved.error === 'ambiguous_project' ? 'plusieurs projets correspondent' : 'projet inconnu',
      candidates: (resolved.candidates ?? []).map(p => ({ name: p.name, directory: p.directory })),
    };
  }
  const project = resolved.project;

  const asList = (v: unknown): string[] => Array.isArray(v)
    ? v.map(x => String(x).trim()).filter(Boolean).slice(0, 6)
    : [];
  const doneCriteria = asList(args.done_criteria);
  const constraints = asList(args.constraints);

  const key = `${project.directory}|${normTitle(title)}`;
  if (creating.has(key)) {
    return { ok: false, error: 'duplicate', message: 'création déjà en cours pour ce titre', title };
  }
  creating.add(key);
  try {
    // le brief est écrit immédiatement : même si la flotte n'a pas encore
    // intégré la nouvelle session, un second appel ne peut pas créer un doublon
    const briefDup = listTaskBriefs(project.directory)
      .find(b => !b.closed_at && normTitle(b.title ?? '') === normTitle(title));
    if (briefDup) {
      return {
        ok: false,
        error: 'duplicate',
        message: 'une tâche active porte déjà ce titre dans ce projet',
        taskId: briefDup.session_id,
        title: briefDup.title ?? title,
      };
    }

    const duplicate = currentFleet().rows.find(r => {
      const st = getTaskState(r.id) as { closed_at?: number } | null;
      if (st?.closed_at) return false;
      if (r.sup?.termine && r.status !== 'busy') return false;
      return normTitle(r.title) === normTitle(title) && r.dir === project.directory;
    });
    if (duplicate) {
      return {
        ok: false,
        error: 'duplicate',
        message: 'une tâche active porte déjà ce titre dans ce projet',
        taskId: duplicate.id,
        title: duplicate.title,
      };
    }

    if (activeCount() >= MAX_TASKS) {
      return { ok: false, error: 'limit', message: `plafond de ${MAX_TASKS} tâches actives atteint` };
    }

    const prompt = composePrompt({ goal, doneCriteria, constraints, context: args.context, project: project.name });
    const agent = String(args.agent ?? '').trim() || 'build';
    const body: Record<string, unknown> = {
      title,
      prompt,
      directory: project.directory,
      agent,
    };
    if (args.model) body.model = String(args.model);
    const out = await jpost('/api/openchamber/sessions', body);
    const taskId = (out.data as { sessionId?: string })?.sessionId;
    if (!out.ok || !taskId) {
      return {
        ok: false,
        error: 'create_failed',
        message: `création refusée (${out.status})`,
        detail: out.data,
      };
    }

    putTaskBrief(taskId, {
      title,
      goal,
      doneCriteria,
      constraints,
      projectDir: project.directory,
      agent,
      model: args.model ?? null,
    });
    upsertTaskState(taskId, { title, goal });
    // la tâche est armée pour l'auto-restart dès sa création : si sa session
    // OpenCode est détruite, une nouvelle repart automatiquement (task_resume)
    armTaskResume(taskId, {
      sessionId: taskId,
      title,
      projectDir: project.directory,
      agent,
      model: args.model ?? null,
    });
    logEvent(taskId, 'open', `lancé depuis le chat : ${title}`.slice(0, 180));
    logEvent('supervisor', 'note', `start_task ${title} → ${taskId}`);

    return {
      ok: true,
      taskId,
      title,
      project: project.name,
      directory: project.directory,
      status: 'created',
    };
  } finally {
    creating.delete(key);
  }
}

export async function sendTask(args: { task?: string; text?: string } = {}): Promise<ToolResult> {
  await pollOnce();
  const found = findTask(String(args.task ?? ''));
  if (!found.row) return { ok: false, error: found.error ?? 'unknown_task', candidates: found.candidates ?? [] };
  const row = found.row;
  const text = String(args.text ?? '').trim();
  if (!text) return { ok: false, error: 'invalid', message: 'texte requis' };
  const pending = await pendingFor(row.id);
  if (pending.permissions) {
    return {
      ok: false,
      error: 'waiting_human',
      message: 'la tâche attend une permission ; réponds sur la carte',
      taskId: row.id,
      title: row.title,
      question: { kind: 'permission', text: 'Une permission attend ta réponse.' },
      canCancel: false,
    };
  }
  let cancelledQuestion: string | null = null;
  if (pending.forms.length) {
    const cancelled = await cancelPendingForms(row.id, pending.forms.map(f => f.id), CANCEL_MESSAGE);
    if (!cancelled.ok) {
      return { ok: false, error: 'cancel_failed', message: cancelled.error ?? 'annulation impossible', taskId: row.id };
    }
    cancelledQuestion = pending.forms[0].text;
    logEvent(row.id, 'note', `question annulée par message : ${cancelledQuestion}`);
  }
  // encadrement owner : le plan doit être remis à jour quand une nouvelle
  // instruction du propriétaire arrive (session idle et tour busy) ; le journal
  // et la réponse gardent le texte brut
  const prompt = wrapOwnerPrompt(text);
  const out = await jpost(`/api/session/${row.id}/prompt`, { text: prompt, delivery: 'steer' });
  if (!out.ok) return { ok: false, error: 'send_failed', message: `envoi refusé (${out.status})`, taskId: row.id };
  // le propriétaire écrit à la tâche : sa reprise repart si elle était désactivée
  reviveTaskResume(row.id);
  logEvent(row.id, 'note', `→ chat : ${text.slice(0, 120)}`);
  logEvent('supervisor', 'note', `send_task ${row.title}`);
  return { ok: true, taskId: row.id, title: row.title, text, cancelledQuestion };
}

export async function cancelQuestion(args: { task?: string; message?: string } = {}): Promise<ToolResult> {
  await pollOnce();
  const found = findTask(String(args.task ?? ''));
  if (!found.row) return { ok: false, error: found.error ?? 'unknown_task', candidates: found.candidates ?? [] };
  const row = found.row;
  const pending = await pendingFor(row.id);
  if (!pending.forms.length) {
    return {
      ok: false,
      error: pending.permissions ? 'permission' : 'no_question',
      message: pending.permissions ? 'une permission attend, elle ne s’annule pas comme une question' : 'aucune question en attente',
      taskId: row.id,
      title: row.title,
    };
  }
  const question = pending.forms[0].text;
  const res = await cancelPendingForms(
    row.id,
    pending.forms.map(f => f.id),
    String(args.message ?? '').trim() || "L'utilisateur a annulé la question depuis le chat de supervision.",
  );
  if (!res.ok) return { ok: false, error: 'cancel_failed', message: res.error ?? 'annulation impossible', taskId: row.id };
  logEvent(row.id, 'note', `question annulée depuis le chat : ${question}`);
  logEvent('supervisor', 'note', `cancel_question ${row.title}`);
  return { ok: true, taskId: row.id, title: row.title, cancelledQuestion: question, cancelled: res.cancelled };
}

export async function closeTask(args: { task?: string; note?: string; force?: boolean } = {}): Promise<ToolResult> {
  await pollOnce();
  const found = findTask(String(args.task ?? ''));
  if (!found.row) return { ok: false, error: found.error ?? 'unknown_task', candidates: found.candidates ?? [] };
  const row = found.row;
  const pending = await pendingFor(row.id);
  const hasPending = pending.forms.length > 0 || pending.permissions > 0;
  if (hasPending && !args.force) {
    return {
      ok: false,
      error: 'waiting_human',
      message: 'la tâche attend une réponse ; réponds sur la carte, ou demande une fermeture forcée',
      taskId: row.id,
      title: row.title,
      question: {
        kind: pending.forms.length ? 'question' : 'permission',
        text: pending.forms[0]?.text ?? 'Une permission attend ta réponse.',
      },
      canForce: true,
    };
  }
  const abandoned = pending.forms[0]?.text ?? (pending.permissions ? 'Une permission attendait.' : '');
  if (pending.forms.length) {
    await cancelPendingForms(
      row.id,
      pending.forms.map(f => f.id),
      "La tâche est fermée depuis le chat de supervision : la question est abandonnée.",
    ).catch(() => undefined);
  }
  upsertTaskState(row.id, { closedAt: Date.now(), closure: 'terminé' });
  logEvent(row.id, 'done', args.note
    ? `fermé depuis le chat : ${String(args.note).slice(0, 80)}`
    : abandoned
      ? `fermé en abandonnant la question : ${abandoned}`
      : 'fermé depuis le chat');
  logEvent('supervisor', 'note', `close_task ${row.title}`);
  return { ok: true, taskId: row.id, title: row.title, abandonedQuestion: abandoned || undefined };
}

async function runInvestigationTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const directory = await investigationDirectory();
  if (!directory) return { ok: false, error: 'project_required', message: 'le projet d’investigation n’est plus disponible' };
  if (name === 'read_project') {
    return await readProjectFile(directory, String(args.path ?? ''), Number(args.start_line), Number(args.line_count));
  }
  if (name === 'glob_project') {
    return await globProjectFiles(directory, String(args.pattern ?? '**/*'));
  }
  if (name === 'grep_project') {
    return await grepProjectFiles(
      directory,
      String(args.query ?? ''),
      String(args.pattern ?? '**/*'),
      args.case_sensitive === true,
    );
  }
  return { ok: false, error: 'unknown_tool', message: name };
}

/** Dispatch unique pour la route /api/tools/:name. */
export async function runTool(name: string, callerSessionId: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (!isSupervisorSession(callerSessionId)) {
    return { ok: false, error: 'not_supervisor', message: 'outil réservé à la session de supervision' };
  }
  const mode = getSupervisorMode().mode;
  const denied = modeDenial(name, mode);
  if (denied) return denied;
  if (mode === 'investigation') return runInvestigationTool(name, args);
  switch (name) {
    case 'list_projects': return listProjects();
    case 'list_tasks': return listTasks(args as { section?: string; include_closed?: boolean });
    case 'get_task': return getTask(args as { task?: string });
    case 'start_task': return startTask(args as Parameters<typeof startTask>[0]);
    case 'send_task': return sendTask(args as { task?: string; text?: string });
    case 'cancel_question': return cancelQuestion(args as { task?: string; message?: string });
    case 'close_task': return closeTask(args as { task?: string; note?: string; force?: boolean });
    default: return { ok: false, error: 'unknown_tool', message: name };
  }
}
