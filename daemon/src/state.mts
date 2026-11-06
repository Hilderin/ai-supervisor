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
);`);

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
