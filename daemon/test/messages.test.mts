import { describe, expect, test } from 'bun:test';
import { messageText } from '../src/messages.mts';

describe('messageText', () => {
  test('lit le prompt humain à la racine (API actuelle)', () => {
    // Forme réelle renvoyée par /api/session/:id/message sur l'instance installée.
    expect(messageText({ type: 'user', text: 'oui, tu peux commit et même push' })).toBe('oui, tu peux commit et même push');
  });

  test('garde la compatibilité avec payload.text (ancienne forme)', () => {
    expect(messageText({ type: 'user', payload: { text: 'ancien prompt' } })).toBe('ancien prompt');
  });

  test('lit les blocs texte de l’assistant', () => {
    expect(messageText({ type: 'assistant', content: [{ type: 'reasoning', text: 'je réfléchis' }, { type: 'text', text: 'Corrigé.' }] })).toBe('Corrigé.');
  });

  test('ne confond pas reasoning et texte', () => {
    expect(messageText({ type: 'assistant', content: [{ type: 'reasoning', text: 'je réfléchis' }] })).toBe('');
  });
});
