/**
 * Tests du panneau de configuration : regroupement des modèles par provider,
 * libellés des options « défaut », avertissements et contenu du formulaire.
 * Rendu statique seulement (le portail et les interactions ne sont pas testés
 * ici, comme pour les autres popovers).
 */
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  ConfigFields, configSummary, prefsToValues,
} from './ConfigPopover';
import {
  customAgentHint, defaultModelLabel, groupModelsByProvider, isDefaultAgent, prefValue,
} from '../lib/config';
import type { SupervisorConfig, SupervisorModelOption } from '../types';

const model = (providerID: string, modelID: string, name: string, providerName: string): SupervisorModelOption => ({
  ref: `${providerID}/${modelID}`, providerID, modelID, name, providerName,
});

const config: SupervisorConfig = {
  prefs: { chatModel: null, chatAgent: null, taskModel: null },
  defaults: {
    chatAgent: null,
    chatAgentLabel: 'Orchestrateur (recommandé)',
    chatModel: 'openai/gpt-fast',
    taskModel: null,
    taskModelLabel: 'Défaut de la session',
  },
  models: [
    model('openai', 'gpt-fast', 'GPT Fast', 'OpenAI'),
    model('openai', 'gpt-strong', 'GPT Strong', 'OpenAI'),
    model('opencode', 'free', 'Free', 'OpenCode'),
  ],
  agents: [{ id: 'build', name: 'Build' }, { id: 'plan', name: 'Plan' }],
  updatedAt: null,
};

describe('groupModelsByProvider', () => {
  test('groupe par provider dans l’ordre alphabétique', () => {
    const groups = groupModelsByProvider(config.models);
    expect(groups.map(g => g.providerName)).toEqual(['OpenAI', 'OpenCode']);
    expect(groups[0]!.models.map(m => m.ref)).toEqual(['openai/gpt-fast', 'openai/gpt-strong']);
    expect(groups[1]!.models.map(m => m.ref)).toEqual(['opencode/free']);
  });

  test('une liste vide donne aucun groupe', () => {
    expect(groupModelsByProvider([])).toEqual([]);
  });
});

describe('libellés', () => {
  test('le défaut du chat porte le nom du modèle par défaut courant', () => {
    expect(defaultModelLabel(config.models, 'openai/gpt-fast')).toBe('Défaut (GPT Fast)');
  });

  test('sans défaut connu, un libellé neutre', () => {
    expect(defaultModelLabel(config.models, null)).toBe('Défaut OpenChamber');
    expect(defaultModelLabel(config.models, 'mort/inconnu')).toBe('Défaut (mort/inconnu)');
  });

  test('une préférence vide vaut défaut', () => {
    expect(prefValue(null)).toBe('');
    expect(prefValue('  ')).toBe('');
    expect(prefValue('openai/gpt-fast')).toBe('openai/gpt-fast');
  });

  test('l’orchestrateur est le défaut ; un agent standard porte un avertissement', () => {
    expect(isDefaultAgent(null, config.agents)).toBe(true);
    expect(isDefaultAgent('plan', config.agents)).toBe(false);
    expect(customAgentHint(null, config.agents)).toBeNull();
    expect(customAgentHint('plan', config.agents)).toContain('consignes de supervision');
  });
});

describe('ConfigFields', () => {
  test('l agent du chat et les deux modèles sont des réglages distincts', () => {
    const html = renderToStaticMarkup(createElement(ConfigFields, {
      config,
      values: prefsToValues(config),
      warnings: [],
      onChange: () => undefined,
    }));
    expect(html).toContain('data-testid="config-agent"');
    expect(html).toContain('data-testid="config-chat-model"');
    expect(html).toContain('data-testid="config-task-model"');
    // le modèle du compagnon a disparu avec les sous-agents (2026-11-12)
    expect(html).not.toContain('config-companion-model');
    expect(html).not.toContain('Compagnon');
    expect(html).toContain('Orchestrateur (recommandé)');
    expect(html).toContain('Défaut (GPT Fast)');
    expect(html).toContain('Défaut de la session');
    expect(html).toContain('GPT Strong');
    expect(html).toContain('<optgroup label="OpenAI">');
  });

  test('les avertissements de repli sont visibles dans le panneau', () => {
    const html = renderToStaticMarkup(createElement(ConfigFields, {
      config,
      values: { ...prefsToValues(config), chatModel: 'mort/inconnu' },
      warnings: [{ field: 'chatModel', value: 'mort/inconnu', message: 'Modèle du chat inconnu : le défaut s’applique.' }],
      onChange: () => undefined,
    }));
    expect(html).toContain('data-testid="config-warnings"');
    expect(html).toContain('Modèle du chat inconnu');
  });

  test('un agent standard choisi affiche l’avertissement dans le panneau', () => {
    const html = renderToStaticMarkup(createElement(ConfigFields, {
      config,
      values: { ...prefsToValues(config), chatAgent: 'build' },
      warnings: [],
      onChange: () => undefined,
    }));
    expect(html).toContain('consignes de supervision');
  });
});

describe('configSummary', () => {
  test('résume l’agent et le modèle effectifs', () => {
    expect(configSummary('superviseur-orchestrateur-dc6b25be', 'GPT Fast')).toBe('orchestrateur · GPT Fast');
    expect(configSummary('build', 'GPT Strong')).toBe('build · GPT Strong');
    expect(configSummary(null, null)).toBe('orchestrateur · modèle par défaut');
  });
});
