import { describe, expect, test } from 'bun:test';
import { OWNER_WRAP, stripOwnerWrap, wrapOwnerPrompt } from '../src/supervisor.mts';

describe('encadrement des prompts du propriétaire', () => {
  test('le texte envoyé au chat est précédé de l\'instruction combinée (todolist + answer)', () => {
    const wrapped = wrapOwnerPrompt('cherche la météo');
    expect(wrapped.startsWith(OWNER_WRAP)).toBe(true);
    expect(wrapped).toContain('answer');
    expect(wrapped.endsWith('cherche la météo')).toBe(true);
  });

  test('un texte sans encadrement ressort intact', () => {
    const raw = 'message quelconque';
    expect(stripOwnerWrap(raw)).toBe(raw);
    expect(stripOwnerWrap('')).toBe('');
  });

  test('aller-retour : seul le texte du propriétaire reste visible', () => {
    expect(stripOwnerWrap(wrapOwnerPrompt('lance la migration'))).toBe('lance la migration');
  });

  test('l\'instruction elle-même n\'encadre pas une seconde fois', () => {
    // un propriétaire qui recopie le préfixe garde son texte
    expect(stripOwnerWrap(wrapOwnerPrompt(wrapOwnerPrompt('x')))).toBe(wrapOwnerPrompt('x'));
  });
});
