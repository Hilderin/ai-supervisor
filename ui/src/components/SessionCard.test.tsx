import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FleetRow } from '../types';
import type { Section } from '../lib/placement';
import { cardState } from '../lib/cardState';
import { SessionCard } from './SessionCard';

function row(patch: Partial<FleetRow> = {}): FleetRow {
  return {
    id: 'ses_card',
    title: 'Tâche de test',
    dir: '/proj/ai-supervisor',
    status: 'idle',
    ...patch,
  } as FleetRow;
}

function renderCard(r: FleetRow): string {
  return renderToStaticMarkup(
    <SessionCard
      row={r}
      state={cardState(r, 'running' as Section)}
      selected={false}
      flash={false}
      now={0}
      onOpen={() => {}}
      onOpenChamber={() => {}}
    />,
  );
}

describe('SessionCard sans composer', () => {
  test("la carte n'a plus de champ d'écriture : écrire passe par le détail", () => {
    for (const r of [row(), { ...row(), status: 'busy' as const }, { ...row(), sup: { resume: 'r', at: 1 } }]) {
      const html = renderCard(r as FleetRow);
      expect(html).not.toContain('Écrire à cette tâche…');
      expect(html).not.toContain('<textarea');
    }
  });

  test('hauteur réduite : trois rangées (en-tête, corps, pied), 190 px', () => {
    const html = renderCard({ ...row(), sup: { resume: 'r', at: 1 } });
    expect(html).toContain('h-[190px]');
    expect(html).toContain('grid-rows-[24px_minmax(0,1fr)_30px]');
  });

  test('affiche un échec OpenCode sur la carte au lieu du faux signal de réflexion', () => {
    const html = renderCard(row({
      status: 'busy',
      issue: { state: 'error', message: 'Le fournisseur est indisponible', errorType: 'ProviderError', updatedAt: 2 },
    }));
    expect(html).toContain('Le fournisseur est indisponible');
    expect(html).toContain('Erreur OpenCode');
    expect(html).not.toContain('Réflexion en cours');
    expect(html).toContain('Détail');
  });

  test('distingue le retry planifié et son numéro de tentative', () => {
    const html = renderCard(row({
      status: 'idle',
      issue: { state: 'retry', message: 'Connexion interrompue', attempt: 3, updatedAt: 2 },
    }));
    expect(html).toContain('Nouvel essai');
    expect(html).toContain('Retry OpenCode · tentative 3');
    expect(html).toContain('Connexion interrompue');
  });
});

describe('barres de progression', () => {
  const classOf = (html: string, testid: string): string => {
    const match = html.match(new RegExp(`data-testid="${testid}"[^>]*class="([^"]*)"`));
    return match?.[1] ?? '';
  };

  test('la barre des critères partage exactement le gabarit de celle du plan', () => {
    const html = renderCard(row({
      id: 'ses_bars',
      status: 'busy',
      sup: { resume: 'r', at: 1, progress: 50 },
      plan: {
        steps: [{ text: 'Étape 1', status: 'completed' }, { text: 'Étape 2', status: 'in_progress' }],
        done: 1,
        total: 2,
      },
      criteria: { total: 2, todo: 0, toValidate: 1, toFix: 0, validated: 1 },
    }));
    const planBar = classOf(html, 'plan-progress-bar');
    const criteriaBar = classOf(html, 'criteria-progress-bar');
    expect(planBar).toContain('flex-1');
    expect(planBar).toContain('max-w-[160px]');
    // même gabarit, à la marge d'espacement près demandée par le propriétaire
    // (plus d'air avant la barre, compteur serré)
    expect(criteriaBar.replace('ml-[15px] ', '')).toBe(planBar);
    expect(criteriaBar).toContain('ml-[15px]');
  });
});
