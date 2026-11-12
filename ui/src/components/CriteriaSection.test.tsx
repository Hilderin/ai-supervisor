/**
 * Tests de CriteriaSection (comportement d'ouverture, badges d'état, preuve et
 * commentaire du vérificateur). La liste se charge à la demande (fetch client) :
 * la ligne est testée directement via CriterionRow.
 */
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { CriteriaSection, criteriaDefaultOpen, CriterionRow } from './CriteriaSection';
import type { CriteriaCounts, Criterion } from '../types';

const counts: CriteriaCounts = { total: 4, todo: 1, toValidate: 1, toFix: 1, validated: 1 };

const validated: Criterion = {
  id: 1, task_id: 's1', ref: 'AC-01', title: 'Tests passent',
  detail: 'bun test', methods: ['unit_test'], status: 'validated',
  evidence: [{ kind: 'unit_test', text: '12 pass', at: 1 }],
  review: 'La sortie de test est visible.', review_at: 2, created_at: 1, updated_at: 2,
};

const rejected: Criterion = {
  id: 2, task_id: 's1', ref: 'AC-02', title: 'Capture du rendu',
  detail: null, methods: ['screenshot'], status: 'to_fix',
  evidence: [{ kind: 'screenshot', text: 'voir la carte', path: 'capture.png', at: 1 }],
  review: 'La capture ne montre pas l’état final.', review_at: 3, created_at: 1, updated_at: 3,
};

describe('criteriaDefaultOpen', () => {
  test('dépliée tant que la tâche travaille ou attend, repliée sinon (règle du plan)', () => {
    expect(criteriaDefaultOpen('busy')).toBe(true);
    expect(criteriaDefaultOpen('waiting')).toBe(true);
    expect(criteriaDefaultOpen('done')).toBe(false);
    expect(criteriaDefaultOpen('warning')).toBe(false);
  });
});

describe('CriterionRow', () => {
  test('rend ref, titre, badge d’état, preuve et note de jugement', () => {
    const html = renderToStaticMarkup(createElement(CriterionRow, { sessionId: 's1', criterion: validated }));
    expect(html).toContain('AC-01');
    expect(html).toContain('Tests passent');
    expect(html).toContain('Validé');
    expect(html).toContain('bun test');
    expect(html).toContain('Preuve acceptée : La sortie de test est visible.');
    // plus de mention du vérificateur (sous-agent retiré, l'agent juge lui-même)
    expect(html).not.toContain('Vérificateur');
  });

  test('un critère rejeté affiche « À corriger » et la raison, libellée claire', () => {
    const html = renderToStaticMarkup(createElement(CriterionRow, { sessionId: 's1', criterion: rejected }));
    expect(html).toContain('À corriger');
    expect(html).toContain('Preuve refusée : La capture ne montre pas l’état final.');
  });

  test('un extrait de code pointe son fichier et ses lignes', () => {
    const html = renderToStaticMarkup(createElement(CriterionRow, {
      sessionId: 's1',
      criterion: {
        ...validated,
        status: 'to_validate',
        review: null,
        evidence: [{ kind: 'code_excerpt', text: 'la garde single-flight', path: 'daemon/src/plan.mts', start_line: 190, line_count: 20, at: 1 }],
      },
    }));
    expect(html).toContain('daemon/src/plan.mts:190+20');
    expect(html).toContain('À valider');
  });

  test('la capture de preuve est un bouton d’agrandissement nommé par son critère', () => {
    const html = renderToStaticMarkup(createElement(CriterionRow, { sessionId: 's1', criterion: rejected }));
    expect(html).toContain('data-testid="evidence-thumb"');
    expect(html).toContain('aria-label="Agrandir la capture de preuve AC-02"');
    expect(html).toContain('cursor-zoom-in');
    expect(html).toContain('src="/api/fleet/asset?sessionId=s1&amp;path=capture.png"');
  });

  test('une preuve sans image n’offre pas de miniature', () => {
    const html = renderToStaticMarkup(createElement(CriterionRow, { sessionId: 's1', criterion: validated }));
    expect(html).not.toContain('data-testid="evidence-thumb"');
  });
});

describe('CriteriaSection (en-tête)', () => {
  test('l’en-tête porte le compte validés/total', () => {
    const html = renderToStaticMarkup(createElement(CriteriaSection, {
      sessionId: 's1',
      state: 'busy',
      refreshKey: '10:0',
      counts,
    }));
    expect(html).toContain('Critères');
    expect(html).toContain('1/4');
    expect(html).toContain('4 critères');
  });
});
