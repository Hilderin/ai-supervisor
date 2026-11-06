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
    useFleetStore.setState({ fleet: null, placements: {}, closed: {}, drafts: {}, error: null });
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
});
