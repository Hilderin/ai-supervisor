import { describe, expect, test } from 'bun:test';
import type { FleetRow } from '../types';
import { cardState, cardStateLabel } from './cardState';

const row = (over: Partial<FleetRow> = {}): FleetRow => ({
  id: 'ses_test',
  title: 'test',
  status: 'idle',
  pendingForms: [],
  pendingPermissions: [],
  ...over,
});

describe('état visuel d’une carte', () => {
  test('une attente gagne sur busy', () => {
    const waiting = row({ status: 'busy', pendingForms: [{ id: 'f' }] });
    expect(cardState(waiting, 'waiting')).toBe('waiting');
    expect(cardStateLabel('waiting', 'form')).toBe('attend ta réponse');
    expect(cardStateLabel('waiting', 'permission')).toBe('permission demandée');
  });

  test('les états OpenCode error et retry sont distincts de busy', () => {
    const failed = row({ status: 'idle', issue: { state: 'error', message: 'indisponible', updatedAt: 1 } });
    const retry = row({ status: 'busy', issue: { state: 'retry', attempt: 2, updatedAt: 2 } });
    expect(cardState(failed)).toBe('error');
    expect(cardState(retry, 'running')).toBe('retry');
    expect(cardStateLabel('error')).toBe('Erreur OpenCode');
    expect(cardStateLabel('retry')).toBe('Nouvel essai');
  });

  test('busy gagne sur un verdict done', () => {
    const busy = row({ status: 'busy', sup: { termine: true, at: 60 } });
    expect(cardState(busy, 'running')).toBe('busy');
  });

  test('le placement done affiche la coche', () => {
    const done = row({ sup: { termine: true, at: 60 } });
    expect(cardState(done, 'done')).toBe('done');
    expect(cardStateLabel('done')).toBe('terminé');
  });

  test('un verdict done encore en hysteresis reste « fini, à valider »', () => {
    const done = row({ sup: { termine: true, at: 60 } });
    expect(cardState(done, 'running')).toBe('idle');
    expect(cardStateLabel('idle')).toBe('fini, à valider');
  });

  test('sans placement, isDone décide', () => {
    expect(cardState(row({ sup: { termine: true, at: 60 } }))).toBe('done');
    expect(cardState(row())).toBe('idle');
  });
});
