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
      onOpenChamber={() => {}}
    />,
  );
}

describe('TaskInspector', () => {
  test('la même ligne d’activité que la carte vit en haut du panneau', () => {
    const html = renderInspector(row({
      status: 'busy',
      activity: { kind: 'shell', label: 'Commande', detail: 'bun test daemon/test/activity.test.mts', title: 'bun test daemon/test/activity.test.mts', at: 1 },
    }));
    expect(html.match(/data-testid="activity-line"/g)).toHaveLength(1);
    expect(html).toContain('Commande');
    expect(html).toContain('bun test daemon/test/activity.test.mts');
  });

  test('au repos, le détail ne garde pas de ligne d’activité', () => {
    const html = renderInspector(row({
      status: 'idle',
      activity: { kind: 'edit', label: 'Édition', detail: 'a.ts', at: 2 },
    }));
    expect(html).not.toContain('data-testid="activity-line"');
  });

  test('le détail présente le message et le numéro du retry OpenCode', () => {
    const html = renderInspector(row({
      issue: { state: 'retry', message: 'Connexion interrompue', errorType: 'NetworkError', attempt: 2, updatedAt: 3 },
    }));
    expect(html).toContain('data-testid="session-issue"');
    expect(html).toContain('Nouvelle tentative OpenCode · tentative 2');
    expect(html).toContain('Connexion interrompue');
    expect(html).toContain('NetworkError');
  });

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
    const html = renderInspector(row({ sup: { resume: 'r', at: 1 }, plan: { done: 1, total: 2, steps } }));
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

  test('la section des questions porte un titre et le « ? » orange, dans le gabarit des autres sections', () => {
    const html = renderInspector(row({
      pendingForms: [{
        id: 'form_1',
        title: 'Quelle suite ?',
        fields: [{ key: 'q0', title: 'Quelle suite ?', type: 'string', description: 'Préciser la suite.' }],
      }],
    }));
    expect(html).toContain('data-testid="question-section"');
    expect(html).toContain('Question en attente');
    expect(html).toContain('rounded-[9px] border border-wait-border bg-wait');
    expect(html).toContain('rounded-full bg-orange');
    expect(html).not.toContain('✋');
  });
});

describe('supervision opt-in dans le détail', () => {
  test('badge non supervisée dans la ligne d état + bouton de bascule dans l en-tête', () => {
    const html = renderInspector(row({ supervised: false }));
    expect(html).toContain('data-testid="inspector-unsupervised"');
    expect(html).toContain('Non supervisée');
    // icône œil barré distinctive du badge
    expect(html).toContain('M4 4l16 16');
    expect(html).toContain('data-testid="inspector-supervision-toggle"');
    expect(html).toContain('aria-label="Activer la supervision"');
    expect(html).toContain('Activer la supervision (compagnon + vérificateur sur cette conversation)');
  });

  test('tâche supervisée : pas de badge, bouton présent pour désactiver', () => {
    const html = renderInspector(row({ supervised: true }));
    expect(html).not.toContain('data-testid="inspector-unsupervised"');
    expect(html).toContain('data-testid="inspector-supervision-toggle"');
    expect(html).toContain('aria-label="Désactiver la supervision"');
  });
});
