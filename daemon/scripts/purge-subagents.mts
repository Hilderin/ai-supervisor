/**
 * Nettoyage one-off du retrait des sous-agents (2026-11-12) :
 * archive les sessions compagnon et vérificateur connues des mappings,
 * puis vide ces mappings (et le verdict hérité). Idempotent.
 * Usage : bun daemon/scripts/purge-subagents.mts <chemin-base> <port-openchamber> [--apply]
 * Sans --apply : simulation seule.
 */
import { Database } from 'bun:sqlite';

const [dbPath, port, flag] = process.argv.slice(2);
if (!dbPath || !port) {
  console.error('usage : bun daemon/scripts/purge-subagents.mts <base.db> <port> [--apply]');
  process.exit(1);
}
const apply = flag === '--apply';
const base = `http://127.0.0.1:${port}`;

const db = new Database(dbPath);
db.run('PRAGMA busy_timeout = 5000;');

const companions = (db.query('SELECT parent_session_id p, companion_session_id c FROM companion_map').all() as Array<{ p: string; c: string }>);
const verifiers = (db.query('SELECT parent_session_id p, verifier_session_id v FROM verifier_map').all() as Array<{ p: string; v: string }>);

console.log(`base ${dbPath} : ${companions.length} compagnon(s), ${verifiers.length} vérificateur(s) en mapping`);

const ids = [...new Set([...companions.map(r => r.c), ...verifiers.map(r => r.v)])].filter(Boolean);
if (ids.length) {
  if (!apply) {
    console.log(`simulation : archivage de ${ids.length} session(s) enfant(s)`);
  } else {
    const out = await fetch(`${base}/api/openchamber/sessions/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }).then(r => r.text()).catch(e => `erreur : ${e}`);
    console.log(`archivage OpenChamber (${ids.length} ids) : ${out.slice(0, 200)}`);
    db.run('DELETE FROM companion_map');
    db.run('DELETE FROM verifier_map');
    // verdict hérité du compagnon : plus aucun lecteur, on purge les lignes
    db.run('DELETE FROM task_verdict');
    console.log('mappings compagnon/vérificateur et verdicts vidés');
  }
} else {
  console.log('rien à archiver');
}
db.close();
