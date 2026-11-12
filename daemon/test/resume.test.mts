/**
 * Tests du mécanisme d'auto-restart (resume.mts + helpers task_resume).
 * La base SQLite vit dans un dossier temporaire : les tables sont vides,
 * chaque test y construit son état. L'instance OpenChamber est simulée par un
 * `fetch` de remplacement (pas une vraie instance dans les tests).
 */
import { describe, expect, test, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SUPERVISEUR_DATA_DIR = mkdtempSync(join(tmpdir(), 'resume-test-'));

console.log("RESUME_ENV_AT_IMPORT", process.env.SUPERVISEUR_DATA_DIR);
const state = await import('../src/state.mts');

// garde-fou anti-catastrophe : en batch (`bun test daemon/test`), state.mts peut
// avoir été évalué d'abord par un autre fichier, sans SUPERVISEUR_DATA_DIR, et
// alors pointer sur la vraie base. On refuse alors toute écriture : les tests
// suppriment des tables entières, jamais sur la base de production.
const boundFile = (state.db as unknown as { query: Function }).query('pragma database_list').all()
  .map((r: { file?: string }) => r.file ?? '').join(',');
if (!boundFile.includes('resume-test-')) {
  process.exitCode = 1;
  throw new Error(`resume.test : base SQLite ${boundFile} n'est pas une base de test : on n'écrit rien. Lancer ce fichier SEUL (for f in daemon/test/*.test.mts; do bun test "$f"; done)`);
}
const {
  armTaskResume, disableTaskResume, getTaskResume, getTaskBrief, getTaskState,
  listTaskBriefs, putTaskBrief, upsertTaskState, migrateTaskSession,
  noteResumeAlive, noteResumeAttempt, resetResumeAttempts, reviveTaskResume,
  logEvent, db,
} = state;

const resume = await import('../src/resume.mts');
const models = await import('../src/models.mts');
const {
  resumeConfigFromEnv, shouldRestartTask, nextBackoffMs, composeResumePrompt,
  sessionGone, resumeTick, resetResumeState, backfillResumeTasks,
} = resume;

const cfg = resumeConfigFromEnv();
const now = 1_700_000_000_000;

describe('config', () => {
  test('activée par défaut ; SUPERVISEUR_AUTO_RESTART=0/off la désactive', () => {
    expect(resumeConfigFromEnv({}).enabled).toBe(true);
    expect(resumeConfigFromEnv({ SUPERVISEUR_AUTO_RESTART: '0' }).enabled).toBe(false);
    expect(resumeConfigFromEnv({ SUPERVISEUR_AUTO_RESTART: 'off' }).enabled).toBe(false);
    expect(resumeConfigFromEnv({ SUPERVISEUR_AUTO_RESTART: '1' }).enabled).toBe(true);
  });

  test('les seuils env passent dans la config, un seuil illégal retombe sur le défaut', () => {
    const c = resumeConfigFromEnv({ SUPERVISEUR_AUTO_RESTART_MAX: '2', SUPERVISEUR_AUTO_RESTART_BACKOFF_MS: '500' });
    expect(c.maxAttempts).toBe(2);
    expect(c.backoffBaseMs).toBe(500);
    expect(resumeConfigFromEnv({ SUPERVISEUR_AUTO_RESTART_MAX: '0' }).maxAttempts).toBe(3);
  });
});

describe('garde-fous', () => {
  const base = {
    attempts: 0,
    lastAttemptAt: null as number | null,
    now,
    confirmedMissing: true,
    closed: false,
    disabled: false,
    modelResolved: true,
    cfg,
  };

  test('départ ok', () => {
    expect(shouldRestartTask(base)).toEqual({ restart: true, reason: 'ok' });
  });

  test('désactivée, fermée, modèle inconnu : non', () => {
    expect(shouldRestartTask({ ...base, disabled: true }).reason).toBe('disabled');
    expect(shouldRestartTask({ ...base, closed: true }).reason).toBe('closed');
    expect(shouldRestartTask({ ...base, modelResolved: false }).reason).toBe('no_model');
  });

  test('budget épuisé : non, définitivement', () => {
    const v = shouldRestartTask({ ...base, attempts: 3 });
    expect(v.restart).toBe(false);
    expect(v.reason).toBe('exhausted');
  });

  test('backoff croissant, bloquant tant que le délai n’est pas écoulé', () => {
    expect(nextBackoffMs(1, cfg)).toBe(30_000);
    expect(nextBackoffMs(2, cfg)).toBe(60_000);
    expect(nextBackoffMs(40, cfg)).toBeLessThanOrEqual(10 * 60_000);
    const v = shouldRestartTask({ ...base, attempts: 1, lastAttemptAt: now - 10_000 });
    expect(v.restart).toBe(false);
    expect(v.reason).toBe('backoff');
    expect(v.waitMs).toBeGreaterThan(0);
    // deux essais : le délai double (120 s) ; passé ce délai, ça repart
    expect(shouldRestartTask({ ...base, attempts: 2, lastAttemptAt: now - 61_000 }).restart).toBe(false);
    expect(shouldRestartTask({ ...base, attempts: 2, lastAttemptAt: now - 121_000 }).restart).toBe(true);
  });
});

describe('prompt de reprise', () => {
  test('porte les critères, le plan et le contexte de reprise', () => {
    const p = composeResumePrompt({
      goal: 'Livrer X',
      doneCriteria: ['a', 'b'],
      constraints: ['ne rien casser'],
      project: 'proj',
      plan: [{ step: 'Étape 1', done: true }, { step: 'Étape 2', done: false }],
      summary: 'résumé précédent',
    });
    expect(p).toContain('Objectif : Livrer X');
    expect(p).toContain('- a');
    expect(p).toContain('(fait) Étape 1');
    expect(p).toContain('(à refaire si besoin) Étape 2');
    expect(p).toContain('session précédente');
    expect(p).toContain('résumé précédent');
  });
});

describe('registre task_resume', () => {
  beforeEach(() => {
    console.log('RESUME_DB_FILES', (db as any).query('pragma database_list').all().map((d: any) => d.file));
    db.run('DELETE FROM task_resume; DELETE FROM task_brief; DELETE FROM task_state; DELETE FROM task_log;');
    resetResumeState();
    models.resetCatalogCache();
  });

  test('armement, suivi de vie, tentative', () => {
    armTaskResume('ses_a', { sessionId: 'ses_a', title: 'T', projectDir: '/p', agent: 'build' });
    noteResumeAlive('ses_a', now);
    let row = getTaskResume('ses_a')!;
    expect(row.session_id).toBe('ses_a');
    expect(row.session_since).toBe(now);
    noteResumeAttempt('ses_a', { newSessionId: 'ses_b', at: now + 1000 });
    row = getTaskResume('ses_a')!;
    expect(row.session_id).toBe('ses_b');
    expect(row.attempts).toBe(1);
    expect(row.session_since).toBeNull();
    resetResumeAttempts('ses_a', now + 2000);
    expect(getTaskResume('ses_a')!.attempts).toBe(0);
  });

  test('désactivation puis réveil par une écriture humaine', () => {
    armTaskResume('ses_a', { sessionId: 'ses_a', title: 'T', projectDir: '/p' });
    disableTaskResume('ses_a', 'budget épuisé', now);
    expect(getTaskResume('ses_a')!.disabled_at).toBe(now);
    reviveTaskResume('ses_a');
    const row = getTaskResume('ses_a')!;
    expect(row.disabled_at).toBeNull();
    expect(row.attempts).toBe(0);
  });

  test('migration de carte : tout suit vers la nouvelle session, jamais en double', () => {
    putTaskBrief('ses_a', { title: 'Reprise test', goal: 'g', doneCriteria: ['c'], constraints: [], projectDir: '/p', agent: 'build' });
    upsertTaskState('ses_a', { title: 'Reprise test', goal: 'g' });
    // plus de verdict (compagnon retiré) : la reprise lit les réponses answer
    logEvent('ses_a', 'open', 'lancement');
    armTaskResume('ses_a', { sessionId: 'ses_a', title: 'Reprise test', projectDir: '/p' });

    migrateTaskSession('ses_a', 'ses_b');

    // le registre suit la tâche
    expect(getTaskResume('ses_a')!.session_id).toBe('ses_b');
    // brief et état déplacés : rien ne reste au vieil id
    expect(getTaskBrief('ses_b')?.title).toBe('Reprise test');
    expect(getTaskBrief('ses_a')).toBeNull();
    expect(getTaskState('ses_b')?.title).toBe('Reprise test');
    const logsOld = db.query('SELECT COUNT(*) c FROM task_log WHERE session_id = ?').get('ses_a') as { c: number };
    const logsNew = db.query('SELECT COUNT(*) c FROM task_log WHERE session_id = ?').get('ses_b') as { c: number };
    expect(logsOld.c).toBe(0);
    expect(logsNew.c).toBe(1);
  });
});

/* --- E2E : boucle de reprise avec instance simulée --- */

interface FetchCall { url: string; init?: RequestInit }

type Rule = { match: string | RegExp; status?: number; body: unknown };

function fakeFetch(routes: Rule[], calls: FetchCall[]) {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    const rule = routes.find(r => (typeof r.match === 'string' ? url.includes(r.match) : r.match.test(url)));
    if (!rule) return new Response('not found', { status: 404 });
    if (rule.status && rule.status >= 400) return new Response('err', { status: rule.status });
    return new Response(JSON.stringify(rule.body), { status: rule.status ?? 200 });
  }) as typeof fetch;
}

/** Reconstruction du verbe HTTP pour les assertions de POST/GET. */
function callsTo(calls: FetchCall[], fragment: string): FetchCall[] {
  return calls.filter(c => c.url.includes(fragment));
}

describe('resumeTick de bout en bout', () => {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    db.run('DELETE FROM task_resume; DELETE FROM task_brief; DELETE FROM task_state; DELETE FROM task_log;');
    calls.length = 0;
    resetResumeState();
  });

  test('une session détruite et confirmée repart sur une nouvelle session, modèle default', async () => {
    putTaskBrief('ses_gone', { title: 'Analyse X', goal: 'g', doneCriteria: ['c'], constraints: [], projectDir: '/proj', agent: 'build' });
    upsertTaskState('ses_gone', { title: 'Analyse X', goal: 'g' });
    // le « dernier bilan connu » de la reprise est la dernière réponse answer
    db.run('INSERT INTO task_answer (session_id, at, text, question, read_at) VALUES (?, ?, ?, NULL, NULL)', ['ses_gone', 1, 'dernier résumé']);
    logEvent('ses_gone', 'open', 'lancement');
    armTaskResume('ses_gone', { sessionId: 'ses_gone', title: 'Analyse X', projectDir: '/proj', agent: 'build' });

    const tickCfg = { ...cfg, confirmMissingMs: 0, backoffBaseMs: 60_000 };
    globalThis.fetch = fakeFetch([
      { match: '/api/session/ses_gone', status: 404 },
      { match: '/api/config/settings', body: { defaultModel: 'provider-x/model-y' } },
      { match: '/api/openchamber/sessions', body: { sessionId: 'ses_fresh' } },
    ], calls);

    const stats = await resumeTick(new Set(['ses_live', 'ses_other']), tickCfg);

    expect(stats.restarted).toEqual([{ task: 'ses_gone', from: 'ses_gone', to: 'ses_fresh' }]);
    const row = getTaskResume('ses_gone')!;
    expect(row.session_id).toBe('ses_fresh');
    expect(row.attempts).toBe(1);
    expect(getTaskBrief('ses_fresh')?.title).toBe('Analyse X');
    // le prompt portait le modèle default courant et le contexte de reprise
    const create = callsTo(calls, '/api/openchamber/sessions')[0];
    const body = JSON.parse(String(create.init!.body));
    expect(body.model).toBe('provider-x/model-y');
    expect(body.directory).toBe('/proj');
    expect(body.prompt).toContain('Reprise automatique');
    expect(body.prompt).toContain('dernier résumé');

    // tout de suite après : la tentative fraîche bloque un second départ (backoff)
    const before = calls.length;
    await resumeTick(new Set(['ses_live']), tickCfg);
    expect(calls.length - before).toBe(1); // une seule lecture (sessionGone), aucune création
    expect(callsTo(calls, '/api/openchamber/sessions')).toHaveLength(1);

    // la nouvelle session vivante met à jour le suivi
    await resumeTick(new Set(['ses_fresh']), tickCfg);
    expect(getTaskResume('ses_gone')!.session_since).toBeGreaterThan(0);

    globalThis.fetch = originalFetch;
  });

  test('la reprise utilise le modèle propre à la tâche, pas le réglage global', async () => {
    putTaskBrief('ses_task_model', {
      title: 'Modèle de tâche', goal: 'g', doneCriteria: [], constraints: [],
      projectDir: '/proj', agent: 'build', model: 'task/model',
    });
    upsertTaskState('ses_task_model', { title: 'Modèle de tâche', goal: 'g' });
    armTaskResume('ses_task_model', {
      sessionId: 'ses_task_model', title: 'Modèle de tâche', projectDir: '/proj',
      agent: 'build', model: 'task/model',
    });
    // un réglage global différent ne doit pas écraser le modèle de la tâche
    state.setSupervisorPref({
      chatModel: null, chatAgent: null, taskModel: 'global/model',
    });
    const tickCfg = { ...cfg, confirmMissingMs: 0 };
    globalThis.fetch = fakeFetch([
      { match: '/api/session/ses_task_model', status: 404 },
      { match: '/api/model', body: { data: [
        { id: 'model', modelID: 'model', providerID: 'task', name: 'Tâche', type: 'chat', enabled: true, status: 'active' },
        { id: 'model', modelID: 'model', providerID: 'global', name: 'Global', type: 'chat', enabled: true, status: 'active' },
      ] } },
      { match: '/api/provider', body: { data: [] } },
      { match: '/api/agent', body: { data: [] } },
      { match: '/api/openchamber/sessions', body: { sessionId: 'ses_task_model2' } },
    ], calls);

    const stats = await resumeTick(new Set(['ses_live']), tickCfg);

    expect(stats.restarted).toHaveLength(1);
    const create = callsTo(calls, '/api/openchamber/sessions')[0];
    expect(JSON.parse(String(create.init!.body)).model).toBe('task/model');
    globalThis.fetch = originalFetch;
  });

  test('sans modèle de tâche, la reprise suit le défaut, jamais le réglage global', async () => {
    putTaskBrief('ses_no_model', { title: 'Sans modèle', goal: 'g', doneCriteria: [], constraints: [], projectDir: '/proj' });
    upsertTaskState('ses_no_model', { title: 'Sans modèle', goal: 'g' });
    armTaskResume('ses_no_model', { sessionId: 'ses_no_model', title: 'Sans modèle', projectDir: '/proj' });
    state.setSupervisorPref({
      chatModel: null, chatAgent: null, taskModel: 'global/model',
    });
    const tickCfg = { ...cfg, confirmMissingMs: 0 };
    globalThis.fetch = fakeFetch([
      { match: '/api/session/ses_no_model', status: 404 },
      { match: '/api/config/settings', body: { defaultModel: 'provider-x/model-y' } },
      { match: '/api/openchamber/sessions', body: { sessionId: 'ses_no_model2' } },
    ], calls);

    await resumeTick(new Set(['ses_live']), tickCfg);

    const create = callsTo(calls, '/api/openchamber/sessions')[0];
    expect(JSON.parse(String(create.init!.body)).model).toBe('provider-x/model-y');
    globalThis.fetch = originalFetch;
  });

  test('une session vivante ne déclenche rien et arme le suivi', async () => {
    putTaskBrief('ses_alive', { title: 'Vivante', goal: 'g', doneCriteria: [], constraints: [], projectDir: '/p' });
    const tickCfg = { ...cfg, confirmMissingMs: 0 };
    globalThis.fetch = fakeFetch([
      { match: '/api/session/ses_alive', body: { data: { id: 'ses_alive', time: {} } } },
    ], calls);

    await resumeTick(new Set(['ses_alive']), tickCfg);

    expect(callsTo(calls, '/api/openchamber/sessions')).toEqual([]);
    const row = getTaskResume('ses_alive');
    expect(row?.session_id).toBe('ses_alive');
    expect(row?.last_seen_at).toBeGreaterThan(0);
    globalThis.fetch = originalFetch;
  });

  test('crash répété : le budget sature puis la tâche est désactivée (pas de boucle)', async () => {
    putTaskBrief('ses_loop', { title: 'Boucle', goal: 'g', doneCriteria: [], constraints: [], projectDir: '/p' });
    armTaskResume('ses_loop', { sessionId: 'ses_loop', title: 'Boucle', projectDir: '/p' });
    const tickCfg = { ...cfg, confirmMissingMs: 0, backoffBaseMs: 0, maxAttempts: 2 };
    globalThis.fetch = fakeFetch([
      { match: '/api/session/ses_loop', status: 404 },
      { match: '/api/session/ses_loop2', status: 404 },
      { match: '/api/config/settings', body: { defaultModel: 'p/m' } },
      { match: '/api/openchamber/sessions', body: { sessionId: 'ses_loop2' } },
    ], calls);

    for (let i = 0; i < 4; i++) await resumeTick(new Set(['ses_live']), tickCfg);

    // un crash en boucle ne recrée pas la session indéfiniment
    expect(callsTo(calls, '/api/openchamber/sessions').length).toBeLessThanOrEqual(2);
    const row = getTaskResume('ses_loop')!;
    expect(row.disabled_at).toBeGreaterThan(0);
    expect(String(row.disabled_reason)).toContain('budget');
    expect(String(row.disabled_reason)).toContain('essais');
    expect(getTaskBrief(row.session_id)?.title).toBe('Boucle');
    globalThis.fetch = originalFetch;
  });

  test('une réponse illisible de l’instance ne décide rien (pas de faux positif)', async () => {
    armTaskResume('ses_net', { sessionId: 'ses_net', title: 'Net', projectDir: '/p' });
    const tickCfg = { ...cfg, confirmMissingMs: 0 };
    globalThis.fetch = fakeFetch([
      // 200 mais un corps vide : on ne se prononce pas
      { match: '/api/session/ses_net', body: { data: null } },
    ], calls);

    await resumeTick(new Set(['ses_live']), tickCfg);
    expect(callsTo(calls, '/api/openchamber/sessions')).toEqual([]);
    expect(getTaskResume('ses_net')!.disabled_at).toBeNull();
    globalThis.fetch = originalFetch;
  });

  test('un archivage est un geste humain : la reprise est désactivée, pas relancée', async () => {
    putTaskBrief('ses_arch', { title: 'Archivée', goal: 'g', doneCriteria: [], constraints: [], projectDir: '/p' });
    armTaskResume('ses_arch', { sessionId: 'ses_arch', title: 'Archivée', projectDir: '/p' });
    const tickCfg = { ...cfg, confirmMissingMs: 0 };
    globalThis.fetch = fakeFetch([
      { match: '/api/session/ses_arch', body: { data: { id: 'ses_arch', time: { archived: now } } } },
    ], calls);

    const stats = await resumeTick(new Set(['ses_live']), tickCfg);
    expect(stats.restarted).toEqual([]);
    expect(callsTo(calls, '/api/openchamber/sessions')).toEqual([]);
    const row = getTaskResume('ses_arch')!;
    expect(row.disabled_at).toBeGreaterThan(0);
    expect(String(row.disabled_reason)).toContain('archivée');
    globalThis.fetch = originalFetch;
  });

  test('backfill : les briefs récents s’arment, les orphelines anciennes sont désactivées', () => {
    const hour = 60 * 60_000;
    // récente : créée hier, activité il y a 10 min
    db.query(`INSERT INTO task_brief (session_id,title,goal,done_criteria,constraints,project_dir,agent,model,created_at)
              VALUES (?,?,?,?,?,?,?,?,?)`).run('ses_recent', 'Récente', 'g', '[]', '[]', '/p', null, null, Date.now() - 24 * hour);
    logEvent('ses_recent', 'note', 'activité récente');
    // ancienne : créée il y a 3 jours, plus rien depuis
    db.query(`INSERT INTO task_brief (session_id,title,goal,done_criteria,constraints,project_dir,agent,model,created_at)
              VALUES (?,?,?,?,?,?,?,?,?)`).run('ses_old', 'Ancienne', 'g', '[]', '[]', '/p', null, null, Date.now() - 72 * hour);

    const result = backfillResumeTasks(new Set(['ses_other']), { ...cfg, legacyWindowMs: hour });

    expect(result.armed).toBe(1);
    expect(result.disabled).toBe(1);
    expect(getTaskResume('ses_recent')?.disabled_at).toBeNull();
    expect(getTaskResume('ses_old')?.disabled_reason).toContain('longue date');
  });

  test('sessionGone lit le répertoire direct : 404 = détruite, archivée = archivée', async () => {
    globalThis.fetch = fakeFetch([
      { match: '/api/session/ses_found', body: { data: { id: 'ses_found', time: {} } } },
      { match: '/api/session/ses_arch', body: { data: { id: 'ses_arch', time: { archived: now } } } },
      { match: '/api/session/ses_missing', status: 404 },
    ], calls);
    expect(await sessionGone('ses_found')).toBe('alive');
    expect(await sessionGone('ses_arch')).toBe('archived');
    expect(await sessionGone('ses_missing')).toBe('gone');
    globalThis.fetch = originalFetch;
  });
});
