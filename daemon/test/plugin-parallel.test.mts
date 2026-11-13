/**
 * Courses d'écriture des plugins superviseur-criteria et superviseur-plan :
 * des tool calls lancés EN PARALLÈLE (plusieurs criteria_add ou planupdate
 * dans un même tour) lisaient-modifiaient-écrivaient en concurrence et le
 * dernier écrivain écrasait les autres (constaté le 2026-11-13 : des
 * criteria_add parallèles ont réduit une liste de 5 aux 2 derniers).
 *
 * Le test monte chaque plugin avec un ctx factice (storage en Map, registre
 * de tools), tire les appels avec Promise.all et vérifie que TOUT survit.
 * Aucune base ouverte.
 */
import { describe, expect, test } from 'bun:test';

import criteriaPlugin from '../plugin/superviseur-criteria/index.js';
import planPlugin from '../plugin/superviseur-plan/index.js';

function makeCtx() {
  const store = new Map();
  const tools = new Map();
  const ctx = {
    storage: {
      get: async (k) => store.get(k),
      set: async (k, v) => { store.set(k, v); },
    },
    tool: {
      transform: async (fn) => fn({ add: (t) => tools.set(t.name, t) }),
    },
    session: {
      hook: async () => {},
    },
  };
  return { store, tools, ctx };
}

describe('courses parallèles : plugin criteria', () => {
  test('six criteria_add parallèles donnent six critères AC-01..AC-06', async () => {
    const { tools, ctx } = makeCtx();
    await criteriaPlugin.setup(ctx);
    const add = tools.get('criteria_add');
    expect(add).toBeDefined();

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        add.execute({ title: `Critère ${i + 1}`, methods: ['text'] }, { sessionID: 's-par-add' })),
    );

    // le dernier de la file voit la liste complète
    expect(results[5].metadata.counts.total).toBe(6);
    const list = await tools.get('criteria_list').execute({}, { sessionID: 's-par-add' });
    expect(list.metadata.criteria.map((c) => c.ref)).toEqual(['AC-01', 'AC-02', 'AC-03', 'AC-04', 'AC-05', 'AC-06']);
  });

  test('des criteria_set_status parallèles appliquent tous les jugements', async () => {
    const { tools, ctx } = makeCtx();
    await criteriaPlugin.setup(ctx);
    const add = tools.get('criteria_add');
    await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        add.execute({ title: `C${i}`, methods: ['text'] }, { sessionID: 's-par-status' })),
    );
    const judge = tools.get('criteria_set_status');
    const results = await Promise.all(
      ['AC-01', 'AC-02', 'AC-03', 'AC-04'].map((ref) =>
        judge.execute({ ref, status: 'validated', note: 'vu au test' }, { sessionID: 's-par-status' })),
    );
    expect(results[3].metadata.counts.validated).toBe(4);
    const list = await tools.get('criteria_list').execute({}, { sessionID: 's-par-status' });
    expect(list.metadata.counts).toEqual({ total: 4, todo: 0, toValidate: 0, toFix: 0, validated: 4 });
  });
});

describe('courses parallèles : plugin plan', () => {
  test('cinq planupdate parallèles appliquent les cinq statuts', async () => {
    const { tools, ctx } = makeCtx();
    await planPlugin.setup(ctx);
    const write = tools.get('planwrite');
    await write.execute({
      items: Array.from({ length: 5 }, (_, i) => ({ content: `Étape ${i + 1}`, status: 'pending', priority: 'medium' })),
    }, { sessionID: 's-par-plan' });

    const update = tools.get('planupdate');
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((num) =>
        update.execute({ updates: [{ num, status: 'completed' }] }, { sessionID: 's-par-plan' })),
    );
    expect(results[4].metadata.todos.every((t) => t.status === 'completed')).toBe(true);

    const read = await tools.get('planread').execute({}, { sessionID: 's-par-plan' });
    expect(read.metadata.todos.filter((t) => t.status === 'completed').length).toBe(5);
  });

  test('planwrite et planupdate parallèles ne se perdent pas', async () => {
    const { tools, ctx } = makeCtx();
    await planPlugin.setup(ctx);
    const write = tools.get('planwrite');
    const update = tools.get('planupdate');
    // un planwrite (remplace la liste) et un planupdate partent en même temps :
    // ils composent dans l'ordre d'arrivée, rien n'est perdu
    await Promise.all([
      write.execute({
        items: [
          { content: 'A', status: 'pending', priority: 'high' },
          { content: 'B', status: 'pending', priority: 'medium' },
        ],
      }, { sessionID: 's-par-mix' }),
      update.execute({ updates: [{ num: 1, status: 'in_progress' }] }, { sessionID: 's-par-mix' }).catch(() => null),
    ]);
    const read = await tools.get('planread').execute({}, { sessionID: 's-par-mix' });
    expect(read.metadata.todos.length).toBe(2);
  });
});
