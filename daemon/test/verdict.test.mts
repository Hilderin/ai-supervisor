import { describe, expect, test } from 'bun:test';
import {
  detectHumanQuestion,
  emptyWait,
  isNewObjective,
  lintSummary,
  normalizePlan,
  normalizeVerdict,
  parseVerdictText,
  planProgress,
  resolveObjective,
  scrubSummary,
  shouldRepair,
  toolActionLine,
  type WaitInfo,
} from '../src/verdict.mts';

const wait = (over: Partial<WaitInfo> = {}): WaitInfo => ({ ...emptyWait(), ...over });

const baseCtx = (over: Partial<Parameters<typeof normalizeVerdict>[1]> = {}) => ({
  busy: false,
  wait: emptyWait(),
  agentAsk: null,
  objectiveChanged: false,
  objective: 'Livrer la fonctionnalité',
  previous: null,
  ...over,
});

describe('parseVerdictText', () => {
  test('lit le nouveau schéma et ignore le bruit autour du JSON', () => {
    const raw = parseVerdictText('Voici le verdict.\n{"state":"working","summary":"Ça avance.","plan":[]}\nMerci.');
    expect(raw?.state).toBe('working');
    expect(raw?.summary).toBe('Ça avance.');
  });

  test('lit les anciennes clés françaises', () => {
    const raw = parseVerdictText('{"resume":"Ancien texte","termine":true,"progress":80,"attend":""}');
    expect(raw?.resume).toBe('Ancien texte');
    expect(raw?.termine).toBe(true);
  });

  test('refuse un texte sans JSON', () => {
    expect(parseVerdictText('pas de json')).toBeNull();
  });
});

describe('normalizeVerdict', () => {
  test('done implique 100, même si le plan n’est pas recoché', () => {
    const v = normalizeVerdict({
      state: 'done',
      summary: 'La fonctionnalité est livrée et vérifiée.',
      plan: [{ step: 'A', done: false }, { step: 'B', done: false }],
    }, baseCtx({ workPlan: [{ step: 'A', done: false }, { step: 'B', done: false }] }));
    expect(v.done).toBe(true);
    expect(v.progress).toBe(100);
    expect(v.plan.length).toBe(2);
  });

  test('busy ne peut jamais être done', () => {
    const v = normalizeVerdict({ state: 'done', summary: 'Fini.' }, baseCtx({
      busy: true,
      workPlan: [{ step: 'A', done: true }],
    }));
    expect(v.done).toBe(false);
    expect(v.state).toBe('working');
    expect(v.progress).toBe(99);
  });

  test('sans plan, la progression reste nulle', () => {
    const v = normalizeVerdict({ state: 'working', summary: 'Ça avance.' }, baseCtx());
    expect(v.progress).toBeNull();
    expect(v.plan).toEqual([]);
  });

  test('sans signal d’attente, un attend inventé est supprimé', () => {
    const v = normalizeVerdict({
      summary: 'L’agent travaille.',
      human_request: { needs: true, source: 'agent_ask', ask: 'Relance la session.' },
    }, baseCtx());
    expect(v.attend).toBe('');
    expect(v.humanSource).toBe('none');
    expect(v.state).toBe('working');
  });

  test('un formulaire réel fournit l’attente et sa provenance', () => {
    const v = normalizeVerdict({ summary: 'Une question attend.' }, baseCtx({
      wait: wait({ waiting: true, source: 'question_tool', ask: 'Quelle option choisir ?' }),
    }));
    expect(v.attend).toBe('Quelle option choisir ?');
    expect(v.humanSource).toBe('question_tool');
    expect(v.state).toBe('waiting_human');
  });

  test('une question explicite de l’agent est une attente agent_ask', () => {
    const ask = 'Veux-tu que je pose le commit ?';
    const v = normalizeVerdict({ summary: 'Le correctif est prêt.' }, baseCtx({ agentAsk: ask }));
    expect(v.attend).toBe(ask);
    expect(v.humanSource).toBe('agent_ask');
    expect(v.state).toBe('waiting_human');
  });

  test('la progression vient du planwrite, pas du modèle', () => {
    const v = normalizeVerdict({
      summary: 'Deux étapes sur quatre.',
      progress: 92,
      plan: [{ step: 'A', done: true }, { step: 'B', done: true }, { step: 'C', done: false }, { step: 'D', done: false }],
    }, baseCtx({
      workPlan: [
        { step: 'A', done: true },
        { step: 'B', done: true },
        { step: 'C', done: false },
        { step: 'D', done: false },
      ],
    }));
    expect(v.progress).toBe(50);
  });

  test('une baisse est refusée si le plan n’a pas changé', () => {
    const plan = [{ step: 'A', done: true }, { step: 'B', done: false }, { step: 'C', done: false }, { step: 'D', done: false }];
    const v = normalizeVerdict({ summary: 'Toujours pareil.' }, baseCtx({
      workPlan: plan,
      previous: { progress: 75, plan, resume: 'Trois étapes sur quatre.' },
    }));
    expect(v.progress).toBe(75);
  });

  test('un nouveau plan autorise la remise à zéro', () => {
    const plan = [{ step: 'A', done: false }, { step: 'B', done: false }];
    const v = normalizeVerdict({ summary: 'Nouvelle demande.' }, baseCtx({
      objectiveChanged: true,
      workPlan: plan,
      previous: { progress: 90, plan: [{ step: 'X', done: true }] },
    }));
    expect(v.progress).toBe(0);
  });
});

describe('détection et lint', () => {
  test('une question explicite est détectée', () => {
    expect(detectHumanQuestion('Le correctif est prêt.\nVeux-tu que je pose le commit ?')).toBe('Veux-tu que je pose le commit ?');
  });

  test('une longue explication avec un point d’interrogation ne suffit pas', () => {
    const long = 'x'.repeat(300) + ' Pourquoi ?';
    expect(detectHumanQuestion(long)).toBeNull();
  });

  test('la télémétrie est refusée', () => {
    const l = lintSummary('Session busy, rien de nouveau depuis le dernier passage.');
    expect(l.ok).toBe(false);
    expect(shouldRepair(l.reasons)).toBe(true);
  });

  test('un identifiant est nettoyé et signalé', () => {
    const l = lintSummary('La session ses_e4da1234 est terminée.');
    expect(l.cleaned).not.toContain('ses_');
    expect(l.reasons).toContain('identifiant ou code');
    expect(shouldRepair(l.reasons)).toBe(false); // nettoyé sans reprise
  });

  test('« le compagnon » pour l’agent est refusé', () => {
    const l = lintSummary('Le compagnon a répondu OK.');
    expect(l.reasons).toContain("compagnon pour l'agent");
    expect(shouldRepair(l.reasons)).toBe(true);
  });

  test('un résumé anglais est refusé', () => {
    const l = lintSummary('The session is blocked and the objective is unknown.');
    expect(l.reasons).toContain('pas en français');
    expect(shouldRepair(l.reasons)).toBe(true);
  });

  test('le jargon de développeur est refusé', () => {
    const l = lintSummary('Analyse livrée (doc 09, README, section G), branche poussée, 33/33 tests, 95 %.');
    expect(l.reasons).toContain('jargon');
    expect(shouldRepair(l.reasons)).toBe(true);
  });

  test('la mécanique de supervision est refusée', () => {
    const l = lintSummary('Plan de 3 à 6 étapes non établi ; le verdict reste en attente.');
    expect(l.reasons).toContain('mécanique interne');
    expect(shouldRepair(l.reasons)).toBe(true);
    const l2 = lintSummary('Le taux d’avancement affiché ne vient pas du travail de l’agent.');
    expect(l2.reasons).toContain('mécanique interne');
  });

  test('scrub enlève les identifiants et les backticks', () => {
    const s = scrubSummary('Le fichier `src/a.ts` et ses_e4da1234 sont prêts.');
    expect(s).toContain('src/a.ts');
    expect(s).not.toContain('`');
    expect(s).not.toContain('ses_');
  });
});

describe('objectif et plan', () => {
  const prev = {
    objective: 'MVP1 restant',
    objective_version: 1,
    last_user_id: 'u1',
    goal: 'MVP1 restant',
    plan: JSON.stringify([{ step: 'A', done: true }, { step: 'B', done: false }]),
  };

  test('une nouvelle consigne incrémente la version et vide le plan', () => {
    const r = resolveObjective({ prev, lastUser: { id: 'u2', text: 'démarre l’implémentation de la livraison inline dans la carte' } });
    expect(r.changed).toBe(true);
    expect(r.version).toBe(2);
    expect(r.plan).toEqual([]);
    expect(r.objective).toContain('livraison inline');
  });

  test('une réponse courte ne change pas l’objectif', () => {
    const r = resolveObjective({ prev, lastUser: { id: 'u2', text: 'Bun' } });
    expect(r.changed).toBe(false);
    expect(r.version).toBe(1);
    expect(r.plan.length).toBe(2);
  });

  test('un recadrage sans verbe de nouvelle demande ne change pas l’objectif', () => {
    expect(isNewObjective('je demande pas des tests, je te demande si tu as fait des tests!!!')).toBe(false);
    const r = resolveObjective({ prev, lastUser: { id: 'u2', text: 'je demande pas des tests, je te demande si tu as fait des tests!!!' } });
    expect(r.changed).toBe(false);
  });

  test('premier passage : l’objectif est le dernier message humain', () => {
    const r = resolveObjective({ prev: null, lastUser: { id: 'u1', text: 'Prépare le plan de la migration' } });
    expect(r.objective).toBe('Prépare le plan de la migration');
    expect(r.version).toBe(1);
    expect(r.changed).toBe(false);
  });

  test('progression du plan : 99 tant que done est faux', () => {
    const plan = [{ step: 'A', done: true }, { step: 'B', done: true }];
    expect(planProgress(plan, false)).toBe(99);
    expect(planProgress(plan, true)).toBe(100);
    expect(planProgress([], false)).toBeNull();
  });

  test('un plan est limité à 6 étapes', () => {
    const plan = Array.from({ length: 10 }, (_, i) => ({ step: `Étape ${i}`, done: false }));
    expect(normalizePlan(plan).length).toBe(6);
  });
});

describe('toolActionLine', () => {
  test('une commande shell est lisible', () => {
    const line = toolActionLine({
      type: 'tool', name: 'shell',
      state: { status: 'completed', input: { command: 'bun test daemon/test/verdict.test.mts' } },
    });
    expect(line).toContain('[OUTIL shell]');
    expect(line).toContain('bun test');
    expect(line).toContain('completed');
  });

  test('un fichier écrit est lisible', () => {
    const line = toolActionLine({
      type: 'tool', name: 'write',
      state: { status: 'completed', input: { path: 'daemon/src/verdict.mts' } },
    });
    expect(line).toContain('daemon/src/verdict.mts');
  });

  test('un texte simple ne produit rien', () => {
    expect(toolActionLine({ type: 'text', text: 'bonjour' })).toBeNull();
  });
});
