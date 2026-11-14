/**
 * Tests des rendus OpenChamber des tâches (renders.mts + table task_render),
 * même mécanisme que les réponses au propriétaire (answers.test.mts) : le
 * rendu vit dans le tool part `openchamber_render`, le daemon le MOISSONNE
 * dans task_render (dédoublonné par part_key).
 *
 * La base SQLite vit dans un dossier temporaire ; l'instance OpenChamber est
 * simulée par un serveur de test (le moissonnage lit /api/session/:id/message).
 */
import { describe, expect, test, afterAll } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SUPERVISEUR_DATA_DIR = mkdtempSync(join(tmpdir(), 'renders-test-'));

const state = await import('../src/state.mts');
const renders = await import('../src/renders.mts');
const { extractRenders, harvestRenders, invalidateRenders, ackRenders, listRenders, unreadRenderCounts, setBase } = renders;
const { db } = state;

// garde-fou anti-catastrophe (même règle que answers.test) : jamais la base réelle
const boundFile = (state.db as unknown as { query: Function }).query('pragma database_list').all()
  .map((r: { file?: string }) => r.file ?? '').join(',');
if (!boundFile.includes('renders-test-')) {
  process.exitCode = 1;
  throw new Error('renders.test : base SQLite non temporaire, on n\'écrit rien. Lancer ce fichier SEUL.');
}

const htmlPart = (html: string, title: string, ok = true) => ({
  type: 'tool',
  tool: 'openchamber_render',
  state: {
    status: 'completed',
    input: { action: 'render.page', parameters: { html, title } },
    metadata: { openchamber: { ok } },
  },
});

const uiPart = (ui: string, title?: string) => ({
  type: 'tool',
  name: 'openchamber_render',
  state: {
    status: 'completed',
    input: { action: 'render.page', parameters: { ui, ...(title ? { title } : {}) } },
    metadata: { openchamber: { ok: true } },
  },
});

describe('renders : extraction des tool parts', () => {
  test('page HTML et page ui capturées, titre et horodatage du message', () => {
    const drafts = extractRenders([
      { id: 'm2', time: { created: 200 }, content: [uiPart('root = Stack([])', 'Formulaire')] },
      { id: 'm1', time: { created: 100 }, content: [htmlPart('<h1>Ventes</h1>', 'Ventes')] },
    ], 'ses_x');
    expect(drafts.map(d => `${d.kind}:${d.title}`)).toEqual(['html:Ventes', 'ui:Formulaire']);
    expect(drafts[0].content).toBe('<h1>Ventes</h1>');
    expect(drafts[0].at).toBe(100);
    expect(drafts[0].partKey).not.toBe(drafts[1].partKey);
  });

  test('titre déduit de la page HTML quand il manque', () => {
    const [d] = extractRenders([
      { id: 'm1', time: { created: 1 }, content: [htmlPart('<html><head><title>Mon rapport</title></head><body></body></html>', '')] },
    ], 'ses_x');
    expect(d.title).toBe('Mon rapport');
  });

  test('rendu refusé, partiel, vide ou autre tool : ignorés', () => {
    const drafts = extractRenders([
      { id: 'm1', time: { created: 1 }, content: [
        { type: 'tool', tool: 'shell', state: { status: 'completed', input: {} } },
        htmlPart('<p>non</p>', 'Non', false), // refusé par OpenChamber
        { type: 'tool', tool: 'openchamber_render', state: { status: 'running', input: { parameters: { html: '<p>x</p>' } } } },
        { type: 'tool', tool: 'openchamber_render', state: { status: 'completed', input: { parameters: {} }, metadata: {} } },
        uiPart('   '),
      ] },
    ], 'ses_x');
    expect(drafts).toEqual([]);
  });
});

describe('renders : moissonnage et lecture', () => {
  const MESSAGES = [
    { id: 'm1', time: { created: 100 }, content: [htmlPart('<h1>Une</h1>', 'Rendu 1')] },
    { id: 'm2', time: { created: 200 }, content: [
      { type: 'tool', tool: 'shell', state: { status: 'completed', input: {} } },
      htmlPart('<h1>Deux</h1>', 'Rendu 2'),
    ] },
  ];
  const server = Bun.serve({ port: 0, fetch: () => Response.json({ data: MESSAGES }) });

  afterAll(() => { server.stop(true); setBase(''); });

  test('harvest insère les rendus, journalise une fois, et reste idempotent', async () => {
    setBase(`http://127.0.0.1:${server.port}`);
    await harvestRenders('ses_h1', 1);
    const rows = listRenders('ses_h1');
    expect(rows.map(r => r.title)).toEqual(['Rendu 1', 'Rendu 2']);
    expect(rows.every(r => r.kind === 'html')).toBe(true);
    expect(rows.every(r => r.read_at === null)).toBe(true);
    // le journal porte une entrée render par rendu
    const log = db.query('SELECT text FROM task_log WHERE session_id = ? AND kind = ?').all('ses_h1', 'render') as Array<{ text: string }>;
    expect(log.length).toBe(2);
    // re-moissonnage : aucun doublon (part_key), aucun journal en plus
    invalidateRenders();
    await harvestRenders('ses_h1', 2);
    expect(listRenders('ses_h1').length).toBe(2);
    const log2 = db.query('SELECT text FROM task_log WHERE session_id = ? AND kind = ?').all('ses_h1', 'render') as Array<{ text: string }>;
    expect(log2.length).toBe(2);
  });

  test('unreadRenderCounts compte les non vus, puis retombe au « Vu »', () => {
    expect(unreadRenderCounts().get('ses_h1')).toBe(2);
    const acked = ackRenders('ses_h1');
    expect(acked).toBe(2);
    expect(unreadRenderCounts().get('ses_h1')).toBeUndefined();
    // le rendu reste lisible, marqué vu
    expect(listRenders('ses_h1').every(r => r.read_at != null)).toBe(true);
  });

  test('« Vu » par ids : seul le rendu visé est marqué', async () => {
    invalidateRenders();
    const MESSAGES_B = [
      { id: 'm1', time: { created: 100 }, content: [htmlPart('<p>A</p>', 'A')] },
      { id: 'm2', time: { created: 200 }, content: [uiPart('root = Stack([])', 'B')] },
    ];
    server.stop(true);
    const serverB = Bun.serve({ port: 0, fetch: () => Response.json({ data: MESSAGES_B }) });
    setBase(`http://127.0.0.1:${serverB.port}`);
    await harvestRenders('ses_h2', 1);
    const [a, b] = listRenders('ses_h2');
    expect(b.kind).toBe('ui');
    ackRenders('ses_h2', [b.id]);
    const after = listRenders('ses_h2');
    expect(after.find(x => x.id === a.id)?.read_at).toBeNull();
    expect(after.find(x => x.id === b.id)?.read_at).not.toBeNull();
    expect(unreadRenderCounts().get('ses_h2')).toBe(1);
    serverB.stop(true);
  });
});

describe('migrateTaskSession', () => {
  test('les rendus moissonnés suivent la tâche sur sa nouvelle session', () => {
    state.migrateTaskSession('ses_h1', 'ses_new');
    expect(listRenders('ses_h1')).toEqual([]);
    expect(listRenders('ses_new').length).toBe(2);
    expect(unreadRenderCounts().get('ses_new')).toBeUndefined(); // vus par « Vu » global
  });
});
