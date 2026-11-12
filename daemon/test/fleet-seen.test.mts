/**
 * Tests du registre du tableau (fleet_seen + persistFleetSeen/restoreFleetRows).
 * Le statut vivant d'OpenChamber (/api/sessions/status) est une carte en mémoire :
 * perdue au redémarrage, expirée après 24 h. Le registre persistant doit remettre
 * au tableau toute conversation encore existante, et rien de plus (terminée,
 * archivée, supprimée, sous-session : pas de retour).
 *
 * La base SQLite vit dans un dossier temporaire ; l'instance OpenChamber est
 * simulée par un `fetch` de remplacement (annuaire + lectures directes).
 */
import { describe, expect, test, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SUPERVISEUR_DATA_DIR = mkdtempSync(join(tmpdir(), 'fleetseen-test-'));
const state = await import('../src/state.mts');

// garde-fou anti-catastrophe : en batch (`bun test daemon/test`), state.mts peut
// avoir été évalué d'abord par un autre fichier, sans SUPERVISEUR_DATA_DIR, et
// alors pointer sur la vraie base. On refuse alors toute écriture.
const boundFile = (state.db as unknown as { query: Function }).query('pragma database_list').all()
  .map((r: { file?: string }) => r.file ?? '').join(',');
if (!boundFile.includes('fleetseen-test-')) {
  process.exitCode = 1;
  throw new Error(`fleet-seen.test : base SQLite ${boundFile} n'est pas une base de test : on n'écrit rien. Lancer ce fichier SEUL (for f in daemon/test/*.test.mts; do bun test "$f"; done)`);
}

const { upsertFleetSeen, listFleetSeen, forgetFleetSeen } = state;

const fleetMod = await import('../src/fleet.mts');
const supervisorMod = await import('../src/supervisor.mts');
const { persistFleetSeen, restoreFleetRows, resetFleetSeenCaches, setBase } = fleetMod;
type Fleet = fleetMod.Fleet;
type FleetRow = fleetMod.FleetRow;
const { SUPERVISOR_DIR } = supervisorMod;

/* --- OpenChamber simulé --- */

const BASE = 'http://oc.test';
setBase(BASE);

interface FakeSession {
  id: string; title?: string; parentID?: string;
  time?: Record<string, number>;
  location?: { directory?: string };
  metadata?: { openchamber?: { work?: { state?: string } } };
}

/** annuaire « paginé » : ce que GET /api/session renvoie */
const directory = new Map<string, FakeSession>();
/** lectures directes GET /api/session/:id : session, 'gone' (404) ou 'error' */
let directReads: Record<string, FakeSession | 'gone' | 'error'> = {};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const realFetch = globalThis.fetch;
const fetchCalls: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
  const url = String(input instanceof Request ? input.url : input);
  fetchCalls.push(url);
  if (url === `${BASE}/api/session?limit=200`) {
    return jsonResponse({ data: [...directory.values()] });
  }
  const m = url.match(/^http:\/\/oc\.test\/api\/session\/([^/]+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const v = directReads[id];
    if (v === 'gone') return jsonResponse({ error: 'not found' }, 404);
    if (v === 'error') throw new Error('instance injoignable');
    if (v) return jsonResponse({ data: v });
    return jsonResponse({ error: 'not found' }, 404);
  }
  throw new Error(`URL inattendue par le harnais : ${url}`);
}) as typeof fetch;

const NOW = 1_760_000_000_000;

function emptyFleet(): Fleet {
  return { at: NOW, rows: [], concern: null };
}

function metaOf(p: Partial<FakeSession> & { id: string }): FakeSession {
  return {
    id: p.id,
    title: p.title ?? 'Sans titre',
    location: p.location ?? { directory: 'C:\\projets\\demo' },
    time: p.time ?? { created: NOW - 60_000, updated: NOW - 10_000, busy: NOW - 30_000, idle: NOW - 10_000 },
    metadata: p.metadata,
    parentID: p.parentID,
  };
}

async function restore(fleet: Fleet, status: { sessions?: Record<string, unknown>; pending?: Record<string, unknown> } = {}): Promise<FleetRow[]> {
  await restoreFleetRows(fleet, status as never, directory, NOW);
  return fleet.rows;
}

beforeEach(() => {
  directory.clear();
  directReads = {};
  resetFleetSeenCaches();
  for (const row of listFleetSeen()) forgetFleetSeen(row.session_id);
});

describe('persistFleetSeen', () => {
  test('note chaque carte vue : titre, dossier, dernière activité', () => {
    persistFleetSeen({
      at: NOW, concern: null,
      rows: [
        { id: 'ses_a', title: 'Analyse X', status: 'busy', dir: 'C:\\projets\\x', lastUpdateAt: NOW - 5_000, pendingForms: [], pendingPermissions: [] },
        { id: 'ses_b', title: 'Correctif Y', status: 'idle', dir: 'C:\\projets\\y', lastUpdateAt: NOW - 60_000, pendingForms: [], pendingPermissions: [] },
      ],
    }, NOW);
    const rows = listFleetSeen();
    expect(rows.length).toBe(2);
    const a = rows.find(r => r.session_id === 'ses_a');
    expect(a?.title).toBe('Analyse X');
    expect(a?.dir).toBe('C:\\projets\\x');
    expect(a?.last_update_at).toBe(NOW - 5_000);
    expect(a?.first_seen_at).toBe(NOW);
    expect(a?.last_seen_at).toBe(NOW);
  });

  test('un nouveau passage met à jour le suivi sans dupliquer la ligne', () => {
    persistFleetSeen({ at: NOW, concern: null, rows: [{ id: 'ses_a', title: 'Analyse X', status: 'busy', lastUpdateAt: NOW - 5_000, pendingForms: [], pendingPermissions: [] }] }, NOW);
    persistFleetSeen({ at: NOW + 3_000, concern: null, rows: [{ id: 'ses_a', title: 'Analyse X (maj)', status: 'idle', lastUpdateAt: NOW - 1_000, pendingForms: [], pendingPermissions: [] }] }, NOW + 3_000);
    const rows = listFleetSeen();
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe('Analyse X (maj)');
    expect(rows[0].last_update_at).toBe(NOW - 1_000);
    expect(rows[0].last_seen_at).toBe(NOW + 3_000);
    expect(rows[0].first_seen_at).toBe(NOW);
  });
});

describe('restoreFleetRows', () => {
  test('remet une conversation vivante absente du statut vivant', async () => {
    upsertFleetSeen('ses_a', { title: 'Analyse X', dir: 'C:\\projets\\x', lastUpdateAt: NOW - 60_000, at: NOW - 60_000 });
    directory.set('ses_a', metaOf({ id: 'ses_a', title: 'Analyse X (titre frais)', location: { directory: 'C:\\projets\\x' } }));
    const rows = await restore(emptyFleet());
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('ses_a');
    expect(rows[0].status).toBe('idle');
    expect(rows[0].title).toBe('Analyse X (titre frais)');
    expect(rows[0].dir).toBe('C:\\projets\\x');
    // activité relu de l'annuaire : tri et livraison suivent la vraie fraîcheur
    expect(rows[0].lastUpdateAt).toBe(NOW - 10_000);
    expect(rows[0].turnStartedAt).toBe(NOW - 30_000);
  });

  test('une conversation marquée terminée (work=done) ne revient pas', async () => {
    upsertFleetSeen('ses_done', { title: 'Terminée', at: NOW - 60_000 });
    directory.set('ses_done', metaOf({ id: 'ses_done', metadata: { openchamber: { work: { state: 'done' } } } }));
    const rows = await restore(emptyFleet());
    expect(rows.length).toBe(0);
    // la ligne du registre reste : la carte peut encore être vue tant que le
    // statut vivant d'OpenChamber la porte (fenêtre 24 h), elle ne revient
    // juste plus après une perte du statut
    expect(listFleetSeen().length).toBe(1);
  });

  test('une conversation archivée ne revient pas et quitte le registre', async () => {
    upsertFleetSeen('ses_arch', { title: 'Archivée', at: NOW - 60_000 });
    directory.set('ses_arch', metaOf({ id: 'ses_arch', time: { created: NOW, archived: NOW - 1_000 } }));
    const rows = await restore(emptyFleet());
    expect(rows.length).toBe(0);
    expect(listFleetSeen().length).toBe(0);
  });

  test('une conversation supprimée (404 en lecture directe) quitte le registre', async () => {
    upsertFleetSeen('ses_gone', { title: 'Perdue', at: NOW - 60_000 });
    // absente de l'annuaire paginé ET 404 en lecture directe : suppression confirmée
    const rows = await restore(emptyFleet());
    expect(rows.length).toBe(0);
    expect(listFleetSeen().length).toBe(0);
  });

  test('instance injoignable : rien n\'est décidé, la ligne du registre reste', async () => {
    upsertFleetSeen('ses_err', { title: 'En vol', at: NOW - 60_000 });
    directory.clear();
    directReads = { ses_err: 'error' };
    const rows = await restore(emptyFleet());
    expect(rows.length).toBe(0);
    expect(listFleetSeen().length).toBe(1);
  });

  test('une sous-session (parentID) ne revient pas', async () => {
    upsertFleetSeen('ses_child', { title: 'Sous-agent', at: NOW - 60_000 });
    directory.set('ses_child', metaOf({ id: 'ses_child', parentID: 'ses_parent' }));
    const rows = await restore(emptyFleet());
    expect(rows.length).toBe(0);
  });

  test('le chat de supervision ne revient pas', async () => {
    upsertFleetSeen('ses_chat', { title: 'Superviseur', dir: SUPERVISOR_DIR, at: NOW - 60_000 });
    directory.set('ses_chat', metaOf({ id: 'ses_chat', location: { directory: SUPERVISOR_DIR } }));
    const rows = await restore(emptyFleet());
    expect(rows.length).toBe(0);
  });

  test('absente de l\'annuaire paginé mais vivante en lecture directe : restaurée', async () => {
    upsertFleetSeen('ses_page', { title: 'Hors page', at: NOW - 60_000 });
    directory.clear(); // l'annuaire paginé ne la porte pas
    directReads = { ses_page: metaOf({ id: 'ses_page', title: 'Hors page' }) };
    const rows = await restore(emptyFleet());
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('ses_page');
    expect(rows[0].status).toBe('idle');
  });

  test('déjà dans le statut vivant sans annuaire (fantôme) : pas de carte fabriquée', async () => {
    upsertFleetSeen('ses_ghost', { title: 'Fantôme', at: NOW - 60_000 });
    directory.clear();
    const rows = await restore(emptyFleet(), { sessions: { ses_ghost: { status: 'busy', lastUpdateAt: NOW } } });
    expect(rows.length).toBe(0);
    // la ligne du registre reste : l'annuaire rattrapera
    expect(listFleetSeen().length).toBe(1);
  });

  test('une carte vivante n\'est jamais doublée par sa restauration', async () => {
    upsertFleetSeen('ses_a', { title: 'Analyse X', at: NOW - 60_000 });
    directory.set('ses_a', metaOf({ id: 'ses_a' }));
    const f = emptyFleet();
    f.rows.push({ id: 'ses_a', title: 'Analyse X', status: 'busy', turnStartedAt: NOW, lastUpdateAt: NOW, pendingForms: [], pendingPermissions: [] });
    const rows = await restore(f);
    expect(rows.filter(r => r.id === 'ses_a').length).toBe(1);
    expect(rows[0].status).toBe('busy');
  });

  test('les cartes restaurées suivent le même tri (récence, demandes d\'abord)', async () => {
    upsertFleetSeen('ses_old', { title: 'Ancienne', at: NOW - 600_000 });
    upsertFleetSeen('ses_recent', { title: 'Récente', at: NOW - 60_000 });
    directory.set('ses_old', metaOf({ id: 'ses_old', time: { created: NOW - 600_000, updated: NOW - 400_000, busy: NOW - 400_000, idle: NOW - 400_000 } }));
    directory.set('ses_recent', metaOf({ id: 'ses_recent', time: { created: NOW - 120_000, updated: NOW - 60_000, busy: NOW - 60_000, idle: NOW - 60_000 } }));
    const rows = await restore(emptyFleet());
    expect(rows.map(r => r.id)).toEqual(['ses_recent', 'ses_old']);
  });

  test('une question en attente connue du statut est portée par la carte restaurée', async () => {
    upsertFleetSeen('ses_q', { title: 'Question', at: NOW - 60_000 });
    directory.set('ses_q', metaOf({ id: 'ses_q' }));
    const rows = await restore(emptyFleet(), {
      pending: { ses_q: { forms: [{ id: 'f1', sessionID: 'ses_q', metadata: { kind: 'question' }, fields: [] }] } },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].pendingForms.length).toBe(1);
  });
});
