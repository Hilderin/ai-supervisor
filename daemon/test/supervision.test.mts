/**
 * Supervision opt-in (docs/analyses/mvp1/supervision-bascule.md) : une
 * conversation démarrée directement dans OpenChamber (sans brief) n'installe
 * NI compagnon NI vérificateur par défaut ; une tâche du Superviseur (brief)
 * reste supervisée ; la bascule persiste en BD et détache/arme à chaud.
 * Même harnais que companion-recovery.test.mts : base SQLite temporaire
 * (imports dynamiques APRÈS l'affectation d'env) + fetch simulé.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const testHome = mkdtempSync(join(tmpdir(), 'supervision-home-'));
const testData = mkdtempSync(join(tmpdir(), 'supervision-data-'));
process.env.HOME = testHome;
process.env.SUPERVISEUR_DATA_DIR = testData;
process.env.SUPERVISEUR_COMPANION = 'on';

const state = await import('../src/state.mts');
const criteria = await import('../src/criteria.mts');
const companion = await import('../src/companion.mts');
const verifier = await import('../src/verifier.mts');
const supervision = await import('../src/supervision.mts');
const supervisor = await import('../src/supervisor.mts');
const kicks = await import('../src/kicks.mts');

const dbPath = (state.db as unknown as { query: (sql: string) => { all: () => Array<{ file?: string }> } })
  .query('pragma database_list').all().map(row => row.file ?? '').join(',');
if (!dbPath.includes('supervision-data-')) {
  throw new Error(`supervision.test : base SQLite inattendue (${dbPath})`);
}

import { expect, test } from 'bun:test';
const {
  getSupervision, isSupervised, setSupervision, putTaskBrief, getCompanion, getVerifier, getTaskState,
} = state;
const { addCriterion } = criteria;
const { companionTick } = companion;
const { verifierTick, resetVerifierState } = verifier;
const { applySupervisionToggle } = supervision;
const { kick } = kicks;
companion.setBase('http://supervision.test');
verifier.setVerifierBase('http://supervision.test');
resetVerifierState();

/** attend une condition pendant au plus deadlineMs (sinon échec du test courant) */
async function waitFor(check: () => boolean, deadlineMs = 10_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  expect(check()).toBe(true);
}

/** fetch simulé : enregistre chaque appel, sert les réponses du harnais. */
function installFetch(routes: Array<{ match: (url: string, method: string) => boolean; reply: (url: string, method: string) => Response }>) {
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    const route = routes.find(r => r.match(url, method));
    return route ? route.reply(url, method) : new Response('not found', { status: 404 });
  }) as typeof fetch;
  return calls;
}

const parentMessages = {
  data: [
    { id: 'u1', type: 'user', time: { created: 10 }, text: 'Fais le travail.' },
    { id: 'a1', type: 'assistant', time: { created: 20 }, text: 'Je commence.' },
  ],
};
const verdict = JSON.stringify({
  summary: 'L’agent démarre le travail demandé.',
  state: 'working',
  human_request: { needs: false, source: 'none', ask: '' },
  next: 'Continuer le travail.',
});

/** harnais compagnon : création d'un enfant, présence, envoi, réponse verdict */
function companionRoutes(compId: string) {
  return [
    { match: (url: string, m: string) => url.endsWith('/api/openchamber/sessions') && m === 'POST', reply: () => Response.json({ sessionId: compId }) },
    { match: (url: string, m: string) => url.includes(`/api/session/${compId}/agent`) && m === 'POST', reply: () => new Response(null, { status: 204 }) },
    { match: (url: string, m: string) => url.includes(`/api/session/${compId}/model`) && m === 'POST', reply: () => new Response(null, { status: 204 }) },
    { match: (url: string) => url.includes(`/api/session/${compId}`) && url.includes('/message'), reply: () => Response.json({
      data: [{ id: 'r1', type: 'assistant', time: { created: Date.now() + 1000 }, content: [{ type: 'text', text: verdict }] }],
    }) },
    { match: (url: string) => url.includes(`/api/session/${compId}`) && !url.includes('/message'), reply: () => Response.json({ data: { id: compId } }) },
    { match: (url: string) => url.includes('/api/openchamber/sessions/') && url.includes('/send'), reply: () => Response.json({ ok: true }) },
    { match: (url: string) => url.includes('/message'), reply: () => Response.json(parentMessages) },
  ];
}

test('défaut : conversation OpenChamber non supervisée, tâche du Superviseur supervisée', () => {
  // aucune ligne : la règle de défaut se lit, elle n'est pas migrée
  expect(getSupervision('ses_openchamber')).toBeNull();
  expect(isSupervised('ses_openchamber')).toBe(false);
  // brief = démarrée via le Superviseur : supervisée par défaut (inchangé)
  putTaskBrief('ses_brief', {
    title: 'Tâche chat', goal: 'but', doneCriteria: [], constraints: [],
    projectDir: '/tmp/projet', agent: 'build', model: null,
  });
  expect(getSupervision('ses_brief')).toBeNull();
  expect(isSupervised('ses_brief')).toBe(true);
});

test('le choix explicite fait foi dans les deux sens', () => {
  setSupervision('ses_openchamber', true);
  expect(isSupervised('ses_openchamber')).toBe(true);
  setSupervision('ses_openchamber', false);
  expect(isSupervised('ses_openchamber')).toBe(false);
  setSupervision('ses_brief', false);
  expect(isSupervised('ses_brief')).toBe(false);
  setSupervision('ses_brief', true);
  expect(isSupervised('ses_brief')).toBe(true);
});

test('companionTick : aucun compagnon sur une conversation non supervisée (kick start présent)', async () => {
  const calls = installFetch(companionRoutes('comp-refuse'));
  kick('ses_openchamber2', 'start');
  await companionTick(
    [{ id: 'ses_openchamber2', title: 'Conv OpenChamber', location: { directory: '/tmp/projet' } }],
    { ses_openchamber2: { status: 'idle', lastUpdateAt: 20 } },
  );
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(getCompanion('ses_openchamber2')).toBeNull();
  // aucun enfant créé, aucun envoi à un enfant : la conversation reste intacte
  expect(calls.some(c => c.url.endsWith('/api/openchamber/sessions') && c.method === 'POST')).toBe(false);
  expect(getTaskState('ses_openchamber2')).toBeNull();
});

test('la même conversation activée (bascule) crée son compagnon au kick', async () => {
  const calls = installFetch(companionRoutes('comp-actif'));
  const out = await applySupervisionToggle('ses_openchamber2', true);
  expect(out.ok).toBe(true);
  expect(isSupervised('ses_openchamber2')).toBe(true);
  await companionTick(
    [{ id: 'ses_openchamber2', title: 'Conv OpenChamber', location: { directory: '/tmp/projet' } }],
    { ses_openchamber2: { status: 'idle', lastUpdateAt: 20 } },
  );
  await waitFor(() => getCompanion('ses_openchamber2')?.compId === 'comp-actif');
  expect(calls.some(c => c.url.endsWith('/api/openchamber/sessions') && c.method === 'POST')).toBe(true);
});

test('companionTick : la tâche du Superviseur (brief) garde son compagnon par défaut', async () => {
  const calls = installFetch(companionRoutes('comp-brief'));
  await companionTick(
    [{ id: 'ses_brief', title: 'Tâche chat', location: { directory: '/tmp/projet' } }],
    { ses_brief: { status: 'idle', lastUpdateAt: 20 } },
  );
  await waitFor(() => getCompanion('ses_brief')?.compId === 'comp-brief');
  expect(calls.some(c => c.url.endsWith('/api/openchamber/sessions') && c.method === 'POST')).toBe(true);
});

test('verifierTick : aucun vérificateur sur une conversation non supervisée, même avec critères', async () => {
  const calls = installFetch(companionRoutes('verif-refuse'));
  addCriterion('ses_unsup_crit', { title: 'Preuve exigée', methods: ['unit_test'] });
  kick('ses_unsup_crit', 'end');
  await verifierTick(
    [{ id: 'ses_unsup_crit', title: 'Conv OpenChamber', location: { directory: '/tmp/projet' } }],
    { ses_unsup_crit: { status: 'idle', lastUpdateAt: 20 } },
  );
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(getVerifier('ses_unsup_crit')).toBeNull();
  expect(calls.some(c => c.url.endsWith('/api/openchamber/sessions') && c.method === 'POST')).toBe(false);
});

test('verifierTick : la même conversation activée crée son vérificateur', async () => {
  const calls = installFetch(companionRoutes('verif-actif'));
  await applySupervisionToggle('ses_unsup_crit', true);
  await verifierTick(
    [{ id: 'ses_unsup_crit', title: 'Conv OpenChamber', location: { directory: '/tmp/projet' } }],
    { ses_unsup_crit: { status: 'idle', lastUpdateAt: 20 } },
  );
  await waitFor(() => getVerifier('ses_unsup_crit')?.verifierId === 'verif-actif');
  expect(calls.some(c => c.url.endsWith('/api/openchamber/sessions') && c.method === 'POST')).toBe(true);
});

test('désactivation : sous-agents archivés (doux), choix persisté, conversation intacte', async () => {
  // une tâche du Superviseur avec compagnon + vérificateur existants
  state.putVerifier('ses_brief', 'verif-brief', 'superviseur-verificateur');
  const calls = installFetch([
    { match: (url: string, m: string) => url.includes('/api/openchamber/sessions/archive') && m === 'POST', reply: () => Response.json({ ok: true }) },
  ]);
  const before = getTaskState('ses_brief');
  const out = await applySupervisionToggle('ses_brief', false);
  expect(out.ok).toBe(true);
  expect(isSupervised('ses_brief')).toBe(false);
  expect(getSupervision('ses_brief')).toBe(false);
  // les deux enfants ont été archivés (compagnon + vérificateur de ses_brief)
  expect(calls.filter(c => c.url.includes('/api/openchamber/sessions/archive')).length).toBe(2);
  // la conversation elle-même et son état ne bougent pas
  expect(getTaskState('ses_brief')).toEqual(before);
  // réactivation : le choix repasse supervisé sans recréer quoi que ce soit ici
  const back = await applySupervisionToggle('ses_brief', true);
  expect(back.ok).toBe(true);
  expect(isSupervised('ses_brief')).toBe(true);
});

test('ownerPromptFor : texte brut pour une non supervisée, habillé pour une supervisée', () => {
  const raw = 'Relance les tests et dis-moi ce qui casse.';
  // ses_openchamber : ligne explicite false (choix du propriétaire)
  expect(applySupervisionToggle).toBeDefined();
  expect(supervision.ownerPromptFor('ses_openchamber', raw)).toBe(raw);
  // ses_brief : tâche du Superviseur supervisée : habillage plan/critères/answer
  const wrapped = supervision.ownerPromptFor('ses_brief', raw);
  expect(wrapped.startsWith(supervisor.OWNER_WRAP)).toBe(true);
  expect(wrapped.endsWith(raw)).toBe(true);
  expect(wrapped).not.toBe(raw);
});
