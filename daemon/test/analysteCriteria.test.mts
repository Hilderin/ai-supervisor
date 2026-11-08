/**
 * Contrat critères du prompt de l'analyste, en texte statique (aucune base) :
 * le compagnon doit savoir que la tâche porte des critères (section injectée)
 * et savoir produire `criteria_note` (rappel poussé à l'agent quand le travail
 * est done mais les critères incomplets).
 */
import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const analyste = await Bun.file(join(here, '../agent/superviseur-analyste.md')).text();

describe('superviseur-analyste.md : contrat critères', () => {
  test('la section reçue annonce les critères d\'acceptation', () => {
    expect(analyste).toMatch(/Critères d'acceptation/);
    expect(analyste).toMatch(/à valider.*à corriger.*validé|`à faire`.*`à valider`/s);
  });

  test('criteria_note : clé documentée, réservée au trou de critères sur un travail done', () => {
    expect(analyste).toMatch(/criteria_note/);
    expect(analyste).toMatch(/`state` = `done`/);
    expect(analyste).toMatch(/criteria_add/);
    expect(analyste).toMatch(/criteria_to_validate/);
    // le message est adressé à l'agent (inverse de la voix du résumé)
    expect(analyste).toMatch(/adressé/);
  });
});
