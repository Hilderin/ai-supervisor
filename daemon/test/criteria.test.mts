/**
 * Machine à états des critères d'acceptation, sur une base SQLite temporaire.
 * Garde de la leçon du 2026-11-07 : JAMAIS la base de production ; le dossier
 * de données est redirigé avant l'import de state.mts (imports dynamiques :
 * les imports statiques seraient hissés AVANT l'affectation d'env) et on
 * refuse toute écriture si la base liée n'est pas une base de test.
 *
 * Flux 2026-11-12 : l'agent juge lui-même (criteria_set_status) ; plus de
 * transitions vérificateur.
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
  CriteriaError, addCriterion, criteriaCounts,
  getCriterion, listCriteria, nextRef, removeCriterion,
  setStatusCriterion, submitEvidence, updateCriterion,
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

  test('set_status validated : depuis « à valider », note et horodatage enregistrés', () => {
    const c = getCriterion(TASK, 'AC-01')!;
    const ok = setStatusCriterion(TASK, c.ref, 'validated', 'sortie de test vue, 12 pass');
    expect(ok.status).toBe('validated');
    expect(ok.review).toContain('12 pass');
    expect(ok.validated_at).toBeGreaterThan(0);
    expect(ok.validated_work).toBeTruthy();
    // un critère déjà validé peut être re-marqué (re-jugement), sans erreur
    const again = setStatusCriterion(TASK, c.ref, 'validated', 'revérifié');
    expect(again.status).toBe('validated');
  });

  test('set_status to_fix : raison obligatoire, depuis n importe quel état vivant', () => {
    const c = getCriterion(TASK, 'AC-02')!;
    // depuis « à faire » : autorisé (l'agent se corrige lui-même)
    expect(() => setStatusCriterion(TASK, c.ref, 'to_fix', '')).toThrow(CriteriaError);
    const fixed = setStatusCriterion(TASK, c.ref, 'to_fix', 'la sortie ne montre pas le bon fichier');
    expect(fixed.status).toBe('to_fix');
    expect(fixed.review).toContain('bon fichier');
    expect(fixed.validated_at).toBeNull();
    // depuis « à corriger », une validation directe repart (re-jugement)
    const ok = setStatusCriterion(TASK, c.ref, 'validated', 'corrigé et revérifié');
    expect(ok.status).toBe('validated');
  });

  test('set_status refuse un statut inconnu et une ref inconnue', () => {
    expect(() => setStatusCriterion(TASK, 'AC-01', 'todo' as 'validated', 'x')).toThrow(CriteriaError);
    expect(() => setStatusCriterion(TASK, 'AC-99', 'validated', 'x')).toThrow(CriteriaError);
  });

  test('version : chaque preuve, jugement ou contenu incrémente', async () => {
    const c = getCriterion(TASK, 'AC-02')!;
    // AC-02 est « validé » (test précédent) : un re-jugement « à corriger »
    // repart, puis une nouvelle preuve se soumet depuis « à corriger »
    const judged0 = setStatusCriterion(TASK, c.ref, 'to_fix', 'revérification : la preuve ne tient plus');
    expect(judged0.status).toBe('to_fix');
    const after = await submitEvidence(TASK, c.ref, [{ kind: 'command', text: 'bun test : 13 pass' }], projectDir);
    expect(after.status).toBe('to_validate');
    const v1 = after.version;
    const judged = setStatusCriterion(TASK, c.ref, 'to_fix', 'raison du re-jugement');
    expect(judged.version).toBe(v1 + 1);
    // une nouvelle preuve repart depuis « à corriger »
    const after2 = await submitEvidence(TASK, c.ref, [{ kind: 'command', text: 'bun test : 14 pass' }], projectDir);
    expect(after2.version).toBe(v1 + 2);
    // un update de contenu repasse « à faire » et incrémente
    const updated = updateCriterion(TASK, c.ref, { detail: 'nouveau détail plus précis' });
    expect(updated.status).toBe('todo');
    expect(updated.evidence).toEqual([]);
    expect(updated.review).toBeNull();
    expect(updated.validated_at).toBeNull();
  });

  test('update d un critère non « à faire » le repasse « à faire » et invalide la preuve', async () => {
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

  test('remove supprime la ligne ; la ref n est jamais réattribuée', () => {
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

  test('plafond : porte sur les critères NON validés ; un validé libère une place', async () => {
    const before = listCriteria(TASK).length;
    try {
      for (let i = before; i < 12; i++) addCriterion(TASK, { title: `Critère ${i + 1}`, methods: ['text'] });
      // 12 en attente (todo) : le plafond refuse
      expect(() => addCriterion(TASK, { title: 'Trop', methods: ['text'] })).toThrow(CriteriaError);
      // une validation repasse la place : le critère validé est de l'histoire
      const first = listCriteria(TASK)[0];
      await submitEvidence(TASK, first.ref, [{ kind: 'command', text: 'sortie de test du plafond' }], projectDir);
      setStatusCriterion(TASK, first.ref, 'validated', 'validé pour le test');
      const added = addCriterion(TASK, { title: 'Critère après validation', methods: ['text'] });
      expect(added.status).toBe('todo');
    } finally {
      // nettoyage pour les tests suivants
      for (const r of listCriteria(TASK).slice(4)) removeCriterion(TASK, r.ref);
    }
    expect(listCriteria(TASK).length).toBe(4);
  });
});
