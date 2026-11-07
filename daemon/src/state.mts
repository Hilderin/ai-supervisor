/**
 * État du Superviseur dans SQLite (bun:sqlite, natif Bun — même moteur que la stack OpenChamber).
 * On ne stocke QUE ce qui nous appartient : journal, clôtures, seuils.
 * Tout ce que les endpoints OpenChamber servent déjà n'est pas dupliqué.
 */
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.SUPERVISEUR_DATA_DIR ?? join(here, '..', '..', 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new Database(join(dataDir, 'superviseur.db'));
db.run('PRAGMA journal_mode = WAL;');
// un script annexe (test, brut, script ponctuel) qui écrit au même instant ne
// doit plus tuer le daemon : mmap/attente de verrou 5 s avant SQLITE_BUSY
db.run('PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS task_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  at INTEGER NOT NULL,               -- epoch ms
  kind TEXT NOT NULL,                -- 'open' | 'note' | 'question' | 'reply' | 'done' | 'repart'
  text TEXT,                         -- court (<= 200 chars)
  meta TEXT                          -- JSON libre
);
CREATE TABLE IF NOT EXISTS task_state (
  session_id TEXT PRIMARY KEY,
  goal TEXT,                         -- bullets 1-3 lignes
  title TEXT,
  created_at INTEGER NOT NULL,
  closed_at INTEGER,
  closure TEXT                       -- 'terminé' | 'repart' | null
);
CREATE TABLE IF NOT EXISTS task_verdict (
  session_id TEXT PRIMARY KEY,
  resume TEXT,
  confiance REAL,
  progress INTEGER,
  termine INTEGER,
  attend TEXT,
  note TEXT,
  at INTEGER
);
CREATE TABLE IF NOT EXISTS companion_map (
  parent_session_id TEXT PRIMARY KEY,
  companion_session_id TEXT NOT NULL,
  version INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS supervisor_session (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  oc_session_id TEXT NOT NULL,
  agent TEXT,
  version INTEGER,
  title TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS task_brief (
  session_id TEXT PRIMARY KEY,
  title TEXT,
  goal TEXT,
  done_criteria TEXT,
  constraints TEXT,
  project_dir TEXT,
  agent TEXT,
  model TEXT,
  created_at INTEGER NOT NULL
);
-- Registre de reprise : une tâche garde une identité stable (task_id) même
-- quand sa session OpenCode disparaît et qu'une nouvelle la remplace.
CREATE TABLE IF NOT EXISTS task_resume (
  task_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  title TEXT,
  project_dir TEXT,
  agent TEXT,
  model TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  session_since INTEGER,
  last_seen_at INTEGER,
  disabled_at INTEGER,
  disabled_reason TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_resume_session ON task_resume(session_id);
`);
try { db.exec('ALTER TABLE task_verdict ADD COLUMN note TEXT'); } catch { /* colonne déjà présente */ }
try { db.exec('ALTER TABLE companion_map ADD COLUMN version INTEGER'); } catch { /* colonne déjà présente */ }
// nom exact de l'agent versionné utilisé par le compagnon (le prompt est mis en cache par nom)
try { db.exec('ALTER TABLE companion_map ADD COLUMN agent TEXT'); } catch { /* colonne déjà présente */ }
// objectif courant + plan : une nouvelle consigne change l'objectif, pas seulement le tour
try { db.exec('ALTER TABLE task_state ADD COLUMN objective TEXT'); } catch { /* colonne déjà présente */ }
try { db.exec('ALTER TABLE task_state ADD COLUMN objective_version INTEGER'); } catch { /* colonne déjà présente */ }
try { db.exec('ALTER TABLE task_state ADD COLUMN last_user_id TEXT'); } catch { /* colonne déjà présente */ }
try { db.exec('ALTER TABLE task_state ADD COLUMN plan TEXT'); } catch { /* colonne déjà présente */ }
// état sémantique du verdict (working/waiting_human/done/blocked) et provenance de l'attente
try { db.exec('ALTER TABLE task_verdict ADD COLUMN state TEXT'); } catch { /* colonne déjà présente */ }
try { db.exec('ALTER TABLE task_verdict ADD COLUMN human_source TEXT'); } catch { /* colonne déjà présente */ }
try { db.exec('ALTER TABLE task_verdict ADD COLUMN next TEXT'); } catch { /* colonne déjà présente */ }
try { db.exec('ALTER TABLE task_verdict ADD COLUMN objective_version INTEGER'); } catch { /* colonne déjà présente */ }
// règle dure : un verdict terminé vaut 100, même si une ancienne ligne avait null
db.run('UPDATE task_verdict SET progress = 100 WHERE termine = 1 AND progress IS NULL');

/** version du prompt de l'agent analyste : hash du contenu, pas mtime (un touch ne recrée plus tous les comps) */
import { existsSync, readFileSync, symlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const agentMD = join(dirname(fileURLToPath(import.meta.url)), '..', 'agent', 'superviseur-analyste.md');
const orchestratorMD = join(dirname(fileURLToPath(import.meta.url)), '..', 'agent', 'superviseur-orchestrateur.md');

/**
 * Hash du contenu, relu à chaque appel (8 Ko, négligeable) : un cache par mtime
 * pouvait mémoriser un fichier lu pendant une écriture et rester figé ensuite.
 */
function versionOf(path: string): number {
  try {
    const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
    return parseInt(digest.slice(0, 8), 16);
  } catch { return 0; }
}

export function getAgentVersion(): number { return versionOf(agentMD); }

function ensureDefinition(md: string, name: string): string {
  try {
    const dir = join(homedir(), '.config', 'opencode', 'agent');
    mkdirSync(dir, { recursive: true });
    const link = join(dir, `${name}.md`);
    if (!existsSync(link)) symlinkSync(md, link);
  } catch { /* le nom reste utilisable si le lien existe déjà ou si le dossier est protégé */ }
  return name;
}

/**
 * OpenChamber garde en cache le prompt d'un agent par NOM. Un simple changement
 * de contenu ne suffit donc pas : on donne à chaque version un nom neuf
 * (`superviseur-analyste-<hash>`), avec un lien vers le fichier canonique.
 * Une session créée avec ce nom charge forcément le prompt de cette version.
 */
export function agentNameFor(version: number): string {
  return `superviseur-analyste-${version.toString(16)}`;
}

export function ensureAgentDefinition(version: number): string {
  return ensureDefinition(agentMD, agentNameFor(version));
}

export function getOrchestratorVersion(): number { return versionOf(orchestratorMD); }

export function orchestratorNameFor(version: number): string {
  return `superviseur-orchestrateur-${version.toString(16)}`;
}

export function ensureOrchestratorDefinition(version: number): string {
  return ensureDefinition(orchestratorMD, orchestratorNameFor(version));
}

export function getVerdict(sessionId: string) {
  return db.query('SELECT * FROM task_verdict WHERE session_id = ?').get(sessionId) ?? null;
}
export function upsertVerdict(sessionId: string, v: {
  resume?: string; termine?: boolean; confiance?: number | null; progress?: number | null;
  attend?: string; note?: string; state?: string; humanSource?: string; next?: string; objectiveVersion?: number;
}) {
  db.query(`INSERT INTO task_verdict (session_id, resume, confiance, progress, termine, attend, note, at, state, human_source, next, objective_version)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(session_id) DO UPDATE SET resume=excluded.resume, confiance=excluded.confiance,
              progress=excluded.progress, termine=excluded.termine, attend=excluded.attend, note=excluded.note, at=excluded.at,
              state=excluded.state, human_source=excluded.human_source, next=excluded.next, objective_version=excluded.objective_version`)
    .run(sessionId, v.resume ?? null, v.confiance ?? null, v.progress ?? null, v.termine ? 1 : 0,
      v.attend ?? null, v.note ?? null, Date.now(), v.state ?? null, v.humanSource ?? null, v.next ?? null, v.objectiveVersion ?? null);
}

/**
 * Objectif courant et version. Le plan est stocké à part pour rester stable
 * entre deux analyses (la progression est recalculée à partir de lui).
 */
export function setTaskObjective(sessionId: string, p: {
  objective: string; version: number; goal?: string; lastUserId?: string;
}) {
  const cur = db.query('SELECT session_id FROM task_state WHERE session_id = ?').get(sessionId) as { session_id?: string } | undefined;
  if (!cur) {
    db.query(`INSERT INTO task_state (session_id, goal, title, created_at, objective, objective_version, last_user_id, plan)
              VALUES (?,?,?,?,?,?,?,?)`)
      .run(sessionId, p.goal ?? null, null, Date.now(), p.objective, p.version, p.lastUserId ?? null, '[]');
    return;
  }
  db.query(`UPDATE task_state SET
      goal = COALESCE(?, goal), objective = ?, objective_version = ?,
      last_user_id = COALESCE(?, last_user_id)
      WHERE session_id = ?`)
    .run(p.goal ?? null, p.objective, p.version, p.lastUserId ?? null, sessionId);
}

export function setTaskPlan(sessionId: string, plan: unknown) {
  const json = JSON.stringify(plan ?? []);
  const cur = db.query('SELECT session_id FROM task_state WHERE session_id = ?').get(sessionId) as { session_id?: string } | undefined;
  if (!cur) {
    db.query('INSERT INTO task_state (session_id, created_at, plan) VALUES (?,?,?)')
      .run(sessionId, Date.now(), json);
    return;
  }
  db.query('UPDATE task_state SET plan = ? WHERE session_id = ?').run(json, sessionId);
}

export function getCompanion(parentSid: string): { compId: string; version: number | null; agent: string | null } | null {
  const r = db.query('SELECT companion_session_id c, version v, agent a FROM companion_map WHERE parent_session_id = ?').get(parentSid) as { c: string; v: number | null; a: string | null } | undefined;
  return r ? { compId: r.c, version: r.v, agent: r.a } : null;
}
export function putCompanion(parentSid: string, compId: string, agent?: string) {
  const version = getAgentVersion();
  db.query(`INSERT INTO companion_map (parent_session_id, companion_session_id, version, agent, created_at)
            VALUES (?,?,?,?,?)
            ON CONFLICT(parent_session_id) DO UPDATE SET companion_session_id=excluded.companion_session_id,
              version=excluded.version, agent=excluded.agent`)
    .run(parentSid, compId, version, agent ?? null, Date.now());
}
export function reopenTaskState(sid: string) {
  db.query('UPDATE task_state SET closed_at = NULL, closure = NULL WHERE session_id = ?').run(sid);
  db.query('DELETE FROM task_verdict WHERE session_id = ?').run(sid);
  // carte rouverte : la reprise redevient possible (budget remis à zéro)
  db.query(`UPDATE task_resume SET disabled_at = NULL, disabled_reason = NULL,
      attempts = 0, session_since = NULL, last_seen_at = NULL, updated_at = ?
      WHERE session_id = ?`).run(Date.now(), sid);
}

export function getCompanionOut(parentSid: string): string | null { return getCompanion(parentSid); }

export function logEvent(sessionId: string, kind: string, text: string, meta?: object) {
  db.query('INSERT INTO task_log (session_id, at, kind, text, meta) VALUES (?,?,?,?,?)')
    .run(sessionId, Date.now(), kind, String(text).slice(0, 200), meta ? JSON.stringify(meta) : null);
}

export function upsertTaskState(sessionId: string, patch: {
  goal?: string; title?: string; closedAt?: number | null; closure?: string | null;
}) {
  const cur = db.query('SELECT * FROM task_state WHERE session_id = ?').get(sessionId) as { created_at?: number } | undefined;
  if (!cur) {
    db.query('INSERT INTO task_state (session_id, title, goal, created_at, closed_at, closure) VALUES (?,?,?,?,?,?)')
      .run(sessionId, patch.title ?? null, patch.goal ?? null, Date.now(), patch.closedAt ?? null, patch.closure ?? null);
    return;
  }
  db.query(`UPDATE task_state SET
      title = COALESCE(?, title), goal = COALESCE(?, goal),
      closed_at = COALESCE(?, closed_at), closure = COALESCE(?, closure)
      WHERE session_id = ?`)
    .run(patch.title ?? null, patch.goal ?? null, patch.closedAt ?? null, patch.closure ?? null, sessionId);
}

export function getTaskState(sessionId: string) {
  return db.query('SELECT * FROM task_state WHERE session_id = ?').get(sessionId) ?? null;
}

export interface SupervisorSessionRow {
  oc_session_id: string;
  agent: string | null;
  version: number | null;
  title: string | null;
  created_at: number;
}

export function getSupervisorSession(): SupervisorSessionRow | null {
  return (db.query('SELECT * FROM supervisor_session WHERE id = 1').get() as SupervisorSessionRow | undefined) ?? null;
}

export function setSupervisorSession(p: {
  ocSessionId: string; agent: string; version: number; title: string;
}) {
  db.query(`INSERT INTO supervisor_session (id, oc_session_id, agent, version, title, created_at)
            VALUES (1, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET oc_session_id = excluded.oc_session_id,
              agent = excluded.agent, version = excluded.version, title = excluded.title`)
    .run(p.ocSessionId, p.agent, p.version, p.title, Date.now());
}

export interface TaskBriefRow {
  session_id: string;
  title: string | null;
  goal: string | null;
  done_criteria: string | null;
  constraints: string | null;
  project_dir: string | null;
  agent: string | null;
  model: string | null;
  created_at: number;
}

export function getTaskBrief(sessionId: string): TaskBriefRow | null {
  return (db.query('SELECT * FROM task_brief WHERE session_id = ?').get(sessionId) as TaskBriefRow | undefined) ?? null;
}

/** Tous les briefs d'un projet, avec l'état de fermeture : détection de doublon
 *  immédiate, sans attendre que la flotte ait vu la nouvelle session. */
export function listTaskBriefs(projectDir?: string): Array<TaskBriefRow & { closed_at?: number | null }> {
  const sql = `SELECT b.*, s.closed_at FROM task_brief b
               LEFT JOIN task_state s ON s.session_id = b.session_id
               ${projectDir ? 'WHERE b.project_dir = ?' : ''}`;
  return (projectDir
    ? db.query(sql).all(projectDir)
    : db.query(sql).all()) as Array<TaskBriefRow & { closed_at?: number | null }>;
}

export function putTaskBrief(sessionId: string, p: {
  title: string; goal: string; doneCriteria: string[]; constraints: string[];
  projectDir: string; agent?: string | null; model?: string | null;
}) {
  db.query(`INSERT INTO task_brief (session_id, title, goal, done_criteria, constraints, project_dir, agent, model, created_at)
            VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(session_id) DO UPDATE SET title = excluded.title, goal = excluded.goal,
              done_criteria = excluded.done_criteria, constraints = excluded.constraints,
              project_dir = excluded.project_dir, agent = excluded.agent, model = excluded.model`)
    .run(sessionId, p.title, p.goal, JSON.stringify(p.doneCriteria), JSON.stringify(p.constraints),
      p.projectDir, p.agent ?? null, p.model ?? null, Date.now());
}

/* --- Registre de reprise (auto-restart) ---
 * Une ligne par tâche, identifiée par `task_id` : l'id de la session d'origine,
 * conservé à travers les recréations. `session_id` porte la session vivante
 * actuelle ; les garde-fous (tentatives, backoff, désactivation) vivent ici.
 */

export interface TaskResumeRow {
  task_id: string;
  session_id: string;
  title: string | null;
  project_dir: string | null;
  agent: string | null;
  model: string | null;
  attempts: number;
  last_attempt_at: number | null;
  session_since: number | null;
  last_seen_at: number | null;
  disabled_at: number | null;
  disabled_reason: string | null;
  updated_at: number;
}

export function getTaskResume(taskId: string): TaskResumeRow | null {
  return (db.query('SELECT * FROM task_resume WHERE task_id = ?').get(taskId) as TaskResumeRow | undefined) ?? null;
}

export function getTaskResumeBySession(sessionId: string): TaskResumeRow | null {
  return (db.query('SELECT * FROM task_resume WHERE session_id = ?').get(sessionId) as TaskResumeRow | undefined) ?? null;
}

export function listTaskResume(): TaskResumeRow[] {
  return db.query('SELECT * FROM task_resume ORDER BY updated_at').all() as TaskResumeRow[];
}

/** Arme (ou re-arme) la reprise d'une tâche. Un task_id déjà armé garde son historique de garde-fous. */
export function armTaskResume(taskId: string, p: {
  sessionId: string; title: string; projectDir: string; agent?: string | null; model?: string | null; at?: number;
}) {
  const at = p.at ?? Date.now();
  db.query(`INSERT INTO task_resume (task_id, session_id, title, project_dir, agent, model, updated_at)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(task_id) DO UPDATE SET title = excluded.title, project_dir = excluded.project_dir,
              agent = excluded.agent, updated_at = excluded.updated_at`)
    .run(taskId, p.sessionId, p.title, p.projectDir, p.agent ?? null, p.model ?? null, at);
}

/** La session de la tâche a été vue vivante. */
export function noteResumeAlive(taskId: string, at = Date.now()) {
  db.query(`UPDATE task_resume SET
      last_seen_at = ?, session_since = COALESCE(session_since, ?),
      disabled_at = NULL, disabled_reason = NULL, updated_at = ?
      WHERE task_id = ? AND (disabled_at IS NOT NULL OR last_seen_at IS NULL OR last_seen_at != ?)`)
    .run(at, at, at, taskId, at);
}

/** Un essai de reprise : la tâche passe sur une nouvelle session (ou un essai vient d'échouer). */
export function noteResumeAttempt(taskId: string, p: {
  newSessionId?: string; at?: number;
}) {
  const at = p.at ?? Date.now();
  db.query(`UPDATE task_resume SET
      attempts = attempts + 1, last_attempt_at = ?,
      session_id = COALESCE(?, session_id), session_since = NULL,
      last_seen_at = NULL, disabled_at = NULL, disabled_reason = NULL, updated_at = ?
      WHERE task_id = ?`)
    .run(at, p.newSessionId ?? null, at, taskId);
}

export function resetResumeAttempts(taskId: string, at = Date.now()) {
  db.query('UPDATE task_resume SET attempts = 0, updated_at = ? WHERE task_id = ?')
    .run(at, taskId);
}

export function disableTaskResume(taskId: string, reason: string, at = Date.now()) {
  db.query('UPDATE task_resume SET disabled_at = ?, disabled_reason = ?, updated_at = ? WHERE task_id = ?')
    .run(at, reason.slice(0, 200), at, taskId);
}

export function enableTaskResume(taskId: string, at = Date.now()) {
  db.query(`UPDATE task_resume SET disabled_at = NULL, disabled_reason = NULL,
      attempts = 0, session_since = NULL, updated_at = ? WHERE task_id = ?`)
    .run(at, taskId);
}

/** Une activité humaine sur la carte (prompt envoyé) rouvre la reprise si elle était désactivée. */
export function reviveTaskResume(sessionId: string) {
  db.query(`UPDATE task_resume SET disabled_at = NULL, disabled_reason = NULL,
      attempts = 0, session_since = NULL, last_seen_at = NULL, updated_at = ?
      WHERE session_id = ? AND disabled_at IS NOT NULL`)
    .run(Date.now(), sessionId);
}

/**
 * La tâche passe à une nouvelle session : ses données locales suivent.
 * Le verdict est supprimé ici : un verdict ancien sur une session neuve
 * masquerait le travail en cours (carte « terminé » figée).
 */
export function migrateTaskSession(oldId: string, newId: string) {
  if (!oldId || !newId || oldId === newId) return;
  db.transaction(() => {
    db.query('UPDATE task_state SET session_id = ? WHERE session_id = ?').run(newId, oldId);
    db.query('UPDATE task_brief SET session_id = ? WHERE session_id = ?').run(newId, oldId);
    db.query('UPDATE task_log SET session_id = ? WHERE session_id = ?').run(newId, oldId);
    db.query('DELETE FROM task_verdict WHERE session_id = ?').run(oldId);
    // Le compagnon enfant est détruit avec son parent : la mapping ne doit pas
    // ressusciter une session morte, le nouveau parent refabrique le sien.
    db.query('DELETE FROM companion_map WHERE parent_session_id = ?').run(oldId);
    // le registre suit la tâche : la session de reprise devient la nouvelle
    db.query('UPDATE task_resume SET session_id = ?, session_since = NULL, last_seen_at = NULL WHERE session_id = ?')
      .run(newId, oldId);
  })();
}
