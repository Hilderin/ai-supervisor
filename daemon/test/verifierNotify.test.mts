/**
 * Notifications critères (P5) : contenu structuré (justification d'approbation,
 * détail des ajouts) et livraison fiable (3 essais de steer, puis repli sur la
 * file d'attente OpenChamber avec sendConfig repris de la session). Fetch
 * stubbé avant les imports ; base SQLite temporaire (JAMAIS la production).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'verifier-notify-test-'));
process.env.SUPERVISEUR_DATA_DIR = dataDir;

// Enregistre les appels HTTP du module et répond selon un scénario.
const calls: Array<{ method: string; path: string; body?: unknown }> = [];
// Scénario par défaut : tout réussit.
let steerFails = 0;    // nombre de POST /prompt qui échouent avant succès
let steerAlwaysFails = false;
let sessionMeta = true; // GET /api/session/:id renvoie model + directory

// @ts-expect-error stub global installé avant les imports dynamiques
globalThis.fetch = async (url: string | URL, init?: { method?: string; body?: string }) => {
  const path = String(url).replace(/^https?:\/\/[^/]+/, '');
  const method = init?.method ?? 'GET';
  let body: unknown;
  try { body = init?.body ? JSON.parse(init.body) : undefined; } catch { body = undefined; }
  calls.push({ method, path, body });
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
  if (path.startsWith('/api/session/') && path.endsWith('/prompt')) {
    const fail = steerAlwaysFails || calls.filter(c => c.path.endsWith('/prompt')).length <= steerFails;
    return fail ? json({ error: 'busy' }, 500) : json({ ok: true });
  }
  if (path.startsWith('/api/session/') && method === 'GET') {
    return sessionMeta
      ? json({ data: { model: { providerID: 'prov', id: 'model-x' }, location: { directory: '/tmp/projet' } } })
      : json({ data: {} });
  }
  if (path.includes('/message-queue')) return json({ ok: true });
  return json({});
};

const state = await import('../src/state.mts');
const verifier = await import('../src/verifier.mts');

// garde-fou anti-catastrophe (comme criteria.test.mts)
const boundFile = (state.db as unknown as { query: Function }).query('pragma database_list').all()
  .map((r: { file?: string }) => r.file ?? '').join(',');
if (!boundFile.includes('verifier-notify-test-')) {
  process.exitCode = 1;
  throw new Error(`verifierNotify.test : base SQLite ${boundFile} n'est pas une base de test : on n'écrit rien. Lancer ce fichier SEUL.`);
}

import { describe, expect, test } from 'bun:test';

const TASK = 'ses_test_notify';

describe('notifications critères : structurées et fiables', () => {
  test('la justification d approbation et le détail des ajouts partent dans le message', () => {
    const lines = verifier.transitionLines([
      { ref: 'AC-02', op: 'approve', line: 'AC-02 validé : la sortie de test passe' },
      { ref: 'AC-05', op: 'add', line: 'AC-05 ajouté par le vérificateur : « aucune régression du build UI » : build passe après chaque lot (méthodes : unit_test) : le plan touche l UI' },
    ]);
    const text = `[superviseur] Critères : ${lines.join('. ')}. Ne réponds pas à ce message : applique les corrections nécessaires.`;
    // la justification d'approbation est transmise
    expect(text).toContain('AC-02 validé : la sortie de test passe');
    // le détail de l'ajout aussi (titre, détail, méthodes, raison)
    expect(text).toContain('aucune régression du build UI');
    expect(text).toContain('unit_test');
  });

  test('3 essais de steer puis succès : pas de repli file d attente', async () => {
    calls.length = 0;
    steerFails = 2;           // deux échecs, le troisième passe
    steerAlwaysFails = false;
    await verifier.notifyMainAgent(TASK, [{ ref: 'AC-01', op: 'approve', line: 'AC-01 validé : preuve acceptée' }]);
    const prompts = calls.filter(c => c.path.endsWith('/prompt'));
    expect(prompts.length).toBe(3);
    expect((prompts[0].body as { delivery: string }).delivery).toBe('steer');
    expect(calls.some(c => c.path.includes('message-queue'))).toBe(false);
    const sent = (prompts.at(-1)!.body as { text: string }).text;
    expect(sent).toContain('AC-01 validé : preuve acceptée');
  }, 20_000);

  test('steer toujours en échec : repli file d attente avec sendConfig repris de la session', async () => {
    calls.length = 0;
    steerFails = 0;
    steerAlwaysFails = true;
    sessionMeta = true;
    await verifier.notifyMainAgent(TASK, [{ ref: 'AC-02', op: 'reject', line: 'AC-02 à corriger : la capture ne montre pas l état final' }]);
    expect(calls.filter(c => c.path.endsWith('/prompt')).length).toBe(3);
    const queue = calls.find(c => c.path.includes('/message-queue/sessions/') && c.method === 'POST');
    expect(queue).toBeTruthy();
    const item = (queue!.body as { directory: string; item: { text: string; sendConfig: Record<string, string> } });
    expect(item.directory).toBe('/tmp/projet');
    expect(item.item.sendConfig).toEqual({ providerID: 'prov', modelID: 'model-x' });
    expect(item.item.text).toContain('AC-02 à corriger');
  }, 20_000);

  test('steer et file d attente en échec : rien ne crashe, journal au prochain kick', async () => {
    calls.length = 0;
    steerAlwaysFails = true;
    sessionMeta = false;      // la session ne donne ni model ni directory
    await verifier.notifyMainAgent(TASK, [{ ref: 'AC-03', op: 'approve', line: 'AC-03 validé' }]);
    expect(calls.filter(c => c.path.endsWith('/prompt')).length).toBe(3);
    expect(calls.some(c => c.path.includes('message-queue'))).toBe(false);
  }, 20_000);
});
