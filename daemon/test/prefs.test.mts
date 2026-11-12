/**
 * Tests des préférences de modèles et d'agent (bouton config du chat).
 *
 * Fausse instance OpenChamber (Bun.serve) : catalogue de modèles, providers,
 * agents, et session de supervision vivante. Base SQLite temporaire, comme
 * resume.test : on refuse de continuer si le module state a lié la vraie base.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'superviseur-prefs-'));
process.env.SUPERVISEUR_DATA_DIR = join(root, 'data');
process.env.SUPERVISEUR_HOME = join(root, 'home');

interface Call { method: string; path: string; body: string }

const KEEP = 'ses_keep';
const COMP = 'ses_comp';

let calls: Call[] = [];
let server: ReturnType<typeof Bun.serve> | null = null;
let state: typeof import('../src/state.mts');
let models: typeof import('../src/models.mts');
let prefs: typeof import('../src/prefs.mts');
let supervisor: typeof import('../src/supervisor.mts');
let tools: typeof import('../src/tools.mts');

/** Modèles exposés : mutable pour simuler un modèle retiré du catalogue. */
let modelCatalog: Array<Record<string, unknown>> = [];
const baseModels = (): Array<Record<string, unknown>> => [
  { id: 'gpt-strong', modelID: 'gpt-strong', providerID: 'openai', name: 'GPT Strong', type: 'chat', enabled: true, status: 'active' },
  { id: 'gpt-fast', modelID: 'gpt-fast', providerID: 'openai', name: 'GPT Fast', type: 'chat', enabled: true, status: 'active' },
  { id: 'free', modelID: 'free', providerID: 'opencode', name: 'Free', type: 'chat', enabled: true, status: 'active' },
  { id: 'old', modelID: 'old', providerID: 'opencode', name: 'Old', type: 'chat', enabled: false, status: 'disabled' },
  { id: 'embed', modelID: 'embed', providerID: 'openai', name: 'Embed', type: 'embedding', enabled: true, status: 'active' },
  { id: 'judge', modelID: 'judge', providerID: 'openai', name: 'Judge', type: 'decision', enabled: true, status: 'active' },
  // source custom : OpenChamber ne pose pas de `type` (constaté sur Skytech)
  { id: 'DeepSeek-V4.1-Flash-1017', modelID: 'DeepSeek-V4.1-Flash-1017', providerID: 'skytech', name: 'DeepSeek-V4.1-Flash-1017', enabled: true, status: 'active' },
];

/** Session de supervision simulée : les POST /agent et /model la mutent. */
let live = { agent: 'build', model: { providerID: 'openai', id: 'gpt-fast' } as { providerID: string; id: string } };

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const path = url.pathname;
      const body = req.method === 'POST' ? await req.text() : '';
      calls.push({ method: req.method, path, body });
      if (path === '/api/model') return Response.json({ data: modelCatalog });
      if (path === '/api/provider') {
        return Response.json({ data: [{ id: 'openai', name: 'OpenAI' }, { id: 'opencode', name: 'OpenCode' }, { id: 'skytech', name: 'Skytech' }] });
      }
      if (path === '/api/agent') {
        return Response.json({ data: [
          { id: 'build', name: 'Build', mode: 'primary', hidden: false },
          { id: 'plan', name: 'Plan', mode: 'primary', hidden: false },
          { id: 'general', name: 'General', mode: 'subagent', hidden: false },
          { id: 'title', name: 'Title', mode: 'primary', hidden: true },
          { id: 'superviseur-orchestrateur', name: 'orchestrateur', mode: 'primary', hidden: false },
                            ] });
      }
      if (path === '/api/config/settings') return Response.json({ defaultModel: 'openai/gpt-fast' });
      if (path === `/api/session/${KEEP}` && req.method === 'GET') {
        return Response.json({ data: { id: KEEP, agent: live.agent, model: live.model, location: { directory: '/tmp' } } });
      }
      if (path === `/api/session/${KEEP}/model` && req.method === 'POST') {
        const m = (JSON.parse(body) as { model?: { providerID?: string; id?: string } }).model;
        if (m?.providerID && m.id) live.model = { providerID: m.providerID, id: m.id };
        return new Response(null, { status: 204 });
      }
      if (path === `/api/session/${KEEP}/agent` && req.method === 'POST') {
        const a = (JSON.parse(body) as { agent?: string }).agent;
        if (a) live.agent = a;
        return new Response(null, { status: 204 });
      }
      if (path === `/api/session/${COMP}/model` && req.method === 'POST') {
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
  prefs = await import('../src/prefs.mts');
  supervisor = await import('../src/supervisor.mts');
  tools = await import('../src/tools.mts');
  models.setBase(`http://127.0.0.1:${server.port}`);
  supervisor.setBase(`http://127.0.0.1:${server.port}`);
});

afterAll(async () => {
  server?.stop(true);
  // la base SQLite ouverte verrouille le dossier sous Windows (EBUSY au rm)
  try { state.db.close(); } catch { /* déjà fermée */ }
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  calls = [];
  modelCatalog = baseModels();
  live = { agent: 'build', model: { providerID: 'openai', id: 'gpt-fast' } };
  models.resetCatalogCache();
  prefs.resetPrefWarnings();
  state.db.run('DELETE FROM supervisor_pref; DELETE FROM supervisor_session; ');
});

const posts = (pattern: RegExp) => calls.filter(c => c.method === 'POST' && pattern.test(c.path));
const bodyOf = (call: Call | undefined) => JSON.parse(call?.body ?? '{}') as Record<string, unknown>;

describe('catalogue', () => {
  test('ne garde que les modèles de chat activés et les agents choisissables', async () => {
    const config = await prefs.getSupervisorConfig();
    expect(config.models.map(m => m.ref)).toEqual([
      'openai/gpt-fast', 'openai/gpt-strong', 'opencode/free', 'skytech/DeepSeek-V4.1-Flash-1017',
    ]);
    expect(config.models.find(m => m.ref === 'openai/gpt-strong')?.providerName).toBe('OpenAI');
    // un type absent vaut chat (source custom : Skytech) ; les autres types sont exclus
    expect(config.models.find(m => m.ref === 'skytech/DeepSeek-V4.1-Flash-1017')?.providerName).toBe('Skytech');
    expect(config.models.some(m => m.ref === 'openai/embed')).toBe(false);
    expect(config.models.some(m => m.ref === 'openai/judge')).toBe(false);
    // l'orchestrateur et les agents internes ne sont pas des choix
    expect(config.agents.map(a => a.id)).toEqual(['build', 'plan']);
  });

  test('un modèle sans type (source custom) est proposé comme un modèle de chat', async () => {
    modelCatalog = [
      { id: 'Untyped', providerID: 'skytech', name: 'Untyped', enabled: true, status: 'active' },
      { id: 'Typed', providerID: 'skytech', name: 'Typed', type: 'chat', enabled: true, status: 'active' },
      { id: 'Picture', providerID: 'skytech', name: 'Picture', type: 'image', enabled: true, status: 'active' },
    ];
    models.resetCatalogCache();
    const config = await prefs.getSupervisorConfig();
    expect(config.models.map(m => m.ref)).toEqual(['skytech/Typed', 'skytech/Untyped']);
    expect(config.models.find(m => m.ref === 'skytech/Untyped')?.providerName).toBe('Skytech');
  });

  test('sans préférence, tout est au défaut actuel', async () => {
    const config = await prefs.getSupervisorConfig();
    expect(config.prefs).toEqual({ chatModel: null, chatAgent: null, taskModel: null });
    expect(config.defaults.chatModel).toBe('openai/gpt-fast');
    expect(await prefs.chatAgentRef()).toBeNull();
    expect(await prefs.taskModelRef()).toBeNull();
  });
});

describe('sauvegarde et repli', () => {
  test('les trois modèles et l’agent sont indépendants et persistent', async () => {
    const saved = await prefs.saveSupervisorConfig({
      chatAgent: 'plan',
      chatModel: 'openai/gpt-strong',
      taskModel: 'opencode/free',
    });
    expect(saved.warnings).toEqual([]);
    expect(saved.prefs).toEqual({
      chatModel: 'openai/gpt-strong', chatAgent: 'plan',
      taskModel: 'opencode/free',
    });
    // relecture depuis la base, comme après un redémarrage
    const config = await prefs.getSupervisorConfig();
    expect(config.prefs).toEqual(saved.prefs);
    expect(await prefs.chatAgentRef()).toBe('plan');
    expect(await prefs.taskModelRef()).toBe('opencode/free');
  });

  test('une valeur inconnue retombe sur le défaut avec un avertissement clair', async () => {
    const saved = await prefs.saveSupervisorConfig({
      chatAgent: 'agent-fantome',
      chatModel: 'openai/inconnu',
      taskModel: 'provider-absent/modele',
    });
    expect(saved.prefs).toMatchObject({
      chatModel: null, chatAgent: null, taskModel: null,
    });
    expect(saved.warnings.map(w => w.field).sort()).toEqual(['chatAgent', 'chatModel', 'taskModel']);
    const byField = Object.fromEntries(saved.warnings.map(w => [w.field, w.message]));
    expect(byField.chatAgent).toContain('orchestrateur');
    expect(byField.chatModel).toContain('défaut');
    expect(byField.taskModel).toContain('défaut');
    expect((await prefs.getSupervisorConfig()).prefs.chatAgent).toBeNull();
  });

  test('une chaîne vide remet le défaut', async () => {
    await prefs.saveSupervisorConfig({ chatModel: 'openai/gpt-strong', taskModel: 'opencode/free' });
    const reset = await prefs.saveSupervisorConfig({ chatModel: '', taskModel: '' });
    expect(reset.prefs.chatModel).toBeNull();
    expect(reset.prefs.taskModel).toBeNull();
    expect(reset.warnings).toEqual([]);
  });

  test('un modèle retiré du catalogue ne part pas dans une tâche', async () => {
    await prefs.saveSupervisorConfig({ taskModel: 'opencode/free' });
    expect(await prefs.taskModelRef()).toBe('opencode/free');
    // l'instance ne propose plus ce modèle : la préférence retombe proprement
    modelCatalog = baseModels().filter(m => m.id !== 'free');
    models.resetCatalogCache();
    expect(await prefs.taskModelRef()).toBeNull();
    const stale = await prefs.getSupervisorConfig();
    expect(stale.prefs.taskModel).toBeNull();
    // le panneau reçoit un avertissement à l'ouverture, pas un repli muet
    expect(stale.warnings?.map(w => w.field)).toContain('taskModel');
    expect(stale.warnings?.find(w => w.field === 'taskModel')?.message).toContain('introuvable');
  });
});

describe('modèle d’une tâche au lancement', () => {
  test('sans préférence ni choix, aucune contrainte de modèle', async () => {
    expect(await tools.resolveTaskModel()).toEqual({ model: null, warning: null, requested: null });
  });

  test('la préférence « tâches » sert de défaut au lancement', async () => {
    await prefs.saveSupervisorConfig({ taskModel: 'opencode/free' });
    expect((await tools.resolveTaskModel()).model).toBe('opencode/free');
  });

  test('un modèle demandé et valide prime sur la préférence', async () => {
    await prefs.saveSupervisorConfig({ taskModel: 'opencode/free' });
    const out = await tools.resolveTaskModel('openai/gpt-strong');
    expect(out.model).toBe('openai/gpt-strong');
    expect(out.warning).toBeNull();
  });

  test('un modèle demandé inconnu replie sur la préférence avec un avertissement', async () => {
    await prefs.saveSupervisorConfig({ taskModel: 'opencode/free' });
    const out = await tools.resolveTaskModel('inconnu/modele');
    expect(out.model).toBe('opencode/free');
    expect(out.warning).toContain('inconnu');
    expect(out.warning).toContain('repli sur opencode/free');
  });

  test('un modèle demandé inconnu sans préférence laisse le défaut de la session', async () => {
    const out = await tools.resolveTaskModel('inconnu/modele');
    expect(out.model).toBeNull();
    expect(out.warning).toContain('défaut de la session');
  });
});

describe('application à chaud', () => {  test('le chat change d’agent et de modèle sans changer de session', async () => {
    state.setSupervisorSession({ ocSessionId: KEEP, agent: 'build', title: 'Superviseur' });
    await prefs.saveSupervisorConfig({ chatAgent: 'plan', chatModel: 'openai/gpt-strong' });

    const applied = await supervisor.applySupervisorChatConfig();

    expect(applied.sessionId).toBe(KEEP);
    expect(applied.applied).toBe(true);
    expect(applied.agent).toBe('plan');
    expect(applied.model).toBe('openai/gpt-strong');
    expect(bodyOf(posts(new RegExp(`/api/session/${KEEP}/agent$`))[0])).toEqual({ agent: 'plan' });
    expect(bodyOf(posts(new RegExp(`/api/session/${KEEP}/model$`))[0])).toEqual({
      model: { providerID: 'openai', id: 'gpt-strong' },
    });
    // l'id stocké et la session vivante restent les mêmes
    expect(state.getSupervisorSession()?.oc_session_id).toBe(KEEP);
    expect(live.agent).toBe('plan');
    expect(live.model).toEqual({ providerID: 'openai', id: 'gpt-strong' });
    // aucune création de session
    expect(posts(/\/api\/openchamber\/sessions$/)).toHaveLength(0);
  });

  test('revenir au défaut ramène l’orchestrateur et le modèle par défaut', async () => {
    state.setSupervisorSession({ ocSessionId: KEEP, agent: 'build', title: 'Superviseur' });
    await prefs.saveSupervisorConfig({ chatAgent: 'build', chatModel: 'openai/gpt-strong' });
    await prefs.saveSupervisorConfig({ chatAgent: '', chatModel: '' });

    const applied = await supervisor.applySupervisorChatConfig();
    expect(applied.applied).toBe(true);
    expect(applied.agent).toBe('superviseur-orchestrateur');
    expect(live.agent).toBe('superviseur-orchestrateur');
    expect(live.model).toEqual({ providerID: 'openai', id: 'gpt-fast' });
    expect(state.getSupervisorSession()?.oc_session_id).toBe(KEEP);
  });


});
