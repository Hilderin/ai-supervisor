import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ActivityKind, FleetActivity } from '../types';
import { ActivityLine } from './ActivityLine';

function render(activity?: FleetActivity | null): string {
  return renderToStaticMarkup(<ActivityLine activity={activity} />);
}

function activity(patch: Partial<FleetActivity>): FleetActivity {
  return { kind: 'tool', label: 'Outil', at: 1, ...patch };
}

describe('ActivityLine', () => {
  test('rien à rendre sans activité (repos)', () => {
    expect(render(undefined)).toBe('');
    expect(render(null)).toBe('');
  });

  test('une seule ligne : icône, libellé court, puis sujet tronquable', () => {
    const html = render(activity({ kind: 'edit', label: 'Édition', detail: 'activity.mts', title: '/projet/activity.mts' }));
    expect(html.match(/data-testid="activity-line"/g)).toHaveLength(1);
    expect(html).toContain('Édition');
    expect(html).toContain('activity.mts');
    expect(html).toContain('title="/projet/activity.mts"');
    expect(html).toContain('truncate');
    expect(html).toContain('whitespace-nowrap');
    expect(html).not.toContain('<br');
  });

  test('les cinq types minimaux ont chacun leur icône et leur libellé', () => {
    const cases: Array<[ActivityKind, string]> = [
      ['thinking', 'Réflexion'],
      ['edit', 'Édition'],
      ['write', 'Écriture'],
      ['search', 'Recherche'],
      ['shell', 'Commande'],
    ];
    const icons = new Set<string>();
    for (const [kind, label] of cases) {
      const html = render(activity({ kind, label }));
      expect(html).toContain(label);
      expect(html).toContain('<svg');
      const path = html.match(/<path d="([^"]+)"/)?.[1] ?? '';
      icons.add(path);
    }
    // un pictogramme différent par type (pas la même icône partout)
    expect(icons.size).toBe(cases.length);
  });

  test('une commande longue reste sur une ligne et garde son texte complet en infobulle', () => {
    const command = `bun test daemon/test/activity.test.mts --filter ${'x'.repeat(120)}`;
    const html = render(activity({ kind: 'shell', label: 'Commande', detail: `${command.slice(0, 95)}…`, title: command }));
    expect(html).toContain('Commande');
    expect(html).toContain('title="' + command + '"');
    expect(html).toContain('truncate');
  });
});
