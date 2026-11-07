import { beforeEach, describe, expect, test } from 'bun:test';
import type { Fleet, FleetRow } from '../types';
import { useFleetStore } from './fleetStore';

const row: FleetRow = {
  id: 'ses_test',
  title: 'test',
  status: 'idle',
  pendingForms: [],
  pendingPermissions: [],
};

const fleet = (at: number, rows: FleetRow[]): Fleet => ({ at, rows, concern: null });

describe('fleetStore.setFleet', () => {
  beforeEach(() => {
    useFleetStore.setState({
      fleet: null,
      placements: {},
      order: {},
      nextRank: 1,
      seenAt: {},
      orderHydrated: false,
      closed: {},
      drafts: {},
      error: null,
    });
  });

  test('un snapshot plus ancien n’écrase pas un plus récent', () => {
    useFleetStore.getState().setFleet(fleet(20, [row]));
    useFleetStore.getState().setFleet(fleet(10, []));
    const s = useFleetStore.getState();
    expect(s.fleet?.at).toBe(20);
    expect(s.fleet?.rows.length).toBe(1);
  });

  test('un snapshot plus récent remplace et place les cartes', () => {
    useFleetStore.getState().setFleet(fleet(20, []));
    useFleetStore.getState().setFleet(fleet(30, [row]));
    const s = useFleetStore.getState();
    expect(s.fleet?.at).toBe(30);
    expect(s.placements.ses_test?.section).toBe('running');
  });

  test('le premier snapshot attribue un rang stable', () => {
    useFleetStore.getState().setFleet(fleet(20, [row, { ...row, id: 'ses_b' }]));
    const s = useFleetStore.getState();
    expect(s.order.ses_test).toBe(1);
    expect(s.order.ses_b).toBe(2);
  });

  test('un tri du daemon qui change ne change pas les rangs', () => {
    useFleetStore.getState().setFleet(fleet(20, [row, { ...row, id: 'ses_b' }]));
    useFleetStore.getState().setFleet(fleet(30, [{ ...row, id: 'ses_b' }, row]));
    const s = useFleetStore.getState();
    expect(s.order.ses_test).toBe(1);
    expect(s.order.ses_b).toBe(2);
  });

  test('une première frame vide ne perd pas l’ordre persisté', () => {
    const now = Date.now();
    useFleetStore.setState({
      fleet: null,
      order: { a: 1, b: 2 },
      nextRank: 3,
      seenAt: { a: now, b: now },
      orderHydrated: false,
    });
    useFleetStore.getState().setFleet(fleet(10, []));
    expect(useFleetStore.getState().order).toEqual({ a: 1, b: 2 });
    expect(useFleetStore.getState().orderHydrated).toBe(false);

    useFleetStore.getState().setFleet(
      fleet(20, [{ ...row, id: 'b' }, { ...row, id: 'a' }]),
    );
    const s = useFleetStore.getState();
    expect(s.orderHydrated).toBe(true);
    expect(s.order.a).toBe(1);
    expect(s.order.b).toBe(2);
  });

  test('une fermeture oublie le rang, une réouverture repart en bas', () => {
    useFleetStore.getState().setFleet(fleet(20, [row, { ...row, id: 'ses_b' }]));
    useFleetStore.getState().closeSession('ses_test', 30);
    expect(useFleetStore.getState().order.ses_test).toBeUndefined();

    // la session rouvre après une activité postérieure à la fermeture
    useFleetStore.getState().setFleet(
      fleet(40, [
        { ...row, id: 'ses_b' },
        { ...row, lastUpdateAt: 35 },
      ]),
    );
    expect(useFleetStore.getState().order.ses_test).toBe(3);
  });
});
