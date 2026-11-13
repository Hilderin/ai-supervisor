/**
 * Tests des réponses des tâches au propriétaire (answers.mts + table
 * task_answer), après la migration « réponses natives session » (2026-11-13) :
 * le tool `answer` du plugin ne poste plus au daemon, la réponse vit dans le
 * tool part et le daemon la MOISSONNE (dédoublonnée par part_key).
 *
 * La base SQLite vit dans un dossier temporaire ; l'instance OpenChamber est
 * simulée par un serveur de test (le moissonnage lit /api/session/:id/message).
 */
import { describe, expect, test, afterAll } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SUPERVISEUR_DATA_DIR = mkdtempSync(join(tmpdir(), 'answers-test-'));

const state = await import('../src/state.mts');
const answers = await import('../src/answers.mts');
const { extractAnswers, harvestAnswers, invalidateAnswers, ackAnswers, listAnswers, unreadAnswerCounts, setBase } = answers;
const { db } = state;

// garde-fou anti-catastrophe (même règle que resume.test) : jamais la base réelle
const boundFile = (state.db as unknown as { query: Function }).query('pragma database_list').all()
  .map((r: { file?: string }) => r.file ?? '').join(',');
if (!boundFile.includes('answers-test-')) {
  process.exitCode = 1;
  throw new Error('answers.test : base SQLite non temporaire, on n\'écrit rien. Lancer ce fichier SEUL.');
}

const answerPart = (metadata: Record<string, unknown>) => ({
  type: 'tool', tool: 'answer', state: { status: 'completed', metadata },
});

describe('answers : extraction des tool parts', () => {
  test('nouveau format : metadata {ok, at, text, question}, ordonné par at', () => {
    const drafts = extractAnswers([
      { id: 'm2', content: [answerPart({ ok: true, at: 200, text: 'réponse 2' })] },
      { id: 'm1', content: [answerPart({ ok: true, at: 100, text: 'réponse 1', question: 'Q ?' })] },
    ], 'ses_x');
    expect(drafts.map(d => d.text)).toEqual(['réponse 1', 'réponse 2']);
    expect(drafts[0].question).toBe('Q ?');
    expect(drafts[1].question).toBeNull();
    expect(drafts[0].partKey).not.toBe(drafts[1].partKey);
  });

  test('ancien format (réponse daemon, sans text) et parts non answer ignorés', () => {
    const drafts = extractAnswers([
      { id: 'm1', content: [
        { type: 'tool', tool: 'shell', state: { status: 'completed', input: {} } },
        answerPart({ ok: true, taskId: 'x', answerId: 5, at: 100 }), // ancien format
        answerPart({ ok: true, at: 100, text: '   ' }), // vide : ignoré
      ] },
    ], 'ses_x');
    expect(drafts).toEqual([]);
  });
});

describe('answers : moissonnage et lecture', () => {
  const MESSAGES = [
    { id: 'm1', time: { created: 100 }, content: [answerPart({ ok: true, at: 100, text: 'réponse 1', question: 'Faut-il fixer le port ?' })] },
    { id: 'm2', time: { created: 200 }, content: [
      { type: 'tool', tool: 'shell', state: { status: 'completed', input: {} } },
      { type: 'tool', name: 'answer', state: { status: 'completed', metadata: { ok: true, at: 200, text: 'réponse 2' } } },
    ] },
  ];
  const server = Bun.serve({ port: 0, fetch: () => Response.json({ data: MESSAGES }) });

  afterAll(() => { server.stop(true); setBase(''); });

  test('harvest insère les réponses, journalise une fois, et reste idempotent', async () => {
    setBase(`http://127.0.0.1:${server.port}`);
    await harvestAnswers('ses_h1', 1);
    const rows = listAnswers('ses_h1');
    expect(rows.map(r => r.text)).toEqual(['réponse 1', 'réponse 2']);
    expect(rows[0].question).toBe('Faut-il fixer le port ?');
    expect(rows.every(r => r.read_at === null)).toBe(true);
    // le journal porte une entrée reply par réponse
    const log = db.query('SELECT text FROM task_log WHERE session_id = ? AND kind = ?').all('ses_h1', 'reply') as Array<{ text: string }>;
    expect(log.length).toBe(2);
    // re-moissonnage : aucun doublon (part_key), aucun journal en plus
    invalidateAnswers();
    await harvestAnswers('ses_h1', 2);
    expect(listAnswers('ses_h1').length).toBe(2);
    const log2 = db.query('SELECT text FROM task_log WHERE session_id = ? AND kind = ?').all('ses_h1', 'reply') as Array<{ text: string }>;
    expect(log2.length).toBe(2);
  });

  test('unreadAnswerCounts compte les non lues, puis retombe après Got it', () => {
    expect(unreadAnswerCounts().get('ses_h1')).toBe(2);
    const acked = ackAnswers('ses_h1');
    expect(acked).toBe(2);
    expect(unreadAnswerCounts().get('ses_h1')).toBeUndefined();
    // le journal reste lisible : les réponses sont gardées, marquées lues
    const all = listAnswers('ses_h1');
    expect(all.every(a => a.read_at != null)).toBe(true);
  });

  test('Got it par ids : seule la réponse visée est lue', async () => {
    setBase(`http://127.0.0.1:${server.port}`);
    invalidateAnswers();
    const MESSAGES_B = [
      { id: 'm1', content: [answerPart({ ok: true, at: 100, text: 'réponse A du test par ids' })] },
      { id: 'm2', content: [answerPart({ ok: true, at: 200, text: 'réponse B du test par ids' })] },
    ];
    server.stop(true);
    const serverB = Bun.serve({ port: 0, fetch: () => Response.json({ data: MESSAGES_B }) });
    setBase(`http://127.0.0.1:${serverB.port}`);
    await harvestAnswers('ses_h2', 1);
    const [a, b] = listAnswers('ses_h2');
    ackAnswers('ses_h2', [b.id]);
    const after = listAnswers('ses_h2');
    expect(after.find(x => x.id === a.id)?.read_at).toBeNull();
    expect(after.find(x => x.id === b.id)?.read_at).not.toBeNull();
    expect(unreadAnswerCounts().get('ses_h2')).toBe(1);
    serverB.stop(true);
  });
});

describe('migrateTaskSession', () => {
  test('les réponses moissonnées suivent la tâche sur sa nouvelle session', () => {
    state.migrateTaskSession('ses_h1', 'ses_new');
    expect(listAnswers('ses_h1')).toEqual([]);
    expect(listAnswers('ses_new').length).toBe(2);
    expect(unreadAnswerCounts().get('ses_new')).toBeUndefined(); // lues par Got it global
  });
});

describe('plugin superviseur-task : câblage du tool answer', () => {
  test('execute rend {ok, at, text, question} dans le metadata, sans daemon', async () => {
    const adds: Array<Record<string, unknown>> = [];
    const ctx = {
      tool: {
        transform: async (fn: (editor: { add: (t: Record<string, unknown>) => void }) => Promise<void>) => {
          await fn({ add: (t) => adds.push(t) });
        },
      },
    };
    const plugin = (await import('../plugin/superviseur-task/index.js')).default;
    await plugin.setup(ctx);
    expect(adds.map(t => t.name)).toEqual(['answer']);
    const tool = adds[0] as { execute: (i: unknown, c: unknown) => Promise<{ metadata: Record<string, unknown> }> };
    const ok = await tool.execute({ text: 'Oui, le port est fixe', question: 'Faut-il fixer le port ?' }, { sessionID: 'ses_p' });
    expect(ok.metadata).toMatchObject({ ok: true, text: 'Oui, le port est fixe', question: 'Faut-il fixer le port ?' });
    expect((ok.metadata.at as number)).toBeGreaterThan(0);
    // sans question : rattachement NULL
    const noQ = await tool.execute({ text: 'Point relu.' }, { sessionID: 'ses_p' });
    expect(noQ.metadata.question).toBeNull();
    // réponse vide : erreur structurée
    const bad = await tool.execute({ text: '   ' }, { sessionID: 'ses_p' });
    expect(bad.metadata).toMatchObject({ ok: false, error: 'invalid' });
  });
});
