import { describe, expect, test } from 'bun:test';
import type { FleetRow } from '../types';
import { isUnsupervised, supervisionActionLabel } from './supervision';

function row(patch: Partial<FleetRow> = {}): FleetRow {
  return { id: 'ses_sup', title: 'Tâche', status: 'idle', ...patch } as FleetRow;
}

describe('supervision opt-in (lib)', () => {
  test('seul supervised === false est non supervisée (daemon ancien = supervisée)', () => {
    expect(isUnsupervised(row({ supervised: false }))).toBe(true);
    expect(isUnsupervised(row({ supervised: true }))).toBe(false);
    expect(isUnsupervised(row())).toBe(false);
  });

  test("le libellé du menu suit l'état dans les deux sens", () => {
    expect(supervisionActionLabel(row({ supervised: false }))).toBe('Activer la supervision');
    expect(supervisionActionLabel(row({ supervised: true }))).toBe('Désactiver la supervision');
    expect(supervisionActionLabel(row())).toBe('Désactiver la supervision');
  });
});
