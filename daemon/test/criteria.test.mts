/**
 * Machine à états des critères d'acceptation, sur une base SQLite temporaire.
 * Garde de la leçon du 2026-11-07 : JAMAIS la base de production ; le dossier
 * de données est redirigé avant l'import de state.mts (imports dynamiques :
 * les imports statiques seraient hissés AVANT l'affectation d'env) et on
 * refuse toute écriture si la base liée n'est pas une base de test.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SUPERVISEUR_DATA_DIR = mkdtempSync(join(tmpdir(), 'criteria-test-'));
const state = await import('../src/state.mts');
const criteria = await import('../src/criteria.mts');

// garde-fou anti-catastrophe (comme resume.test.mts) : en batch, state.mts peut
// pointer sur la vraie base ; on refuse alors toute écriture.
const boundFile = (state.db as unknown as { query: Function }).query('pragma database_list').all()
  .map((r: { file?: string }) => r.file ?? '').join(',');
if (!boundFile.includes('criteria-test-')) {
  process.exitCode = 1;
  throw new Error(`criteria.test : base SQLite ${boundFile} n'est pas une base de test : on n'écrit rien. Lancer ce fichier SEUL.`);
}

import { describe, expect, test } from 'bun:test';
const {
  CriteriaError, addCriterion, approveCriterion, criteriaCounts, criteriaSignature,
  getCriterion, listCriteria, nextRef, rejectCriterion, removeCriterion,
  submitEvidence, updateCriterion, proposeRemoval,
} = criteria;

const TASK = 'ses_test_criteria';

/** dossier projet réel pour les preuves à chemin */
const dataDir = process.env.SUPERVISEUR_DATA_DIR as string;
const projectDir = join(dataDir, 'project');
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync(projectDir, { recursive: true });
writeFileSync(join(projectDir, 'report.txt'), 'sortie de test');

function addBase() {
  return addCriterion(TASK, { title: 'Tests passent', detail: 'bun test', methods: ['unit_test'] });
}

describe('criteria : machine à états', () => {
  test('add crée AC-01 puis AC-02, en « à faire »', () => {
    const c1 = addBase();
    expect(c1.ref).toBe('AC-01');
    expect(c1.status).toBe('todo');
    const c2 = addCriterion(TASK, { title: 'Build passe', methods: ['command'] });
    expect(c2.ref).toBe('AC-02');
    expect(criteriaCounts(listCriteria(TASK))).toEqual({ total: 2, todo: 2, toValidate: 0, toFix: 0, validated: 0 });
  });

  test('méthode inconnue et vide refusées', () => {
    expect(() => addCriterion(TASK, { title: 'X', methods: ['magie'] })).toThrow(CriteriaError);
    expect(() => addCriterion(TASK, { title: 'X', methods: [] })).toThrow(CriteriaError);
    expect(() => addCriterion(TASK, { title: 'X' })).toThrow(CriteriaError);
  });

  test('to_validate exige une preuve et part de « à faire » ou « à corriger »', async () => {
    const c = getCriterion(TASK, 'AC-01')!;
    await expect(submitEvidence(TASK, c.ref, [], projectDir)).rejects.toThrow(CriteriaError);
    const after = await submitEvidence(TASK, c.ref, [{ kind: 'command', text: 'bun test : 12 pass' }], projectDir);
    expect(after.status).toBe('to_validate');
    expect(after.evidence[0].kind).toBe('command');
    // re-soumission depuis « à valider » : refusée
    await expect(submitEvidence(TASK, c.ref, [{ kind: 'text', text: 'x' }], projectDir)).rejects.toThrow();
  });

  test('preuve à chemin inexistant refusée au dépôt', async () => {
    const c = addCriterion(TASK, { title: 'Capture du rendu', methods: ['screenshot'] });
    await expect(submitEvidence(TASK, c.ref, [{ kind: 'screenshot', text: 'voir', path: 'inconnu.png' }], projectDir))
      .rejects.toMatchObject({ code: 'evidence_path_missing' });
    const ok = await submitEvidence(TASK, c.ref, [{ kind: 'artifact', text: 'lire report.txt', path: 'report.txt' }], projectDir);
    expect(ok.status).toBe('to_validate');
    expect(ok.evidence[0].path).toBe('report.txt');
  });

  test('approve et reject ne partent que de « à valider »', () => {
    approveCriterion(TASK, 'AC-01', 'tests visibles');
    expect(getCriterion(TASK, 'AC-01')!.status).toBe('validated');
    expect(getCriterion(TASK, 'AC-01')!.validated_at).toBeGreaterThan(0);
    expect(() => approveCriterion(TASK, 'AC-01', 'encore')).toThrow(CriteriaError);
    expect(() => rejectCriterion(TASK, 'AC-01', 'raison')).toThrow(CriteriaError);
  });

  test('version : chaque preuve ou contenu incrémente ; un jugement sur une autre version est périmé', async () => {
    const c = getCriterion(TASK, 'AC-02')!;
    expect(c.version).toBe(0);
    const after = await submitEvidence(TASK, c.ref, [{ kind: 'command', text: 'bun test : 12 pass' }], projectDir);
    expect(after.version).toBe(1);
    // jugement sur la version 0 (périmé) : ignoré, le critère reste « à valider »
    expect(() => approveCriterion(TASK, c.ref, 'obsolète', 0)).toThrow(/périmé/);
    expect(() => rejectCriterion(TASK, c.ref, 'obsolète aussi', 0)).toThrow(/périmé/);
    expect(getCriterion(TASK, c.ref)!.status).toBe('to_validate');
    // rejet à la bonne version, puis l'agent resoumet (l'ancien jugement ne suit pas)
    const rejected = rejectCriterion(TASK, c.ref, 'la sortie ne montre pas le bon fichier', 1);
    expect(rejected.status).toBe('to_fix');
    const after2 = await submitEvidence(TASK, c.ref, [{ kind: 'command', text: 'bun test : 13 pass' }], projectDir);
    expect(after2.version).toBe(2);
    // un jugement visant la version 1 ne touche pas la version 2
    expect(() => approveCriterion(TASK, c.ref, 'périmé', 1)).toThrow(/périmé/);
    expect(getCriterion(TASK, c.ref)!.status).toBe('to_validate');
    // un update de contenu repasse « à faire » et incrémente
    const updated = updateCriterion(TASK, c.ref, { detail: 'nouveau détail plus précis' });
    expect(updated.status).toBe('todo');
    expect(updated.version).toBe(3);
    expect(updated.evidence).toEqual([]);
    expect(updated.review).toBeNull();
    expect(updated.validated_at).toBeNull();
  });

  test('reject exige une raison et pose « à corriger », puis une nouvelle preuve repart', async () => {
    const c = getCriterion(TASK, 'AC-02')!;
    await submitEvidence(TASK, c.ref, [{ kind: 'text', text: 'préuve faible' }], projectDir);
    expect(() => rejectCriterion(TASK, c.ref, '')).toThrow(CriteriaError);
    const rejected = rejectCriterion(TASK, c.ref, 'la sortie ne montre pas le bon fichier');
    expect(rejected.status).toBe('to_fix');
    expect(rejected.review).toContain('bon fichier');
    const again = await submitEvidence(TASK, c.ref, [{ kind: 'artifact', text: 'lire report.txt', path: 'report.txt' }], projectDir);
    expect(again.status).toBe('to_validate');
    expect(again.review).toBeNull();
  });

  test('update d\'un critère non « à faire » le repasse « à faire » et invalide la preuve', async () => {
    const c = getCriterion(TASK, 'AC-02')!;
    const updated = updateCriterion(TASK, c.ref, { detail: 'nouveau détail plus précis' });
    expect(updated.status).toBe('todo');
    expect(updated.evidence).toEqual([]);
    expect(updated.review).toBeNull();
    // update d'un critère « à faire » : il reste « à faire »
    const updated2 = updateCriterion(TASK, c.ref, { title: 'Build passe (retitré)' });
    expect(updated2.status).toBe('todo');
    expect(updated2.title).toBe('Build passe (retitré)');
  });

  test('remove supprime la ligne ; la ref n\'est jamais réattribuée', () => {
    removeCriterion(TASK, 'AC-01');
    expect(getCriterion(TASK, 'AC-01')).toBeNull();
    // suppression DOUCE : l'historique reste lisible (includeRemoved)
    const ghost = getCriterion(TASK, 'AC-01', { includeRemoved: true });
    expect(ghost?.removed_at).toBeGreaterThan(0);
    expect(ghost?.title).toBe('Tests passent');
    expect(listCriteria(TASK, { includeRemoved: true }).some(r => r.ref === 'AC-01')).toBe(true);
    expect(listCriteria(TASK).some(r => r.ref === 'AC-01')).toBe(false);
    const c = addCriterion(TASK, { title: 'Critère suivant', methods: ['text'] });
    // AC-03 est pris (Capture du rendu, test précédent) et AC-01 n'est pas réutilisé
    expect(c.ref).toBe('AC-04');
    expect(nextRef(TASK)).toBe('AC-05');
  });

  test('proposition de retrait du vérificateur : le critère reste en place', () => {
    const before = listCriteria(TASK).length;
    const c = getCriterion(TASK, 'AC-04')!;
    const proposed = proposeRemoval(TASK, c.ref, 'doublon de AC-02');
    expect(proposed.status).toBe(c.status);           // aucun changement d'état
    expect(proposed.remove_proposed_at).toBeGreaterThan(0);
    expect(proposed.remove_reason).toBe('doublon de AC-02');
    expect(listCriteria(TASK).length).toBe(before);   // rien n'est supprimé
    // idempotente à raison identique (updated_at inchangé)
    const again = proposeRemoval(TASK, c.ref, 'doublon de AC-02');
    expect(again.updated_at).toBe(proposed.updated_at);
    // un contenu modifié efface la proposition
    const updated = updateCriterion(TASK, c.ref, { detail: 'détail affiné' });
    expect(updated.remove_proposed_at).toBeNull();
    expect(updated.remove_reason).toBeNull();
  });

  test('plafond : porte sur les critères NON validés ; un validé libère une place', async () => {
    const before = listCriteria(TASK).length;
    try {
      for (let i = before; i < 12; i++) addCriterion(TASK, { title: `Critère ${i + 1}`, methods: ['text'] });
      // 12 en attente (todo) : le plafond refuse
      expect(() => addCriterion(TASK, { title: 'Trop', methods: ['text'] })).toThrow(CriteriaError);
      // une validation repasse la place : le critère validé est de l'histoire
      const first = listCriteria(TASK)[0];
      await submitEvidence(TASK, first.ref, [{ kind: 'command', text: 'sortie de test du plafond' }], projectDir);
      approveCriterion(TASK, first.ref, 'validé pour le test');
      const added = addCriterion(TASK, { title: 'Critère après validation', methods: ['text'] });
      expect(added.status).toBe('todo');
    } finally {
      // nettoyage pour les tests suivants
      for (const r of listCriteria(TASK).slice(4)) removeCriterion(TASK, r.ref);
    }
    expect(listCriteria(TASK).length).toBe(4);
  });

  test('signature : change à chaque transition, stable sinon', async () => {
    const s1 = criteriaSignature(TASK);
    const c = getCriterion(TASK, 'AC-04')!;   // « Critère suivant », en « à faire »
    await submitEvidence(TASK, c.ref, [{ kind: 'text', text: 'ok' }], projectDir);
    expect(criteriaSignature(TASK)).not.toBe(s1);
    expect(criteriaSignature(TASK)).toBe(criteriaSignature(TASK));
  });
});
