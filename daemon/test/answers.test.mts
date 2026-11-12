/**
 * Tests du tool `answer` : stockage des réponses des tâches au propriétaire
 * (answers.mts + table task_answer). La base SQLite vit dans un dossier
 * temporaire ; l'instance OpenChamber n'est pas touchée (la flotte testée est
 * vide : une session n'est connue que si elle a un brief / un état / une reprise).
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SUPERVISEUR_DATA_DIR = mkdtempSync(join(tmpdir(), 'answers-test-'));

const state = await import('../src/state.mts');
const answers = await import('../src/answers.mts');
const { AnswerError, ackAnswers, isTaskSession, listAnswers, recordAnswer, unreadAnswerCounts } = answers;

// garde-fou anti-catastrophe (même règle que resume.test) : jamais la base réelle
const boundFile = (state.db as unknown as { query: Function }).query('pragma database_list').all()
  .map((r: { file?: string }) => r.file ?? '').join(',');
if (!boundFile.includes('answers-test-')) {
  process.exitCode = 1;
  throw new Error('answers.test : base SQLite non temporaire, on n\'écrit rien. Lancer ce fichier SEUL.');
}

describe('isTaskSession', () => {
  test('le chat de supervision n\'est jamais une tâche', () => {
    state.setSupervisorSession({ ocSessionId: 'ses_sup', agent: 'superviseur-orchestrateur-x', title: 'Superviseur' });
    expect(isTaskSession('ses_sup')).toBe(false);
  });

  test('une session inconnue est refusée', () => {
    expect(isTaskSession('ses_ghost')).toBe(false);
  });

  test('une session avec un brief, un état ou une reprise est une tâche', () => {
    state.putTaskBrief('ses_brief', {
      title: 'Test', goal: 'g', doneCriteria: [], constraints: [],
      projectDir: '/tmp/proj', agent: 'build', model: null,
    });
    expect(isTaskSession('ses_brief')).toBe(true);
    state.upsertTaskState('ses_open', { title: 'Test ouverte', goal: 'g' });
    expect(isTaskSession('ses_open')).toBe(true);
  });
});

describe('recordAnswer', () => {
  test('stocke la réponse, avec question rattachée en option', () => {
    const a = recordAnswer('ses_brief', 'Oui, le port est fixe maintenant', 'Faut-il fixer le port ?');
    expect(a.id).toBeGreaterThan(0);
    expect(a.text).toContain('port est fixe');
    expect(a.question).toBe('Faut-il fixer le port ?');
    expect(a.read_at).toBeNull();
  });

  test('sans question : le rattachement reste NULL', () => {
    const a = recordAnswer('ses_brief', 'Point relu, rien à signaler.');
    expect(a.question).toBeNull();
    expect(a.read_at).toBeNull();
  });

  test('une tâche inconnue est refusée (pas de fantôme)', () => {
    expect(() => recordAnswer('ses_ghost', 'hi')).toThrow('not_task');
    let err: unknown;
    try { recordAnswer('ses_ghost', 'hi'); } catch (e) { err = e; }
    expect(err instanceof AnswerError).toBe(true);
  });

  test('une réponse vide est refusée', () => {
    expect(() => recordAnswer('ses_brief', '   ')).toThrow('texte requis');
  });
});

describe('compteur et journal', () => {
  test('unreadAnswerCounts compte les non lues, puis retombe après Got it', () => {
    recordAnswer('ses_open', 'réponse 1');
    recordAnswer('ses_open', 'réponse 2');
    recordAnswer('ses_brief', 'réponse autre tâche');
    expect(unreadAnswerCounts().get('ses_open')).toBe(2);

    const acked = ackAnswers('ses_open');
    expect(acked).toBe(2);
    expect(unreadAnswerCounts().get('ses_open')).toBeUndefined();

    const all = listAnswers('ses_open');
    expect(all.map((a) => a.text)).toEqual(['réponse 1', 'réponse 2']);
    // le journal reste lisible : les réponses sont gardées, marquées lues
    expect(all.every((a) => a.read_at != null)).toBe(true);
    // la tâche suivante n'a pas absorbé l'acquittement (3 non lues : question,
    // point relu, et la réponse du present test)
    expect(unreadAnswerCounts().get('ses_brief')).toBe(3);
  });

  test('Got it par ids : seule la réponse visée est lue', () => {
    const a = recordAnswer('ses_open', 'réponse A du test par ids');
    const b = recordAnswer('ses_open', 'réponse B du test par ids');
    ackAnswers('ses_open', [b.id]);
    const after = listAnswers('ses_open');
    expect(after.find((x) => x.id === a.id)?.read_at).toBeNull();
    expect(after.find((x) => x.id === b.id)?.read_at).not.toBeNull();
    expect(unreadAnswerCounts().get('ses_open')).toBe(1);
  });
});

describe('migrateTaskSession', () => {
  test('les réponses suivent la tâche sur sa nouvelle session (auto-restart)', () => {
    state.migrateTaskSession('ses_open', 'ses_new');
    expect(listAnswers('ses_open')).toEqual([]);
    // 1 et 2 (lues par Got it global) + A (non lue) + B (lue par id)
    expect(listAnswers('ses_new').length).toBe(4);
    expect(unreadAnswerCounts().get('ses_new')).toBe(1);
  });
});
