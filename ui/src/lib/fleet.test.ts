import { describe, expect, test } from 'bun:test';
import { isClosedRow } from '../store/fleetStore';
import type { FleetRow } from '../types';
import { briefRow, fmtAge, isDone, isStaleTurn } from './fleet';

const row = (over: Partial<FleetRow>): FleetRow => ({
  id: 'ses_test',
  title: 'test',
  status: 'idle',
  pendingForms: [],
  pendingPermissions: [],
  ...over,
});

describe('isDone / isStaleTurn', () => {
  test('terminé et verdict postérieur au tour → TERMINÉ', () => {
    expect(isDone(row({ sup: { termine: true, at: 60 }, turnStartedAt: 50 }))).toBe(true);
  });

  test('terminé mais busy avec verdict périmé → pas TERMINÉ', () => {
    expect(
      isDone(row({ status: 'busy', sup: { termine: true, at: 40 }, turnStartedAt: 50 })),
    ).toBe(false);
  });

  test('busy avec verdict frais (relance) reste EN COURS', () => {
    expect(
      isDone(row({ status: 'busy', sup: { termine: true, at: 60 }, turnStartedAt: 50 })),
    ).toBe(false);
  });

  test('idle avec verdict antérieur au tour → pas TERMINÉ', () => {
    expect(
      isDone(row({ status: 'idle', sup: { termine: true, at: 40 }, turnStartedAt: 50 })),
    ).toBe(false);
  });

  test('busy sans verdict → pas TERMINÉ', () => {
    expect(isDone(row({ status: 'busy' }))).toBe(false);
  });

  test('verdict périmé sur un tour busy → stale', () => {
    expect(isStaleTurn(row({ status: 'busy', sup: { at: 40 }, turnStartedAt: 50 }))).toBe(true);
  });

  test('busy sans at → pas stale', () => {
    expect(isStaleTurn(row({ status: 'busy', sup: {}, turnStartedAt: 50 }))).toBe(false);
  });
});

describe('briefRow / fmtAge', () => {
  test('question en attente', () => {
    expect(briefRow(row({ pendingForms: [{ id: 'f' }] }), true, 0)).toBe('une question t’attend');
  });

  test('permission en attente', () => {
    expect(briefRow(row({ pendingPermissions: [{ id: 'p' }] }), true, 0)).toBe(
      'une permission t’attend',
    );
  });

  test('busy → travaille', () => {
    expect(briefRow(row({ status: 'busy' }), false, 0)).toBe('travaille');
  });

  test('idle → âge du dernier update', () => {
    expect(briefRow(row({ lastUpdateAt: 0 }), false, 120_000)).toBe('tour terminé · il y a 2 min');
  });

  test('âges courts et longs', () => {
    expect(fmtAge(5_000)).toBe("à l'instant");
    expect(fmtAge(30_000)).toBe('il y a 30 s');
    expect(fmtAge(3 * 3_600_000)).toBe('il y a 3 h');
    expect(fmtAge(2 * 86_400_000)).toBe('il y a 2 j');
  });
});

describe('isClosedRow', () => {
  test('fermée sans activité postérieure → cachée', () => {
    expect(isClosedRow(row({ lastUpdateAt: 50 }), { ses_test: 100 })).toBe(true);
  });

  test('activité postérieure à la fermeture → rouverte', () => {
    expect(isClosedRow(row({ lastUpdateAt: 150 }), { ses_test: 100 })).toBe(false);
  });

  test('jamais fermée → visible', () => {
    expect(isClosedRow(row({ lastUpdateAt: 50 }), {})).toBe(false);
  });
});
