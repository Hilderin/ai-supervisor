/**
 * Consignes openui-lang et tool `question`, en texte statique :
 * - le chat dessine les blocs de structure, donc l'orchestrateur peut les
 *   utiliser, mais une question passe toujours par le tool `question` ;
 * - `composePrompt` et le plugin `superviseur-task` portent la même règle,
 *   car les tâches naissent dans des projets qui ne connaissent pas ce repo.
 */
import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const orchestrator = await Bun.file(join(here, '../agent/superviseur-orchestrateur.md')).text();
const tools = await Bun.file(join(here, '../src/tools.mts')).text();
const plugin = await Bun.file(join(here, '../plugin/superviseur-task/index.js')).text();

describe('orchestrateur : structure en openui-lang, questions par le tool', () => {
  test('le tool question est activé', () => {
    expect(orchestrator).toContain('question: true');
    expect(orchestrator).not.toContain('question: false');
  });

  test('les blocs de structure sont autorisés', () => {
    expect(orchestrator).toContain('`openui-lang`');
    expect(orchestrator).toContain('`Steps`');
    expect(orchestrator).toContain('`Table`');
    expect(orchestrator).toContain('`Callout`');
    expect(orchestrator).not.toMatch(/pas de bloc `openui-lang`/);
  });

  test('une question ne passe jamais par un bloc interactif', () => {
    expect(orchestrator).toContain('Toute question au propriétaire passe par le tool `question`');
    expect(orchestrator).toContain('jamais par du texte à recopier ni par un bloc `openui-lang`');
    expect(orchestrator).toContain('`Choice`, `Input`, `Button`');
  });
});

describe('composePrompt : même règle pour les tâches', () => {
  test('la structure openui-lang est décrite', () => {
    expect(tools).toContain('bloc `openui-lang`');
    expect(tools).toContain('root = Stack([...])');
    expect(tools).toContain('Steps, Table, Callout');
  });

  test('une question passe par le tool question', () => {
    expect(tools).toContain('jamais par un bloc openui-lang');
    expect(tools).toContain('Choice, Input, Button');
    expect(tools).toContain('resterait inerte');
  });
});

describe('plugin superviseur-task : garde-fou de answer', () => {
  test('les blocs de structure sont dessinés, pas les formulaires', () => {
    expect(plugin).toContain('bloc `openui-lang` de structure');
    expect(plugin).toContain('Steps, Table, Callout');
    expect(plugin).toContain('tool `question`');
    expect(plugin).toContain('Choice, Input, Button');
  });
});
