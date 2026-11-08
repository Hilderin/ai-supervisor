/**
 * Tests du modèle de tâche dans le détail : libellé, champs du popover et
 * message de refus. Le portail et les interactions sont vérifiés au navigateur.
 */
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { TaskModelFields, taskModelLabel } from './TaskModelPopover';
import type { TaskModelInfo } from '../types';

const info: TaskModelInfo = {
  sessionId: 'ses_task',
  model: 'openai/gpt-strong',
  effective: 'openai/gpt-strong',
  name: 'GPT Strong',
  defaultModel: 'openai/gpt-fast',
  models: [
    { ref: 'openai/gpt-fast', providerID: 'openai', modelID: 'gpt-fast', name: 'GPT Fast', providerName: 'OpenAI' },
    { ref: 'openai/gpt-strong', providerID: 'openai', modelID: 'gpt-strong', name: 'GPT Strong', providerName: 'OpenAI' },
    { ref: 'opencode/free', providerID: 'opencode', modelID: 'free', name: 'Free', providerName: 'OpenCode' },
  ],
};

describe('taskModelLabel', () => {
  test('affiche le nom effectif avec le préfixe modèle', () => {
    expect(taskModelLabel(info, false, null)).toBe('modèle · GPT Strong');
  });

  test('à défaut, la session, puis les états de chargement et d’erreur', () => {
    expect(taskModelLabel({ ...info, model: null, name: 'GPT Fast' }, false, null)).toBe('modèle · GPT Fast');
    expect(taskModelLabel(null, true, null)).toBe('modèle…');
    expect(taskModelLabel(null, false, 'erreur')).toBe('modèle indisponible');
  });
});

describe('TaskModelFields', () => {
  test('le select porte le défaut de la session et le modèle effectif', () => {
    const html = renderToStaticMarkup(createElement(TaskModelFields, {
      info,
      value: 'openai/gpt-strong',
      loading: false,
      error: null,
      saveError: null,
      onChange: () => undefined,
    }));
    expect(html).toContain('data-testid="task-model-select"');
    expect(html).toContain('Défaut de la session');
    expect(html).toContain('GPT Strong');
    expect(html).toContain('data-testid="task-model-effective"');
    expect(html).toContain('Effectif :');
    expect(html).toContain('<optgroup label="OpenAI">');
  });

  test('sans préférence, le détail rappelle que la tâche suit le défaut', () => {
    const html = renderToStaticMarkup(createElement(TaskModelFields, {
      info: { ...info, model: null },
      value: '',
      loading: false,
      error: null,
      saveError: null,
      onChange: () => undefined,
    }));
    expect(html).toContain('(défaut de la session)');
  });

  test('un refus de modèle est lisible dans le panneau', () => {
    const html = renderToStaticMarkup(createElement(TaskModelFields, {
      info,
      value: 'inconnu/modele',
      loading: false,
      error: null,
      saveError: 'modèle « inconnu/modele » inconnu : la tâche n’a pas été modifiée.',
      onChange: () => undefined,
    }));
    expect(html).toContain('data-testid="task-model-error"');
    expect(html).toContain('la tâche n’a pas été modifiée');
  });

  test('sans catalogue, un repli lisible plutôt qu’un select vide', () => {
    const html = renderToStaticMarkup(createElement(TaskModelFields, {
      info: null,
      value: '',
      loading: true,
      error: null,
      saveError: null,
      onChange: () => undefined,
    }));
    expect(html).toContain('data-testid="task-model-loading"');
    expect(html).toContain('Chargement');
  });
});
