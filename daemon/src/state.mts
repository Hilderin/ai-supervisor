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

/** version du prompt de l'agent analyste : hash du contenu, pas mtime (un touch ne recrée plus tous les comps) */
import { existsSync, readFileSync, symlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const agentMD = join(dirname(fileURLToPath(import.meta.url)), '..', 'agent', 'superviseur-analyste.md');
/**
 * Hash du contenu, relu à chaque appel (8 Ko, négligeable) : un cache par mtime
 * pouvait mémoriser un fichier lu pendant une écriture et rester figé ensuite.
 */
export function getAgentVersion(): number {
  try {
    const digest = createHash('sha256').update(readFileSync(agentMD)).digest('hex');
    return parseInt(digest.slice(0, 8), 16);
  } catch { return 0; }
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
  const name = agentNameFor(version);
  try {
    const dir = join(homedir(), '.config', 'opencode', 'agent');
    mkdirSync(dir, { recursive: true });
    const link = join(dir, `${name}.md`);
    if (!existsSync(link)) symlinkSync(agentMD, link);
  } catch { /* le nom reste utilisable si le lien existe déjà ou si le dossier est protégé */ }
  return name;
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
