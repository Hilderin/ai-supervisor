/**
 * Machine à états PURE des critères (plugin superviseur-criteria/state.js).
 *
 * Depuis la migration « critères natifs session » (2026-11-13), la logique vit
 * DANS le plugin : ce fichier la teste directement, sans base SQLite (state.js
 * ne touche aucune base) et sans OpenCode. Seul un dossier projet de test sert
 * aux preuves à chemin.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const projectDir = join(mkdtempSync(join(tmpdir(), 'criteria-state-')), 'project');
mkdirSync(projectDir, { recursive: true });
writeFileSync(join(projectDir, 'report.txt'), 'sortie de test');
writeFileSync(join(projectDir, 'capture.png'), 'png');

import { describe, expect, test } from 'bun:test';
import {
  CriteriaError, addCriterion, criteriaCounts, criteriaView, getCriterion,
  importCriteria, listCriteria, nextRef, normalizeState, removeCriterion,
  setStatusCriterion, submitEvidence, updateCriterion,
} from '../plugin/superviseur-criteria/state.js';

function fresh() {
  return normalizeState([]);
}

describe('criteria-state : add et refs', () => {
  test('add crée AC-01 puis AC-02, en « à faire »', () => {
    const s = fresh();
    const c1 = addCriterion(s, { title: 'Tests passent', detail: 'bun test', methods: ['unit_test'] });
    expect(c1.ref).toBe('AC-01');
    expect(c1.status).toBe('todo');
    const c2 = addCriterion(s, { title: 'Build passe', methods: ['command'] });
    expect(c2.ref).toBe('AC-02');
    expect(criteriaCounts(listCriteria(s))).toEqual({ total: 2, todo: 2, toValidate: 0, toFix: 0, validated: 0 });
  });

  test('méthode inconnue et vide refusées', () => {
    const s = fresh();
    expect(() => addCriterion(s, { title: 'X', methods: ['magie'] })).toThrow(CriteriaError);
    expect(() => addCriterion(s, { title: 'X', methods: [] })).toThrow(CriteriaError);
    expect(() => addCriterion(s, { title: 'X' })).toThrow(CriteriaError);
  });

  test('un retrait ne libère pas son numéro (ref jamais réattribuée)', () => {
    const s = fresh();
    addCriterion(s, { title: 'A', methods: ['text'] });
    addCriterion(s, { title: 'B', methods: ['text'] });
    removeCriterion(s, 'AC-02');
    expect(nextRef(s)).toBe('AC-03');
    expect(listCriteria(s).map(r => r.ref)).toEqual(['AC-01']);
    // suppression douce : la ligne reste dans l'historique
    expect(listCriteria(s, { includeRemoved: true }).some(r => r.ref === 'AC-02' && r.removed_at != null)).toBe(true);
  });

  test('plafond de 12 critères NON validés ; une validation libère une place', () => {
    const s = fresh();
    for (let i = 0; i < 12; i++) addCriterion(s, { title: `C${i}`, methods: ['text'] });
    expect(() => addCriterion(s, { title: '13e', methods: ['text'] })).toThrow(CriteriaError);
    setStatusCriterion(s, 'AC-01', 'validated', 'vu au test');
    const c13 = addCriterion(s, { title: '13e', methods: ['text'] });
    expect(c13.ref).toBe('AC-13');
  });
});

describe('criteria-state : preuves et jugement', () => {
  test('to_validate exige une preuve et part de « à faire » ou « à corriger »', async () => {
    const s = fresh();
    addCriterion(s, { title: 'Tests passent', methods: ['unit_test'] });
    await expect(submitEvidence(s, 'AC-01', [], projectDir)).rejects.toThrow(CriteriaError);
    const after = await submitEvidence(s, 'AC-01', [{ kind: 'command', text: 'bun test : 12 pass' }], projectDir);
    expect(after.status).toBe('to_validate');
    expect(after.evidence[0].kind).toBe('command');
    // re-soumission depuis « à valider » : refusée
    await expect(submitEvidence(s, 'AC-01', [{ kind: 'text', text: 'x' }], projectDir)).rejects.toThrow();
  });

  test('preuve à chemin inexistant refusée au dépôt ; chemin valide normalisé', async () => {
    const s = fresh();
    addCriterion(s, { title: 'Capture du rendu', methods: ['screenshot'] });
    await expect(submitEvidence(s, 'AC-01', [{ kind: 'screenshot', text: 'voir', path: 'inconnu.png' }], projectDir))
      .rejects.toMatchObject({ code: 'evidence_path_missing' });
    const ok = await submitEvidence(s, 'AC-01', [
      { kind: 'artifact', text: 'lire report.txt', path: 'report.txt' },
      { kind: 'screenshot', text: 'voir', path: 'capture.png' },
    ], projectDir);
    expect(ok.status).toBe('to_validate');
    expect(ok.evidence[0].path).toBe('report.txt');
  });

  test('chemin absolu et sortie du projet refusés', async () => {
    const s = fresh();
    addCriterion(s, { title: 'Preuve', methods: ['artifact'] });
    await expect(submitEvidence(s, 'AC-01', [{ kind: 'artifact', text: 'x', path: 'C:\\temp\\x.txt' }], projectDir))
      .rejects.toMatchObject({ code: 'invalid_evidence' });
    await expect(submitEvidence(s, 'AC-01', [{ kind: 'artifact', text: 'x', path: '../hors.txt' }], projectDir))
      .rejects.toMatchObject({ code: 'invalid_evidence' });
  });

  test('code_excerpt exige path, start_line et line_count', async () => {
    const s = fresh();
    addCriterion(s, { title: 'Extrait', methods: ['code_excerpt'] });
    await expect(submitEvidence(s, 'AC-01', [{ kind: 'code_excerpt', text: 'x', path: 'report.txt' }], projectDir))
      .rejects.toMatchObject({ code: 'invalid_evidence' });
    const ok = await submitEvidence(s, 'AC-01', [
      { kind: 'code_excerpt', text: 'x', path: 'report.txt', start_line: 1, line_count: 5 },
    ], projectDir);
    expect(ok.evidence[0].start_line).toBe(1);
    expect(ok.evidence[0].line_count).toBe(5);
  });

  test('set_status validated : note portée, validated_work horodaté', () => {
    const s = fresh();
    addCriterion(s, { title: 'Tests passent', methods: ['unit_test'] });
    const c = setStatusCriterion(s, 'AC-01', 'validated', 'bun test vu passer');
    expect(c.status).toBe('validated');
    expect(c.review).toContain('bun test');
    expect(c.validated_at).toBeGreaterThan(0);
    const work = JSON.parse(c.validated_work ?? '{}') as { at: number };
    expect(work.at).toBeGreaterThan(0); // pas git : commit null, horodatage présent
  });

  test('set_status to_fix exige une raison', () => {
    const s = fresh();
    addCriterion(s, { title: 'Build passe', methods: ['command'] });
    expect(() => setStatusCriterion(s, 'AC-01', 'to_fix', '')).toThrow(CriteriaError);
    const c = setStatusCriterion(s, 'AC-01', 'to_fix', 'build rouge : import manquant');
    expect(c.status).toBe('to_fix');
    expect(criteriaCounts(listCriteria(s)).toFix).toBe(1);
  });

  test('ref inconnue : erreur structurée', () => {
    const s = fresh();
    expect(() => setStatusCriterion(s, 'AC-99', 'validated', 'x')).toThrow(CriteriaError);
  });
});

describe('criteria-state : update et invalidation', () => {
  test('un critère non todo repasse todo, sa preuve est invalidée', async () => {
    const s = fresh();
    addCriterion(s, { title: 'Tests passent', methods: ['unit_test'] });
    await submitEvidence(s, 'AC-01', [{ kind: 'command', text: 'ok' }], projectDir);
    setStatusCriterion(s, 'AC-01', 'validated', 'vu');
    const before = getCriterion(s, 'AC-01')!;
    expect(before.version).toBe(2); // preuve + jugement

    const after = updateCriterion(s, 'AC-01', { title: 'Tests passent TOUS' });
    expect(after.status).toBe('todo');
    expect(after.evidence).toEqual([]);
    expect(after.review).toBeNull();
    expect(after.validated_at).toBeNull();
    expect(after.validated_work).toBeNull();
    expect(after.version).toBe(3);
    expect(criteriaCounts(listCriteria(s)).todo).toBe(1);
  });

  test('update sans champ à modifier refusé', () => {
    const s = fresh();
    addCriterion(s, { title: 'A', methods: ['text'] });
    expect(() => updateCriterion(s, 'AC-01', {})).toThrow(CriteriaError);
  });
});

describe('criteria-state : import (reprise automatique)', () => {
  test('import normalise une liste, dédoublonne les refs, continue au-delà du max', () => {
    const s = importCriteria([
      { ref: 'AC-01', title: 'A', methods: ['text'], status: 'validated', review: 'vu' },
      { ref: 'AC-02', title: 'B', methods: ['command'], status: 'to_fix', review: 'raison' },
      { ref: 'AC-02', title: 'doublon', methods: ['text'], status: 'todo' }, // ref déjà prise
      { title: 'sans ref', methods: ['text'] }, // invalide : rejeté
    ]);
    expect(listCriteria(s).map(r => r.ref)).toEqual(['AC-01', 'AC-02', 'AC-03']);
    expect(getCriterion(s, 'AC-01')!.status).toBe('validated');
    expect(nextRef(s)).toBe('AC-04');
  });

  test('import conserve les preuves historiques sans revalidation', () => {
    const s = importCriteria([
      {
        ref: 'AC-01', title: 'A', methods: ['screenshot'], status: 'to_validate',
        evidence: [{ kind: 'screenshot', text: 'capture', path: 'report.txt', at: 123 }],
      },
    ]);
    expect(getCriterion(s, 'AC-01')!.evidence[0].path).toBe('report.txt');
  });

  test('plafond de refs : AC-99 atteint, erreur explicite', () => {
    const s = importCriteria([{ ref: 'AC-99', title: 'max', methods: ['text'], status: 'todo' }]);
    expect(() => addCriterion(s, { title: 'encore', methods: ['text'] })).toThrow(CriteriaError);
  });
});

describe('criteria-state : vue', () => {
  test('criteriaView porte la liste et les comptes (forme metadata des tools)', () => {
    const s = fresh();
    addCriterion(s, { title: 'A', methods: ['text'] });
    setStatusCriterion(s, 'AC-01', 'validated', 'vu');
    addCriterion(s, { title: 'B', methods: ['text'] });
    const view = criteriaView(s);
    expect(view.ok).toBe(true);
    expect(view.counts).toEqual({ total: 2, todo: 1, toValidate: 0, toFix: 0, validated: 1 });
    expect(view.criteria[0].ref).toBe('AC-01');
  });
});

describe('criteria-state : câblage du plugin (setup, tools, hook contexte)', () => {
  /** ctx OpenCode simulé : storage en mémoire, editor qui capture les tools. */
  async function wired() {
    const store = new Map<string, unknown>();
    const pushed: Array<{ type: string; text: string }> = [];
    const hooks: Array<(event: { sessionID: string; system: { push: (b: unknown) => void } }) => Promise<void>> = [];
    const adds: Array<Record<string, unknown>> = [];
    const ctx = {
      storage: {
        get: async (k: string) => store.get(k),
        set: async (k: string, v: unknown) => { store.set(k, v); },
      },
      tool: {
        transform: async (fn: (editor: { add: (t: Record<string, unknown>) => void }) => Promise<void>) => {
          await fn({ add: (t) => adds.push(t) });
        },
      },
      session: {
        hook: async (_name: string, fn: (event: { sessionID: string; system: { push: (b: unknown) => void } }) => Promise<void>) => {
          hooks.push(fn); // capturé, déclenché par fireContext
        },
      },
    };
    const plugin = (await import('../plugin/superviseur-criteria/index.js')).default;
    await plugin.setup(ctx);
    return {
      store,
      pushed,
      adds,
      fireContext: async () => {
        await hooks[0]({ sessionID: 'ses_wired', system: { push: (b: unknown) => pushed.push(b as { type: string; text: string }) } });
      },
      byName: (name: string) => adds.find(t => t.name === name),
      run: async (name: string, input: unknown, directory = projectDir) => {
        const tool = adds.find(t => t.name === name) as { execute: (i: unknown, c: unknown) => Promise<{ content: string; metadata: Record<string, unknown> }> };
        return tool.execute(input, { sessionID: 'ses_wired', directory });
      },
    };
  }

  test('les 7 tools sont enregistrés', async () => {
    const { adds } = await wired();
    expect(adds.map(t => t.name).sort()).toEqual([
      'criteria_add', 'criteria_import', 'criteria_list', 'criteria_remove',
      'criteria_set_status', 'criteria_to_validate', 'criteria_update',
    ]);
  });

  test('add persiste dans le storage, metadata porte {ok, criteria, counts}', async () => {
    const { run, store } = await wired();
    const out = await run('criteria_add', { title: 'Tests passent', methods: ['unit_test'] });
    expect(out.metadata).toMatchObject({ ok: true, counts: { total: 1, todo: 1 } });
    expect((out.metadata.criteria as Array<{ ref: string }>)[0].ref).toBe('AC-01');
    // le storage du plugin porte l'état : criteria_list le relit (nouvelle session simulée)
    const keys = [...store.keys()];
    expect(keys).toEqual(['session/ses_wired']);
    const list = await run('criteria_list', {});
    expect((list.metadata as { counts: { total: number } }).counts.total).toBe(1);
  });

  test('erreur machine : ok:false, code structuré, liste rendue', async () => {
    const { run } = await wired();
    const out = await run('criteria_set_status', { ref: 'AC-99', status: 'validated', note: 'x' });
    expect(out.metadata).toMatchObject({ ok: false, error: 'unknown_ref' });
    expect(Array.isArray(out.metadata.criteria)).toBe(true);
  });

  test('preuve à chemin validée contre le dossier projet du contexte', async () => {
    const { run } = await wired();
    await run('criteria_add', { title: 'Capture', methods: ['screenshot'] });
    const bad = await run('criteria_to_validate', { ref: 'AC-01', evidence: [{ kind: 'screenshot', text: 'voir', path: 'inconnu.png' }] });
    expect(bad.metadata).toMatchObject({ ok: false, error: 'evidence_path_missing' });
    const good = await run('criteria_to_validate', { ref: 'AC-01', evidence: [{ kind: 'artifact', text: 'lire', path: 'report.txt' }] });
    expect(good.metadata).toMatchObject({ ok: true, counts: { toValidate: 1 } });
  });

  test('criteria_import remplace l état', async () => {
    const { run } = await wired();
    await run('criteria_add', { title: 'Temporaire', methods: ['text'] });
    const out = await run('criteria_import', { criteria: [{ ref: 'AC-01', title: 'Importé', methods: ['command'], status: 'to_fix', review: 'raison' }] });
    expect(out.metadata).toMatchObject({ ok: true, counts: { total: 1, toFix: 1 } });
    const list = await run('criteria_list', {});
    expect((list.metadata.criteria as Array<{ title: string }>)[0].title).toBe('Importé');
  });

  test('le hook contexte réinjecte la liste compacte', async () => {
    const { run, fireContext, pushed } = await wired();
    // vide : rien n'est injecté
    const first = await run('criteria_list', {});
    expect(first.metadata.counts.total).toBe(0);
    await fireContext();
    expect(pushed.length).toBe(0);
    await run('criteria_add', { title: 'Tests passent', methods: ['unit_test'] });
    await run('criteria_set_status', { ref: 'AC-01', status: 'validated', note: 'vu' });
    await fireContext();
    const hook = pushed[0] as { type: string; text: string };
    expect(hook.type).toBe('text');
    expect(hook.text).toContain('<criteria_list>');
    expect(hook.text).toContain('1/1 validés');
    expect(hook.text).toContain('AC-01 (validé) Tests passent');
  });
});
