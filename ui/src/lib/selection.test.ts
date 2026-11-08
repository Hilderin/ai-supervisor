import { describe, expect, test } from 'bun:test';
import { neighborSelection, selectionAfterChange } from './selection';

const ids = (visible: string[]) => new Set(visible);

describe('neighborSelection', () => {
  test('retient la tâche immédiatement au-dessus', () => {
    expect(neighborSelection(['a', 'b', 'c', 'd'], 'c', ids(['a', 'b', 'd']))).toBe('b');
  });

  test('à défaut de dessus, retient celle juste en dessous', () => {
    expect(neighborSelection(['a', 'b', 'c'], 'a', ids(['b', 'c']))).toBe('b');
  });

  test('plus rien au-dessus ni en dessous : aucune sélection', () => {
    expect(neighborSelection(['a'], 'a', ids([]))).toBeNull();
  });

  test('saute les voisines disparues et garde la plus proche au-dessus', () => {
    expect(neighborSelection(['a', 'b', 'c', 'd', 'e'], 'd', ids(['a', 'e']))).toBe('a');
  });

  test('ne retient jamais une tâche hors de la liste visible', () => {
    // b et c sont masquées par un filtre : on descend jusqu'à e
    expect(neighborSelection(['a', 'b', 'c', 'd', 'e'], 'a', ids(['d', 'e']))).toBe('d');
  });

  test('une tâche inconnue de la liste précédente ne déclenche rien', () => {
    expect(neighborSelection(['a', 'b'], 'z', ids(['a', 'b']))).toBeNull();
  });
});

describe('selectionAfterChange', () => {
  test('sans sélection, aucune sélection automatique', () => {
    expect(selectionAfterChange(null, ['a', 'b', 'c'], ['a', 'b'])).toBeNull();
  });

  test('une tâche encore visible reste sélectionnée', () => {
    expect(selectionAfterChange('b', ['a', 'b', 'c'], ['a', 'b', 'c'])).toBe('b');
  });

  test('la disparition de la tâche voisine ne change pas la sélection', () => {
    expect(selectionAfterChange('a', ['a', 'b', 'c'], ['a', 'c'])).toBe('a');
  });

  test('la tâche sélectionnée disparaît : la voisine du dessus prend sa place', () => {
    expect(selectionAfterChange('c', ['a', 'b', 'c', 'd'], ['a', 'b', 'd'])).toBe('b');
  });

  test('la dernière tâche disparaît : le panneau se ferme', () => {
    expect(selectionAfterChange('a', ['a'], [])).toBeNull();
  });
});
