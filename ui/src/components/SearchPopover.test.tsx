/**
 * Tests du popup de recherche (2026-11-14) : rendu des résultats (titre,
 * projet, date, extrait indenté et surligné), actions selon que la carte est
 * fermée ou présente, et bandeau du dashboard sans l'entête de compteur.
 * Rendu statique seulement : le portail et la frappe ne sont pas joués ici.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Fleet, SearchResponse, SearchResult } from '../types';
import { useFleetStore } from '../store/fleetStore';
import { FleetBoard } from './FleetBoard';
import { formatActivity, roleLabel, SEARCH_SHORTCUT, SearchResults } from './SearchPopover';

const NOW = new Date(2026, 10, 14, 18, 0).getTime();

function result(patch: Partial<SearchResult> = {}): SearchResult {
  return {
    sessionId: 'ses_search',
    title: 'Refonte du dashboard',
    project: 'ai-supervisor',
    directory: 'C:\\GitHub\\ai-supervisor',
    at: new Date(2026, 10, 14, 14, 32).getTime(),
    closed: false,
    titleMatch: true,
    ...patch,
  };
}

function renderResults(
  response: SearchResponse | null,
  query = 'refonte',
  extra: Partial<Parameters<typeof SearchResults>[0]> = {},
): string {
  return renderToStaticMarkup(
    createElement(SearchResults, {
      response,
      query,
      now: NOW,
      loading: false,
      restoring: null,
      onRestore: () => undefined,
      onReveal: () => undefined,
      ...extra,
    }),
  );
}

describe('formatActivity', () => {
  test('donne le jour, le mois et l’heure', () => {
    const text = formatActivity(new Date(2026, 10, 14, 14, 32).getTime(), NOW);
    expect(text).toContain('14');
    expect(text).toContain('nov');
    expect(text).toContain('14:32');
    // année courante : elle est omise
    expect(text).not.toContain('2026');
  });

  test('ajoute l’année quand elle diffère', () => {
    const text = formatActivity(new Date(2025, 10, 14, 14, 32).getTime(), NOW);
    expect(text).toContain('2025');
  });

  test('une date inconnue reste lisible', () => {
    expect(formatActivity(0, NOW)).toBe('activité inconnue');
  });
});

describe('roleLabel', () => {
  test('nomme l’auteur de l’extrait', () => {
    expect(roleLabel('user')).toBe('ton message');
    expect(roleLabel('assistant')).toBe('réponse de l’agent');
    expect(roleLabel(undefined)).toBe('message');
  });
});

describe('SearchResults', () => {
  test('affiche titre, projet, date, extrait surligné et « Restaurer » pour une carte fermée', () => {
    const html = renderResults({
      state: 'ok',
      results: [
        result({
          closed: true,
          snippet: [
            { text: 'la ' },
            { text: 'refonte', match: true },
            { text: ' avance' },
          ],
          role: 'assistant',
        }),
      ],
    });
    expect(html).toContain('data-testid="search-result"');
    expect(html).toContain('Refonte du dashboard');
    expect(html).toContain('ai-supervisor');
    expect(html).toContain('14:32');
    expect(html).toContain('data-testid="search-result-snippet"');
    expect(html).toContain('<mark');
    expect(html).toContain('réponse de l’agent');
    expect(html).toContain('data-testid="search-restore"');
    expect(html).toContain('Restaurer');
    expect(html).toContain('fermée');
  });

  test('une carte encore dans le tableau propose « Voir », pas « Restaurer »', () => {
    const html = renderResults({ state: 'ok', results: [result()] });
    expect(html).toContain('data-testid="search-reveal"');
    expect(html).not.toContain('data-testid="search-restore"');
    expect(html).not.toContain('>fermée<');
  });

  test('moins de deux caractères : une consigne, pas une requête', () => {
    const html = renderResults(null, 'a');
    expect(html).toContain('data-testid="search-hint"');
    expect(html).toContain('cartes fermées');
  });

  test('aucun résultat : le terme cherché est rappelé', () => {
    const html = renderResults({ state: 'ok', results: [] }, 'introuvable');
    expect(html).toContain('data-testid="search-empty"');
    expect(html).toContain('introuvable');
  });

  test('index indisponible : l’avertissement précède les titres trouvés', () => {
    const html = renderResults({ state: 'unavailable', results: [result()] });
    expect(html).toContain('data-testid="search-unavailable"');
    expect(html).toContain('seuls les titres');
    expect(html).toContain('data-testid="search-result"');
  });
});

describe('bandeau du dashboard', () => {
  beforeEach(() => {
    useFleetStore.setState({
      fleet: null,
      placements: {},
      order: {},
      nextRank: 1,
      seenAt: {},
      orderHydrated: false,
      selected: null,
      closed: {},
      drafts: {},
      error: null,
    });
  });

  test('l’entête de compteur a disparu, la loupe le remplace', () => {
    const fleet: Fleet = { at: 1, rows: [], concern: null };
    const html = renderToStaticMarkup(
      createElement(FleetBoard, { fleet, now: NOW, onOpenChamber: () => undefined }),
    );
    expect(html).not.toContain('Aucune tâche en attente');
    expect(html).not.toContain('0 tâche');
    expect(html).toContain('data-testid="search-button"');
    expect(html).toContain(SEARCH_SHORTCUT);
  });

  test('une tâche en attente garde le compteur et « Suivante »', () => {
    const fleet: Fleet = {
      at: 1,
      concern: null,
      rows: [
        {
          id: 'ses_wait',
          title: 'Tâche en attente',
          status: 'idle',
          pendingForms: [{ id: 'form_1', sessionID: 'ses_wait', title: 'Question' }],
          pendingPermissions: [],
        },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(FleetBoard, { fleet, now: NOW, onOpenChamber: () => undefined }),
    );
    expect(html).toContain('1 en attente');
    expect(html).toContain('Suivante');
    expect(html).toContain('data-testid="search-button"');
  });
});
