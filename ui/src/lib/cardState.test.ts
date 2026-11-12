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

const plan = (done: number, total: number): FleetRow['plan'] => ({
  done,
  total,
  steps: Array.from({ length: total }, (_, i) => ({
    text: 'étape',
    status: i < done ? 'completed' : 'pending',
  })),
});

const crit = (validated: number, total: number) => ({ total, todo: 0, toValidate: 0, toFix: 0, validated });

describe('état visuel d’une carte', () => {
  test('une attente gagne sur tout le reste', () => {
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

  test('busy gagne sur done (travail relancé)', () => {
    const busy = row({ status: 'busy', plan: plan(3, 3), criteria: crit(2, 2) });
    expect(cardState(busy, 'running')).toBe('busy');
  });

  test('terminé : plan 100 %, critères tous validés, au repos', () => {
    const done = row({ plan: plan(3, 3), criteria: crit(2, 2) });
    expect(cardState(done, 'done')).toBe('done');
    expect(cardState(done)).toBe('done');
    expect(cardStateLabel('done')).toBe('terminé');
  });

  test('l hystérésis de section s applique : EN COURS reste « à compléter » tant que pas stable', () => {
    const done = row({ plan: plan(3, 3), criteria: crit(2, 2) });
    expect(cardState(done, 'running')).toBe('warning');
    expect(cardStateLabel('warning')).toBe('à compléter');
  });

  test('au repos, travail incomplet → warning, sans placement connu', () => {
    expect(cardState(row({ plan: plan(2, 3), criteria: crit(2, 2) }))).toBe('warning');
    expect(cardState(row())).toBe('warning');
  });
});
