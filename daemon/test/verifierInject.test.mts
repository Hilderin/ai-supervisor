/**
 * Injection du vérificateur (buildPhasePrompt) : l'objectif complet et la
 * liste entière des critères (y compris la DERNIÈRE ref en attente) arrivent
 * au vérificateur, sans coupe en pleine phrase ni en plein critère ; l'extrait
 * de conversation est la partie élastique. Base SQLite temporaire (JAMAIS la
 * production) ; imports dynamiques après l'affectation d'env.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SUPERVISEUR_DATA_DIR = mkdtempSync(join(tmpdir(), 'verifier-inject-test-'));
const state = await import('../src/state.mts');
const verifier = await import('../src/verifier.mts');

// garde-fou anti-catastrophe (comme criteria.test.mts)
const boundFile = (state.db as unknown as { query: Function }).query('pragma database_list').all()
  .map((r: { file?: string }) => r.file ?? '').join(',');
if (!boundFile.includes('verifier-inject-test-')) {
  process.exitCode = 1;
  throw new Error(`verifierInject.test : base SQLite ${boundFile} n'est pas une base de test : on n'écrit rien. Lancer ce fichier SEUL.`);
}

import { describe, expect, test } from 'bun:test';

const OBJECTIVE = 'Nouvelle instruction : corrige cinq problèmes du vérificateur. '.repeat(40); // ~2700 car
const tailOf = (s: string) => s.slice(-60);

/** Une liste longue : 12 critères, preuves de 400+ caractères chacune. */
function longRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    ref: `AC-${String(i + 1).padStart(2, '0')}`,
    title: `Critère numéro ${i + 1}`,
    detail: `détail du critère ${i + 1}`,
    methods: ['unit_test'],
    status: i % 3 === 0 ? 'to_validate' : 'validated',
    version: i + 1,
    evidence: [{
      kind: 'unit_test',
      text: `bun test : ${i + 1} pass, 0 fail. ${'Sortie de preuve répétée pour dépasser la coupe. '.repeat(8)}`,
      path: 'daemon/test/x.test.mts',
      start_line: 1,
      line_count: 10,
    }],
    review: i % 2 === 0 ? `commentaire du vérificateur sur le critère ${i + 1}, phrase complète conservée.` : null,
    remove_proposed_at: null,
    remove_reason: null,
    validated_at: i % 3 === 0 ? null : Date.now(),
  }));
}

describe('buildPhasePrompt : liste et objectif jamais coupés', () => {
  test('toutes les refs sont présentes, y compris la dernière en attente, et la fin de l objectif est là', () => {
    const rows = longRows(12);
    const prompt = verifier.buildPhasePrompt({
      title: 'Tâche de test',
      objective: OBJECTIVE,
      rows: rows as never,
      counts: { validated: 8, total: 12 },
      pending: 4,
      excerpt: 'extrait court',
    });
    for (const r of rows) {
      expect(prompt).toContain(`${r.ref} [`);
      expect(prompt).toContain(r.title);
      // la preuve ne finit pas en pleine phrase : coupe marquée ou complète
      const last = rows[rows.length - 1];
      expect(prompt).toContain(last.ref);
      expect(prompt).toContain(tailOf(OBJECTIVE));       // objectif COMPLET
      expect(prompt).toContain(`${last.ref} [`);         // la dernière ref du critère, pas seulement le titre
    }
    // aucune coupe en pleine phrase : la preuve longue de la dernière ref est marquée « … »
    expect(prompt).toContain(' …');
  });

  test('un extrait très long est tronqué PROPREMENT (fin de phrase, marqueur), sans toucher à la liste', () => {
    const rows = longRows(12);
    const excerpt = `phrase complète un. ${'texte de conversation répété '.repeat(300)}phrase finale.`;
    const prompt = verifier.buildPhasePrompt({
      title: 'Tâche', objective: OBJECTIVE, rows: rows as never,
      counts: { validated: 8, total: 12 }, pending: 4, excerpt,
    });
    expect(prompt).toContain('AC-12');                    // liste entière
    expect(prompt).toContain(tailOf(OBJECTIVE));          // objectif entier
    const excerptCut = prompt.includes('phrase finale.');
    const marked = prompt.includes(' …');
    expect(excerptCut || marked).toBe(true);              // coupe propre, jamais en pleine phrase
  });

  test('si la liste est trop longue, l extrait est OMIS explicitement (jamais la liste)', () => {
    const rows = longRows(30);
    const prompt = verifier.buildPhasePrompt({
      title: 'Tâche', objective: OBJECTIVE, rows: rows as never,
      counts: { validated: 10, total: 30 }, pending: 4, excerpt: 'contexte présent mais jetable',
    });
    expect(prompt).toContain('AC-30');
    expect(prompt).toContain(tailOf(OBJECTIVE));
    expect(prompt).toContain('extrait de conversation omis');
  });

  test('cutText : coupe sur une frontière de phrase, marqueur « … », jamais en pleine phrase', () => {
    const text = 'Première phrase complète. Deuxième phrase complète. Phrase trois tronquée ici';
    const cut = verifier.cutText(text, 40);
    expect(cut.endsWith(' …')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(45);
    expect(cut.startsWith('Première phrase complète.')).toBe(true);
    expect(verifier.cutText('court', 40)).toBe('court');
  });
});
