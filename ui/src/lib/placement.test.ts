import { describe, expect, test } from 'bun:test';
import type { FleetRow } from '../types';
import { SECTION_HYSTERESIS_MS, updatePlacements } from './placement';

const T0 = 1_000_000;

const row = (over: Partial<FleetRow>): FleetRow => ({
  id: 'ses_test',
  title: 'test',
  status: 'idle',
  pendingForms: [],
  pendingPermissions: [],
  ...over,
});

const doneRow = (over: Partial<FleetRow> = {}) =>
  row({ sup: { termine: true, at: 60 }, turnStartedAt: 50, ...over });

const runningRow = (over: Partial<FleetRow> = {}) =>
  row({ sup: { termine: false, at: 60 }, turnStartedAt: 50, ...over });

describe('updatePlacements', () => {
  test('première vue : section immédiate', () => {
    const p = updatePlacements({}, [doneRow()], T0);
    expect(p.ses_test.section).toBe('done');
  });

  test('EN COURS → TERMINÉ attend l’hystérésis', () => {
    const prev = updatePlacements({}, [runningRow()], T0);
    const early = updatePlacements(prev, [doneRow()], T0 + 1000);
    expect(early.ses_test.section).toBe('running');
    expect(early.ses_test.candidate).toBe('done');

    const late = updatePlacements(early, [doneRow()], T0 + 1000 + SECTION_HYSTERESIS_MS);
    expect(late.ses_test.section).toBe('done');
  });

  test('TERMINÉ → EN COURS attend aussi (verdict qui se rétracte)', () => {
    const prev = updatePlacements({}, [doneRow()], T0);
    const early = updatePlacements(prev, [runningRow()], T0 + 1000);
    expect(early.ses_test.section).toBe('done');

    const late = updatePlacements(early, [runningRow()], T0 + 1000 + SECTION_HYSTERESIS_MS);
    expect(late.ses_test.section).toBe('running');
  });

  test('un candidat qui repart avant l’échéance ne déplace pas la carte', () => {
    const prev = updatePlacements({}, [runningRow()], T0);
    const cand = updatePlacements(prev, [doneRow()], T0 + 1000);
    const back = updatePlacements(cand, [runningRow()], T0 + 2000);
    expect(back.ses_test.section).toBe('running');
    expect(back.ses_test.candidate).toBeUndefined();
  });

  test('busy : EN COURS immédiat, même avec un verdict done frais', () => {
    const prev = updatePlacements({}, [doneRow()], T0);
    const busy = updatePlacements(
      prev,
      [doneRow({ status: 'busy', sup: { termine: true, at: 60 } })],
      T0 + 1000,
    );
    expect(busy.ses_test.section).toBe('running');
  });

  test('nouveau tour : placement immédiat', () => {
    const prev = updatePlacements({}, [doneRow()], T0);
    const next = updatePlacements(prev, [runningRow({ turnStartedAt: 70 })], T0 + 1000);
    expect(next.ses_test.section).toBe('running');
  });

  test('attente immédiate, et sortie d’attente immédiate', () => {
    const prev = updatePlacements({}, [runningRow()], T0);
    const waiting = updatePlacements(
      prev,
      [row({ pendingForms: [{ id: 'f' }], turnStartedAt: 50 })],
      T0 + 1000,
    );
    expect(waiting.ses_test.section).toBe('waiting');

    const back = updatePlacements(waiting, [runningRow()], T0 + 2000);
    expect(back.ses_test.section).toBe('running');
  });

  test('les ids disparus sont oubliés', () => {
    const prev = updatePlacements({}, [doneRow()], T0);
    const next = updatePlacements(prev, [], T0 + 1000);
    expect(next.ses_test).toBeUndefined();
  });
});
