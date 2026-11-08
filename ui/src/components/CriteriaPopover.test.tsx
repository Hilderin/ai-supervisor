/**
 * Tests de CriteriaPopover : marque d'état par critère et lignes de la bulle
 * (le portail lui-même est le même gabarit que PlanPopover, non testé ici).
 */
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { CriterionRows, criterionMark } from './CriteriaPopover';
import type { Criterion } from '../types';

const row = (status: Criterion['status'], ref = 'AC-01', title = 'Titre'): Criterion => ({
  id: 1, task_id: 's1', ref, title, detail: null, methods: ['unit_test'],
  status, evidence: [], review: null, review_at: null, created_at: 1, updated_at: 1,
});

describe('criterionMark', () => {
  test('vert validé, ambre à valider, orange à corriger, puce vide à faire', () => {
    expect(criterionMark('validated')).toEqual({ glyph: '✓', cls: 'text-green' });
    expect(criterionMark('to_validate')).toEqual({ glyph: '●', cls: 'text-amber' });
    expect(criterionMark('to_fix')).toEqual({ glyph: '●', cls: 'text-attend' });
    expect(criterionMark('todo')).toEqual({ glyph: '○', cls: 'text-placeholder' });
  });
});

describe('CriterionRows', () => {
  test('liste ref + titre par critère', () => {
    const html = renderToStaticMarkup(createElement(CriterionRows, {
      criteria: [row('validated', 'AC-01', 'Commit unique'), row('to_fix', 'AC-02', 'Capture du rendu')],
    }));
    expect(html).toContain('AC-01');
    expect(html).toContain('Commit unique');
    expect(html).toContain('AC-02');
    expect(html).toContain('Capture du rendu');
  });

  test('liste vide : un repli lisible', () => {
    const html = renderToStaticMarkup(createElement(CriterionRows, { criteria: [] }));
    expect(html).toContain('Aucun critère');
  });
});
