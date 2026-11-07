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
});
