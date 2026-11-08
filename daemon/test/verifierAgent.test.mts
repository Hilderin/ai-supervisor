/**
 * Permissions des agents de supervision, en texte statique (aucune base) :
 * le plugin superviseur-criteria est chargé GLOBALEMENT, donc chaque agent de
 * supervision doit désactiver explicitement les tools criteria ; le
 * vérificateur n'a que ses trois outils de lecture bornée.
 *
 * Constaté réel le 2026-11-08 : le vérificateur voyait `criteria_list`
 * (frontmatter l'activait) et perdait un appel (`not_task`).
 */
import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const CRITERIA_TOOLS = [
  'criteria_add', 'criteria_remove', 'criteria_update',
  'criteria_to_validate', 'criteria_list',
];
const VERIFIER_TOOLS = ['verifier_messages', 'verifier_tools', 'verifier_search'];

async function frontmatterTools(file: string): Promise<Map<string, boolean>> {
  const text = await Bun.file(join(here, '..', 'agent', file)).text();
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error(`pas de frontmatter dans ${file}`);
  const tools = new Map<string, boolean>();
  let inTools = false;
  for (const line of m[1].split('\n')) {
    if (/^tools:/.test(line)) { inTools = true; continue; }
    if (inTools && /^\S/.test(line)) inTools = false;
    if (!inTools) continue;
    const entry = line.match(/^\s{2}([a-z_]+):\s*(true|false)\s*$/);
    if (entry) tools.set(entry[1], entry[2] === 'true');
  }
  return tools;
}

describe('frontmatters des agents de supervision', () => {
  test('vérificateur : tools criteria désactivés, trois outils de lecture activés', async () => {
    const tools = await frontmatterTools('superviseur-verificateur.md');
    for (const t of CRITERIA_TOOLS) expect(tools.get(t)).toBe(false);
    for (const t of VERIFIER_TOOLS) expect(tools.get(t)).toBe(true);
    // aucun autre tool activé
    for (const [name, on] of tools) {
      if (!VERIFIER_TOOLS.includes(name)) expect(on).toBe(false);
    }
  });

  test('orchestrateur et analyste : ni criteria ni verifier_*', async () => {
    for (const file of ['superviseur-orchestrateur.md', 'superviseur-analyste.md']) {
      const tools = await frontmatterTools(file);
      for (const t of [...CRITERIA_TOOLS, ...VERIFIER_TOOLS]) {
        expect(tools.get(t)).toBe(false);
      }
    }
  });
});
