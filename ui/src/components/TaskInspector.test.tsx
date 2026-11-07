import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FleetRow } from '../types';
import type { Section } from '../lib/placement';
import { cardState } from '../lib/cardState';
import { TaskInspector } from './TaskInspector';

function row(patch: Partial<FleetRow> = {}): FleetRow {
  return {
    id: 'ses_test',
    title: 'Tâche de test',
    dir: '/proj/ai-supervisor',
    status: 'idle',
    ...patch,
  } as FleetRow;
}

function renderInspector(r: FleetRow): string {
  return renderToStaticMarkup(
    <TaskInspector
      row={r}
      state={cardState(r, 'running' as Section)}
      now={0}
      onClose={() => {}}
    />,
  );
}

describe('TaskInspector', () => {
  test('le résumé porte un encadré titré « Résumé »', () => {
    const html = renderInspector(row({ sup: { resume: 'Voici le résumé du tour.', at: 1 } }));
    expect(html).toContain('Résumé');
    expect(html).toContain('Voici le résumé du tour.');
  });

  test('avec un plan : pas de barre de progression, le badge X/X vit dans le Plan', () => {
    const steps = [
      { text: 'a', status: 'completed' as const },
      { text: 'b', status: 'pending' as const },
    ];
    const html = renderInspector(row({ sup: { resume: 'r', at: 1 }, todo: { done: 1, total: 2, steps } }));
    expect(html).toContain('Plan');
    expect(html).toContain('1/2'); // badge du plan
    expect(html).not.toContain('bg-track'); // la barre a disparu du détail
    expect(html).not.toContain('data-testid="progress"');
  });

  test('sans plan : repli discret, sans barre', () => {
    const html = renderInspector(row({ sup: { resume: 'r', at: 1 } }));
    expect(html).not.toContain('bg-track');
    expect(html).toContain('pas de plan');
  });
});
