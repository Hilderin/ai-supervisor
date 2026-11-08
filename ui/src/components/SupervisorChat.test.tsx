import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PendingForm } from '../types';
import { ChatQuestionCards, orphanQuestions, questionsForMessage, supervisorStatusLabel } from './SupervisorChat';

const form: PendingForm = {
  id: 'form_1',
  sessionID: 'ses_chat',
  title: 'Quelle suite ?',
  metadata: { kind: 'question', tool: { messageID: 'msg_1' } },
  fields: [{
    key: 'q0',
    title: 'Quelle suite ?',
    type: 'string',
    options: [
      { value: 'lancer', label: 'Lancer' },
      { value: 'attendre', label: 'Attendre' },
    ],
  }],
};

describe('SupervisorChat : question du tool question', () => {
  test('dessine une carte répondable avec ses options et ses boutons', () => {
    const html = renderToStaticMarkup(<ChatQuestionCards sessionId="ses_chat" forms={[form]} />);
    expect(html).toContain('data-testid="chat-question"');
    expect(html).toContain('data-form-id="form_1"');
    expect(html).toContain('Quelle suite ?');
    expect(html).toContain('Lancer');
    expect(html).toContain('Attendre');
    expect(html).toContain('Répondre');
    expect(html).toContain('Annuler la question');
  });

  test('rattache la question à son message', () => {
    expect(questionsForMessage([form], 'msg_1')).toHaveLength(1);
    expect(questionsForMessage([form], 'msg_autre')).toHaveLength(0);
  });

  test('une question sans message retrouvé reste visible en fin de fil', () => {
    expect(orphanQuestions([form], new Set(['msg_1']))).toHaveLength(0);
    expect(orphanQuestions([form], new Set(['msg_autre']))).toHaveLength(1);
    const html = renderToStaticMarkup(<ChatQuestionCards sessionId="ses_chat" forms={orphanQuestions([form], new Set())} />);
    expect(html).toContain('data-testid="chat-question"');
  });

  test('l’en-tête affiche l’attente d’une question, avant le tour en cours', () => {
    const base = { offline: false, busy: false, idleLabel: 'orchestrateur' };
    expect(supervisorStatusLabel({ ...base, waiting: true })).toBe('attend ta réponse');
    expect(supervisorStatusLabel({ ...base, waiting: true, busy: true })).toBe('attend ta réponse');
    expect(supervisorStatusLabel({ ...base, waiting: false, busy: true })).toBe('réfléchit…');
    expect(supervisorStatusLabel({ ...base, waiting: false, offline: true })).toBe('hors ligne');
    expect(supervisorStatusLabel({ ...base, waiting: false })).toBe('orchestrateur');
  });
});
