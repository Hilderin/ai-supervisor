/**
 * Tests de CriteriaSection (comportement d'ouverture, badges d'état, chips de
 * preuve compactes et détail au clic). La liste se charge à la demande (fetch
 * client) : la ligne est testée directement via CriterionRow et le contenu de
 * la bulle via EvidenceDetail.
 */
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  CriteriaSection, criteriaDefaultOpen, CriterionDetailBody, CriterionRow, EvidenceDetail,
  evidenceLabel, neighborCriterionIndex, reviewTitle,
} from './CriteriaSection';
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

describe('libellés', () => {
  test('le type de preuve devient un libellé court, un kind inconnu reste brut', () => {
    expect(evidenceLabel('unit_test')).toBe('test');
    expect(evidenceLabel('screenshot')).toBe('capture');
    expect(evidenceLabel('browser_nav')).toBe('navigateur');
    expect(evidenceLabel('inventé')).toBe('inventé');
  });

  test('la note de jugement est libellée selon l’état', () => {
    expect(reviewTitle(validated)).toBe('Preuve acceptée : La sortie de test est visible.');
    expect(reviewTitle(rejected)).toBe('Preuve refusée : La capture ne montre pas l’état final.');
    expect(reviewTitle({ ...validated, status: 'to_validate' })).toBe('La sortie de test est visible.');
    expect(reviewTitle({ ...validated, review: null })).toBeUndefined();
  });
});

describe('CriterionRow (compacte)', () => {
  test('une ligne : ref, titre et état, plus la chip de preuve', () => {
    const html = renderToStaticMarkup(createElement(CriterionRow, { sessionId: 's1', criterion: validated }));
    expect(html).toContain('AC-01');
    expect(html).toContain('Tests passent');
    expect(html).toContain('Validé');
    expect(html).toContain('data-testid="evidence-chip"');
    expect(html).toContain('data-kind="unit_test"');
    expect(html).toContain('data-state="valid"');
    expect(html).toContain('preuve validée');
    // la chip porte le libellé court, pas le texte de la preuve
    expect(html).toContain('>test<');
    expect(html).not.toContain('12 pass');
    // le détail du critère et la note passent en infobulle
    expect(html).toContain('title="bun test');
    expect(html).toContain('Preuve acceptée : La sortie de test est visible.');
    // plus de mention du vérificateur (sous-agent retiré, l'agent juge lui-même)
    expect(html).not.toContain('Vérificateur');
  });

  test('la ligne entière est un bouton qui ouvre le détail du critère', () => {
    const html = renderToStaticMarkup(createElement(CriterionRow, { sessionId: 's1', criterion: validated }));
    expect(html).toContain('data-testid="criterion-open"');
    expect(html).toContain('aria-label="Ouvrir le détail du critère AC-01"');
  });

  test('une preuve en attente est grise avec un point, jamais une coche verte', () => {
    const html = renderToStaticMarkup(createElement(CriterionRow, { sessionId: 's1', criterion: rejected }));
    expect(html).toContain('À corriger');
    expect(html).toContain('data-state="pending"');
    expect(html).toContain('preuve en attente');
    expect(html).toContain('bg-hover');
    expect(html).not.toContain('data-state="valid"');
    expect(html).toContain('Preuve refusée : La capture ne montre pas l’état final.');
  });

  test('la chip d’un critère validé est verte avec une case cochée', () => {
    const html = renderToStaticMarkup(createElement(CriterionRow, { sessionId: 's1', criterion: validated }));
    expect(html).toContain('bg-green-soft');
    expect(html).toContain('border-green/30');
    expect(html).toContain('aria-label="Preuve test : validée (ouvrir le détail)"');
  });

  test('chaque preuve a sa chip, sans texte de preuve dans la liste', () => {
    const html = renderToStaticMarkup(createElement(CriterionRow, {
      sessionId: 's1',
      criterion: {
        ...validated,
        status: 'to_validate',
        review: null,
        evidence: [
          { kind: 'unit_test', text: 'premier résultat très long', at: 1 },
          { kind: 'command', text: 'second résultat très long', at: 2 },
        ],
      },
    }));
    expect(html.match(/data-testid="evidence-chip"/g)?.length).toBe(2);
    expect(html).toContain('>test<');
    expect(html).toContain('>commande<');
    expect(html).not.toContain('premier résultat très long');
    expect(html).not.toContain('second résultat très long');
  });

  test('la capture reste un bouton d’agrandissement sous les chips', () => {
    const html = renderToStaticMarkup(createElement(CriterionRow, { sessionId: 's1', criterion: rejected }));
    expect(html).toContain('data-testid="evidence-thumbs"');
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

describe('EvidenceDetail (bulle au clic)', () => {
  test('montre le texte complet et le fichier avec ses lignes', () => {
    const criterion: Criterion = {
      ...validated,
      status: 'to_validate',
      review: null,
      evidence: [{
        kind: 'code_excerpt', text: 'la garde single-flight', path: 'daemon/src/plan.mts',
        start_line: 190, line_count: 20, at: 1,
      }],
    };
    const html = renderToStaticMarkup(createElement(EvidenceDetail, {
      sessionId: 's1',
      criterion,
      evidence: criterion.evidence[0]!,
    }));
    expect(html).toContain('preuve en attente');
    expect(html).toContain('data-testid="evidence-detail-path"');
    expect(html).toContain('daemon/src/plan.mts:190+20');
    expect(html).toContain('data-testid="evidence-detail-text"');
    expect(html).toContain('la garde single-flight');
    expect(html).toContain('fournie le');
  });

  test('une capture montre son image dans la bulle', () => {
    const html = renderToStaticMarkup(createElement(EvidenceDetail, {
      sessionId: 's1',
      criterion: rejected,
      evidence: rejected.evidence[0]!,
    }));
    expect(html).toContain('src="/api/fleet/asset?sessionId=s1&amp;path=capture.png"');
    expect(html).toContain('Ouvrir la capture en grand');
    expect(html).toContain('voir la carte');
    expect(html).toContain('preuve en attente');
  });

  test('un critère validé affiche « preuve validée »', () => {
    const html = renderToStaticMarkup(createElement(EvidenceDetail, {
      sessionId: 's1',
      criterion: validated,
      evidence: validated.evidence[0]!,
    }));
    expect(html).toContain('data-testid="evidence-detail-state"');
    expect(html).toContain('preuve validée');
    expect(html).toContain('12 pass');
  });
});

describe('CriterionDetailBody (popup du critère)', () => {
  test('montre détail, méthodes, toutes les preuves, image et preuve acceptée', () => {
    const criterion: Criterion = {
      ...validated,
      evidence: [
        { kind: 'unit_test', text: '12 pass', at: 1 },
        { kind: 'screenshot', text: 'rendu final', path: 'capture.png', at: 2 },
      ],
    };
    const html = renderToStaticMarkup(createElement(CriterionDetailBody, {
      sessionId: 's1',
      criterion,
      onOpenImage: () => undefined,
    }));
    expect(html).toContain('Détail du critère');
    expect(html).toContain('bun test');
    expect(html).toContain('Méthodes de validation');
    expect(html).toContain('>unit_test<');
    expect(html).toContain('Preuves (2)');
    expect(html).toContain('preuve validée');
    expect(html).toContain('12 pass');
    expect(html).toContain('rendu final');
    expect(html).toContain('src="/api/fleet/asset?sessionId=s1&amp;path=capture.png"');
    expect(html).toContain('Preuve acceptée');
    expect(html).toContain('La sortie de test est visible.');
  });

  test('un refus montre « Preuve refusée » et sa raison, en orange', () => {
    const html = renderToStaticMarkup(createElement(CriterionDetailBody, {
      sessionId: 's1',
      criterion: rejected,
    }));
    expect(html).toContain('Preuve refusée');
    expect(html).toContain('La capture ne montre pas l’état final.');
    expect(html).toContain('bg-orange-soft');
    expect(html).toContain('preuve en attente');
  });

  test('sans preuve, le popup le dit au lieu de rester vide', () => {
    const html = renderToStaticMarkup(createElement(CriterionDetailBody, {
      sessionId: 's1',
      criterion: {
        ...validated,
        status: 'todo',
        detail: null,
        methods: [],
        evidence: [],
        review: null,
      },
    }));
    expect(html).toContain('Preuves (0)');
    expect(html).toContain('Aucune preuve soumise pour ce critère.');
    expect(html).not.toContain('Détail du critère');
    expect(html).not.toContain('Méthodes de validation');
    expect(html).not.toContain('data-testid="criterion-review"');
  });

  test('un chemin de preuve pointe ses lignes', () => {
    const html = renderToStaticMarkup(createElement(CriterionDetailBody, {
      sessionId: 's1',
      criterion: {
        ...validated,
        evidence: [{
          kind: 'code_excerpt', text: 'la garde', path: 'daemon/src/plan.mts',
          start_line: 190, line_count: 20, at: 1,
        }],
      },
    }));
    expect(html).toContain('daemon/src/plan.mts:190+20');
  });
});

describe('neighborCriterionIndex', () => {
  test('borne la navigation sans boucler', () => {
    expect(neighborCriterionIndex(2, 5, -1)).toBe(1);
    expect(neighborCriterionIndex(2, 5, 1)).toBe(3);
    expect(neighborCriterionIndex(0, 5, -1)).toBeNull();
    expect(neighborCriterionIndex(4, 5, 1)).toBeNull();
    expect(neighborCriterionIndex(-1, 5, 1)).toBeNull();
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
