/**
 * Fermeture d'une tâche : geste OpenChamber best-effort
 * (docs/analyses/mvp1/fermeture-lu-in-work.md).
 * Harnais : base SQLite temporaire (imports dynamiques APRÈS l'affectation
 * d'env) + fetch simulé, comme supervision.test.mts.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const testHome = mkdtempSync(join(tmpdir(), 'oc-close-home-'));
const testData = mkdtempSync(join(tmpdir(), 'oc-close-data-'));
process.env.HOME = testHome;
process.env.SUPERVISEUR_DATA_DIR = testData;

const state = await import('../src/state.mts');
const ocSession = await import('../src/oc-session.mts');

const dbPath = (state.db as unknown as { query: (sql: string) => { all: () => Array<{ file?: string }> } })
  .query('pragma database_list').all().map(row => row.file ?? '').join(',');
if (!dbPath.includes('oc-close-data-')) {
  throw new Error(`oc-session-close.test : base SQLite inattendue (${dbPath})`);
}

import { expect, test } from 'bun:test';
const { logEvent, upsertTaskState } = state;
const { markTaskSessionRead, setBase } = ocSession;

/** lignes de journal de la session (table task_log) */
function logLines(sessionId: string): Array<{ kind: string; text: string }> {
  return (state.db as unknown as { query: (sql: string) => { all: (s: string) => Array<{ kind: string; text: string }> } })
    .query('SELECT kind, text FROM task_log WHERE session_id = ? ORDER BY at ASC').all(sessionId);
}

/** fetch simulé : enregistre chaque appel, sert les réponses du harnais */
interface Call { url: string; method: string; body?: unknown }
function installFetch(replies: Array<{ match: (url: string, method: string, body: unknown) => boolean; reply: (url: string, body: unknown) => Response | 'throw' }>): Array<Call> {
  const calls: Array<Call> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const route = replies.find(r => r.match(url, method, body));
    if (!route) return new Response('not found', { status: 404 });
    if (route.reply(url, body) === 'throw') throw new Error('connexion refusée');
    return route.reply(url, body) as Response;
  }) as typeof fetch;
  return calls;
}

const BASE = 'http://oc-close.test';
const sessionRoute = (sid: string, idle?: number) => ({
  match: (url: string, m: string) => m === 'GET' && url === `${BASE}/api/session/${sid}`,
  reply: () => Response.json({ data: { id: sid, time: idle === undefined ? { created: 1 } : { created: 1, idle } } }),
});
const viewRoute = (sid: string, idle: number) => ({
  match: (url: string, m: string, body: unknown) => m === 'POST' && url === `${BASE}/api/session/${sid}/view`,
  reply: (_u: string, body: unknown) => {
    expect(body).toEqual({ idle });
    return new Response('', { status: 204 });
  },
});
const attentionRoute = (sid: string) => ({
  match: (url: string, m: string) => m === 'POST' && url === `${BASE}/api/sessions/${sid}/view`,
  reply: () => Response.json({ success: true, sessionId: sid, viewed: true }),
});
const workRoute = (sid: string) => ({
  match: (url: string, m: string) => m === 'POST' && url === `${BASE}/api/openchamber/sessions/${sid}/metadata`,
  reply: (_u: string, body: unknown) => {
    expect(body).toEqual({
      patch: { openchamber: { work: { state: 'done', doneAt: expect.any(Number), suggestDoneAt: null } } },
    });
    return Response.json({ metadata: { openchamber: { work: { state: 'done', doneAt: Date.now() } } } });
  },
});

test('fermeture : tour terminé, les trois appels partent avec les bonnes charges utiles', async () => {
  setBase(BASE);
  const calls = installFetch([
    sessionRoute('ses_a', 123456),
    viewRoute('ses_a', 123456),
    attentionRoute('ses_a'),
    workRoute('ses_a'),
  ]);

  const out = await markTaskSessionRead('ses_a');
  expect(out).toEqual({ read: true, workDone: true });
  expect(calls.map(c => `${c.method} ${c.url}`)).toEqual([
    'GET http://oc-close.test/api/session/ses_a',
    'POST http://oc-close.test/api/session/ses_a/view',
    'POST http://oc-close.test/api/sessions/ses_a/view',
    'POST http://oc-close.test/api/openchamber/sessions/ses_a/metadata',
  ]);
  const lines = logLines('ses_a');
  expect(lines.some(l => l.text.includes('conversation marquée lue (time.viewed)'))).toBe(true);
  expect(lines.some(l => l.text.includes('In work retiré'))).toBe(true);
});

test('fermeture : aucun tour terminé (pas de time.idle) : ni vue OpenCode, ni échec', async () => {
  setBase(BASE);
  const calls = installFetch([
    sessionRoute('ses_noidle'),
    attentionRoute('ses_noidle'),
    workRoute('ses_noidle'),
  ]);
  const out = await markTaskSessionRead('ses_noidle');
  expect(out).toEqual({ read: true, workDone: true });
  expect(calls.filter(c => c.url.endsWith('/view'))).toHaveLength(1); // seul le badge OpenChamber
  expect(logLines('ses_noidle').some(l => l.text.includes('rien à marquer lu'))).toBe(true);
});

test('échec OpenChamber (réseau, 404) : la fonction résout, sans lever, et journalise', async () => {
  setBase(BASE);
  installFetch([
    { match: () => true, reply: () => 'throw' as unknown as Response },
  ]);
  // la fermeture de la tâche est écrite AVANT l'appel (ordre des deux chemins)
  upsertTaskState('ses_b', { closedAt: 123456, closure: 'terminé' });
  const out = await markTaskSessionRead('ses_b');
  expect(out).toEqual({ read: false, workDone: false });
  const lines = logLines('ses_b');
  expect(lines.filter(l => l.text.includes('échec best-effort OpenChamber')).length).toBeGreaterThanOrEqual(1);
  const st = state.getTaskState('ses_b') as { closed_at?: number } | null;
  expect(st?.closed_at).toBe(123456);
});

test('échec partiel : lu appliqué, In work refusé, le détail est journalisé', async () => {
  setBase(BASE);
  installFetch([
    sessionRoute('ses_c', 42),
    viewRoute('ses_c', 42),
    attentionRoute('ses_c'),
    { match: (url) => url.includes('/api/openchamber/sessions/ses_c/metadata'), reply: () => new Response('session ses_c was not found', { status: 500 }) },
  ]);
  const out = await markTaskSessionRead('ses_c');
  expect(out).toEqual({ read: true, workDone: false });
  const lines = logLines('ses_c');
  expect(lines.some(l => l.text.includes('retrait In work') && l.text.includes('500'))).toBe(true);
  expect(lines.some(l => l.text.includes('In work retiré'))).toBe(false);
});

test('pas de base câblée : refus immédiat, journalisé, sans lever', async () => {
  setBase('');
  const out = await markTaskSessionRead('ses_e');
  expect(out).toEqual({ read: false, workDone: false });
  expect(logLines('ses_e').some(l => l.text.includes('échec best-effort OpenChamber'))).toBe(true);
  setBase(BASE);
});
