/**
 * Garde-fou du filaire du daemon (aucune base ouverte) : tout module src qui
 * exporte `setBase` (un lecteur à base OpenChamber) doit être câblé au
 * démarrage de index.mts, ou chaîné par le setBase d'un autre module src
 * (fleet chaîne resume). Un module oublié fait des fetch d'URL relative qui
 * jettent en silence et la flotte reste à zéro (critères et réponses
 * invisibles le 2026-11-13 : criteria.mts et answers.mts jamais câblés
 * depuis leur création, le tool part portait pourtant la liste).
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '../src');

const srcFiles = readdirSync(srcDir).filter((f) => f.endsWith('.mts') && f !== 'index.mts');
const sources = new Map<string, string>();
for (const f of srcFiles) sources.set(f, await Bun.file(join(srcDir, f)).text());

/** Modules lecteurs (convention `export function setBase`). */
const exporters = [...sources.entries()].filter(([, text]) => /export function setBase\(/.test(text));
const index = await Bun.file(join(srcDir, 'index.mts')).text();

describe('filaire du daemon (setBase de chaque lecteur)', () => {
  test('au moins six lecteurs détectés (le garde ne doit pas devenir muet)', () => {
    expect(exporters.length).toBeGreaterThanOrEqual(6);
  });

  for (const [name] of exporters) {
    test(`${name} est câblé (index.mts ou chaînage setBase)`, () => {
      if (index.includes(`from './${name}'`)) return; // câblé au démarrage
      // chaînage : un autre module src importe son setBase et l'appelle
      const aliased = new RegExp(`setBase as (set\\w+Base)[^}]*\\} from '\\.\\/${name}'`);
      const chained = [...sources.entries()].some(([other, text]) => {
        if (other === name) return false;
        const m = text.match(aliased);
        return m != null && text.includes(`${m[1]}(`);
      });
      expect(chained).toBe(true);
    });
  }
});
