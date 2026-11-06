/**
 * Ménage des sessions « comp. supervision ».
 *
 * Une session parente ne doit garder qu'UN compagnon actif : celui de
 * `companion_map`. Tous les anciens (prompt changé, tests, versions archivées)
 * sont archivés, ainsi que les compagnons dont le parent a disparu ou est archivé.
 *
 *   bun daemon/scripts/cleanup-companions.mts            (simulation)
 *   bun daemon/scripts/cleanup-companions.mts --apply    (archive réellement)
 */
import { Database } from 'bun:sqlite';
import { discoverOpenChamberPort } from '../src/discover.mts';

interface Session {
  id: string;
  parentID?: string;
  title?: string;
  time?: { archived?: number; created?: number; updated?: number };
}

const APPLY = process.argv.includes('--apply');
const BATCH = 40;

async function allSessions(base: string): Promise<Session[]> {
  const out: Session[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const url = new URL(`${base}/api/session`);
    url.searchParams.set('limit', '200');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`/api/session → ${res.status}`);
    const body = await res.json() as { data?: Session[]; cursor?: { next?: string } };
    out.push(...(body.data ?? []));
    cursor = body.cursor?.next;
    if (!cursor || !(body.data?.length)) break;
  }
  return out;
}

async function archive(base: string, ids: string[]): Promise<number> {
  let ok = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const res = await fetch(`${base}/api/openchamber/sessions/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: slice }),
    });
    if (!res.ok) {
      console.error(`archive ${slice.length} ids → ${res.status} ${await res.text()}`);
      continue;
    }
    ok += slice.length;
  }
  return ok;
}

async function main() {
  const port = process.env.OPENCHAMBER_PORT
    ? Number(process.env.OPENCHAMBER_PORT)
    : await discoverOpenChamberPort();
  const base = process.env.SUPERVISEUR_OC ?? `http://127.0.0.1:${port}`;
  const db = new Database('data/superviseur.db');
  const sessions = await allSessions(base);
  const byId = new Map(sessions.map(s => [s.id, s]));
  const companions = sessions.filter(s => s.parentID && /^comp\. supervision\b/.test(String(s.title ?? '')));
  const maps = db.query('SELECT parent_session_id p, companion_session_id c FROM companion_map').all() as Array<{ p: string; c: string }>;
  const mapped = new Map(maps.map(m => [m.p, m.c]));

  const activeParents = new Set(sessions.filter(s => !s.parentID && !s.time?.archived).map(s => s.id));
  const keep = new Set<string>();
  const archiveIds: string[] = [];
  const orphanParents: string[] = [];

  for (const comp of companions) {
    if (comp.time?.archived) continue;
    const parent = comp.parentID ? byId.get(comp.parentID) : undefined;
    const parentAlive = !!parent && !parent.time?.archived;
    const isMapped = comp.parentID ? mapped.get(comp.parentID) === comp.id : false;
    if (parentAlive && isMapped) {
      keep.add(comp.id);
    } else {
      archiveIds.push(comp.id);
    }
  }

  for (const [parent, compId] of mapped) {
    const parentAlive = activeParents.has(parent);
    if (!parentAlive && byId.has(compId) && !byId.get(compId)?.time?.archived) {
      // le parent a disparu ou est archivé : son compagnon aussi
      if (!archiveIds.includes(compId)) archiveIds.push(compId);
      orphanParents.push(parent);
    } else if (!parentAlive && !byId.has(compId)) {
      orphanParents.push(parent);
    }
  }

  console.log(`OpenChamber : ${base}`);
  console.log(`Sessions lues : ${sessions.length} (${activeParents.size} parents actifs)`);
  console.log(`Compagnons actifs : ${companions.filter(s => !s.time?.archived).length}`);
  console.log(`Compagnons conservés : ${keep.size}`);
  console.log(`Compagnons à archiver : ${archiveIds.length}`);
  console.log(`Entrées companion_map orphelines : ${orphanParents.length}`);

  if (!APPLY) {
    const sample = archiveIds.slice(0, 12).map(id => `${id} (${byId.get(id)?.parentID?.slice(-8) ?? '?'})`);
    if (sample.length) console.log(`Exemples : ${sample.join(', ')}`);
    console.log('Simulation : relancer avec --apply pour archiver.');
    return;
  }

  const archived = await archive(base, archiveIds);
  // Nettoie les mappings des parents disparus/archivés (un nouveau compagnon sera créé à la prochaine analyse)
  if (orphanParents.length) {
    const del = db.prepare('DELETE FROM companion_map WHERE parent_session_id = ?');
    for (const p of orphanParents) del.run(p);
  }
  console.log(`Archivés : ${archived}/${archiveIds.length}`);
  if (orphanParents.length) console.log(`Mappings orphelins supprimés : ${orphanParents.length}`);
}

main().catch(e => { console.error('[cleanup-companions]', e); process.exit(1); });
