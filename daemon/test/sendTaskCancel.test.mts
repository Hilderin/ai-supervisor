import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Message envoyé à une TÂCHE pendant qu'une question attend (tool `question`)
 * : la question est annulée (DELETE du formulaire + trace au journal de la
 * tâche) et le message part tout de suite en steer, jamais en file. C'est le
 * chemin de `send_task` (chat de supervision) et de `/api/fleet/send` (panel
 * de détail), qui partagent `pendingFor` + `cancelPendingForms`.
 */
const root = await mkdtemp(join(tmpdir(), 'superviseur-taskcancel-'));
process.env.SUPERVISEUR_DATA_DIR = join(root, 'data');
process.env.SUPERVISEUR_HOME = join(root, 'home');

const TASK = 'ses_task_question';
const TITLE = 'Tâche question en attente';
/** Bascule du mock : y a-t-il une question en attente ? */
let questionPending = true;

interface Call {
  method: string;
  path: string;
  body?: unknown;
}
const calls: Call[] = [];

let server: ReturnType<typeof Bun.serve> | null = null;
let state: typeof import('../src/state.mts');
let fleet: typeof import('../src/fleet.mts');
let tools: typeof import('../src/tools.mts');

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const path = url.pathname;
      const body = req.method === 'POST' ? await req.text().then(t => t ? JSON.parse(t) : undefined).catch(() => undefined) : undefined;
      calls.push({ method: req.method, path: `${path}${url.search}`, body });
      if (path === '/api/sessions/status') {
        return Response.json({
          sessions: { [TASK]: { status: 'busy', lastUpdateAt: 1_000 } },
          pending: questionPending
            ? {
                [TASK]: {
                  permissions: [],
                  forms: [
                    {
                      id: 'form_9',
                      sessionID: TASK,
                      title: 'On continue ?',
                      metadata: { kind: 'question', tool: { messageID: 'msg_1', id: 'prt_1' } },
                      fields: [{ key: 'q0', title: 'On continue ?', type: 'string' }],
                    },
                  ],
                },
              }
            : {},
        });
      }
      if (path === '/api/session' && url.search.includes('limit=200')) {
        return Response.json({
          data: [{ id: TASK, title: TITLE, location: { directory: join(root, 'projet') } }],
        });
      }
      if (path === `/api/session/${TASK}/message`) {
        return Response.json({ data: [] });
      }
      if (req.method === 'DELETE' && path === `/api/session/${TASK}/form/form_9`) {
        return Response.json({ ok: true });
      }
      if (path === `/api/session/${TASK}/prompt` && req.method === 'POST') {
        return Response.json({ ok: true });
      }
      return new Response('not found', { status: 404 });
    },
  });

  state = await import('../src/state.mts');
  fleet = await import('../src/fleet.mts');
  tools = await import('../src/tools.mts');
  const main = state.db.query('PRAGMA database_list').all() as Array<{ name: string; file: string }>;
  const file = main.find((d) => d.name === 'main')?.file ?? '';
  if (!file.startsWith(root)) throw new Error(`test lié à une base non temporaire : ${file}`);

  const base = `http://127.0.0.1:${server.port}`;
  fleet.setBase(base);
  // plan (enrichPlanProgress) et activité (enrichActivity) lisent aussi l'instance
  const { setBase: setPlanBase } = await import('../src/plan.mts');
  const { setActivityBase } = await import('../src/activity.mts');
  setPlanBase(base);
  setActivityBase(base);
  await fleet.pollOnce();
});

afterAll(async () => {
  server?.stop(true);
  try { await rm(root, { recursive: true, force: true, maxRetries: 5 }); } catch { /* dossier verrouillé */ }
});

describe('sendTask : question en attente', () => {
  test('la flotte porte la question en attente', () => {
    const row = fleet.currentFleet().rows.find((r) => r.id === TASK);
    expect(row).toBeTruthy();
    expect(row?.pendingForms.map((f) => f.id)).toEqual(['form_9']);
  });

  test('annule la question puis envoie le message en steer', async () => {
    calls.length = 0;
    const result = await tools.sendTask({ task: TASK, text: 'continue avec ça' });
    expect(result.ok).toBe(true);
    expect(result.cancelledQuestion).toBe('On continue ?');
    const cancelled = calls.find((c) => c.method === 'DELETE' && c.path.includes('/form/form_9'));
    expect(cancelled).toBeTruthy();
    expect(decodeURIComponent(cancelled!.path)).toContain('message=');
    const prompt = calls.find((c) => c.method === 'POST' && c.path.endsWith('/prompt'));
    expect(prompt).toBeTruthy();
    expect((prompt!.body as { delivery?: string }).delivery).toBe('steer');
    expect((prompt!.body as { text: string }).text).toContain('continue avec ça');
    // trace au journal de la TÂCHE (traçabilité exigée)
    const log = state.db
      .query('SELECT text FROM task_log WHERE session_id = ? AND kind = ? ORDER BY at DESC')
      .all(TASK, 'note') as Array<{ text: string }>;
    expect(log.some((row) => row.text.includes('question annulée par message'))).toBe(true);
    expect(log.some((row) => row.text.includes('continue avec ça'))).toBe(true);
  });

  test('sans question en attente, aucun DELETE ne part', async () => {
    // la question a été annulée au tour précédent : pending ne porte plus rien
    questionPending = false;
    await fleet.pollOnce();
    calls.length = 0;
    const result = await tools.sendTask({ task: TASK, text: 'message ordinaire' });
    expect(result.ok).toBe(true);
    expect(result.cancelledQuestion).toBeNull();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    const prompt = calls.find((c) => c.method === 'POST' && c.path.endsWith('/prompt'));
    expect(prompt).toBeTruthy();
    questionPending = true;
  });
});
