/**
 * Flux vérificateur : parsing du JSON, application des actions par le daemon
 * (machine à états), lignes de notification. Base SQLite temporaire (imports
 * dynamiques après l'env, garde-fou comme criteria.test.mts), aucun réseau
 * (notifyMainAgent n'est pas appelé ici).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SUPERVISEUR_DATA_DIR = mkdtempSync(join(tmpdir(), 'criteria-flow-test-'));
const state = await import('../src/state.mts');
const criteria = await import('../src/criteria.mts');
const verifier = await import('../src/verifier.mts');

// garde-fou anti-catastrophe (comme criteria.test.mts)
const boundFile = (state.db as unknown as { query: Function }).query('pragma database_list').all()
  .map((r: { file?: string }) => r.file ?? '').join(',');
if (!boundFile.includes('criteria-flow-test-')) {
  process.exitCode = 1;
  throw new Error(`criteria-flow.test : base SQLite ${boundFile} n'est pas une base de test : on n'écrit rien. Lancer ce fichier SEUL.`);
}

import { describe, expect, test } from 'bun:test';
const { addCriterion, getCriterion, listCriteria, submitEvidence } = criteria;
const { applyVerifierActions, parseVerifierJson, transitionLines } = verifier;

const TASK = 'ses_test_flow';

async function pending(ref: string, evidence: Array<Record<string, unknown>> = [{ kind: 'command', text: 'bun test : pass' }]) {
  await submitEvidence(TASK, ref, evidence);
}

describe('vérificateur : application du JSON par le daemon', () => {
  test('parse tolérant : JSON noyé dans du texte, ou rien', () => {
    expect(parseVerifierJson('Voici :\n```json\n{"review":"ok","actions":[]}\n```')).toEqual({ review: 'ok', actions: [] });
    expect(parseVerifierJson('pas de json')).toBeNull();
    expect(parseVerifierJson('[1,2]')).toBeNull();
    expect(parseVerifierJson('{"review":"issues"}')).toEqual({ review: 'issues' });
  });

  test('approve et reject appliqués, lignes de notification structurées', async () => {
    addCriterion(TASK, { title: 'A', methods: ['unit_test'] });
    addCriterion(TASK, { title: 'B', methods: ['unit_test'] });
    addCriterion(TASK, { title: 'C', methods: ['unit_test'] });
    await pending('AC-01');
    await pending('AC-02');
    const json: VerifierJson = {
      review: 'issues',
      notes: 'deux preuves jugées',
      actions: [
        { op: 'approve', ref: 'AC-01', submission_version: 1, comment: 'la sortie de test passe' },
        { op: 'reject', ref: 'AC-02', submission_version: 1, reason: 'la sortie ne montre pas le bon fichier' },
      ],
    };
    const applied = applyVerifierActions(TASK, json, '{"commit":"abc123","at":1}');
    expect(getCriterion(TASK, 'AC-01')!.status).toBe('validated');
    expect(getCriterion(TASK, 'AC-01')!.validated_at).toBeGreaterThan(0);
    // version du travail examinée, enregistrée AVEC la validation (AC-17)
    expect(getCriterion(TASK, 'AC-01')!.validated_work).toBe('{"commit":"abc123","at":1}');
    expect(getCriterion(TASK, 'AC-02')!.status).toBe('to_fix');
    expect(transitionLines(applied)).toEqual([
      'AC-01 validé : la sortie de test passe',
      'AC-02 à corriger : la sortie ne montre pas le bon fichier',
    ]);
  });

  test('un jugement sur une version périmée est ignoré (l agent a changé la preuve pendant la phase)', async () => {
    await pending('AC-03');   // version 1
    const applied = applyVerifierActions(TASK, {
      review: 'ok',
      actions: [{ op: 'approve', ref: 'AC-03', submission_version: 0, comment: 'obsolète' }],
    });
    expect(applied).toEqual([]);
    expect(getCriterion(TASK, 'AC-03')!.status).toBe('to_validate');
    // le même jugement à la bonne version est appliqué
    const applied2 = applyVerifierActions(TASK, {
      review: 'ok',
      actions: [{ op: 'approve', ref: 'AC-03', submission_version: 1, comment: 'à jour' }],
    });
    expect(getCriterion(TASK, 'AC-03')!.status).toBe('validated');
    expect(transitionLines(applied2)[0]).toBe('AC-03 validé : à jour');
  });

  test('approve sur un critère non « à valider » : ignoré, sans casser les suivantes', async () => {
    const before = listCriteria(TASK).map(r => r.status);
    const applied = applyVerifierActions(TASK, {
      review: 'ok',
      actions: [
        { op: 'approve', ref: 'AC-01' },   // déjà validé : ignoré
        { op: 'reject', ref: 'AC-ZZZ', reason: 'inconnu' },  // ref inconnu : ignoré
        { op: 'unknown', ref: 'AC-03' },   // op inconnu : ignoré
      ],
    });
    expect(applied).toEqual([]);
    expect(listCriteria(TASK).map(r => r.status)).toEqual(before);
  });

  test('add, update et remove-aproposition appliqués ; add alloue la prochaine ref libre', async () => {
    const refsBefore = listCriteria(TASK).length;
    const applied = applyVerifierActions(TASK, {
      review: 'issues',
      actions: [
        { op: 'add', title: 'Aucune régression du build UI', detail: 'build passe après chaque lot', methods: ['unit_test'], reason: 'le plan touche l\'UI' },
        { op: 'update', ref: 'AC-03', detail: 'détail précisé avec la commande', reason: 'détail trop vague' },
        { op: 'remove', ref: 'AC-03', reason: 'doublon de AC-02' },
      ],
    });
    // remove du vérificateur : une PROPOSITION, le critère reste en place
    expect(listCriteria(TASK).length).toBe(refsBefore + 1);
    const added = listCriteria(TASK).at(-1)!;
    expect(added.ref).toBe('AC-04');
    expect(added.status).toBe('todo');
    expect(added.methods).toEqual(['unit_test']);
    expect(applied.map(t => t.op)).toEqual(['add', 'update', 'remove']);
    expect(transitionLines(applied)[1]).toContain('AC-03 modifié');
    expect(transitionLines(applied)[2]).toContain('AC-03 : retrait proposé');
    const c3 = getCriterion(TASK, 'AC-03')!;
    expect(c3.remove_proposed_at).toBeGreaterThan(0);
    expect(c3.remove_reason).toBe('doublon de AC-02');
    expect(c3.status).toBe('todo');   // pas de changement d'état sur une proposition
  });

  test('update d\'un critère validé le repasse « à faire » (cohérence des états)', async () => {
    await pending('AC-04');
    applyVerifierActions(TASK, { review: 'ok', actions: [{ op: 'approve', ref: 'AC-04', submission_version: 1 }] });
    expect(getCriterion(TASK, 'AC-04')!.status).toBe('validated');
    applyVerifierActions(TASK, { review: 'ok', actions: [{ op: 'update', ref: 'AC-04', title: 'Retitré' }] });
    expect(getCriterion(TASK, 'AC-04')!.status).toBe('todo');
    expect(getCriterion(TASK, 'AC-04')!.evidence).toEqual([]);
  });

  test('plafond d\'actions : au plus 12', async () => {
    const actions = Array.from({ length: 40 }, (_, i) => ({ op: 'unknown', ref: `AC-${i}` }));
    const applied = applyVerifierActions(TASK, { review: 'ok', actions });
    expect(applied).toEqual([]);
  });

  test('P0 : submission_version absente : l action est REFUSÉE, jamais appliquée à la version courante', async () => {
    addCriterion(TASK, { title: 'Sans version', methods: ['unit_test'] });
    await pending('AC-05');   // version 1, à valider
    // un jugement forgé sur une ANCIENNE phase, sans version : le daemon ne
    // doit PAS le replier sur la version courante
    const applied = applyVerifierActions(TASK, {
      review: 'ok',
      actions: [{ op: 'approve', ref: 'AC-05', comment: 'jugement sans version' }],
    });
    expect(applied).toEqual([]);
    expect(getCriterion(TASK, 'AC-05')!.status).toBe('to_validate');
    expect(getCriterion(TASK, 'AC-05')!.validated_at).toBeNull();
    // même garde pour reject sans version
    const applied2 = applyVerifierActions(TASK, {
      review: 'issues',
      actions: [{ op: 'reject', ref: 'AC-05', reason: 'sans version' }],
    });
    expect(applied2).toEqual([]);
    expect(getCriterion(TASK, 'AC-05')!.status).toBe('to_validate');
    // la compatibilité interne (fonction directe sans version) reste valable :
    // c'est le chemin test, jamais le JSON du LLM
    const internal = await import('../src/criteria.mts');
    internal.approveCriterion(TASK, 'AC-05', 'compatibilité interne');
    expect(getCriterion(TASK, 'AC-05')!.status).toBe('validated');
  });
});
