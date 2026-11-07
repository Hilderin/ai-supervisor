import { describe, expect, test } from 'bun:test';
import { openChamberMiniChatUrl } from '../src/openchamber-link.mts';

describe('openChamberMiniChatUrl', () => {
  test('cible le mini chat web sur une session OpenChamber', () => {
    expect(openChamberMiniChatUrl('http://127.0.0.1:57123/', 'ses_abc123'))
      .toBe('http://127.0.0.1:57123/mini-chat.html?mode=session&sessionId=ses_abc123');
  });

  test('refuse un identifiant invalide avant de former une URL', () => {
    expect(openChamberMiniChatUrl('http://127.0.0.1:57123/', 'invalid')).toBeNull();
    expect(openChamberMiniChatUrl('http://127.0.0.1:57123/', 'ses_../api')).toBeNull();
  });
});
