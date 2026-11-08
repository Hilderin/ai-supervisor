import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Parcours réel de `ensureSupervisorSession` contre une fausse instance
 * OpenChamber : un changement de prompt doit basculer l'agent de la
 * conversation, jamais remplacer la session (le chat « disparaissait »).
 *
 * Imports dynamiques : l'environnement (base temporaire, dossier de
 * supervision) doit être posé AVANT le chargement de `state.mts`.
 */
const root = await mkdtemp(join(tmpdir(), 'superviseur-session-'));
process.env.SUPERVISEUR_DATA_DIR = join(root, 'data');
process.env.SUPERVISEUR_HOME = join(root, 'home');

interface Call { method: string; path: string; body: string }

const KEEP = 'ses_keep';
const OTHER = 'ses_other';
const ELSEWHERE = 'ses_elsewhere';
const NEW = 'ses_new';

let calls: Call[] = [];
/** agent réellement porté par la session côté « OpenChamber » (muté par /agent) */
let liveAgent = '';
let server: ReturnType<typeof Bun.serve> | null = null;
let state: typeof import('../src/state.mts');
let supervisor: typeof import('../src/supervisor.mts');
let agent = '';

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const path = url.pathname;
      const body = req.method === 'POST' ? await req.text() : '';
      calls.push({ method: req.method, path, body });
      if (path === '/api/opencode/trust') return Response.json({ trusted: true });
      if (path === '/api/session' && req.method === 'GET') return Response.json({ data: [] });
      if (path === `/api/session/${KEEP}` && req.method === 'GET') {
        return Response.json({ data: {
          id: KEEP,
          agent: liveAgent,
          location: { directory: supervisor.SUPERVISOR_DIR },
        } });
      }
      if (path === `/api/session/${OTHER}` && req.method === 'GET') {
        return Response.json({ data: {
          id: OTHER,
          agent: liveAgent,
          location: { directory: supervisor.SUPERVISOR_DIR },
        } });
      }
      if (path === `/api/session/${ELSEWHERE}` && req.method === 'GET') {
        return Response.json({ data: {
          id: ELSEWHERE,
          agent: 'build',
          location: { directory: '/tmp/autre-projet' },
        } });
      }
      if (path === `/api/session/${KEEP}/agent` && req.method === 'POST') {
        liveAgent = (JSON.parse(body) as { agent?: string }).agent ?? liveAgent;
        return new Response(null, { status: 204 });
      }
      if (path === '/api/openchamber/sessions' && req.method === 'POST') {
        return Response.json({ sessionId: NEW }, { status: 201 });
      }
      if (path.endsWith('/metadata')) return Response.json({ ok: true });
      return new Response('not found', { status: 404 });
    },
  });

  state = await import('../src/state.mts');
  supervisor = await import('../src/supervisor.mts');
  // garde-fou : si un autre fichier de test a déjà lié `state.mts`, l'import
  // dynamique réutilise sa base (la production). On refuse de continuer.
  const main = state.db.query('PRAGMA database_list').all() as Array<{ name: string; file: string }>;
  const file = main.find((d) => d.name === 'main')?.file ?? '';
  if (!file.startsWith(root)) throw new Error(`test lié à une base non temporaire : ${file}`);

  supervisor.setBase(`http://127.0.0.1:${server.port}`);
  agent = state.orchestratorNameFor(state.getOrchestratorVersion());
});

afterAll(async () => {
  server?.stop(true);
  await rm(root, { recursive: true, force: true });
});

const postsTo = (pattern: RegExp) => calls.filter((c) => c.method === 'POST' && pattern.test(c.path));

describe('ensureSupervisorSession : le prompt change, la conversation reste', () => {
  test('un agent différent bascule en place et ne recrée pas la session', async () => {
    calls = [];
    liveAgent = 'superviseur-orchestrateur-00000001';
    state.setSupervisorSession({ ocSessionId: KEEP, agent: liveAgent, version: 1, title: 'Superviseur' });
    const out = await supervisor.ensureSupervisorSession();
    expect(out.id).toBe(KEEP);
    expect(out.agent).toBe(agent);
    const switched = postsTo(new RegExp(`/api/session/${KEEP}/agent$`));
    expect(switched).toHaveLength(1);
    expect(JSON.parse(switched[0]!.body)).toEqual({ agent });
    expect(postsTo(/\/api\/openchamber\/sessions$/)).toHaveLength(0);
    const stored = state.getSupervisorSession();
    expect(stored?.oc_session_id).toBe(KEEP);
    expect(stored?.agent).toBe(agent);
    expect(stored?.version).toBe(state.getOrchestratorVersion());
  });

  test('un agent déjà à jour est réutilisé sans bascule', async () => {
    calls = [];
    liveAgent = agent;
    state.setSupervisorSession({ ocSessionId: KEEP, agent, version: state.getOrchestratorVersion(), title: 'Superviseur' });
    const out = await supervisor.ensureSupervisorSession();
    expect(out.id).toBe(KEEP);
    expect(postsTo(/\/agent$/)).toHaveLength(0);
    expect(postsTo(/\/api\/openchamber\/sessions$/)).toHaveLength(0);
  });

  test('une session absente ou archivée fait créer une nouvelle conversation', async () => {
    calls = [];
    state.setSupervisorSession({ ocSessionId: 'ses_gone', agent, version: state.getOrchestratorVersion(), title: 'Superviseur' });
    const out = await supervisor.ensureSupervisorSession();
    expect(out.id).toBe(NEW);
    expect(postsTo(/\/api\/openchamber\/sessions$/)).toHaveLength(1);
    expect(state.getSupervisorSession()?.oc_session_id).toBe(NEW);
  });
});

describe('isSupervisorSession : le dossier fait foi', () => {
  test('la conversation courante et les autres conversations du dossier sont acceptées', async () => {
    state.setSupervisorSession({ ocSessionId: KEEP, agent, version: state.getOrchestratorVersion(), title: 'Superviseur' });
    expect(await supervisor.isSupervisorSession(KEEP)).toBe(true);
    expect(await supervisor.isSupervisorSession(OTHER)).toBe(true);
  });

  test('une session d’un autre projet est refusée', async () => {
    expect(await supervisor.isSupervisorSession(ELSEWHERE)).toBe(false);
    expect(await supervisor.isSupervisorSession('')).toBe(false);
  });
});
