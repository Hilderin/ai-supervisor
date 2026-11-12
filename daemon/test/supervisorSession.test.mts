import { describe, expect, test } from 'bun:test';
import { ORCHESTRATOR_AGENT } from '../src/state.mts';
import { supervisorSessionAction } from '../src/supervisor.mts';

/**
 * Nom d'agent FIXE (retrait du versionnage par hash) : la conversation de
 * supervision n'est jamais remplacée. Une session vivante portant encore un
 * ancien nom versionné (ou un agent choisi) bascule en place, l'historique
 * reste ; seule une session absente ou archivée fait créer une conversation.
 */
describe('cycle de vie de la conversation de supervision', () => {
  test('une session vivante avec un ancien nom versionné bascule en place (jamais de remplacement)', () => {
    expect(supervisorSessionAction({
      exists: true,
      sessionAgent: 'superviseur-orchestrateur-c453c714',
      agent: ORCHESTRATOR_AGENT,
    })).toBe('switch');
  });

  test('une session vivante avec le bon agent est réutilisée', () => {
    expect(supervisorSessionAction({
      exists: true,
      sessionAgent: ORCHESTRATOR_AGENT,
      agent: ORCHESTRATOR_AGENT,
    })).toBe('reuse');
  });

  test('une session sans agent connu (ancienne trace) bascule aussi', () => {
    expect(supervisorSessionAction({
      exists: true,
      sessionAgent: null,
      agent: ORCHESTRATOR_AGENT,
    })).toBe('switch');
  });

  test('seule une session absente ou archivée fait créer une conversation', () => {
    expect(supervisorSessionAction({
      exists: false,
      sessionAgent: null,
      agent: ORCHESTRATOR_AGENT,
    })).toBe('create');
  });
});
