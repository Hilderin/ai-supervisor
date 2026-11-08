import { describe, expect, test } from 'bun:test';
import { supervisorSessionAction } from '../src/supervisor.mts';

/**
 * Un changement de prompt (hash du fichier) ne doit jamais remplacer la
 * conversation de supervision : c'est ce qui a fait « disparaître » le chat
 * le 2026-11-07, quand une tâche a renommé todowrite en planwrite dans l'agent
 * pendant que le propriétaire écrivait dans le chat.
 */
describe('cycle de vie de la conversation de supervision', () => {
  test('une session vivante avec un autre agent bascule en place (jamais de remplacement)', () => {
    expect(supervisorSessionAction({
      exists: true,
      sessionAgent: 'superviseur-orchestrateur-c453c714',
      agent: 'superviseur-orchestrateur-dc6b25be',
    })).toBe('switch');
  });

  test('une session vivante avec le bon agent est réutilisée', () => {
    expect(supervisorSessionAction({
      exists: true,
      sessionAgent: 'superviseur-orchestrateur-dc6b25be',
      agent: 'superviseur-orchestrateur-dc6b25be',
    })).toBe('reuse');
  });

  test('une session sans agent connu (ancienne trace) bascule aussi', () => {
    expect(supervisorSessionAction({
      exists: true,
      sessionAgent: null,
      agent: 'superviseur-orchestrateur-dc6b25be',
    })).toBe('switch');
  });

  test('seule une session absente ou archivée fait créer une conversation', () => {
    expect(supervisorSessionAction({
      exists: false,
      sessionAgent: null,
      agent: 'superviseur-orchestrateur-dc6b25be',
    })).toBe('create');
  });
});
