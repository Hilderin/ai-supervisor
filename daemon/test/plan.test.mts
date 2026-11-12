/**
 * Lecteur de plan : extraction, repli lastKnown et persistance plan_known.
 * Garde de la leçon du 2026-11-07 : JAMAIS la base de production ; le dossier
 * de données est redirigé avant l'import de state.mts (imports dynamiques :
 * les imports statiques seraient hissés AVANT l'affectation d'env) et on
 * refuse toute écriture si la base liée n'est pas une base de test.
 *
 * Leçon du 2026-11-12 (ses_e2fa0f250ffefiYkSzP55eg4ks) : le planwrite qui sort
 * de la fenêtre de lecture ne doit plus vider le plan ; le repli survit à
 * invalidatePlan (mémoire) et au redémarrage du daemon (table plan_known).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SUPERVISEUR_DATA_DIR = mkdtempSync(join(tmpdir(), 'plan-test-'));
const plan = await import('../src/plan.mts');
const state = await import('../src/state.mts');

// garde-fou anti-catastrophe (comme criteria.test.mts) : en batch, state.mts
// peut pointer sur la vraie base ; on refuse alors toute écriture.
const boundFile = (state.db as unknown as { query: Function }).query('pragma database_list').all()
  .map((r: { file?: string }) => r.file ?? '').join(',');
if (!boundFile.includes('plan-test-')) {
  process.exitCode = 1;
  throw new Error(`plan.test : base SQLite ${boundFile} n'est pas une base de test : on n'écrit rien. Lancer ce fichier SEUL.`);
}

import { afterAll, describe, expect, test } from 'bun:test';
const { extractPlanItems, normalizePlanItems, planStepsOf, snapshotOf } = plan;

describe('plan : extraction', () => {
  test('normalise une liste du plugin', () => {
    const items = normalizePlanItems([
      { content: 'Lire', status: 'completed', priority: 'high' },
      { content: 'Écrire', status: 'in_progress', priority: 'low' },
      { content: 'Vérifier' },
      { content: '  ' },
    ]);
    expect(items).toEqual([
      { content: 'Lire', status: 'completed', priority: 'high' },
      { content: 'Écrire', status: 'in_progress', priority: 'low' },
      { content: 'Vérifier', status: 'pending', priority: 'medium' },
    ]);
  });

  test('extrait le dernier planwrite par metadata, même après un autre outil', () => {
    const messages = [
      {
        content: [
          { type: 'tool', tool: 'planwrite', state: { status: 'completed', metadata: { items: [{ content: 'A', status: 'completed', priority: 'high' }] } } },
        ],
      },
      {
        content: [
          { type: 'tool', tool: 'shell', state: { status: 'completed', input: { command: 'pwd' } } },
          { type: 'tool', name: 'planwrite', state: { status: 'completed', metadata: { items: [
            { content: 'A', status: 'completed', priority: 'high' },
            { content: 'B', status: 'in_progress', priority: 'medium' },
          ] } } },
        ],
      },
    ];
    expect(extractPlanItems(messages).map(t => t.content)).toEqual(['A', 'B']);
  });

  test('accepte input.items quand metadata manque', () => {
    const messages = [{ content: [{ type: 'tool', tool: 'planwrite:0', state: { input: { items: [{ content: 'X', status: 'pending', priority: 'low' }] } } }] }];
    expect(extractPlanItems(messages)[0]?.content).toBe('X');
  });

  test('compatibilité : les tool parts todowrite/todoupdate d’avant le renommage restent lus', () => {
    const todos = [
      { content: 'A', status: 'completed', priority: 'high' },
      { content: 'B', status: 'in_progress', priority: 'medium' },
      { content: 'C', status: 'pending', priority: 'low' },
    ];
    const messages = [
      {
        content: [
          { type: 'tool', tool: 'todowrite', state: { status: 'completed', metadata: { todos: todos.slice(0, 2) } } },
        ],
      },
      {
        content: [
          // mise à jour unitaire par numéro : le part porte la liste complète
          { type: 'tool', tool: 'todoupdate', state: { status: 'completed', metadata: { todos } } },
        ],
      },
      {
        // clé `items` aussi acceptée sur un nom de tool ancien
        content: [
          { type: 'tool', tool: 'todowrite:0', state: { input: { items: [{ content: 'X', status: 'pending', priority: 'low' }] } } },
        ],
      },
    ];
    expect(extractPlanItems(messages)[0]?.content).toBe('X');
  });

  test('planupdate est aussi une source : le dernier part gagne', () => {
    const items = [
      { content: 'A', status: 'completed', priority: 'high' },
      { content: 'B', status: 'in_progress', priority: 'low' },
      { content: 'C', status: 'pending', priority: 'low' },
    ];
    const messages = [
      {
        content: [
          { type: 'tool', tool: 'planwrite', state: { status: 'completed', metadata: { items: items.slice(0, 2) } } },
        ],
      },
      {
        content: [
          // mise à jour unitaire par numéro : le part porte la liste complète
          { type: 'tool', tool: 'planupdate', state: { status: 'completed', metadata: { items } } },
        ],
      },
    ];
    expect(extractPlanItems(messages)).toEqual(items);
  });

  test('progression : 50 %, 99 % quand tout est fait, null sans plan', () => {
    const half = snapshotOf([
      { content: 'A', status: 'completed', priority: 'high' },
      { content: 'B', status: 'pending', priority: 'low' },
    ]);
    expect(half.done).toBe(1);
    expect(half.total).toBe(2);
    expect(half.progress).toBe(50);
    const all = snapshotOf([{ content: 'A', status: 'completed', priority: 'high' }]);
    expect(all.progress).toBe(99);
    expect(snapshotOf([]).progress).toBeNull();
  });

  test('convertit en plan compatible avec le verdict', () => {
    const snap = snapshotOf([
      { content: 'A', status: 'completed', priority: 'high' },
      { content: 'B', status: 'in_progress', priority: 'low' },
    ]);
    expect(planStepsOf(snap)).toEqual([{ step: 'A', done: true }, { step: 'B', done: false }]);
  });
});

describe('plan : repli lastKnown et persistance plan_known', () => {
  const SID = 'ses_plan_test_lecon';
  const itemsV1 = [
    { content: 'Lire', status: 'completed', priority: 'high' },
    { content: 'Écrire', status: 'pending', priority: 'low' },
  ];
  const itemsV2 = [
    { content: 'Lire', status: 'completed', priority: 'high' },
    { content: 'Écrire', status: 'completed', priority: 'low' },
    { content: 'Vérifier', status: 'pending', priority: 'medium' },
  ];
  /** items servis par le faux OpenChamber (plan dans la fenêtre) */
  let itemsInWindow: typeof itemsV1 | typeof itemsV2 = itemsV1;
  /** false = le planwrite est sorti de la fenêtre de lecture */
  let planInWindow = true;

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (!url.pathname.includes('/message')) return new Response('not found', { status: 404 });
      const data = planInWindow
        ? [{
            id: 'm1',
            time: { created: 1 },
            content: [{ type: 'tool', tool: 'planwrite', state: { status: 'completed', metadata: { items: itemsInWindow } } }],
          }]
        : [];
      return Response.json({ data });
    },
  });
  afterAll(() => server.stop(true));

  test('le plan est lu depuis la fenêtre de messages', async () => {
    plan.setBase(`http://127.0.0.1:${server.port}`);
    const snap = await plan.getPlanSnapshot(SID, 1, true);
    expect(snap.total).toBe(2);
    expect(snap.done).toBe(1);
  });

  test('planwrite sorti de la fenêtre : invalidatePlan ne vide plus le plan (leçon 2026-11-12)', async () => {
    planInWindow = false;
    plan.invalidatePlan(SID); // ce que fait events.mts à chaque message.* du tour
    const snap = await plan.getPlanSnapshot(SID, 2, true);
    expect(snap.total).toBe(2);
    expect(snap.done).toBe(1);
  });

  test('le repli survit au redémarrage du daemon (table plan_known)', async () => {
    plan.resetPlanCache(); // mémoire vidée, comme après un restart du daemon
    const snap = await plan.getPlanSnapshot(SID, 3, true);
    expect(snap.total).toBe(2);
    expect(snap.done).toBe(1);
  });

  test('un nouveau planwrite reprend la main sur le repli', async () => {
    planInWindow = true;
    itemsInWindow = itemsV2;
    const snap = await plan.getPlanSnapshot(SID, 4, true);
    expect(snap.total).toBe(3);
    expect(snap.done).toBe(2);
  });

  test('instance injoignable : le plan connu reste affiché', async () => {
    plan.setBase('http://127.0.0.1:9'); // aucun service : refus immédiat
    plan.invalidatePlan(SID);
    const snap = await plan.getPlanSnapshot(SID, 5, true);
    expect(snap.total).toBe(3);
    expect(snap.done).toBe(2);
  });
});
