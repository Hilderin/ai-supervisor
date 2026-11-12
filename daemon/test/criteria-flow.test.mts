/**
 * Dispatch des tools criteria côté daemon (runCriteriaTool, criteria-tools.mts)
 * sur une base SQLite temporaire (imports dynamiques après l'env, garde-fou
 * comme criteria.test.mts). Flux 2026-11-12 : plus de vérificateur, l'agent
 * juge lui-même avec criteria_set_status.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SUPERVISEUR_DATA_DIR = mkdtempSync(join(tmpdir(), 'criteria-flow-test-'));
const state = await import('../src/state.mts');
const criteria = await import('../src/criteria.mts');
const tools = await import('../src/criteria-tools.mts');

// garde-fou anti-catastrophe (comme criteria.test.mts)
const boundFile = (state.db as unknown as { query: Function }).query('pragma database_list').all()
  .map((r: { file?: string }) => r.file ?? '').join(',');
if (!boundFile.includes('criteria-flow-test-')) {
  process.exitCode = 1;
  throw new Error(`criteria-flow.test : base SQLite ${boundFile} n'est pas une base de test : on n'écrit rien. Lancer ce fichier SEUL.`);
}

import { describe, expect, test } from 'bun:test';
const { addCriterion, getCriterion, listCriteria } = criteria;

const TASK = 'ses_test_flow';

/** Le gating isTaskSession exige une tâche connue : un brief suffit. */
state.putTaskBrief(TASK, { title: 'Tâche de test', goal: 'g', doneCriteria: [], constraints: [], projectDir: '/p' });

function run(name: string, args: Record<string, unknown> = {}, sessionId = TASK) {
  return tools.runCriteriaTool(name, sessionId, args);
}

describe('criteria tools : dispatch daemon', () => {
  test('un appel hors tâche est refusé (not_task), chat de supervision inclus', async () => {
    const out = await run('criteria_list', {}, 'ses_inconnu');
    expect(out.ok).toBe(false);
    expect(out.error).toBe('not_task');
  });

  test('add, list, to_validate, set_status : le flux complet passe par le dispatch', async () => {
    const added = await run('criteria_add', { title: 'Tests passent', methods: ['unit_test'] });
    expect(added.ok).toBe(true);
    const list1 = await run('criteria_list');
    expect(list1.ok).toBe(true);
    expect((list1 as { counts: { total: number } }).counts.total).toBe(1);

    const submitted = await run('criteria_to_validate', {
      ref: 'AC-01',
      evidence: [{ kind: 'command', text: 'bun test : 12 pass' }],
    });
    expect(submitted.ok).toBe(true);
    expect(getCriterion(TASK, 'AC-01')!.status).toBe('to_validate');

    // statut invalide : refus AVANT toute écriture
    const bad = await run('criteria_set_status', { ref: 'AC-01', status: 'to_validate', note: 'x' });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('invalid_status');
    expect(getCriterion(TASK, 'AC-01')!.status).toBe('to_validate');

    const validated = await run('criteria_set_status', { ref: 'AC-01', status: 'validated', note: 'sortie de test vue' });
    expect(validated.ok).toBe(true);
    const c = getCriterion(TASK, 'AC-01')!;
    expect(c.status).toBe('validated');
    expect(c.review).toContain('sortie de test');
    expect(c.validated_at).toBeGreaterThan(0);
  });

  test('set_status to_fix exige une raison ; l erreur machine remonte à l agent', async () => {
    const added = await run('criteria_add', { title: 'Build passe', methods: ['command'] });
    expect(added.ok).toBe(true);
    const noReason = await run('criteria_set_status', { ref: 'AC-02', status: 'to_fix', note: '' });
    expect(noReason.ok).toBe(false);
    expect(noReason.error).toBe('invalid');
    const fixed = await run('criteria_set_status', { ref: 'AC-02', status: 'to_fix', note: 'build rouge : import manquant' });
    expect(fixed.ok).toBe(true);
    expect(getCriterion(TASK, 'AC-02')!.status).toBe('to_fix');
    // la réponse porte toujours la liste à jour (l'agent lit l'état réel)
    expect((fixed as { counts: { toFix: number } }).counts.toFix).toBe(1);
  });

  test('ref inconnue : erreur structurée, liste rendue', async () => {
    const out = await run('criteria_set_status', { ref: 'AC-99', status: 'validated', note: 'x' });
    expect(out.ok).toBe(false);
    expect(out.error).toBe('unknown_ref');
    expect(Array.isArray((out as { criteria: unknown[] }).criteria)).toBe(true);
  });

  test('tool inconnu refusé', async () => {
    const out = await run('criteria_approve', { ref: 'AC-01' });
    expect(out.ok).toBe(false);
    expect(out.error).toBe('unknown_tool');
  });

  test('la liste de la tâche reste isolée des autres tâches', async () => {
    // une deuxième tâche (même base) ne voit pas les critères de TASK
    const OTHER = 'ses_test_flow_other';
    state.putTaskBrief(OTHER, { title: 'Autre tâche', goal: 'g', doneCriteria: [], constraints: [], projectDir: '/p' });
    addCriterion(OTHER, { title: 'Autre tâche', methods: ['text'] });
    const out = await run('criteria_list', {}, OTHER);
    expect((out as { counts: { total: number } }).counts.total).toBe(1);
    expect(listCriteria(TASK).length).toBeGreaterThan(1);
  });
});
