/**
 * Lecteur daemon des critères (criteria.mts) : extraction des tool parts du
 * plugin superviseur-criteria, normalisation, repli criteria_known, reprise.
 *
 * Depuis la migration « critères natifs session » (2026-11-13), le daemon
 * LIT l'état porté par la session (metadata {ok, criteria, counts} rendu par
 * chaque tool criteria), exactement comme plan.mts lit `planwrite`.
 *
 * La base SQLite est une base de test : imports dynamiques après l'env (les
 * imports statiques seraient hissés AVANT l'affectation d'env) et garde-fou
 * anti-catastrophe, comme criteria-state.test.mts.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SUPERVISEUR_DATA_DIR = mkdtempSync(join(tmpdir(), 'criteria-reader-test-'));
const state = await import('../src/state.mts');
const criteria = await import('../src/criteria.mts');

// garde-fou anti-catastrophe : en batch, state.mts peut pointer sur la vraie
// base ; on refuse alors toute écriture.
const boundFile = (state.db as unknown as { query: Function }).query('pragma database_list').all()
  .map((r: { file?: string }) => r.file ?? '').join(',');
if (!boundFile.includes('criteria-reader-test-')) {
  process.exitCode = 1;
  throw new Error(`criteria-reader.test : base SQLite ${boundFile} n'est pas une base de test : on n'écrit rien. Lancer ce fichier SEUL.`);
}

import { afterAll, describe, expect, test } from 'bun:test';
const {
  extractCriteria, normalizeCriteria, criteriaCounts, getCriteriaSnapshot,
  invalidateCriteria, criteriaForResume, resetCriteriaCache, setBase,
} = criteria;
const { db } = state;

const TASK = 'ses_criteria_reader';

const ROW_A = {
  ref: 'AC-01', title: 'Tests passent', detail: null, methods: ['unit_test'],
  status: 'validated', evidence: [], review: 'bun test vu', review_at: 10,
  created_at: 1, updated_at: 10, version: 2, validated_at: 10,
  validated_work: '{"commit":null,"at":10}', removed_at: null,
};
const ROW_B = {
  ref: 'AC-02', title: 'Build passe', detail: 'ok', methods: ['command'],
  status: 'todo', evidence: [], review: null, review_at: null,
  created_at: 2, updated_at: 2, version: 0, validated_at: null,
  validated_work: null, removed_at: null,
};

describe('criteria-reader : extraction des tool parts', () => {
  test('normalise la liste du plugin (forme metadata {ok, criteria, counts})', () => {
    const rows = normalizeCriteria([ROW_A, ROW_B, { ref: 'AC-03', title: 'retiré', methods: ['text'], status: 'todo', removed_at: 5 }], TASK);
    expect(rows.map(r => r.ref)).toEqual(['AC-01', 'AC-02']);
    expect(rows[0]).toMatchObject({ id: 1, task_id: TASK, status: 'validated', methods: ['unit_test'] });
    expect(criteriaCounts(rows)).toEqual({ total: 2, todo: 1, toValidate: 0, toFix: 0, validated: 1 });
  });

  test('le DERNIER tool criteria fait foi, même vide, hors autres outils', () => {
    const messages = [
      {
        content: [
          { type: 'tool', tool: 'criteria_add', state: { status: 'completed', metadata: { ok: true, criteria: [ROW_A] } } },
        ],
      },
      {
        content: [
          { type: 'tool', tool: 'shell', state: { status: 'completed', input: { command: 'pwd' } } },
          { type: 'tool', name: 'criteria_set_status:0', state: { status: 'completed', metadata: { ok: true, criteria: [ROW_A, ROW_B] } } },
        ],
      },
      {
        content: [
          { type: 'tool', tool: 'criteria_list', state: { status: 'completed', metadata: { ok: true, criteria: [] } } },
        ],
      },
    ];
    expect(extractCriteria(messages, TASK)).toEqual([]);
    expect(extractCriteria(messages.slice(0, 2), TASK).map(r => r.ref)).toEqual(['AC-01', 'AC-02']);
  });

  test('repli state.output quand metadata manque', () => {
    const messages = [{
      content: [{
        type: 'tool', tool: 'criteria_import', state: { output: { ok: true, criteria: [ROW_B] } },
      }],
    }];
    expect(extractCriteria(messages, TASK).map(r => r.ref)).toEqual(['AC-02']);
  });
});

describe('criteria-reader : repli criteria_known et reprise', () => {
  afterAll(() => resetCriteriaCache());

  test('le miroir criteria_known nourrit le repli et la reprise', () => {
    db.run('INSERT INTO criteria_known (session_id, criteria, at) VALUES (?,?,?)',
      [TASK, JSON.stringify([ROW_A, ROW_B]), Date.now()]);
    const known = criteriaForResume(TASK);
    expect(known.map(r => r.ref)).toEqual(['AC-01', 'AC-02']);
    expect(known[0].review).toBe('bun test vu');
  });

  test('repli sur l ancienne table criteria (tâches pré-migration)', () => {
    const OLD = 'ses_criteria_old';
    db.run(`INSERT INTO criteria (task_id, ref, title, methods, status, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?)`, [OLD, 'AC-01', 'Ancien critère', '["text"]', 'to_fix', 1, 2]);
    const rows = criteriaForResume(OLD);
    expect(rows.map(r => r.ref)).toEqual(['AC-01']);
    expect(rows[0].status).toBe('to_fix');
  });

  test('lecture avec instance injoignable : le repli évite le zéro', async () => {
    // base injoignable (port discard) : la lecture fraîche échoue, le miroir répond
    setBase('http://127.0.0.1:9');
    invalidateCriteria();
    const snap = await getCriteriaSnapshot(TASK, undefined, true);
    expect(snap.criteria.map(r => r.ref)).toEqual(['AC-01', 'AC-02']);
  });

  test('lecture fraîche via un serveur de test : extraction, miroir, journal', async () => {
    const messages = [{
      content: [{
        type: 'tool', tool: 'criteria_set_status', state: {
          status: 'completed',
          metadata: { ok: true, criteria: [{ ...ROW_A, status: 'to_validate', review: null, validated_at: null, validated_work: null }, ROW_B] },
        },
      }],
    }];
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ data: messages }),
    });
    setBase(`http://127.0.0.1:${server.port}`);
    invalidateCriteria();
    try {
      const snap = await getCriteriaSnapshot(TASK, undefined, true);
      expect(snap.counts).toEqual({ total: 2, todo: 1, toValidate: 1, toFix: 0, validated: 0 });
      // le miroir est actualisé (relis après invalidation : même contenu)
      invalidateCriteria();
      const again = await getCriteriaSnapshot(TASK, undefined, true);
      expect(again.counts.toValidate).toBe(1);
      // le journal porte la transition AC-01 validated → to_validate
      const log = db.query('SELECT text FROM task_log WHERE session_id = ? AND kind = ?').all(TASK, 'criteria') as Array<{ text: string }>;
      expect(log.some(l => l.text.includes('AC-01 : validated → to_validate'))).toBe(true);
    } finally {
      server.stop(true);
      setBase('');
      invalidateCriteria();
    }
  });
});
