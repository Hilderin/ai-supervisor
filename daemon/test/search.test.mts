/**
 * Recherche des conversations et restauration d'une carte fermée (2026-11-14).
 *
 * Le noyau (search-core.mts) est testé sans base ni instance : fusion des
 * titres et des messages, dédoublonnage, exclusions, surlignage des extraits.
 * Le module complet est testé avec un serveur factice pour l'index de messages
 * et une base temporaire pour la restauration.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'superviseur-search-'));
process.env.SUPERVISEUR_DATA_DIR = join(root, 'data');
process.env.SUPERVISEUR_HOME = join(root, 'home');

let server: ReturnType<typeof Bun.serve> | null = null;
let core: typeof import('../src/search-core.mts');
let search: typeof import('../src/search.mts');
let state: typeof import('../src/state.mts');
let supervisor: typeof import('../src/supervisor.mts');

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/openchamber/message-search') {
        if (url.searchParams.get('q') === 'offline') {
          return Response.json({ error: 'Message search is off on this server' }, { status: 503 });
        }
        return Response.json({
          status: 'ok',
          hits: [
            {
              id: 'msg_1',
              sessionId: 'ses_msg',
              role: 'assistant',
              createdAt: 8_000,
              sessionTitle: 'Autre sujet',
              directory: 'C:\\work\\api',
              snippet: 'on a tranché\uE000alpha\uE001, le reste suit',
            },
          ],
        });
      }
      return new Response('not found', { status: 404 });
    },
  });
  core = await import('../src/search-core.mts');
  state = await import('../src/state.mts');
  supervisor = await import('../src/supervisor.mts');
  search = await import('../src/search.mts');
  const main = state.db.query('PRAGMA database_list').all() as Array<{ name: string; file: string }>;
  const file = main.find((d) => d.name === 'main')?.file ?? '';
  if (!file.startsWith(root)) throw new Error(`test lié à une base non temporaire : ${file}`);
  search.setBase(`http://127.0.0.1:${server.port}`);
});

afterAll(async () => {
  server?.stop(true);
  try { await rm(root, { recursive: true, force: true, maxRetries: 5 }); } catch { /* dossier verrouillé */ }
});

function sessionsFixture() {
  const dir = supervisor.SUPERVISOR_DIR;
  return [
    {
      id: 'ses_title',
      title: 'Refonte du dashboard',
      time: { updated: 9_000 },
      location: { directory: 'C:\\work\\dashboard' },
    },
    {
      id: 'ses_msg',
      title: 'Autre sujet',
      time: { updated: 8_000 },
      location: { directory: 'C:\\work\\api' },
    },
    {
      id: 'ses_child',
      title: 'Refonte enfant',
      parentID: 'ses_title',
      time: { updated: 7_000 },
      location: { directory: 'C:\\work\\api' },
    },
    {
      id: 'ses_arch',
      title: 'Refonte archivée',
      time: { updated: 7_000, archived: 1 },
      location: { directory: 'C:\\work\\api' },
    },
    {
      id: 'ses_sup',
      title: 'Refonte superviseur',
      time: { updated: 7_000 },
      location: { directory: dir },
    },
  ];
}

describe('extraits', () => {
  test('les marqueurs privés deviennent des segments surlignés', () => {
    expect(core.parseSnippet('avant \uE000mot\uE001 après')).toEqual([
      { text: 'avant ' },
      { text: 'mot', match: true },
      { text: ' après' },
    ]);
  });

  test('un extrait sans marqueur reste un seul segment', () => {
    expect(core.parseSnippet('rien à surligner')).toEqual([{ text: 'rien à surligner' }]);
    expect(core.parseSnippet('')).toEqual([]);
  });

  test('une marque ouvrante sans fermante ne perd pas le texte', () => {
    const segments = core.parseSnippet('\uE000mot');
    expect(segments).toEqual([{ text: 'mot', match: true }]);
  });

  test('la normalisation ignore casse et accents', () => {
    expect(core.normalizeForSearch('  Décision  ')).toBe('decision');
    expect(core.normalizeForSearch('ÉTÉ')).toBe('ete');
  });
});

describe('fusion titre + messages', () => {
  test('un titre trouvé sort, les enfants, archivées et le chat sont écartés', () => {
    const results = core.mergeSearch({
      query: 'refonte',
      sessions: sessionsFixture(),
      hits: [],
      excludeDirs: [supervisor.SUPERVISOR_DIR],
    });
    expect(results.map((r) => r.sessionId)).toEqual(['ses_title']);
    expect(results[0]).toMatchObject({
      title: 'Refonte du dashboard',
      project: 'dashboard',
      closed: false,
      titleMatch: true,
    });
  });

  test('un message trouvé sort même si le titre ne correspond pas', () => {
    const results = core.mergeSearch({
      query: 'alpha',
      sessions: sessionsFixture(),
      hits: [{
        sessionId: 'ses_msg',
        role: 'assistant',
        createdAt: 8_000,
        snippet: 'on a tranché\uE000alpha\uE001, le reste suit',
      }],
      excludeDirs: [supervisor.SUPERVISOR_DIR],
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.sessionId).toBe('ses_msg');
    expect(results[0]!.titleMatch).toBe(false);
    expect(results[0]!.role).toBe('assistant');
    expect(results[0]!.snippet).toEqual([
      { text: 'on a tranché' },
      { text: 'alpha', match: true },
      { text: ', le reste suit' },
    ]);
  });

  test('titre et message sur la même conversation donnent une seule ligne', () => {
    const results = core.mergeSearch({
      query: 'refonte',
      sessions: sessionsFixture(),
      hits: [{ sessionId: 'ses_title', role: 'user', snippet: 'la \uE000refonte\uE001 avance' }],
      excludeDirs: [supervisor.SUPERVISOR_DIR],
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.titleMatch).toBe(true);
    expect(results[0]!.snippet?.some((s) => s.match)).toBe(true);
  });

  test('les correspondances de titre passent avant les messages, puis l’activité décroissante', () => {
    const sessions = [
      ...sessionsFixture(),
      { id: 'ses_title2', title: 'Refonte API', time: { updated: 20_000 }, location: { directory: 'C:\\work\\api' } },
    ];
    const results = core.mergeSearch({
      query: 'refonte',
      sessions,
      hits: [{ sessionId: 'ses_msg', snippet: 'refonte\uE000\uE001' }],
      excludeDirs: [supervisor.SUPERVISOR_DIR],
    });
    expect(results.map((r) => r.sessionId)).toEqual(['ses_title2', 'ses_title', 'ses_msg']);
  });

  test('une carte fermée est marquée et la liste est plafonnée', () => {
    const sessions = Array.from({ length: 15 }, (_, index) => ({
      id: `ses_${index}`,
      title: `Item ${index}`,
      time: { updated: 1_000 + index },
      location: { directory: `C:\\work\\p${index}` },
    }));
    const results = core.mergeSearch({
      query: 'item',
      sessions,
      hits: [],
      closed: new Set(['ses_14']),
      excludeDirs: [],
    });
    expect(results).toHaveLength(core.SEARCH_MAX_RESULTS);
    expect(results[0]!.sessionId).toBe('ses_14');
    expect(results[0]!.closed).toBe(true);
  });

  test('moins de deux caractères ne cherche rien', () => {
    expect(core.mergeSearch({ query: ' a ', sessions: sessionsFixture(), hits: [] })).toEqual([]);
  });
});

describe('recherche complète', () => {
  test('requête trop courte : état dédié, aucun appel', async () => {
    const answer = await search.searchConversations('a', { sessions: sessionsFixture(), closed: new Set() });
    expect(answer.state).toBe('too_short');
    expect(answer.results).toEqual([]);
  });

  test('fusionne les titres et les messages de l’index', async () => {
    const answer = await search.searchConversations('refonte', {
      sessions: sessionsFixture(),
      closed: new Set(['ses_title']),
    });
    expect(answer.state).toBe('ok');
    // le serveur factice renvoie un hit pour ses_msg (snippet alpha)
    expect(answer.results.map((r) => r.sessionId)).toEqual(['ses_title', 'ses_msg']);
    expect(answer.results[0]!.closed).toBe(true);
  });

  test('index indisponible : les titres restent, avec l’état signalé', async () => {
    const answer = await search.searchConversations('offline', {
      sessions: sessionsFixture(),
      closed: new Set(),
    });
    expect(answer.state).toBe('unavailable');
    expect(answer.results).toEqual([]);
  });

  test('sans base (daemon non câblé), l’état est indisponible', async () => {
    search.setBase('');
    const answer = await search.searchConversations('refonte', {
      sessions: sessionsFixture(),
      closed: new Set(),
    });
    expect(answer.state).toBe('unavailable');
    expect(answer.results.map((r) => r.sessionId)).toEqual(['ses_title']);
    search.setBase(`http://127.0.0.1:${server!.port}`);
  });
});

describe('restauration d’une carte fermée', () => {
  test('une carte fermée redevient visible', () => {
    state.upsertTaskState('ses_msg', { closedAt: Date.now(), closure: 'terminé' });
    expect(state.closedTaskIds().has('ses_msg')).toBe(true);
    const restored = search.restoreConversation('ses_msg', sessionsFixture());
    expect(restored.ok).toBe(true);
    expect(state.closedTaskIds().has('ses_msg')).toBe(false);
    expect((state.getTaskState('ses_msg') as { closed_at?: number | null }).closed_at).toBeNull();
  });

  test('une conversation disparue est refusée', () => {
    expect(search.restoreConversation('ses_inconnue', sessionsFixture())).toEqual({
      ok: false,
      error: 'session_gone',
    });
  });

  test('une session archivée ou enfant n’est pas restaurée', () => {
    expect(search.restoreConversation('ses_arch', sessionsFixture()).ok).toBe(false);
    expect(search.restoreConversation('ses_child', sessionsFixture()).ok).toBe(false);
  });
});
