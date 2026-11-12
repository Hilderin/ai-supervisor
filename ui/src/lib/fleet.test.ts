import { describe, expect, test } from 'bun:test';
import { isClosedRow } from '../store/fleetStore';
import type { Fleet, FleetRow } from '../types';
import { briefRow, criteriaAllValidated, fmtAge, isDone, isWarning, planComplete, planLabel, taskTitleOf } from './fleet';

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

describe('isDone déterministe (plan 100 % + critères tous validés + au repos)', () => {
  test('plan terminé et critères validés → TERMINÉ', () => {
    expect(isDone(row({ plan: plan(3, 3), criteria: crit(2, 2) }))).toBe(true);
  });

  test('plan incomplet → pas TERMINÉ, warning', () => {
    const r = row({ plan: plan(2, 3), criteria: crit(2, 2) });
    expect(isDone(r)).toBe(false);
    expect(isWarning(r)).toBe(true);
  });

  test('critères manquants ou non validés → warning', () => {
    expect(isWarning(row({ plan: plan(3, 3), criteria: crit(1, 2) }))).toBe(true);
    expect(isWarning(row({ plan: plan(3, 3), criteria: crit(0, 0) }))).toBe(true);      // aucun critère défini
    expect(isDone(row({ plan: plan(3, 3), criteria: crit(0, 0) }))).toBe(false);
  });

  test('aucun plan → pas TERMINÉ (le travail n est pas cadré)', () => {
    expect(isDone(row({ criteria: crit(2, 2) }))).toBe(false);
    expect(isWarning(row({ criteria: crit(2, 2) }))).toBe(true);
  });

  test('busy → jamais TERMINÉ, jamais warning', () => {
    const r = row({ status: 'busy', plan: plan(3, 3), criteria: crit(2, 2) });
    expect(isDone(r)).toBe(false);
    expect(isWarning(r)).toBe(false);
  });

  test('question ou permission en attente → jamais TERMINÉ', () => {
    const r = row({ plan: plan(3, 3), criteria: crit(2, 2), pendingForms: [{ id: 'f' }] });
    expect(isDone(r)).toBe(false);
    expect(isWarning(r)).toBe(false);
  });

  test('planComplete / criteriaAllValidated : règles unitaires', () => {
    expect(planComplete(row({ plan: plan(3, 3) }))).toBe(true);
    expect(planComplete(row({ plan: plan(2, 3) }))).toBe(false);
    expect(planComplete(row())).toBe(false);
    expect(criteriaAllValidated(row({ criteria: crit(2, 2) }))).toBe(true);
    expect(criteriaAllValidated(row({ criteria: crit(1, 2) }))).toBe(false);
    expect(criteriaAllValidated(row())).toBe(false);
  });
});

describe('planLabel', () => {
  const mk = (done: number, statuses: Array<'pending' | 'in_progress' | 'completed'>) => ({
    done,
    total: statuses.length,
    steps: statuses.map((status) => ({ text: 'étape', status })),
  });

  test('plan non commencé → taille du plan, jamais 0/N', () => {
    expect(planLabel(mk(0, ['pending', 'pending', 'pending', 'pending', 'pending']), false, 0)).toBe(
      '5 étapes',
    );
  });

  test('une étape en cours → 0/N est honnête', () => {
    expect(planLabel(mk(0, ['in_progress', 'pending']), false, 0)).toBe('0/2');
  });

  test('plan commencé → étapes faites / total', () => {
    expect(planLabel(mk(2, ['completed', 'completed', 'pending']), false, 66)).toBe('2/3');
  });

  test('tâche terminée → pourcentage', () => {
    expect(planLabel(mk(2, ['completed', 'completed', 'pending']), true, 100)).toBe('100 %');
  });

  test('sans plan → pourcentage calculé de la progression', () => {
    expect(planLabel(undefined, false, 40)).toBe('40 %');
  });
});

describe('taskTitleOf', () => {
  const fleetWith = (title: string): Fleet => ({
    at: 1,
    concern: null,
    rows: [{ ...row({ id: 'ses_task' }), title }],
  });

  test('résout le titre courant de la flotte (renommage)', () => {
    expect(taskTitleOf(fleetWith('Nom actuel'), 'ses_task', 'Ancien nom')).toBe('Nom actuel');
  });

  test('tâche absente de la flotte → repli lisible', () => {
    expect(taskTitleOf({ at: 1, concern: null, rows: [] }, 'ses_task', 'Ancien nom')).toBe(
      'une tâche qui n’est plus dans la flotte',
    );
  });

  test('flotte pas encore chargée → titre mémorisé', () => {
    expect(taskTitleOf(null, 'ses_task', 'Ancien nom')).toBe('Ancien nom');
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

  test('busy → réflexion en cours', () => {
    expect(briefRow(row({ status: 'busy' }), false, 0)).toBe('Réflexion en cours...');
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
