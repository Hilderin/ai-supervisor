import { describe, expect, test } from 'bun:test';
import type { FormField } from '../types';
import {
  buildAnswer,
  isOther,
  OTHER,
  otherWithoutText,
  selectOption,
  typeText,
  type AnswerState,
} from './answer';

const fields: FormField[] = [
  { key: 'q0', type: 'string', options: [{ value: 'bun', label: 'Bun' }] },
  { key: 'q1', type: 'multiselect', options: [{ value: 'flotte', label: 'Flotte' }] },
];

const empty: AnswerState = { choice: {}, free: {} };

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

  test('un texte saisi gagne sur une option résiduelle, jamais remplacé par le libellé', () => {
    expect(buildAnswer(fields, { q0: 'bun' }, { q0: 'rust' })).toEqual({ q0: 'rust' });
  });

  test('« Autre » actif : exactement le texte saisi, sans libellé ajouté', () => {
    expect(buildAnswer(fields, { q0: OTHER }, { q0: '  ma réponse  ' })).toEqual({
      q0: 'ma réponse',
    });
  });

  test('« Autre » actif en multiselect : le texte part en tableau', () => {
    expect(buildAnswer(fields, { q1: OTHER }, { q1: 'mobile' })).toEqual({ q1: ['mobile'] });
  });

  test('« Autre » actif sans texte : rien (soumission bloquée en amont)', () => {
    expect(buildAnswer(fields, { q0: OTHER }, { q0: '   ' })).toEqual({});
  });

  test('sans réponse → objet vide', () => {
    expect(buildAnswer(fields, {}, {})).toEqual({});
  });

  test('clé absente → q0', () => {
    expect(buildAnswer([{ type: 'string' }], {}, { q0: 'ok' })).toEqual({ q0: 'ok' });
  });
});

describe('typeText', () => {
  test('la frappe active « Autre » et désélectionne les autres options', () => {
    const typed = typeText({ choice: { q0: 'bun' }, free: {} }, 'q0', 'a');
    expect(typed.choice.q0).toBe(OTHER);
    expect(isOther(typed.choice.q0)).toBe(true);
    expect(typed.free.q0).toBe('a');
  });

  test('la frappe en multiselect remplace les options cochées', () => {
    const typed = typeText({ choice: { q1: ['flotte', 'rendus'] }, free: {} }, 'q1', 'mobile');
    expect(typed.choice.q1).toBe(OTHER);
  });

  test('effacer le texte laisse « Autre » actif (blocage visible)', () => {
    const typed = typeText({ choice: { q0: OTHER }, free: { q0: 'a' } }, 'q0', '');
    expect(typed.choice.q0).toBe(OTHER);
    expect(typed.free.q0).toBe('');
  });

  test('saisir des espaces active « Autre » et bloque', () => {
    const typed = typeText(empty, 'q0', '   ');
    expect(typed.choice.q0).toBe(OTHER);
    expect(otherWithoutText(fields, typed.choice, typed.free)).toEqual(['q0']);
  });

  test('un champ sans options ne pose pas « Autre » (comportement inchangé)', () => {
    const typed = typeText(empty, 'q0', 'mon texte', false);
    expect(typed.choice.q0).toBeUndefined();
    expect(typed.free.q0).toBe('mon texte');
    expect(buildAnswer([{ type: 'string' }], typed.choice, typed.free)).toEqual({ q0: 'mon texte' });
  });
});

describe('selectOption', () => {
  test('choisir une option après avoir tapé efface le texte fantôme', () => {
    const typed = typeText(empty, 'q0', 'rust');
    const picked = selectOption(typed, 'q0', 'bun', false);
    expect(picked.choice.q0).toBe('bun');
    expect(picked.free.q0).toBe('');
    expect(buildAnswer(fields, picked.choice, picked.free)).toEqual({ q0: 'bun' });
  });

  test('le choix « Autre » garde le texte déjà saisi', () => {
    const typed = typeText(empty, 'q0', 'rust');
    const picked = selectOption(typed, 'q0', OTHER, false);
    expect(picked.choice.q0).toBe(OTHER);
    expect(picked.free.q0).toBe('rust');
  });

  test('multiselect : « Autre » puis une option repart sur l’option, texte effacé', () => {
    const typed = typeText(empty, 'q1', 'mobile');
    const picked = selectOption(typed, 'q1', 'flotte', true);
    expect(picked.choice.q1).toEqual(['flotte']);
    expect(picked.free.q1).toBe('');
  });

  test('multiselect : désélectionner une option garde le tableau cohérent', () => {
    const picked = selectOption({ choice: { q1: ['flotte', 'rendus'] }, free: {} }, 'q1', 'flotte', true);
    expect(picked.choice.q1).toEqual(['rendus']);
  });
});

describe('otherWithoutText', () => {
  test('aucun blocage sans « Autre »', () => {
    expect(otherWithoutText(fields, { q0: 'bun' }, {})).toEqual([]);
  });

  test('« Autre » avec texte : pas de blocage', () => {
    expect(otherWithoutText(fields, { q0: OTHER }, { q0: 'rust' })).toEqual([]);
  });

  test('« Autre » avec des espaces seulement : blocage', () => {
    expect(otherWithoutText(fields, { q0: OTHER }, { q0: '  ' })).toEqual(['q0']);
  });

  test('un champ bloqué n’empêche pas un autre champ de compter', () => {
    const answer = buildAnswer(fields, { q0: OTHER, q1: ['flotte'] }, { q0: ' ' });
    expect(answer).toEqual({ q1: ['flotte'] });
    expect(otherWithoutText(fields, { q0: OTHER, q1: ['flotte'] }, { q0: ' ' })).toEqual(['q0']);
  });
});
