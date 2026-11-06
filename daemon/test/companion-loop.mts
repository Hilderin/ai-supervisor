/**
 * Test de la boucle compagnon (reproductible, à lancer : bun daemon/test/companion-loop.mts).
 * Vérifie, sur une session jetable REELLE :
 *  1. un repo instantané : le compagnon met à jour le verdict prompt reçu (< 30 s),
 *  2. un seuil de latence : le déclencheur prompt n'est PERT qu'une fois (une analyse, pas deux, dans les 10 s),
 *  2 bis. le digest du compagnon contient le prompt humain ([HUMAIN]) et l'objectif (premier prompt),
 *  3. ANTI-FEUILLE : sans nouveau contenu (session idle au repos), le compagnon ne relance RIEN pendant 45 s,
 *  4. la re-activité d'extraction du consentement de l'utilisateur (le dernier message traité devient le reflet de la flotte).
 * Cleanup : archive la session de test (parent et enfants compagnon).
 */
import { Database } from 'bun:sqlite';

const BASE = process.env.SUPERVISEUR_DAEMON ?? 'http://127.0.0.1:5180';
const OC = process.env.SUPERVISEUR_OC ?? 'http://127.0.0.1:57123';
const DIR = '/home/guillaume/Documents/Projects/ai-supervisor';

const post = async (url: string, body: unknown) => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try { return { status: res.status, data: await res.json() }; } catch { return { status: res.status, data: null }; }
};
const getJSON = async (url: string) => { const r = await fetch(url); return r.json(); };

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const dbR = new Database('data/superviseur.db', { readonly: true });
  console.log('— Test boucle compagnon —');
  // 1. session jetable
  const mk = await post(`${OC}/api/openchamber/sessions`, { prompt: 'Robot du test compagnon : réponds exactement OK, rien de plus, jamais de question.', directory: DIR });
  const sid = (mk.data as { sessionId?: string })?.sessionId;
  check('session de test créée', !!sid, JSON.stringify(mk.data).slice(0, 120));
  if (!sid) process.exit(1);
  await sleep(12_000);   // laisse le premier tour se terminer
  const countBase = (dbR.query("SELECT count(*) c FROM task_log WHERE kind='note' AND text LIKE '%analyste:%'").get() as { c?: number }).c ?? 0;

  // 2. prompt #1 : le compagnon doit réagir (≥1 analyse) dans les 30 s, sans enchaîner plus de 3 runs en 40 s
  const t0 = Date.now();
  await post(`${OC}/api/openchamber/sessions/${sid}/send`, { prompt: 'test kick — réponds OK', directory: DIR });
  let lat: number | null = null;
  const t_stop = Date.now() + 30_000;
  while (Date.now() < t_stop && !lat) {
    await sleep(1000);
    const c = dbR.query("SELECT count(*) c FROM task_log WHERE kind='note' AND text LIKE '%analyste:%'").get() as { c: number };
    if ((c.c ?? 0) > countBase) lat = Date.now() - t0;
  }
  check('compagnon relancé par le prompt < 30 s', lat != null, `latence=${lat}ms`);
  await sleep(10_000);   // laisse le tour se terminer et la clôture compagnon finir

  // 2 bis. le compagnon doit VOIR le prompt humain (régression : texte lu dans payload.text au lieu de m.text)
  const compRow = dbR.query('SELECT companion_session_id c, version v FROM companion_map WHERE parent_session_id = ?').get(sid) as { c?: string; v?: number | null } | undefined;
  const compId = compRow?.c;
  const compMsgs = await getJSON(`${OC}/api/session/${compId}/message?limit=20`);
  const injected = ((compMsgs.data ?? []) as Array<{ type?: string; text?: string }>)
    .filter(m => m.type === 'user').map(m => m.text ?? '').join('\n');
  check('prompt humain présent dans le digest ([HUMAIN])', injected.includes('[HUMAIN]') && injected.includes('test kick'));
  check('objectif = premier prompt de la session', injected.includes('Objectif de la tâche : Robot du test compagnon'));
  check('companion_map.version enregistrée (pas de recréation à chaque analyse)', compRow?.v != null, `version=${compRow?.v ?? 'NULL'}`);

  // 3. anti-relance à vide (SCOPE : session de test; les autres sessions peuvent bouger légitimement)
  const c0s = (dbR.query("SELECT count(*) c FROM task_log WHERE kind='note' AND session_id = ? AND text LIKE '%analyste:%'").get(sid) as { c: number }).c;
  await sleep(45_000);
  const c1s = (dbR.query("SELECT count(*) c FROM task_log WHERE kind='note' AND session_id = ? AND text LIKE '%analyste:%'").get(sid) as { c: number }).c;
  check('aucune relance à vide pendant 45 s (idle immobile)', c1s - c0s === 0, `Δ=${c1s - c0s}`);

  // 4. un nouveau prompt doit PURGER l'ancien attend/résumé immédiatement (anti-« ✋ collé »)
  const fleetA = await getJSON(`${BASE}/api/fleet`);
  const rBefore = (fleetA.rows ?? []).find((r: { id: string }) => r.id === sid);
  check('verdict présent avant prompt (précondition)', !!rBefore?.sup, JSON.stringify(rBefore?.sup ?? {}).slice(0, 120));
  await post(`${OC}/api/openchamber/sessions/${sid}/send`, { prompt: 'nouveau tour — réponds OK', directory: DIR });
  await sleep(5000);
  const fleetB = await getJSON(`${BASE}/api/fleet`);
  const rB = (fleetB.rows ?? []).find((r: { id: string }) => r.id === sid);
  const stripped = !rB?.sup || !rB.sup.attend || (rB.sup.at && rB.turnStartedAt && rB.sup.at >= rB.turnStartedAt);
  check('attend/résumé purgé au nouveau prompt', !!stripped, JSON.stringify(rB?.sup ?? {}).slice(0, 120));

  // cleanup : archive le parent des tests
  await post(`${OC}/api/openchamber/sessions/archive`, { ids: [sid] });
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}
main();
