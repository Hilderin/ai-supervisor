import { describe, expect, test } from 'bun:test';
import type { FormField } from '../types';
import { buildAnswer } from './answer';

const fields: FormField[] = [
  { key: 'q0', type: 'string', options: [{ value: 'bun', label: 'Bun' }] },
  { key: 'q1', type: 'multiselect', options: [{ value: 'flotte', label: 'Flotte' }] },
];

describe('buildAnswer', () => {
  test('options : mono en chaîne, multiselect en tableau', () => {
    expect(buildAnswer(fields, { q0: 'bun', q1: ['flotte', 'rendus'] }, {})).toEqual({
      q0: 'bun',
      q1: ['flotte', 'rendus'],
    });
  });

  test('texte libre : mono en chaîne, multiselect en tableau', () => {
    expect(buildAnswer(fields, {}, { q0: 'rust', q1: 'mobile' })).toEqual({
      q0: 'rust',
      q1: ['mobile'],
    });
  });

  test('multiselect vide + texte libre → [texte]', () => {
    expect(buildAnswer(fields, { q1: [] }, { q1: 'mobile' })).toEqual({ q1: ['mobile'] });
  });

  test('une sélection prime sur le champ libre du même champ', () => {
    expect(buildAnswer(fields, { q0: 'bun' }, { q0: 'rust' })).toEqual({ q0: 'bun' });
  });

  test('sans réponse → objet vide', () => {
    expect(buildAnswer(fields, {}, {})).toEqual({});
  });

  test('clé absente → q0', () => {
    expect(buildAnswer([{ type: 'string' }], {}, { q0: 'ok' })).toEqual({ q0: 'ok' });
  });
});
