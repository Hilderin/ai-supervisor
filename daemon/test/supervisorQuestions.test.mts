import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * `GET /api/supervisor` doit exposer la question du tool `question` en attente
 * et rattacher son message, pour que le chat la dessine comme une carte
 * répondable. Aucune écriture de message n'est ajoutée : tout vient de
 * `/api/sessions/status` et du listing OpenChamber.
 */
const root = await mkdtemp(join(tmpdir(), 'superviseur-question-'));
process.env.SUPERVISEUR_DATA_DIR = join(root, 'data');
process.env.SUPERVISEUR_HOME = join(root, 'home');

const SESSION = 'ses_chat_question';
let AGENT = 'superviseur-orchestrateur-test';

let server: ReturnType<typeof Bun.serve> | null = null;
let state: typeof import('../src/state.mts');
let supervisor: typeof import('../src/supervisor.mts');

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const path = url.pathname;
      if (path === '/api/opencode/trust') return Response.json({ trusted: true });
      if (path === '/api/session' && req.method === 'GET') {
        return Response.json({
          data: [{ id: SESSION, location: { directory: supervisor.SUPERVISOR_DIR }, agent: AGENT }],
        });
      }
      if (path === `/api/session/${SESSION}` && req.method === 'GET') {
        return Response.json({
          data: { id: SESSION, agent: AGENT, location: { directory: supervisor.SUPERVISOR_DIR } },
        });
      }
      if (path === `/api/session/${SESSION}/message`) {
        return Response.json({
          data: [
            {
              id: 'msg_1',
              type: 'assistant',
              time: { created: 1_000 },
              content: [
                { type: 'text', text: 'Je peux lancer la tâche.' },
                {
                  type: 'tool',
                  tool: 'question',
                  state: {
                    status: 'completed',
                    metadata: { ok: true },
                    input: { question: 'Quelle suite ?' },
                  },
                },
              ],
            },
          ],
        });
      }
      if (path === '/api/sessions/status') {
        return Response.json({
          sessions: { [SESSION]: { status: 'idle', lastUpdateAt: 1_000 } },
          pending: {
            [SESSION]: {
              forms: [
                {
                  id: 'form_1',
                  sessionID: SESSION,
                  title: 'Quelle suite ?',
                  metadata: { kind: 'question', tool: { messageID: 'msg_1', id: 'prt_1' } },
                  fields: [{
                    key: 'q0',
                    title: 'Quelle suite ?',
                    type: 'string',
                    options: [{ value: 'lancer', label: 'Lancer' }, { value: 'attendre', label: 'Attendre' }],
                  }],
                },
                {
                  id: 'perm_1',
                  sessionID: SESSION,
                  metadata: { kind: 'permission' },
                },
              ],
            },
          },
        });
      }
      if (path === '/api/message-queue') return Response.json({ sessions: [] });
      if (path.endsWith('/metadata')) return Response.json({ ok: true });
      return new Response('not found', { status: 404 });
    },
  });

  state = await import('../src/state.mts');
  supervisor = await import('../src/supervisor.mts');
  const main = state.db.query('PRAGMA database_list').all() as Array<{ name: string; file: string }>;
  const file = main.find((d) => d.name === 'main')?.file ?? '';
  if (!file.startsWith(root)) throw new Error(`test lié à une base non temporaire : ${file}`);

  supervisor.setBase(`http://127.0.0.1:${server.port}`);
  AGENT = state.ORCHESTRATOR_AGENT;
  state.setSupervisorSession({
    ocSessionId: SESSION,
    agent: AGENT,
    title: 'Superviseur',
  });
});

afterAll(async () => {
  server?.stop(true);
  // Windows garde parfois le dossier temp verrouillé (base SQLite) : le
  // nettoyage est best-effort, l'échec ne doit pas marquer le test en échec
  try { await rm(root, { recursive: true, force: true, maxRetries: 5 }); } catch { /* dossier verrouillé */ }
});

describe('GET /api/supervisor : questions du tool question', () => {
  test('expose la question en attente, rattachée à son message, et ignore les permissions', async () => {
    const out = await supervisor.getSupervisorState();
    expect(out.error).toBeUndefined();
    expect(out.sessionId).toBe(SESSION);
    expect(out.pendingForms).toHaveLength(1);
    expect(out.pendingForms[0]?.id).toBe('form_1');
    expect(out.pendingForms[0]?.metadata?.tool?.messageID).toBe('msg_1');
    expect(out.pendingForms[0]?.fields?.[0]?.options?.map((o) => o.label)).toEqual(['Lancer', 'Attendre']);
  });

  test('le message porte le tool question avec un libellé lisible', async () => {
    const out = await supervisor.getSupervisorState();
    const message = out.messages.find((m) => m.id === 'msg_1');
    expect(message?.text).toBe('Je peux lancer la tâche.');
    expect(message?.tools).toEqual([
      { name: 'question', status: 'completed', label: 'a posé une question', ok: true },
    ]);
  });
});
