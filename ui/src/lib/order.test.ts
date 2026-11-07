import { describe, expect, test } from 'bun:test';
import {
  ORDER_GRACE_MS,
  assignOrder,
  emptyOrder,
  sortByOrder,
} from './order';

const T0 = 1_000_000;
const rows = (...ids: string[]) => ids.map((id) => ({ id }));

describe('ordre stable de la flotte', () => {
  test('le premier snapshot attribue un rang dans l’ordre reçu', () => {
    const { state, changed } = assignOrder(emptyOrder(), rows('a', 'b', 'c'), T0);
    expect(changed).toBe(true);
    expect(state.order).toEqual({ a: 1, b: 2, c: 3 });
    expect(state.nextRank).toBe(4);
  });

  test('un changement d’état qui réordonne le daemon ne change pas les rangs', () => {
    const first = assignOrder(emptyOrder(), rows('a', 'b', 'c'), T0);
    const second = assignOrder(first.state, rows('c', 'a', 'b'), T0 + 1000);
    expect(second.changed).toBe(false);
    expect(second.state.order).toEqual({ a: 1, b: 2, c: 3 });
    expect(sortByOrder(rows('c', 'a', 'b'), second.state.order).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  test('une nouvelle tâche est ajoutée en bas, même si le daemon la met en tête', () => {
    const first = assignOrder(emptyOrder(), rows('a', 'b', 'c'), T0);
    const second = assignOrder(first.state, rows('d', 'b', 'a', 'c'), T0 + 1000);
    expect(second.state.order.d).toBe(4);
    expect(sortByOrder(rows('d', 'b', 'a', 'c'), second.state.order).map((r) => r.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  test('une disparition de moins de 2 min conserve le rang', () => {
    const first = assignOrder(emptyOrder(), rows('a', 'b'), T0);
    const hidden = assignOrder(first.state, rows('a'), T0 + 1000);
    const back = assignOrder(hidden.state, rows('a', 'b'), T0 + 2000);
    expect(back.changed).toBe(false);
    expect(back.state.order.b).toBe(2);
  });

  test('une disparition plus longue repart en bas', () => {
    const first = assignOrder(emptyOrder(), rows('a', 'b'), T0);
    const hidden = assignOrder(first.state, rows('a'), T0 + 1000);
    // `a` continue d'être vue pendant l'absence de `b`.
    const stillHidden = assignOrder(hidden.state, rows('a'), T0 + ORDER_GRACE_MS + 1000);
    const back = assignOrder(stillHidden.state, rows('a', 'b'), T0 + ORDER_GRACE_MS + 2000);
    expect(back.changed).toBe(true);
    expect(back.state.order.a).toBe(1);
    expect(back.state.order.b).toBe(3);
  });

  test('le tri est stable pour des rangs manquants', () => {
    expect(sortByOrder(rows('x', 'y'), {}).map((r) => r.id)).toEqual(['x', 'y']);
  });
});
