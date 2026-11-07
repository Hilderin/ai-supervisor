import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TodoStep } from '../types';
import { PlanSection, PlanSteps, planDefaultOpen } from './PlanSection';

const steps: TodoStep[] = [
  { text: 'Explorer le code', status: 'completed' },
  { text: 'Écrire le composant', status: 'in_progress' },
  { text: 'Tester', status: 'pending' },
];

describe('planDefaultOpen', () => {
  test('déplié quand la tâche travaille ou attend l’humain, replié sinon', () => {
    expect(planDefaultOpen('busy')).toBe(true);
    expect(planDefaultOpen('waiting')).toBe(true);
    expect(planDefaultOpen('done')).toBe(false);
    expect(planDefaultOpen('idle')).toBe(false);
  });
});

describe('PlanSection (rendu statique : état initial uniquement)', () => {
  test('tâche en cours : dépliée par défaut, étapes numérotées et badge de progression', () => {
    const html = renderToStaticMarkup(
      <PlanSection sessionId="ses_busy" state="busy" steps={steps} done={1} total={3} />,
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('3 étapes');
    expect(html).toContain('1/3');
    expect(html).toContain('>2.</span>');
    expect(html).toContain('Écrire le composant');
  });

  test('tâche terminée : repliée par défaut, en-tête seul', () => {
    const html = renderToStaticMarkup(
      <PlanSection sessionId="ses_done" state="done" steps={steps} done={3} total={3} />,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('3 étapes');
    expect(html).not.toContain('Écrire le composant');
  });

  test('plan pas commencé : badge « à faire », jamais 0/N', () => {
    const opened = renderToStaticMarkup(
      <PlanSection
        sessionId="ses_fresh"
        state="busy"
        steps={steps.map((s) => ({ ...s, status: 'pending' as const }))}
        done={0}
        total={3}
      />,
    );
    expect(opened).toContain('à faire');
    expect(opened).not.toContain('0/3');
  });
});

describe('PlanSteps', () => {
  test('marque l’état de chaque étape et numérote la liste', () => {
    const html = renderToStaticMarkup(<PlanSteps steps={steps} />);
    expect(html).toContain('>1.</span>');
    expect(html).toContain('Explorer le code');
    expect(html).toContain('line-through'); // étape finie
  });
});
