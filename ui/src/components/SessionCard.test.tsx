import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FleetRow } from '../types';
import type { Section } from '../lib/placement';
import { cardState } from '../lib/cardState';
import { SessionCard } from './SessionCard';
function row(patch: Partial<FleetRow> = {}): FleetRow {
  return {
    id: 'ses_card',
    title: 'Tâche de test',
    dir: '/proj/ai-supervisor',
    status: 'idle',
    ...patch,
  } as FleetRow;
}

const plan = (done: number, total: number): FleetRow['plan'] => ({
  done,
  total,
  steps: Array.from({ length: total }, (_, i) => ({
    text: 'étape',
    status: i < done ? 'completed' : 'pending',
  })),
});

const crit = (validated: number, total: number) => ({ total, todo: 0, toValidate: 0, toFix: 0, validated });

function renderCard(r: FleetRow, placement: Section = 'running'): string {
  return renderToStaticMarkup(
    <SessionCard
      row={r}
      state={cardState(r, placement)}
      selected={false}
      flash={false}
      now={0}
      onOpen={() => {}}
      onOpenChamber={() => {}}
    />,
  );
}

describe('SessionCard sans composer', () => {
  test("la carte n'a plus de champ d'écriture : écrire passe par le détail", () => {
    for (const r of [row(), { ...row(), status: 'busy' as const }, { ...row(), plan: plan(2, 3) }]) {
      const html = renderCard(r as FleetRow);
      expect(html).not.toContain('Écrire à cette tâche…');
      expect(html).not.toContain('<textarea');
    }
  });

  test('hauteur réduite : trois rangées (en-tête, corps, pied), 190 px', () => {
    const html = renderCard(row({ plan: plan(1, 3) }));
    expect(html).toContain('h-[190px]');
    expect(html).toContain('grid-rows-[24px_minmax(0,1fr)_30px]');
  });

  test('affiche un échec OpenCode sur la carte au lieu du faux signal de réflexion', () => {
    const html = renderCard(row({
      status: 'busy',
      issue: { state: 'error', message: 'Le fournisseur est indisponible', errorType: 'ProviderError', updatedAt: 2 },
    }));
    expect(html).toContain('Le fournisseur est indisponible');
    expect(html).toContain('Erreur OpenCode');
    expect(html).not.toContain('Réflexion en cours');
    expect(html).toContain('Détail');
  });

  test('distingue le retry planifié et son numéro de tentative', () => {
    const html = renderCard(row({
      status: 'idle',
      issue: { state: 'retry', message: 'Connexion interrompue', attempt: 3, updatedAt: 2 },
    }));
    expect(html).toContain('Nouvel essai');
    expect(html).toContain('Retry OpenCode · tentative 3');
    expect(html).toContain('Connexion interrompue');
  });
});

describe('ligne d’activité', () => {
  test('une carte busy affiche une seule ligne : type, sujet et infobulle', () => {
    const html = renderCard(row({
      status: 'busy',
      activity: { kind: 'edit', label: 'Édition', detail: 'activity.mts', title: '/projet/daemon/src/activity.mts', at: 1 },
    }));
    expect(html.match(/data-testid="activity-line"/g)).toHaveLength(1);
    expect(html).toContain('Édition');
    expect(html).toContain('activity.mts');
    expect(html).toContain('title="/projet/daemon/src/activity.mts"');
  });

  test('la ligne change de contenu sans empiler l’historique', () => {
    const shell = renderCard(row({
      status: 'busy',
      activity: { kind: 'shell', label: 'Commande', detail: 'bun test', title: 'bun test', at: 2 },
    }));
    const search = renderCard(row({
      status: 'busy',
      activity: { kind: 'search', label: 'Recherche', detail: 'activityOf', title: 'activityOf', at: 3 },
    }));
    expect(shell).toContain('Commande');
    expect(shell).not.toContain('Recherche');
    expect(search).toContain('Recherche');
    expect(search).not.toContain('Commande');
    expect(search.match(/data-testid="activity-line"/g)).toHaveLength(1);
  });

  test('au repos, aucune ligne résiduelle même si le champ traîne', () => {
    for (const r of [
      row({ status: 'idle', activity: { kind: 'shell', label: 'Commande', detail: 'bun test', at: 4 } }),
      row({ status: 'idle', plan: plan(3, 3), criteria: crit(2, 2), activity: { kind: 'shell', label: 'Commande', detail: 'bun test', at: 4 } }),
    ]) {
      const html = renderCard(r);
      expect(html).not.toContain('data-testid="activity-line"');
      expect(html).not.toContain('Commande');
    }
  });
});

describe('barres de progression', () => {
  const classOf = (html: string, testid: string): string => {
    const match = html.match(new RegExp(`data-testid="${testid}"[^>]*class="([^"]*)"`));
    return match?.[1] ?? '';
  };

  test('la barre des critères partage le gabarit visuel de celle du plan', () => {
    const html = renderCard(row({
      id: 'ses_bars',
      status: 'busy',
      plan: plan(1, 2),
      criteria: crit(1, 2),
    }));
    const planBar = classOf(html, 'plan-progress-bar');
    const criteriaBar = classOf(html, 'criteria-progress-bar');
    // même gabarit visuel : hauteur, piste, arrondi, plafond de largeur
    for (const token of ['h-[5px]', 'min-w-[48px]', 'rounded-[3px]', 'bg-track', 'overflow-hidden']) {
      expect(planBar).toContain(token);
      expect(criteriaBar).toContain(token);
    }
    // la barre du plan a une largeur liée à la carte (fin de barre = colonne
    // de la valeur, identique d'une carte à l'autre) ; celle des critères reste
    // souple, avec l'espacement demandé par le propriétaire
    expect(planBar).toContain('w-[clamp(110px,19%,160px)]');
    expect(planBar).not.toContain('flex-1');
    expect(criteriaBar).toContain('flex-1');
    expect(criteriaBar).toContain('max-w-[160px]');
    expect(criteriaBar).toContain('ml-[15px]');
  });

  test('la valeur de progression est alignée quel que soit le libellé du statut', () => {
    const cases: Array<[string, FleetRow, Section]> = [
      ['travaille', row({ status: 'busy' }), 'running'],
      ['à compléter', row(), 'running'],
      ['Nouvel essai', row({ issue: { state: 'retry', message: 'x', attempt: 1, updatedAt: 1 } }), 'running'],
    ];
    for (const [label, r, placement] of cases) {
      const html = renderCard(r, placement);
      expect(html).toContain(`>${label}</span>`);
      expect(classOf(html, 'card-state-label')).toContain('w-[112px]');
      // sans plan, la place de la valeur reste réservée sur 38 px
      expect(html).toContain('w-[38px] shrink-0');
    }
    // avec un plan, la valeur devient le compteur cliquable du PlanPopover
    const done = renderCard(row({ plan: plan(3, 3), criteria: crit(2, 2) }), 'done');
    expect(done).toContain('>terminé</span>');
    expect(done).toContain('data-testid="progress"');
  });

  test('sans progression, le gabarit de la valeur garde la même largeur', () => {
    const r = row();
    const html = renderCard(r);
    expect(classOf(html, 'card-state-label')).toContain('w-[112px]');
    // la place de la valeur est réservée sur 38 px même sans barre
    expect(html).toContain('w-[38px] shrink-0');
  });
});

describe('états terminé et à compléter (déterministes)', () => {
  test('terminé : coche verte, bouton Terminé en action principale', () => {
    const html = renderCard(row({ plan: plan(3, 3), criteria: crit(2, 2) }), 'done');
    expect(html).toContain('terminé');
    expect(html).toContain('>✓</span>');
    expect(html).toContain('>Terminé</button>');
  });

  test('à compléter : triangle d avertissement, détail des manques, action Détail', () => {
    const html = renderCard(row({ plan: plan(2, 4), criteria: crit(1, 2) }));
    expect(html).toContain('à compléter');
    expect(html).toContain('Plan : 2/4 étapes');
    expect(html).toContain('Critères : 1/2 validés');
    expect(html).toContain('>Détail</button>');
    // plus d'étoile violette
    expect(html).not.toContain('text-review');
    expect(html).not.toContain('M5 0.2 6.59 2.82');
  });

  test('à compléter sans plan ni critère : le détail le dit', () => {
    const html = renderCard(row());
    expect(html).toContain('à compléter');
    expect(html).toContain('Pas de plan posé');
    expect(html).toContain('Aucun critère défini');
  });
});

describe('allègement de la carte', () => {
  test("le bloc de résultat à deux lignes n'est plus rendu sur la carte", () => {
    for (const [r, placement] of [
      [row({ plan: plan(1, 3) }), 'running'],
      [row({ plan: plan(3, 3), criteria: crit(2, 2) }), 'done'],
      [row({ status: 'busy', plan: plan(1, 3) }), 'running'],
    ] as Array<[FleetRow, Section]>) {
      const html = renderCard(r, placement);
      expect(html).not.toContain('Aucune réponse textuelle pour ce tour.');
      expect(html).not.toContain('Chargement du résultat…');
      expect(html).not.toContain('Résultat indisponible.');
      expect(html).not.toContain('max-h-[42px]');
    }
  });

  test('le pied de carte garde ses éléments fixes', () => {
    const html = renderCard(row({
      plan: plan(1, 3),
      unreadAnswers: 2,
    }));
    expect(html).toContain('data-testid="card-unread-answers"');
    expect(html).toContain('Options');
    expect(html).toContain('Ouvrir dans le mini chat OpenChamber');
  });

  test('la question est signalée par un « ? » orange, plus par la main', () => {
    const html = renderCard(row({
      pendingForms: [{ id: 'form_1', title: 'Quelle suite ?', fields: [{ key: 'q0', title: 'Quelle suite ?', type: 'string' }] }],
    }));
    expect(html).toContain('attend ta réponse');
    expect(html).toContain('Quelle suite ?');
    expect(html).not.toContain('✋');
    expect(html).toContain('rounded-full bg-orange');
  });

  test('plus de badge ni de bascule de supervision sur la carte', () => {
    const html = renderCard(row());
    expect(html).not.toContain('Non supervisée');
    expect(html).not.toContain('M4 4l16 16');
    expect(html).not.toContain('Désactiver la supervision');
    expect(html).not.toContain('Activer la supervision');
  });
});
