/**
 * Lectures bornées du vérificateur (verifier-tools.mts), sur une base SQLite
 * temporaire et un fetch stubbé : l'historique OpenChamber est simulé (union
 * asc/desc, texte racine m.text, tool call), le projet du parent est un
 * dossier temporaire pour verifier_artifact.
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
// (leçon AGENTS.md), la couverture est l'union des deux extrémités asc/desc.
const now = Date.now();
const MSG_HUMAN = {
  id: 'msg_human', type: 'user', time: { created: now - 30_000 },
  text: 'Ajoute une garde anti-péremption sur les critères du vérificateur',   // texte à la RACINE
  content: [],
};
const MSG_AGENT_TOOL = {
  id: 'msg_agent', type: 'assistant', time: { created: now - 10_000 },
  content: [
    { type: 'tool', name: 'bun test', state: { status: 'completed', input: { command: 'bun test daemon/test/criteria.test.mts' }, output: '12 pass, 0 fail' } },
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

  test('verifier_tool_result donne entrée et sortie COMPLÈTES d un tool call', async () => {
    const byTool = await tools.verifierToolResult(TASK, { tool: 'bun test', query: 'criteria.test' });
    expect(byTool.ok).toBe(true);
    const call = (byTool as { toolCall: { name: string; input: Record<string, string>; output: string } }).toolCall;
    expect(call.name).toBe('bun test');
    expect(call.input.command).toBe('bun test daemon/test/criteria.test.mts');
    expect(call.output).toBe('12 pass, 0 fail');
    const notFound = await tools.verifierToolResult(TASK, { tool: 'bash', query: 'aucun' });
    expect(notFound.ok).toBe(false);
    expect((notFound as { error: string }).error).toBe('not_found');
  });

  test('verifier_search couvre les messages ET les entrées de tool calls', async () => {
    const inMessage = await tools.verifierSearch(TASK, { query: 'anti-péremption' });
    expect(inMessage.ok).toBe(true);
    const m1 = (inMessage as { matches: Array<{ field: string }> }).matches;
    expect(m1.some(m => m.field === 'message')).toBe(true);
    const inTool = await tools.verifierSearch(TASK, { query: 'criteria.test.mts' });
    const m2 = (inTool as { matches: Array<{ field: string; tool: string }> }).matches;
    expect(m2.some(m => m.field === 'tool_input' && m.tool === 'bun test')).toBe(true);
  });

  test('verifier_artifact lit un artefact texte borné au projet ; image refuse avec consigne', async () => {
    const text = await tools.verifierArtifact(TASK, { path: 'result.txt', start_line: 2, line_count: 1 });
    expect(text.ok).toBe(true);
    expect((text as { content?: string }).content).toContain('ligne 2 du resultat');
    const outOfProject = await tools.verifierArtifact(TASK, { path: '../../etc/passwd' });
    expect(outOfProject.ok).toBe(false);
    const image = await tools.verifierArtifact(TASK, { path: 'capture.png' });
    expect(image.ok).toBe(false);
    expect((image as { error: string }).error).toBe('artifact_image');
    expect((image as { message: string }).message).toContain('preuve textuelle complémentaire');
  });
});
