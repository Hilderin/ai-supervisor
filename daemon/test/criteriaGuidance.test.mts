/**
 * Consignes des critères auto-gérés (2026-11-12), en texte statique :
 * - l'agent de tâche est son propre juge : composePrompt et le plugin
 *   `superviseur-criteria` portent criteria_set_status et l'usage honnête ;
 * - plus aucun flux vérificateur (le sous-agent est retiré) ;
 * - l'orchestrateur désactive les tools criteria dans son frontmatter (plugin
 *   global : chaque agent de supervision doit les éteindre explicitement).
 */
import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tools = await Bun.file(join(here, '../src/tools.mts')).text();
const plugin = await Bun.file(join(here, '../plugin/superviseur-criteria/index.js')).text();
const orchestrator = await Bun.file(join(here, '../agent/superviseur-orchestrateur.md')).text();

describe('composePrompt : critères auto-gérés, pas de vérificateur', () => {
  test('le prompt de création de tâche ne parle plus de vérificateur', () => {
    expect(tools).not.toContain('Le vérificateur du Superviseur');
    expect(tools).not.toContain("N'invente pas de validation");
  });

  test('le prompt décrit criteria_set_status et l honnêteté obligatoire', () => {
    expect(tools).toContain('TOI seul juge');
    expect(tools).toContain('criteria_add');
    expect(tools).toContain('criteria_to_validate');
    expect(tools).toContain('criteria_set_status');
    expect(tools).toContain('HONNÊTETÉ');
    expect(tools).toContain("ne marque « validé » qu\\'après une vérification RÉELLE");
    expect(tools).toContain('« à corriger » avec la raison');
  });
});

describe('plugin superviseur-criteria : le tool de jugement et ses garde-fous', () => {
  test('criteria_set_status est exposé avec ses deux statuts', () => {
    expect(plugin).toContain('name: "criteria_set_status"');
    expect(plugin).toContain('\\"validated\\" | \\"to_fix\\"');
    expect(plugin).toContain('la raison, OBLIGATOIRE');
  });

  test('l agent est son propre juge, plus de vérificateur', () => {
    expect(plugin).toContain('Tu es le seul juge');
    expect(plugin).toContain('PAS de vérificateur extérieur');
    expect(plugin).not.toContain('le vérificateur (via le Superviseur) valide ou rejette');
    expect(plugin).not.toContain('revalidation par le vérificateur');
  });

  test('l interdiction de valider sans vérification réelle est écrite', () => {
    expect(plugin).toContain('Honnêteté obligatoire');
    expect(plugin).toContain('vérification RÉELLE');
    expect(plugin).toContain('« pour avancer »');
  });
});

describe('orchestrateur : tools criteria éteints, plus de verifier_*', () => {
  test('le frontmatter désactive les tools criteria', () => {
    expect(orchestrator).toContain('criteria_add: false');
    expect(orchestrator).toContain('criteria_set_status: false');
  });

  test('aucun tool verifier_* dans le frontmatter', () => {
    expect(orchestrator).not.toMatch(/verifier_\w+: true/);
    expect(orchestrator).not.toContain('verifier_messages');
  });
});
