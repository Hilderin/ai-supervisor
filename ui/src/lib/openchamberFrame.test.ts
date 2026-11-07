import { describe, expect, test } from 'bun:test';
import { fetchOpenChamberMiniChatUrl } from './openchamberFrame';

describe('fetchOpenChamberMiniChatUrl', () => {
  test('demande au daemon un lien ciblé sur la session', async () => {
    const originalFetch = globalThis.fetch;
    let requested = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested = String(input);
      return new Response(JSON.stringify({ url: 'http://127.0.0.1:57123/mini-chat.html?mode=session&sessionId=ses_abc' }), { status: 200 });
    }) as typeof fetch;
    try {
      const url = await fetchOpenChamberMiniChatUrl('ses_abc');
      expect(requested).toBe('/api/openchamber/mini-chat?sessionId=ses_abc');
      expect(url).toContain('/mini-chat.html?mode=session&sessionId=ses_abc');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('remonte une erreur du daemon si aucun lien ne peut être construit', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'sessionId invalide' }), { status: 400 })) as unknown as typeof fetch;
    try {
      await expect(fetchOpenChamberMiniChatUrl('bad')).rejects.toThrow('sessionId invalide');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
