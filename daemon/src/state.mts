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
CREATE TABLE IF NOT EXISTS supervisor_session (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  oc_session_id TEXT NOT NULL,
  agent TEXT,
  version INTEGER,
  title TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS supervisor_mode (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mode TEXT NOT NULL DEFAULT 'pilot',
  project_dir TEXT
);
-- Préférences de modèles et d'agent du chat (bouton config de la conversation).
-- Aucune clé ni secret : des références « provider/model » et un id d'agent.
-- NULL = pas de choix explicite, le défaut d'OpenChamber s'applique.
-- (colonne companion_model héritée des sous-agents retirés : plus écrite)
CREATE TABLE IF NOT EXISTS supervisor_pref (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  chat_model TEXT,
  chat_agent TEXT,
  task_model TEXT,
  updated_at INTEGER NOT NULL
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
-- Réponses des tâches au propriétaire (tool « answer » du plugin superviseur-task) :
-- une ligne par appel, relue dans le panel de détails ; read_at vaut NULL tant
-- que le propriétaire n'a pas lu la réponse (compteur de la carte).
CREATE TABLE IF NOT EXISTS task_answer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,          -- task_id, suit la tâche une fois migrée
  at INTEGER NOT NULL,               -- epoch ms
  text TEXT NOT NULL,                -- réponse de l'agent (tronquée)
  question TEXT,                     -- rattachement optionnel à une question posée
  read_at INTEGER                    -- epoch ms de lecture (« Got it »), NULL = non lue
);
CREATE INDEX IF NOT EXISTS idx_task_answer_session ON task_answer(session_id, at);
-- Critères d'acceptation d'une tâche (spec : docs/analyses/mvp1/criteres-acceptation.md).
-- Le statut n'est jamais écrit directement : uniquement via les transitions de
-- daemon/src/criteria.mts (tools criteria de l'agent, dont criteria_set_status
-- pour le jugement).
CREATE TABLE IF NOT EXISTS criteria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,             -- suit la tâche migrée (migrateTaskSession)
  ref TEXT NOT NULL,                 -- 'AC-01', stable, jamais réattribué
  title TEXT NOT NULL,
  detail TEXT,
  methods TEXT NOT NULL,             -- JSON array
  status TEXT NOT NULL DEFAULT 'todo',
  evidence TEXT,                     -- JSON array {kind, text, path, start_line, line_count, at}
  review TEXT,                       -- dernier commentaire (jugement de l'agent)
  review_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- version du contenu : incrémentée à chaque preuve soumise, jugement ou
  -- modification ; l'historique des jugements reste daté
  version INTEGER NOT NULL DEFAULT 0,
  validated_at INTEGER,              -- horodatage de la validation (staleness)
  validated_work TEXT,               -- version du travail validé : JSON {commit?, at}
  removed_at INTEGER,                -- suppression douce : l'historique reste
  UNIQUE(task_id, ref)
);
CREATE INDEX IF NOT EXISTS idx_criteria_task ON criteria(task_id);
-- Registre du tableau (fleet_seen) : /api/sessions/status d'OpenChamber est une
-- carte EN MÉMOIRE (perdue au redémarrage d'OpenChamber ou d'OpenCode, entrées
-- expirées après 24 h). Ce registre persistant note chaque conversation montrée
-- dans le tableau pour la remettre au démarrage tant qu'elle existe encore et
-- n'est pas marquée terminée (work=done), archivée ou supprimée.
CREATE TABLE IF NOT EXISTS fleet_seen (
  session_id TEXT PRIMARY KEY,
  title TEXT,                        -- dernier titre vu (repli si l'annuaire ne répond pas)
  dir TEXT,                          -- dossier du projet
  first_seen_at INTEGER NOT NULL,    -- première carte du tableau
  last_seen_at INTEGER NOT NULL,     -- dernier passage dans le statut vivant
  last_update_at INTEGER,            -- dernière activité connue (statut)
  updated_at INTEGER NOT NULL
);
-- Dernier plan connu par session (repli du lecteur de plan, plan.mts) : le
-- cache mémoire du plan est invalidé à chaque événement message.* et la
-- fenêtre de lecture est bornée, le dernier planwrite peut donc sortir de la
-- fenêtre au milieu d'un tour. Ce repli doit survivre au redémarrage du daemon.
CREATE TABLE IF NOT EXISTS plan_known (
  session_id TEXT PRIMARY KEY,
  items TEXT NOT NULL,               -- JSON PlanItem[] (plan.mts)
  at INTEGER NOT NULL                -- epoch ms du dernier plan connu
);
`);
// objectif courant : une nouvelle consigne change l'objectif, pas seulement le tour
try { db.exec('ALTER TABLE task_state ADD COLUMN objective TEXT'); } catch { /* colonne déjà présente */ }
try { db.exec('ALTER TABLE task_state ADD COLUMN objective_version INTEGER'); } catch { /* colonne déjà présente */ }
try { db.exec('ALTER TABLE task_state ADD COLUMN last_user_id TEXT'); } catch { /* colonne déjà présente */ }
// compteur des refs de critères (AC-01, AC-02, ...) : un retrait ne libère pas son numéro
try { db.exec('ALTER TABLE task_state ADD COLUMN criteria_seq INTEGER'); } catch { /* colonne déjà présente */ }
// colonnes critères (version de contenu, staleness, suppression douce)
try { db.exec('ALTER TABLE criteria ADD COLUMN version INTEGER NOT NULL DEFAULT 0'); } catch { /* colonne déjà présente */ }
try { db.exec('ALTER TABLE criteria ADD COLUMN validated_at INTEGER'); } catch { /* colonne déjà présente */ }
try { db.exec('ALTER TABLE criteria ADD COLUMN validated_work TEXT'); } catch { /* colonne déjà présente */ }
try { db.exec('ALTER TABLE criteria ADD COLUMN removed_at INTEGER'); } catch { /* colonne déjà présente */ }

/**
 * Agents de supervision à nom FIXE : l'orchestrateur du chat est le seul agent
 * défini par le daemon (décision du 2026-11-12 : les sous-agents compagnon et
 * vérificateur sont retirés). Le prompt reste mis en cache par NOM dans
 * OpenCode : un changement de prompt n'est pris en compte que pour les
 * sessions créées après un redémarrage d'OpenCode.
 */
import { existsSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const orchestratorMD = join(dirname(fileURLToPath(import.meta.url)), '..', 'agent', 'superviseur-orchestrateur.md');

export const ORCHESTRATOR_AGENT = 'superviseur-orchestrateur';

function ensureDefinition(md: string, name: string): string {
  try {
    const dir = join(homedir(), '.config', 'opencode', 'agent');
    mkdirSync(dir, { recursive: true });
    const link = join(dir, `${name}.md`);
    if (!existsSync(link)) symlinkSync(md, link);
  } catch { /* le nom reste utilisable si le lien existe déjà ou si le dossier est protégé */ }
  return name;
}

export function ensureOrchestratorDefinition(): string {
  return ensureDefinition(orchestratorMD, ORCHESTRATOR_AGENT);
}

/**
 * Objectif courant (texte libre, versionné par le chat à la création de tâche).
 * Le plan de travail ne vit PAS ici : il est relu du tool part `planwrite` de
 * la session (daemon/src/plan.mts).
 */
export function setTaskObjective(sessionId: string, p: {
  objective: string; version: number; goal?: string; lastUserId?: string;
}) {
  const cur = db.query('SELECT session_id FROM task_state WHERE session_id = ?').get(sessionId) as { session_id?: string } | undefined;
  if (!cur) {
    db.query(`INSERT INTO task_state (session_id, goal, title, created_at, objective, objective_version, last_user_id)
              VALUES (?,?,?,?,?,?,?)`)
      .run(sessionId, p.goal ?? null, null, Date.now(), p.objective, p.version, p.lastUserId ?? null);
    return;
  }
  db.query(`UPDATE task_state SET
      goal = COALESCE(?, goal), objective = ?, objective_version = ?,
      last_user_id = COALESCE(?, last_user_id)
      WHERE session_id = ?`)
    .run(p.goal ?? null, p.objective, p.version, p.lastUserId ?? null, sessionId);
}

export function reopenTaskState(sid: string) {
  db.query('UPDATE task_state SET closed_at = NULL, closure = NULL WHERE session_id = ?').run(sid);
  // carte rouverte : la reprise redevient possible (budget remis à zéro)
  db.query(`UPDATE task_resume SET disabled_at = NULL, disabled_reason = NULL,
      attempts = 0, session_since = NULL, last_seen_at = NULL, updated_at = ?
      WHERE session_id = ?`).run(Date.now(), sid);
}

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

export type SupervisorMode = 'pilot' | 'investigation';
export function getSupervisorMode(): { mode: SupervisorMode; projectDir: string | null } {
  const row = db.query('SELECT mode, project_dir FROM supervisor_mode WHERE id = 1').get() as
    { mode?: string; project_dir?: string | null } | undefined;
  return {
    mode: row?.mode === 'investigation' ? 'investigation' : 'pilot',
    projectDir: row?.project_dir ?? null,
  };
}

export function setSupervisorMode(mode: SupervisorMode, projectDir: string | null): void {
  db.query(`INSERT INTO supervisor_mode (id, mode, project_dir) VALUES (1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET mode=excluded.mode, project_dir=excluded.project_dir`)
    .run(mode, projectDir);
}

export interface SupervisorPrefRow {
  chat_model: string | null;
  chat_agent: string | null;
  task_model: string | null;
  updated_at: number | null;
}

/** Préférences explicites : une colonne NULL = pas de choix, le défaut s'applique. */
export function getSupervisorPref(): SupervisorPrefRow {
  const row = db.query('SELECT chat_model, chat_agent, task_model, updated_at FROM supervisor_pref WHERE id = 1')
    .get() as { chat_model?: string | null; chat_agent?: string | null; task_model?: string | null; updated_at?: number | null } | undefined;
  return {
    chat_model: row?.chat_model ?? null,
    chat_agent: row?.chat_agent ?? null,
    task_model: row?.task_model ?? null,
    updated_at: row?.updated_at ?? null,
  };
}

export function setSupervisorPref(p: {
  chatModel: string | null; chatAgent: string | null; taskModel: string | null;
}): void {
  db.query(`INSERT INTO supervisor_pref (id, chat_model, chat_agent, task_model, updated_at)
            VALUES (1, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET chat_model=excluded.chat_model, chat_agent=excluded.chat_agent,
              task_model=excluded.task_model, updated_at=excluded.updated_at`)
    .run(p.chatModel, p.chatAgent, p.taskModel, Date.now());
}

export function setSupervisorSession(p: {
  ocSessionId: string; agent: string; title: string;
}) {
  // colonne version (nom d'agent versionné) : plus écrite, nom fixe
  db.query(`INSERT INTO supervisor_session (id, oc_session_id, agent, version, title, created_at)
            VALUES (1, ?, ?, NULL, ?, ?)
            ON CONFLICT(id) DO UPDATE SET oc_session_id = excluded.oc_session_id,
              agent = excluded.agent, version = NULL, title = excluded.title`)
    .run(p.ocSessionId, p.agent, p.title, Date.now());
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

/**
 * Modèle propre à une tâche. Le brief fait foi, puis le registre de reprise :
 * le réglage global `supervisor_pref.task_model` ne sert qu'aux nouvelles
 * tâches et n'est jamais lu ici.
 */
export function getTaskModelStored(sessionId: string): string | null {
  const brief = db.query('SELECT model FROM task_brief WHERE session_id = ?')
    .get(sessionId) as { model?: string | null } | undefined;
  if (brief?.model) return brief.model;
  const resume = getTaskResumeBySession(sessionId) ?? getTaskResume(sessionId);
  return resume?.model ?? null;
}

/**
 * Écrit le modèle propre à la tâche dans le brief et le registre de reprise.
 * Retourne false quand la tâche n'a ni brief ni registre : le modèle a bien
 * été appliqué à la session vivante, mais il ne survivra pas à une reprise.
 */
export function updateTaskModel(sessionId: string, model: string | null): boolean {
  let persisted = false;
  const brief = db.query('SELECT session_id FROM task_brief WHERE session_id = ?').get(sessionId);
  if (brief) {
    db.query('UPDATE task_brief SET model = ? WHERE session_id = ?').run(model, sessionId);
    persisted = true;
  }
  const row = getTaskResumeBySession(sessionId) ?? getTaskResume(sessionId);
  if (row) {
    db.query('UPDATE task_resume SET model = ?, updated_at = ? WHERE task_id = ?')
      .run(model, Date.now(), row.task_id);
    persisted = true;
  }
  return persisted;
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
 */
export function migrateTaskSession(oldId: string, newId: string) {
  if (!oldId || !newId || oldId === newId) return;
  db.transaction(() => {
    db.query('UPDATE task_state SET session_id = ? WHERE session_id = ?').run(newId, oldId);
    db.query('UPDATE task_brief SET session_id = ? WHERE session_id = ?').run(newId, oldId);
    db.query('UPDATE task_log SET session_id = ? WHERE session_id = ?').run(newId, oldId);
    // les réponses au propriétaire suivent la tâche : elles restent visibles
    // dans le détail (rien ne dit qu'elles ont déjà été lues)
    db.query('UPDATE task_answer SET session_id = ? WHERE session_id = ?').run(newId, oldId);
    // les critères suivent la tâche (refs et états conservés)
    db.query('UPDATE criteria SET task_id = ? WHERE task_id = ?').run(newId, oldId);
    // le dernier plan connu suit la tâche : la reprise l'affiche tant que le
    // nouvel agent n'a pas écrit le sien
    db.query('UPDATE plan_known SET session_id = ? WHERE session_id = ?').run(newId, oldId);
    // le registre suit la tâche : la session de reprise devient la nouvelle
    db.query('UPDATE task_resume SET session_id = ?, session_since = NULL, last_seen_at = NULL WHERE session_id = ?')
      .run(newId, oldId);
  })();
}

/* --- Registre du tableau (fleet_seen) ---
 * Une ligne par conversation montrée dans le tableau. Le statut vivant
 * d'OpenChamber étant éphémère (carte en mémoire, expirée après 24 h), c'est
 * ce registre qui permet de remettre les cartes au démarrage : fleet.mts
 * persiste chaque carte vue et restaure celles absentes du statut, tant que
 * la conversation existe encore (jamais archivée, jamais marquée terminée).
 */

export interface FleetSeenRow {
  session_id: string;
  title: string | null;
  dir: string | null;
  first_seen_at: number;
  last_seen_at: number;
  last_update_at: number | null;
  updated_at: number;
}

export function upsertFleetSeen(sessionId: string, p: {
  title?: string | null; dir?: string | null; lastUpdateAt?: number | null; at?: number;
}) {
  const at = p.at ?? Date.now();
  db.query(`INSERT INTO fleet_seen (session_id, title, dir, first_seen_at, last_seen_at, last_update_at, updated_at)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(session_id) DO UPDATE SET
              title = COALESCE(excluded.title, title),
              dir = COALESCE(excluded.dir, dir),
              last_seen_at = excluded.last_seen_at,
              last_update_at = COALESCE(excluded.last_update_at, last_update_at),
              updated_at = excluded.updated_at`)
    .run(sessionId, p.title ?? null, p.dir ?? null, at, at, p.lastUpdateAt ?? null, at);
}

export function listFleetSeen(): FleetSeenRow[] {
  return db.query('SELECT * FROM fleet_seen ORDER BY last_seen_at DESC').all() as FleetSeenRow[];
}

/** La conversation n'existe plus (supprimée, archivée) : elle quitte le registre. */
export function forgetFleetSeen(sessionId: string) {
  db.query('DELETE FROM fleet_seen WHERE session_id = ?').run(sessionId);
}
