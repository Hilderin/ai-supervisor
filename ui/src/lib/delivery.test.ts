import { describe, expect, test } from 'bun:test';
import type { Delivery } from '../types';
import { deliveryView, isLongDelivery } from './delivery';

const delivery = (state: Delivery['state'], extra: Partial<Delivery> = {}): Delivery => ({
  sessionId: 's1',
  at: 1,
  state,
  ...extra,
});

describe('deliveryView', () => {
  test('désactivé : rien n’est lu', () => {
    expect(deliveryView({ enabled: false, loading: true, error: false, delivery: null, done: true })).toBe('hidden');
  });

  test('chargement puis contenu', () => {
    expect(deliveryView({ enabled: true, loading: true, error: false, delivery: null, done: false })).toBe('loading');
    expect(deliveryView({
      enabled: true, loading: false, error: false, done: false,
      delivery: delivery('ok', { markdown: 'fini' }),
    })).toBe('content');
  });

  test('aucune réponse : visible sur TERMINÉ, cachée sur une carte au repos', () => {
    expect(deliveryView({ enabled: true, loading: false, error: false, delivery: delivery('empty'), done: true })).toBe('empty');
    expect(deliveryView({ enabled: true, loading: false, error: false, delivery: delivery('empty'), done: false })).toBe('hidden');
  });

  test('indisponible ou erreur réseau : état error', () => {
    expect(deliveryView({ enabled: true, loading: false, error: false, delivery: delivery('unavailable'), done: true })).toBe('error');
    expect(deliveryView({ enabled: true, loading: false, error: true, delivery: null, done: false })).toBe('error');
  });
});

describe('isLongDelivery', () => {
  test('texte court ou absent', () => {
    expect(isLongDelivery(undefined)).toBe(false);
    expect(isLongDelivery('court')).toBe(false);
  });

  test('texte long ou très ligné', () => {
    expect(isLongDelivery('x'.repeat(601))).toBe(true);
    expect(isLongDelivery(Array.from({ length: 11 }, () => 'ligne').join('\n'))).toBe(true);
  });
});
