/**
 * Sélection de la réponse du vérificateur : le listing OpenChamber est
 * DESCENDANT, donc la réponse utile est la plus récente d'abord ; les messages
 * assistant sans texte (tool calls) ne doivent pas masquer le JSON.
 * Constaté réel : une phase attendait le délai complet (150 s) parce que le
 * dernier élément filtré était un assistant vide.
 */
import { describe, expect, test } from 'bun:test';
import { newestVerifierReply } from '../src/verifier.mts';

const msg = (id: string, type: string, at: number, text?: string) => ({
  id, type, time: { created: at },
  content: text ? [{ type: 'text', text }] : [{ type: 'tool', state: {} }],
});

describe('newestVerifierReply', () => {
  const SINCE = 1000;

  test('choisit le JSON le plus récent, pas le dernier du tableau (ordre descendant)', () => {
    const messages = [
      msg('m1', 'idle', 3000),
      msg('m2', 'assistant', 2000, '{"review":"ok","actions":[]}'),
      msg('m3', 'assistant', 1500),
      msg('m4', 'assistant', 1200),
    ];
    const found = newestVerifierReply(messages as never, SINCE);
    expect(found?.parses).toBe(true);
    expect(found?.text).toContain('"review":"ok"');
  });

  test('un assistant vide récent ne masque pas un JSON plus ancien', () => {
    const messages = [
      msg('m1', 'assistant', 5000),
      msg('m2', 'assistant', 4000, '{"review":"ok","actions":[{"op":"approve","ref":"AC-01"}]}'),
    ];
    const found = newestVerifierReply(messages as never, SINCE);
    expect(found?.parses).toBe(true);
  });

  test('texte non JSON : rendu comme dernier texte connu, sans déclaration parsable', () => {
    const messages = [msg('m1', 'assistant', 3000, 'je regarde les preuves…')];
    const found = newestVerifierReply(messages as never, SINCE);
    expect(found?.parses).toBe(false);
    expect(found?.text).toContain('je regarde');
  });

  test('rien de nouveau : null', () => {
    expect(newestVerifierReply([msg('m1', 'user', 500, 'x')], SINCE)).toBeNull();
  });
});
