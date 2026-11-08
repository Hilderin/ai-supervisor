/**
 * Lectures bornées du vérificateur (verifier-tools.mts), sur une base SQLite
 * temporaire et un fetch stubbé : l'historique OpenChamber est simulé (union
 * asc/desc, texte racine m.text, tool call), le projet du parent est un
 * dossier temporaire pour verifier_artifact (image réelle transmise), l'index
 * local est testé au-delà du listing.
 * Garde de la leçon du 2026-11-07 : JAMAIS la base de production ; le dossier
 * de données est redirigé avant les imports dynamiques.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'verifier-tools-test-'));
process.env.SUPERVISEUR_DATA_DIR = dataDir;

const projectDir = join(dataDir, 'project');
mkdirSync(projectDir, { recursive: true });
writeFileSync(join(projectDir, 'result.txt'), 'ligne 1 du resultat\nligne 2 du resultat\n');
writeFileSync(join(projectDir, 'capture.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]));

// fetch stubbé AVANT l'import : le listing /message ignore offset et curseurs
// (leçon AGENTS.md) et refuse limit > 200 (renvoie 0) : la couverture vient
// de l'union des deux extrémités + l'index local du daemon.
const now = Date.now();
const LONG_OUTPUT = `${'x'.repeat(5000)}RESUME FINAL : 12 pass, 0 fail`;
const MSG_HUMAN = {
  id: 'msg_human', type: 'user', time: { created: now - 30_000 },
  text: 'Ajoute une garde anti-péremption sur les critères du vérificateur',   // texte à la RACINE
  content: [],
};
const MSG_AGENT_TOOL = {
  id: 'msg_agent', type: 'assistant', time: { created: now - 10_000 },
  content: [
    { type: 'tool', name: 'bun test', state: { status: 'completed', input: { command: 'bun test daemon/test/criteria.test.mts' }, output: LONG_OUTPUT } },
    { type: 'text', text: 'La garde est en place.' },
  ],
};
const fakeJson = (data: unknown) => new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
// @ts-expect-error stub global, remplacé après les imports si besoin
globalThis.fetch = async (url: string | URL) => {
  const path = String(url);
  if (path.includes('/message?') && path.includes('order=asc')) return fakeJson([MSG_HUMAN, MSG_AGENT_TOOL]);
  if (path.includes('/message?') && path.includes('order=desc')) return fakeJson([MSG_AGENT_TOOL, MSG_HUMAN]);
  throw new Error(`fetch stubbé : URL inattendue ${path}`);
};

const state = await import('../src/state.mts');
const tools = await import('../src/verifier-tools.mts');
const indexModule = await import('../src/message-index.mts');

// garde-fou anti-catastrophe (comme criteria.test.mts)
const boundFile = (state.db as unknown as { query: Function }).query('pragma database_list').all()
  .map((r: { file?: string }) => r.file ?? '').join(',');
if (!boundFile.includes('verifier-tools-test-')) {
  process.exitCode = 1;
  throw new Error(`verifierTools.test : base SQLite ${boundFile} n'est pas une base de test : on n'écrit rien. Lancer ce fichier SEUL.`);
}

import { describe, expect, test } from 'bun:test';

const TASK = 'ses_test_verifier_tools';
state.putTaskBrief(TASK, {
  title: 'Tâche de test', goal: 'objectif', doneCriteria: [], constraints: [],
  projectDir, agent: 'build', model: 'test/model',
});

describe('verifier tools : lectures bornées', () => {
  test('verifier_messages lit le texte RACINE (m.text) et couvre tout l historique', async () => {
    const out = await tools.verifierMessages(TASK, { limit: 10 });
    expect(out.ok).toBe(true);
    const msgs = (out as { messages: Array<{ id: string; text: string }> }).messages;
    const human = msgs.find(m => m.id === 'msg_human');
    expect(human?.text).toContain('garde anti-péremption');   // m.text à la racine
    expect((out as { historyCovered: number }).historyCovered).toBe(2); // asc + desc dédupliqués
  });

  test('verifier_tools porte un callId STABLE (messageId:partIndex)', async () => {
    const out = await tools.verifierTools(TASK, { limit: 10 });
    expect(out.ok).toBe(true);
    const calls = (out as { toolCalls: Array<{ callId: string; name: string }> }).toolCalls;
    expect(calls[0].name).toBe('bun test');
    expect(calls[0].callId).toBe('msg_agent:0');   // stable : id de message + index de part
  });

  test('verifier_tool_result par callId : entrée complète, sortie PAR PAGES', async () => {
    const byCallId = await tools.verifierToolResult(TASK, { callId: 'msg_agent:0', offset: 4900, length: 200 });
    expect(byCallId.ok).toBe(true);
    const call = (byCallId as { toolCall: { callId: string; name: string; input: Record<string, string>; output: string; total: number; truncated: boolean } }).toolCall;
    expect(call.callId).toBe('msg_agent:0');
    expect(call.input.command).toBe('bun test daemon/test/criteria.test.mts');
    expect(call.total).toBe(LONG_OUTPUT.length);          // plus de plafond fixe : la sortie se lit par plages
    expect(call.output).toContain('RESUME FINAL : 12 pass, 0 fail');  // le résumé de FIN est lisible
    expect(call.truncated).toBe(false);
    // pagination chaînable : page 1 puis page 2
    const page1 = await tools.verifierToolResult(TASK, { callId: 'msg_agent:0' });
    const p1 = (page1 as { toolCall: { output: string; total: number; nextOffset?: number; truncated: boolean } }).toolCall;
    expect(p1.output.length).toBe(2000);                  // page par défaut
    expect(p1.truncated).toBe(true);
    expect(p1.nextOffset).toBe(2000);
    const page2 = await tools.verifierToolResult(TASK, { callId: 'msg_agent:0', offset: p1.nextOffset, length: 2000 });
    const p2 = (page2 as { toolCall: { output: string } }).toolCall;
    expect(p2.output).toBe(LONG_OUTPUT.slice(2000, 4000));
    const unknown = await tools.verifierToolResult(TASK, { callId: 'msg_absent:9' });
    expect(unknown.ok).toBe(false);
    expect((unknown as { error: string }).error).toBe('callId_inconnu');
  });

  test('verifier_search couvre messages, entrées de tool calls, et l INDEX local (angle mort du listing)', async () => {
    // un message CENTRAL que le listing (asc 200 + desc 200) ne remonte pas :
    // il n'existe QUE dans l'index local du daemon
    state.upsertIndexedMessages(TASK, [{
      msgId: 'msg_central', at: now - 500_000, type: 'user',
      text: 'convention secrète du milieu de conversation : ancres-lisibles', toolInputs: null,
    }]);
    const fromIndex = await tools.verifierSearch(TASK, { query: 'ancres-lisibles' });
    expect(fromIndex.ok).toBe(true);
    const m0 = (fromIndex as { matches: Array<{ field: string; id: string }>; indexed: number }).matches;
    expect(m0.some(m => m.field === 'message' && m.id === 'msg_central')).toBe(true);   // trouvé via l'index
    expect((fromIndex as { indexed: number }).indexed).toBe(1);
    const inMessage = await tools.verifierSearch(TASK, { query: 'anti-péremption' });
    expect(inMessage.ok).toBe(true);
    const m1 = (inMessage as { matches: Array<{ field: string }> }).matches;
    expect(m1.some(m => m.field === 'message')).toBe(true);
    const inTool = await tools.verifierSearch(TASK, { query: 'criteria.test.mts' });
    const m2 = (inTool as { matches: Array<{ field: string; tool?: string }> }).matches;
    expect(m2.some(m => m.field === 'tool_input')).toBe(true);
  });

  test('verifier_artifact : texte borné au projet, image RÉELLEMENT transmise, sortie refusée', async () => {
    const text = await tools.verifierArtifact(TASK, { path: 'result.txt', start_line: 2, line_count: 1 });
    expect(text.ok).toBe(true);
    expect((text as { content?: string }).content).toContain('ligne 2 du resultat');
    const outOfProject = await tools.verifierArtifact(TASK, { path: '../../etc/passwd' });
    expect(outOfProject.ok).toBe(false);
    const image = await tools.verifierArtifact(TASK, { path: 'capture.png' });
    // l'image n'est plus une consigne de remplacement : le chemin absolu VALIDÉ
    // est renvoyé, le plugin l'attache à la session (le modèle la voit)
    expect(image.ok).toBe(true);
    const img = (image as { image: { path: string; mime: string; size: number } }).image;
    expect(img.path.startsWith(projectDir)).toBe(true);
    expect(img.mime).toBe('image/png');
    expect(img.size).toBe(5);
  });
});

describe('index local des messages : alimenté par le daemon, jamais rétrécie', () => {
  // session distincte : les tests de recherche ci-dessus ont peuplé l'index de TASK
  const TASK2 = `${TASK}-idx`;


  test('refreshSession : union asc+desc dédupliquée, texte racine et entrées de tools stockés', async () => {
    const n = await indexModule.refreshSession(TASK2);
    expect(n).toBe(2);                       // asc + desc = les mêmes 2 messages
    const again = await indexModule.refreshSession(TASK2);
    expect(again).toBe(2);                   // upsert dédupliqué : pas de croissance
    const rows = state.searchIndexedMessages(TASK2, '', 100) as Array<{ msg_id: string; text: string; tool_calls: string | null; type: string }>;
    const human = rows.find(r => r.msg_id === 'msg_human');
    expect(human?.text).toContain('garde anti-péremption');   // m.text racine indexé
    const agent = rows.find(r => r.msg_id === 'msg_agent');
    expect(agent?.tool_calls).toContain('bun test daemon/test/criteria.test.mts');  // entrées de tools indexées
  });

  test('un message central présent SEULEMENT dans l index reste trouvable (angle mort du listing couvert)', async () => {
    // simulé : le listing ne remonte que les extrémités ; un message central
    // indexé plus tôt ne disparaît jamais de l'index
    state.upsertIndexedMessages(TASK2, [{
      msgId: 'msg_central2', at: now - 500_000, type: 'user',
      text: 'instruction du milieu de conversation : mot-de-passe-ancre', toolInputs: null,
    }]);
    const out = await tools.verifierSearch(TASK2, { query: 'mot-de-passe-ancre' });
    expect(out.ok).toBe(true);
    const m = (out as { matches: Array<{ id: string }> }).matches;
    expect(m.some(x => x.id === 'msg_central2')).toBe(true);
    expect(state.indexedCount(TASK2)).toBe(3);
  });
});
