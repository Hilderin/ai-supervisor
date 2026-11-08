import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const testHome = mkdtempSync(join(tmpdir(), 'companion-recovery-home-'));
const testData = mkdtempSync(join(tmpdir(), 'companion-recovery-data-'));
process.env.HOME = testHome;
process.env.SUPERVISEUR_DATA_DIR = testData;
process.env.SUPERVISEUR_COMPANION = 'on';

const state = await import('../src/state.mts');
const companion = await import('../src/companion.mts');

const dbPath = (state.db as unknown as { query: (sql: string) => { all: () => Array<{ file?: string }> } })
  .query('pragma database_list').all().map(row => row.file ?? '').join(',');
if (!dbPath.includes('companion-recovery-data-')) {
  throw new Error(`companion-recovery.test : base SQLite inattendue (${dbPath})`);
}

test('recrée un compagnon supprimé même si la session parente est idle', async () => {
  const { db, getAgentVersion, ensureAgentDefinition, putCompanion, getCompanion } = state;
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  const verdict = JSON.stringify({
    summary: 'L’agent poursuit la vérification demandée.',
    state: 'working',
    human_request: { needs: false, source: 'none', ask: '' },
    next: 'Continuer la vérification.',
  });
  const parentMessages = {
    data: [
      { id: 'u1', type: 'user', time: { created: 10 }, text: 'Analyse cette tâche.' },
      { id: 'a1', type: 'assistant', time: { created: 20 }, text: 'Je commence l’analyse.' },
    ],
  };

  db.run('DELETE FROM companion_map; DELETE FROM task_state; DELETE FROM task_verdict; DELETE FROM task_log;');
  putCompanion('parent-idle', 'companion-deleted', ensureAgentDefinition(getAgentVersion()));
  companion.setBase('http://companion.test');

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    if (url.includes('/api/session/companion-deleted')) return new Response('missing', { status: 404 });
    if (url.includes('/api/session/parent-idle/message')) return Response.json(parentMessages);
    if (url.includes('/api/session/fresh-companion/message')) {
      return Response.json({ data: [{
        id: 'reply', type: 'assistant', time: { created: Date.now() + 1000 },
        content: [{ type: 'text', text: verdict }],
      }] });
    }
    if (url.endsWith('/api/session') && method === 'POST') {
      return Response.json({ data: { id: 'fresh-companion' } });
    }
    if (url.includes('/api/openchamber/sessions/fresh-companion/send') && method === 'POST') {
      return Response.json({ ok: true });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    await companion.companionTick(
      [{ id: 'parent-idle', title: 'Tâche idle', location: { directory: '/tmp/projet' } }],
      { 'parent-idle': { status: 'idle', lastUpdateAt: 20 } },
    );

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const notes = db.query("SELECT COUNT(*) c FROM task_log WHERE session_id = ? AND text LIKE 'analyste:%'")
        .get('parent-idle') as { c: number };
      if (getCompanion('parent-idle')?.compId === 'fresh-companion' && notes.c > 0) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    expect(getCompanion('parent-idle')?.compId).toBe('fresh-companion');
    expect(calls.some(call => call.url.includes('/api/session/companion-deleted'))).toBe(true);
    expect(calls.some(call => call.url.endsWith('/api/session') && call.method === 'POST')).toBe(true);
    expect(calls.some(call => call.url.includes('/api/openchamber/sessions/fresh-companion/send'))).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
    companion.setBase('');
  }
});
