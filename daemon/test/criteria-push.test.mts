/**
 * Tests du flux critères de l'analyste : parsing de `criteria_note`,
 * message déterministe de rappel, et création PROACTIVE du vérificateur pour
 * toute tâche (même sans critère, comme le compagnon).
 *
 * Base SQLite temporaire (imports dynamiques + garde-fou) ; le réseau est
 * simulé par un fetch de remplacement.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SUPERVISEUR_DATA_DIR = mkdtempSync(join(tmpdir(), 'criteria-push-test-'));
process.env.HOME = mkdtempSync(join(tmpdir(), 'criteria-push-home-'));
const state = await import('../src/state.mts');
const criteria = await import('../src/criteria.mts');
const verdict = await import('../src/verdict.mts');

// garde-fou anti-catastrophe (comme criteria.test.mts)
const boundFile = (state.db as unknown as { query: Function }).query('pragma database_list').all()
  .map((r: { file?: string }) => r.file ?? '').join(',');
if (!boundFile.includes('criteria-push-test-')) {
  process.exitCode = 1;
  throw new Error(`criteria-push.test : base SQLite ${boundFile} n'est pas une base de test : on n'écrit rien. Lancer ce fichier SEUL.`);
}

import { describe, expect, test } from 'bun:test';
const { addCriterion, criteriaCounts, criteriaPushMessage, listCriteria } = criteria;
const { normalizeVerdict } = verdict;

const TASK = 'ses_test_push';

describe('criteriaPushMessage', () => {
  test('sans critère : le rappel demande d\'en définir', () => {
    expect(criteriaPushMessage([])).toContain('aucun critère');
    expect(criteriaPushMessage([])).toContain('criteria_add');
  });

  test('critères restants : la liste des refs et leurs états', () => {
    addCriterion(TASK, { title: 'A', methods: ['unit_test'] });
    addCriterion(TASK, { title: 'B', methods: ['unit_test'] });
    const rows = listCriteria(TASK);
    const msg = criteriaPushMessage(rows);
    expect(msg).toContain('AC-01 (à faire)');
    expect(msg).toContain('AC-02 (à faire)');
    expect(msg).toContain('criteria_to_validate');
  });

  test('tout validé : rien à pousser (null)', () => {
    const rows = listCriteria(TASK);
    expect(criteriaCounts(rows).total).toBe(2);
    // les deux passent en validé via les transitions daemon
    for (const r of rows) {
      criteria.submitEvidence(TASK, r.ref, [{ kind: 'text', text: 'ok' }]);
      criteria.approveCriterion(TASK, r.ref, 'ok');
    }
    expect(criteriaPushMessage(listCriteria(TASK))).toBeNull();
  });
});

describe('criteria_note (contrat analyste)', () => {
  const baseCtx = {
    busy: false,
    wait: { waiting: false, source: 'none' as const, ask: '' },
    objectiveChanged: false,
    objective: 'objectif',
  };

  test('la note est parse, nettoyée et tronquée', () => {
    const norm = normalizeVerdict({ state: 'done', summary: 'Livré.', criteria_note: 'Définis tes critères avec criteria_add.' }, baseCtx);
    expect(norm.criteriaNote).toBe('Définis tes critères avec criteria_add.');
  });

  test('absente : chaîne vide (le daemon retombe sur le message déterministe)', () => {
    const norm = normalizeVerdict({ state: 'done', summary: 'Livré.' }, baseCtx);
    expect(norm.criteriaNote).toBe('');
  });
});

describe('vérificateur : création proactive', () => {
  test('une tâche sans critère reçoit quand même sa sous-conversation', async () => {    const { upsertTaskState } = state;
    upsertTaskState(TASK, { title: 'Sans critères' });
    // annuaire simulé : une tâche top-level sans critère
    const sessions = [{ id: TASK, title: 'Sans critères', time: {} }];
    const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      calls.push({ path, body });
      if (path.startsWith('/api/session') && init?.method === 'POST' && !path.includes('/send') && !path.includes('/prompt')) {
        return new Response(JSON.stringify({ data: { id: 'ses_verif_new' } }), { status: 200 });
      }
      if (path.includes('/message')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      if (path.startsWith('/api/session/')) return new Response(JSON.stringify({ data: { id: path.split('/')[3], time: {} } }), { status: 200 });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const { verifierTick, resetVerifierState } = await import('../src/verifier.mts');
    try {
      resetVerifierState();
      await verifierTick(sessions, { [TASK]: { status: 'idle' } });
      // la création est lancée en tâche de fond : attendre qu'elle aboutisse
      for (let i = 0; i < 40 && !state.getVerifier(TASK); i++) {
        await new Promise(r => setTimeout(r, 25));
      }
      expect(state.getVerifier(TASK)?.verifierId).toBe('ses_verif_new');
      // aucun appel de phase (pas de criteria, pas de kick) : pas de send au vérificateur
      expect(calls.some(c => c.path.includes('/send'))).toBe(false);
      // un second tick ne recrée pas (mapping existant)
      const createCalls = calls.filter(c => c.path === '/api/session' && (c.body as { parentID?: string }).parentID === TASK).length;
      await verifierTick(sessions, { [TASK]: { status: 'idle' } });
      await new Promise(r => setTimeout(r, 60));
      expect(calls.filter(c => c.path === '/api/session' && (c.body as { parentID?: string }).parentID === TASK).length).toBe(createCalls);
    } finally {
      globalThis.fetch = originalFetch;
      resetVerifierState();
    }
  });

  test('un redémarrage ne relance pas de phase à vide (signature persistée)', async () => {
    const TASK2 = 'ses_test_restart';
    const { putVerifier, setVerifierSignature, getVerifier } = state;
    const crit = criteria;
    crit.addCriterion(TASK2, { title: 'Déjà jugé', methods: ['unit_test'] });
    crit.submitEvidence(TASK2, 'AC-01', [{ kind: 'text', text: 'preuve' }]);
    crit.approveCriterion(TASK2, 'AC-01', 'ok');
    // état « déjà jugé » persisté (comme après une phase réussie)
    putVerifier(TASK2, 'ses_verif_restart', 'superviseur-verificateur');
    setVerifierSignature(TASK2, crit.criteriaSignature(TASK2));
    expect(getVerifier(TASK2)?.signature).toBe(crit.criteriaSignature(TASK2));

    const { verifierTick, resetVerifierState } = await import('../src/verifier.mts');
    const originalFetch = globalThis.fetch;
    const sends: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      if (path.includes('/send')) { sends.push(path); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
      if (path.includes('/message')) {
        // si une phase partait, elle trouverait une réponse no-op
        return new Response(JSON.stringify({ data: [{ id: 'm1', type: 'assistant', time: { created: Date.now() }, content: [{ type: 'text', text: '{"review":"ok","notes":"","actions":[]}' }] }] }), { status: 200 });
      }
      if (path.startsWith('/api/session/')) return new Response(JSON.stringify({ data: { id: path.split('/')[3], time: {} } }), { status: 200 });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    try {
      // « redémarrage » : mémoire du daemon vide, DB intacte
      resetVerifierState();
      await verifierTick([{ id: TASK2, title: 'Déjà jugé', time: {} }], { [TASK2]: { status: 'idle' } });
      await new Promise(r => setTimeout(r, 200));
      expect(sends.filter(s => s.includes('ses_verif_restart'))).toEqual([]);
      // un changement d'état (invalidation par update) relance bien la phase
      crit.updateCriterion(TASK2, 'AC-01', { detail: 'détail précisé' });
      resetVerifierState();
      await verifierTick([{ id: TASK2, title: 'Déjà jugé', time: {} }], { [TASK2]: { status: 'idle' } });
      for (let i = 0; i < 40 && sends.length === 0; i++) await new Promise(r => setTimeout(r, 50));
      expect(sends.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
      resetVerifierState();
    }
  });
});
