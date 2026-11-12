/**
 * Tests du modèle propre à une tâche : lecture, changement à chaud,
 * persistance dans le brief et le registre de reprise, refus d'un modèle
 * inconnu.
 *
 * Fausse instance OpenChamber (Bun.serve) et base SQLite temporaire ; on
 * refuse de continuer si le module state a lié la vraie base.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'superviseur-task-model-'));
process.env.SUPERVISEUR_DATA_DIR = join(root, 'data');

interface Call { method: string; path: string; body: string }

const TASK = 'ses_task';
const LONE = 'ses_lone';

let calls: Call[] = [];
let server: ReturnType<typeof Bun.serve> | null = null;
let state: typeof import('../src/state.mts');
let models: typeof import('../src/models.mts');
let taskModel: typeof import('../src/task-model.mts');

let liveModel: { providerID: string; id: string } | null = { providerID: 'openai', id: 'gpt-strong' };
let failModelPost = false;
const modelCatalog = (): Array<Record<string, unknown>> => [
  { id: 'gpt-strong', modelID: 'gpt-strong', providerID: 'openai', name: 'GPT Strong', type: 'chat', enabled: true, status: 'active' },
  { id: 'gpt-fast', modelID: 'gpt-fast', providerID: 'openai', name: 'GPT Fast', type: 'chat', enabled: true, status: 'active' },
  { id: 'free', modelID: 'free', providerID: 'opencode', name: 'Free', type: 'chat', enabled: true, status: 'active' },
];

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const path = url.pathname;
      const body = req.method === 'POST' ? await req.text() : '';
      calls.push({ method: req.method, path, body });
      if (path === '/api/model') return Response.json({ data: modelCatalog() });
      if (path === '/api/provider') return Response.json({ data: [{ id: 'openai', name: 'OpenAI' }, { id: 'opencode', name: 'OpenCode' }] });
      if (path === '/api/agent') return Response.json({ data: [] });
      if (path === '/api/config/settings') return Response.json({ defaultModel: 'openai/gpt-fast' });
      if (path === `/api/session/${TASK}` && req.method === 'GET') {
        return Response.json({ data: { id: TASK, model: liveModel } });
      }
      if (path === `/api/session/${LONE}` && req.method === 'GET') {
        return Response.json({ data: { id: LONE, model: liveModel } });
      }
      if (path === `/api/session/${TASK}/model` && req.method === 'POST') {
        if (failModelPost) return new Response('refus', { status: 500 });
        const m = (JSON.parse(body) as { model?: { providerID?: string; id?: string } }).model;
        if (m?.providerID && m.id) liveModel = { providerID: m.providerID, id: m.id };
        return new Response(null, { status: 204 });
      }
      if (path === `/api/session/${LONE}/model` && req.method === 'POST') {
        return new Response(null, { status: 204 });
      }
      return new Response('not found', { status: 404 });
    },
  });

  state = await import('../src/state.mts');
  const main = state.db.query('PRAGMA database_list').all() as Array<{ name: string; file: string }>;
  const file = main.find(d => d.name === 'main')?.file ?? '';
  if (!file.startsWith(root)) throw new Error(`test lié à une base non temporaire : ${file}`);

  models = await import('../src/models.mts');
  taskModel = await import('../src/task-model.mts');
  models.setBase(`http://127.0.0.1:${server.port}`);
  taskModel.setBase(`http://127.0.0.1:${server.port}`);
});

afterAll(async () => {
  server?.stop(true);
  // la base SQLite ouverte verrouille le dossier sous Windows (EBUSY au rm)
  try { state.db.close(); } catch { /* déjà fermée */ }
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  calls = [];
  liveModel = { providerID: 'openai', id: 'gpt-strong' };
  failModelPost = false;
  models.resetCatalogCache();
  state.db.run('DELETE FROM task_brief; DELETE FROM task_resume; DELETE FROM task_state; DELETE FROM task_log;');
  state.putTaskBrief(TASK, {
    title: 'Tâche modèle', goal: 'g', doneCriteria: [], constraints: [],
    projectDir: '/projet', agent: 'build', model: 'openai/gpt-strong',
  });
  state.armTaskResume(TASK, {
    sessionId: TASK, title: 'Tâche modèle', projectDir: '/projet', agent: 'build', model: 'openai/gpt-strong',
  });
});

const posts = (pattern: RegExp) => calls.filter(c => c.method === 'POST' && pattern.test(c.path));
const bodyOf = (call: Call | undefined) => JSON.parse(call?.body ?? '{}') as Record<string, unknown>;

describe('lecture du modèle de la tâche', () => {
  test('renvoie la préférence, le modèle effectif et le catalogue', async () => {
    const info = await taskModel.getTaskModelInfo(TASK);
    expect(info.model).toBe('openai/gpt-strong');
    expect(info.effective).toBe('openai/gpt-strong');
    expect(info.name).toBe('GPT Strong');
    expect(info.defaultModel).toBe('openai/gpt-fast');
    expect(info.models.map(m => m.ref)).toContain('opencode/free');
  });

  test('une session absente laisse le modèle effectif nul mais garde la préférence', async () => {
    const info = await taskModel.getTaskModelInfo('ses_inconnue');
    expect(info.model).toBeNull();
    expect(info.effective).toBeNull();
    expect(info.models.length).toBe(3);
  });
});

describe('changement du modèle d’une tâche', () => {
  test('applique à la session puis persiste dans le brief et le registre', async () => {
    const result = await taskModel.setTaskModel(TASK, 'opencode/free');
    expect(result.ok).toBe(true);
    expect(result.persisted).toBe(true);
    expect(bodyOf(posts(/\/api\/session\/ses_task\/model$/)[0])).toEqual({
      model: { providerID: 'opencode', id: 'free' },
    });
    expect(state.getTaskBrief(TASK)?.model).toBe('opencode/free');
    expect(state.getTaskResumeBySession(TASK)?.model).toBe('opencode/free');
    expect(result.info?.model).toBe('opencode/free');
    expect(result.info?.effective).toBe('opencode/free');
    expect(result.info?.name).toBe('Free');
    // aucune session recréée
    expect(posts(/\/api\/openchamber\/sessions$/)).toHaveLength(0);
  });

  test('une valeur vide ramène la tâche au défaut de la session', async () => {
    const result = await taskModel.setTaskModel(TASK, '');
    expect(result.ok).toBe(true);
    expect(bodyOf(posts(/\/api\/session\/ses_task\/model$/)[0])).toEqual({
      model: { providerID: 'openai', id: 'gpt-fast' },
    });
    expect(state.getTaskBrief(TASK)?.model).toBeNull();
    expect(state.getTaskResumeBySession(TASK)?.model).toBeNull();
    expect(result.info?.model).toBeNull();
    expect(result.info?.effective).toBe('openai/gpt-fast');
  });

  test('un modèle inconnu est refusé sans toucher la session ni la tâche', async () => {
    const result = await taskModel.setTaskModel(TASK, 'inconnu/modele');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_model');
    expect(result.message).toContain('inconnu');
    expect(posts(/\/api\/session\/ses_task\/model$/)).toHaveLength(0);
    expect(state.getTaskBrief(TASK)?.model).toBe('openai/gpt-strong');
    expect(state.getTaskResumeBySession(TASK)?.model).toBe('openai/gpt-strong');
  });

  test('un refus de la session laisse la tâche intacte', async () => {
    failModelPost = true;
    const result = await taskModel.setTaskModel(TASK, 'opencode/free');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('apply_failed');
    expect(state.getTaskBrief(TASK)?.model).toBe('openai/gpt-strong');
  });

  test('sans brief ni registre, le modèle s’applique mais n’est pas conservé', async () => {
    const result = await taskModel.setTaskModel(LONE, 'opencode/free');
    expect(result.ok).toBe(true);
    expect(result.persisted).toBe(false);
    expect(posts(new RegExp(`/api/session/${LONE}/model$`))).toHaveLength(1);
    expect(state.getTaskBrief(LONE)).toBeNull();
  });
});
