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
    for (const r of [row(), { ...row(), status: 'busy' as const }, { ...row(), sup: { resume: 'r', at: 1 } }]) {
      const html = renderCard(r as FleetRow);
      expect(html).not.toContain('Écrire à cette tâche…');
      expect(html).not.toContain('<textarea');
    }
  });

  test('hauteur réduite : trois rangées (en-tête, corps, pied), 190 px', () => {
    const html = renderCard({ ...row(), sup: { resume: 'r', at: 1 } });
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
    for (const status of ['idle', 'done']) {
      const html = renderCard(row({
        status,
        activity: { kind: 'shell', label: 'Commande', detail: 'bun test', at: 4 },
      }));
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
      sup: { resume: 'r', at: 1, progress: 50 },
      plan: {
        steps: [{ text: 'Étape 1', status: 'completed' }, { text: 'Étape 2', status: 'in_progress' }],
        done: 1,
        total: 2,
      },
      criteria: { total: 2, todo: 0, toValidate: 1, toFix: 0, validated: 1 },
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
    const classOf = (html: string, testid: string): string => {
      const match = html.match(new RegExp(`data-testid="${testid}"[^>]*class="([^"]*)"`));
      return match?.[1] ?? '';
    };
    const cases: Array<[string, FleetRow, Section, string]> = [
      ['travaille', row({ status: 'busy', sup: { resume: 'r', at: 1, progress: 40 } }), 'running', 'card-progress-value'],
      ['fini, à valider', row({ plan: { steps: [{ text: 'Étape 1', status: 'completed' }], done: 9, total: 9 } }), 'running', 'progress'],
      ['Nouvel essai', row({ issue: { state: 'retry', message: 'x', attempt: 1, updatedAt: 1 }, sup: { resume: 'r', at: 1, progress: 20 } }), 'running', 'card-progress-value'],
      ['terminé', row({ sup: { resume: 'r', at: 1, progress: 100 } }), 'done', 'card-progress-value'],
    ];
    for (const [label, r, placement, slot] of cases) {
      const html = renderCard(r, placement);
      expect(html).toContain(`>${label}</span>`);
      expect(classOf(html, 'card-state-label')).toContain('w-[112px]');
      const value = classOf(html, slot);
      if (slot === 'progress') {
        // compteur cliquable du plan : même largeur minimale que le gabarit fixe
        expect(value).toContain('min-w-[38px]');
        expect(value).toContain('text-right');
      } else {
        expect(value).toContain('w-[38px]');
        expect(value).toContain('text-right');
      }
    }
  });

  test('sans progression, le gabarit de la valeur garde la même largeur', () => {
    const classOf = (html: string, testid: string): string => {
      const match = html.match(new RegExp(`data-testid="${testid}"[^>]*class="([^"]*)"`));
      return match?.[1] ?? '';
    };
    const r = row({ sup: { resume: 'r', at: 1 } });
    const html = renderCard(r);
    expect(classOf(html, 'card-state-label')).toContain('w-[112px]');
    // la place de la valeur est réservée sur 38 px même sans barre
    expect(html).toContain('w-[38px] shrink-0');
  });
});

describe('allègement de la carte', () => {
  test("le bloc de résultat à deux lignes n'est plus rendu sur la carte", () => {
    for (const [r, placement] of [
      [row({ sup: { resume: 'r', at: 1 } }), 'running'],
      [row({ sup: { resume: 'r', at: 1 } }), 'done'],
      [row({ status: 'busy', sup: { resume: 'r', at: 1 } }), 'running'],
    ] as Array<[FleetRow, Section]>) {
      const html = renderCard(r, placement);
      expect(html).not.toContain('Aucune réponse textuelle pour ce tour.');
      expect(html).not.toContain('Chargement du résultat…');
      expect(html).not.toContain('Résultat indisponible.');
      expect(html).not.toContain('max-h-[42px]');
      expect(html).not.toContain('mt-[5px] max-h-[56px]');
    }
  });

  test('le résumé et les autres éléments de la carte restent en place', () => {
    const html = renderCard(row({
      sup: { resume: 'Le résumé de la tâche', at: 1 },
      unreadAnswers: 2,
    }));
    expect(html).toContain('Le résumé de la tâche');
    expect(html).toContain('data-testid="card-unread-answers"');
    expect(html).toContain('Options');
    expect(html).toContain('Ouvrir dans le mini chat OpenChamber');
    expect(html).toContain('Terminé');
  });

  test('la question est signalée par un « ? » orange, plus par la main', () => {
    const html = renderCard(row({ sup: { resume: 'r', at: 1, attend: 'valider le rendu', humanSource: 'agent_ask' } }));
    expect(html).toContain('valider le rendu');
    expect(html).not.toContain('✋');
    expect(html).toContain('rounded-full bg-orange');
  });

  test('une carte en attente de réponse montre la question avec le « ? » orange', () => {
    const html = renderCard(row({
      pendingForms: [{ id: 'form_1', title: 'Quelle suite ?', fields: [{ key: 'q0', title: 'Quelle suite ?', type: 'string' }] }],
    }));
    expect(html).toContain('attend ta réponse');
    expect(html).toContain('Quelle suite ?');
    expect(html).not.toContain('✋');
    expect(html).toContain('rounded-full bg-orange');
  });

  test("l'icône de « fini, à valider » est une étoile violette, à la même place", () => {
    const html = renderCard(row({ sup: { resume: 'r', at: 1 } }));
    expect(html).toContain('fini, à valider');
    // plus de pastille verte d'acceptation
    expect(html).not.toContain('rounded-full bg-green ring-2 ring-green/25');
    // étoile violette de 10 px, premier élément de l'en-tête (avant le titre)
    expect(html).toContain('text-review');
    expect(html).not.toContain('text-amber');
    expect(html).toContain('M5 0.2 6.59 2.82 9.57 3.52 7.57 5.83 7.82 8.88 5 7.7 2.18 8.88 2.43 5.83 0.43 3.52 3.41 2.82Z');
    expect(html.indexOf('text-review')).toBeLessThan(html.indexOf('truncate font-[650]'));
  });
});
