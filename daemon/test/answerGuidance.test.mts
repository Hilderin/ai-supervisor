/**
 * Garde-fous du tool `answer`, en texte statique (aucune base ouverte) :
 * - le plugin `superviseur-task` porte la consigne (markdown lisible, réponse
 *   autonome, pas d'invite à la concision) ;
 * - `composePrompt` (prompt injecté à la création de tâche) porte les mêmes
 *   règles plus le tool `question` pour les demandes au propriétaire.
 *
 * Le propriétaire ne voit pas la conversation d'une tâche : une réponse qui
 * renvoie à un tableau ou un rendu resté dans la session lui est inutile
 * (déjà arrivé sur « Ajout d'idées à la boîte à idées », 2026-11-07).
 */
import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const plugin = await Bun.file(join(here, '../plugin/superviseur-task/index.js')).text();
const tools = await Bun.file(join(here, '../src/tools.mts')).text();

describe('instructions du tool `answer`', () => {
  test('le champ texte du plugin ne pousse plus à la réponse compacte', () => {
    expect(plugin).not.toMatch(/1 à 5 phrases/);
  });

  test('plugin : markdown lisible, sans forcer la longueur', () => {
    expect(plugin).toMatch(/markdown/);
    expect(plugin).toMatch(/titres, gras, listes, code/);
    expect(plugin).toMatch(/sans forcer la longueur/);
  });

  test('plugin : réponse autonome, jamais un renvoi au chat', () => {
    expect(plugin).toMatch(/ne voit pas la conversation/);
    expect(plugin).toMatch(/autonome/);
    expect(plugin).toMatch(/ne renvoie jamais vers le chat/);
  });

  test('composePrompt : réponse markdown autonome', () => {
    expect(tools).toMatch(/tool `answer`/);
    expect(tools).toMatch(/titres, listes, gras/);
    expect(tools).toMatch(/sans forcer la longueur/);
    expect(tools).toMatch(/ne lit PAS la conversation/);
    expect(tools).toMatch(/reproduit en markdown dans le texte/);
  });

  test('composePrompt : les questions passent par le tool `question`', () => {
    expect(tools).toMatch(/`question` : le formulaire/);
    expect(tools).toMatch(/n\\'arrive jamais au propriétaire/);
  });
});
