import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Envoi au chat de supervision quand une question du tool `question` attend :
 * le message annule la question (DELETE du formulaire, message d'abandon
 * consigné, trace au journal) puis part TOUT DE SUITE en steer, jamais en
 * file. Sans question en attente, le chemin normal est inchangé (pas de
 * delivery). Et la reprise d'un message en file (`take`) rend le texte
 * dépouillé de l'encadrement et les pièces jointes.
 */
const root = await mkdtemp(join(tmpdir(), 'superviseur-sendcancel-'));
process.env.SUPERVISEUR_DATA_DIR = join(root, 'data');
process.env.SUPERVISEUR_HOME = join(root, 'home');

const SESSION = 'ses_chat_cancel';
let AGENT = 'superviseur-orchestrateur-test';
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
let supervisor: typeof import('../src/supervisor.mts');

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const path = url.pathname;
      if (req.method !== 'DELETE') {
        const raw = await req.text();
        const body = raw ? JSON.parse(raw) : undefined;
        calls.push({ method: req.method, path: `${path}${url.search}`, body });
      } else {
        calls.push({ method: req.method, path: `${path}${url.search}` });
      }
      if (path === '/api/opencode/trust') return Response.json({ trusted: true });
      if (path === `/api/session/${SESSION}` && req.method === 'GET') {
        return Response.json({
          data: { id: SESSION, agent: AGENT, location: { directory: supervisor.SUPERVISOR_DIR } },
        });
      }
      if (path === `/api/session/${SESSION}/message`) {
        return Response.json({ data: [] });
      }
      if (path === '/api/sessions/status') {
        return Response.json({
          sessions: { [SESSION]: { status: questionPending ? 'busy' : 'idle', lastUpdateAt: 1_000 } },
          pending: questionPending
            ? {
                [SESSION]: {
                  forms: [
                    {
                      id: 'form_1',
                      sessionID: SESSION,
                      title: 'Quelle suite ?',
                      metadata: { kind: 'question', tool: { messageID: 'msg_1', id: 'prt_1' } },
                      fields: [{ key: 'q0', title: 'Quelle suite ?', type: 'string' }],
                    },
                    {
                      id: 'perm_1',
                      sessionID: SESSION,
                      metadata: { kind: 'permission' },
                    },
                  ],
                },
              }
            : {},
        });
      }
      if (req.method === 'DELETE' && path === `/api/session/${SESSION}/form/form_1`) {
        return Response.json({ ok: true });
      }
      if (req.method === 'DELETE' && path === `/api/session/${SESSION}/form/perm_1`) {
        // la permission ne doit JAMAIS être annulée par un envoi de message
        return new Response('forbidden', { status: 403 });
      }
      if (path === `/api/session/${SESSION}/prompt` && req.method === 'POST') {
        return Response.json({ ok: true });
      }
      if (path === '/api/message-queue') return Response.json({ sessions: [] });
      if (path === `/api/message-queue/sessions/${SESSION}/items/q1/take` && req.method === 'POST') {
        return Response.json({
          revision: 2,
          session: { sessionId: SESSION, directory: supervisor.SUPERVISOR_DIR, items: [], sendingId: null },
          item: {
            id: 'q1',
            createdAt: 42,
            content: 'texte encadré',
            text: 'texte encadré',
            attachments: [
              {
                id: 'att-1',
                filename: 'note.png',
                mimeType: 'image/png',
                size: 12,
                source: 'local',
                dataUrl: 'data:image/png;base64,AAAA',
              },
            ],
            sendConfig: { providerID: 'p', modelID: 'm' },
          },
        });
      }
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

describe('sendSupervisor : question en attente', () => {
  test('annule la question puis envoie le message en steer', async () => {
    await supervisor.sendSupervisor('réponds plutôt à ça');
    const cancelled = calls.find((c) => c.method === 'DELETE' && c.path.includes('/form/form_1'));
    expect(cancelled).toBeTruthy();
    expect(decodeURIComponent(cancelled!.path)).toContain('message=');
    expect(decodeURIComponent(cancelled!.path)).toContain('la question est annulée');
    // la permission n'est pas touchée
    expect(calls.some((c) => c.path.includes('/form/perm_1'))).toBe(false);
    const prompt = calls.find((c) => c.method === 'POST' && c.path.endsWith('/prompt'));
    expect(prompt).toBeTruthy();
    expect((prompt!.body as { delivery?: string }).delivery).toBe('steer');
    expect((prompt!.body as { text: string }).text).toContain('réponds plutôt à ça');
    // journal : l'annulation laisse une trace dans task_log (le chat journalise
    // sous l'id 'supervisor')
    const log = state.db
      .query('SELECT text FROM task_log WHERE session_id = ? AND kind = ? ORDER BY at DESC')
      .all('supervisor', 'note') as Array<{ text: string }>;
    expect(log.some((row) => row.text.includes('question annulée par message'))).toBe(true);
  });

  test('aucune question en attente : le chemin normal, sans champ delivery ni DELETE', async () => {
    questionPending = false;
    calls.length = 0;
    await supervisor.sendSupervisor('message ordinaire');
    const prompt = calls.find((c) => c.method === 'POST' && c.path.endsWith('/prompt'));
    expect(prompt).toBeTruthy();
    expect((prompt!.body as { delivery?: string }).delivery).toBeUndefined();
    expect((prompt!.body as { text: string }).text).toContain('message ordinaire');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    questionPending = true;
  });
});

describe('takeQueuedSupervisor : reprise d’un message en file', () => {
  test('rend le texte dépouillé et les pièces jointes, et retire l’item', async () => {
    const taken = await supervisor.takeQueuedSupervisor('q1');
    expect(taken.id).toBe('q1');
    expect(taken.text).toBe('texte encadré');
    expect(taken.at).toBe(42);
    expect(taken.attachments).toEqual([
      { id: 'att-1', name: 'note.png', mimeType: 'image/png', size: 12, dataUrl: 'data:image/png;base64,AAAA' },
    ]);
    const take = calls.find((c) => c.path.includes('/items/q1/take'));
    expect(take?.method).toBe('POST');
  });
});
