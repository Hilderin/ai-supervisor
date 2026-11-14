import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Deux évolutions du chat de supervision (2026-11-14) :
 * - marquage lu : la conversation est marquée lue dans OpenChamber à la fin du
 *   tour (transition busy → idle vue par le poll de flotte du daemon) ;
 * - nommage : « Superviseur AAAA-MM-JJ HH:mm » au lieu de « Superviseur »,
 *   y compris pour une conversation existante restée au nom générique.
 */
const root = await mkdtemp(join(tmpdir(), 'superviseur-turn-'));
process.env.SUPERVISEUR_DATA_DIR = join(root, 'data');
process.env.SUPERVISEUR_HOME = join(root, 'home');

const SESSION = 'ses_chat_turn';
/** Création fixe : 2026-11-14 14:32 heure locale. */
const CREATED = new Date(2026, 10, 14, 14, 32, 5).getTime();

interface Call {
  method: string;
  path: string;
  body?: unknown;
}
const calls: Call[] = [];

let server: ReturnType<typeof Bun.serve> | null = null;
let state: typeof import('../src/state.mts');
let supervisor: typeof import('../src/supervisor.mts');
let title: typeof import('../src/supervisor-title.mts');

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const path = url.pathname;
      let body: unknown;
      if (req.method !== 'DELETE' && req.method !== 'GET') {
        const raw = await req.text();
        body = raw ? JSON.parse(raw) : undefined;
      }
      calls.push({ method: req.method, path: `${path}${url.search}`, body });
      if (path === '/api/opencode/trust') return Response.json({ trusted: true });
      if (path === `/api/session/${SESSION}` && req.method === 'GET') {
        return Response.json({
          data: {
            id: SESSION,
            title: 'Superviseur',
            agent: state.ORCHESTRATOR_AGENT,
            location: { directory: supervisor.SUPERVISOR_DIR },
            time: { created: CREATED, idle: 4_000 },
          },
        });
      }
      if (path === `/api/session/${SESSION}` && req.method === 'PATCH') return new Response(null, { status: 204 });
      if (path === `/api/session/${SESSION}/message`) return Response.json({ data: [] });
      if (path === `/api/session/${SESSION}/view` && req.method === 'POST') return new Response(null, { status: 204 });
      if (path === `/api/sessions/${SESSION}/view` && req.method === 'POST') return new Response(null, { status: 204 });
      if (path === `/api/session/${SESSION}/prompt` && req.method === 'POST') return Response.json({ ok: true });
      if (path === '/api/sessions/status') return Response.json({ sessions: {}, pending: {} });
      if (path === '/api/message-queue') return Response.json({ sessions: [] });
      if (path.endsWith('/metadata')) return Response.json({ ok: true });
      if (path.startsWith('/api/experimental/session/')) return new Response(null, { status: 204 });
      return new Response('not found', { status: 404 });
    },
  });

  state = await import('../src/state.mts');
  supervisor = await import('../src/supervisor.mts');
  title = await import('../src/supervisor-title.mts');
  const main = state.db.query('PRAGMA database_list').all() as Array<{ name: string; file: string }>;
  const file = main.find((d) => d.name === 'main')?.file ?? '';
  if (!file.startsWith(root)) throw new Error(`test lié à une base non temporaire : ${file}`);

  supervisor.setBase(`http://127.0.0.1:${server.port}`);
  const ocSession = await import('../src/oc-session.mts');
  ocSession.setBase(`http://127.0.0.1:${server.port}`);
  state.setSupervisorSession({ ocSessionId: SESSION, agent: state.ORCHESTRATOR_AGENT, title: 'Superviseur' });
});

afterAll(async () => {
  server?.stop(true);
  try { await rm(root, { recursive: true, force: true, maxRetries: 5 }); } catch { /* dossier verrouillé */ }
});

beforeEach(() => {
  calls.length = 0;
});

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('nom des conversations', () => {
  test('porte la date et l’heure locales de création', () => {
    expect(title.supervisorTitle(CREATED)).toBe('Superviseur 2026-11-14 14:32');
    const other = new Date(2027, 0, 2, 9, 5, 0).getTime();
    expect(title.supervisorTitle(other)).toBe('Superviseur 2027-01-02 09:05');
  });

  test('le nom générique est reconnu, un nom choisi ne l’est pas', () => {
    expect(title.isGenericSupervisorTitle('Superviseur')).toBe(true);
    expect(title.isGenericSupervisorTitle(' superviseur ')).toBe(true);
    expect(title.isGenericSupervisorTitle('Superviseur (2)')).toBe(true);
    expect(title.isGenericSupervisorTitle('Superviseur 2026-11-14 14:32')).toBe(false);
    expect(title.isGenericSupervisorTitle('Revue de la flotte')).toBe(false);
    expect(title.isGenericSupervisorTitle(undefined)).toBe(false);
  });

  test('une conversation restée « Superviseur » est renommée avec SA date', async () => {
    await supervisor.sendSupervisor('bonjour');
    const patch = calls.find((c) => c.method === 'PATCH' && c.path === `/api/session/${SESSION}`);
    expect(patch).toBeTruthy();
    expect((patch!.body as { title?: string }).title).toBe('Superviseur 2026-11-14 14:32');
    // une seule fois : le poll suivant ne renomme pas à nouveau
    calls.length = 0;
    await supervisor.sendSupervisor('encore');
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });
});

describe('marquage lu à la fin du tour', () => {
  test('marque la conversation lue quand le tour passe de busy à idle', async () => {
    supervisor.notifySupervisorStatus({ [SESSION]: { status: 'busy' } });
    expect(calls.some((c) => c.path === `/api/session/${SESSION}/view`)).toBe(false);
    supervisor.notifySupervisorStatus({ [SESSION]: { status: 'idle' } });
    await waitFor(() => calls.some((c) => c.path === `/api/sessions/${SESSION}/view`));
    const viewed = calls.find((c) => c.method === 'POST' && c.path === `/api/session/${SESSION}/view`);
    expect(viewed).toBeTruthy();
    // l'état lu d'OpenCode porte la transition idle observée
    expect((viewed!.body as { idle?: number }).idle).toBe(4_000);
    expect(calls.some((c) => c.method === 'POST' && c.path === `/api/sessions/${SESSION}/view`)).toBe(true);
    // le chat ne touche pas au marqueur « In work » (pas de patch work:done)
    expect(calls.some((c) => c.path.endsWith('/metadata'))).toBe(false);
  });

  test('ne remarque pas une session déjà au repos', async () => {
    calls.length = 0;
    supervisor.notifySupervisorStatus({ [SESSION]: { status: 'idle' } });
    supervisor.notifySupervisorStatus({ [SESSION]: { status: 'idle' } });
    await new Promise((r) => setTimeout(r, 80));
    expect(calls.some((c) => c.path === `/api/sessions/${SESSION}/view`)).toBe(false);
  });

  test('ignore une autre session', async () => {
    calls.length = 0;
    supervisor.notifySupervisorStatus({ other: { status: 'busy' } });
    supervisor.notifySupervisorStatus({ other: { status: 'idle' } });
    await new Promise((r) => setTimeout(r, 80));
    expect(calls.some((c) => c.path.endsWith('/view'))).toBe(false);
  });
});
