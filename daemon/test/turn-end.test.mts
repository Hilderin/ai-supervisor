/**
 * Fin de tour prouvée par la conversation (turn-end.mts).
 *
 * Le statut d'OpenChamber ne referme pas un tour stoppé pendant une question :
 * OpenCode annonce l'arrêt comme un `shutdown` (motif ignoré par OpenChamber) et
 * l'entrée reste `busy` — la carte du Superviseur gardait donc son spinner.
 * Aucune base SQLite ici : ce module ne lit que l'instance OpenChamber simulée.
 */
import { describe, expect, test, beforeEach } from 'bun:test';
import {
  isStoppedTurnError,
  resetTurnEndCache,
  settleStoppedTurns,
  turnEndedFromTail,
  type SettleCandidate,
  type TailMessage,
} from '../src/turn-end.mts';

const BASE = 'http://oc.test';

const assistant = (error?: unknown, created = 10): TailMessage => ({
  id: `msg_a${created}`,
  type: 'assistant',
  time: { created, completed: created + 1 },
  ...(error === undefined ? {} : { error }),
});
const user = (created = 1): TailMessage => ({ id: `msg_u${created}`, type: 'user', time: { created } });
const idle = (created = 20): TailMessage => ({ id: `msg_i${created}`, type: 'idle', time: { created }, outcome: 'interrupted' });

describe('isStoppedTurnError : seul un arrêt compte', () => {
  test("types et détails d'OpenCode", () => {
    expect(isStoppedTurnError({ type: 'aborted', message: 'The user dismissed this question' })).toBe(true);
    expect(isStoppedTurnError({ type: 'aborted', message: 'Step interrupted' })).toBe(true);
    expect(isStoppedTurnError({ name: 'MessageAbortedError', message: 'The running turn was interrupted.' })).toBe(true);
    expect(isStoppedTurnError('Step interrupted')).toBe(true);
  });

  test('échec de provider, coupure de flux et absence d’erreur ne sont pas des arrêts', () => {
    expect(isStoppedTurnError({ type: 'Overloaded', message: 'busy' })).toBe(false);
    expect(isStoppedTurnError({ type: 'APIConnectionError', message: 'Connection aborted' })).toBe(false);
    expect(isStoppedTurnError({ type: 'ProviderAuthError', message: 'Stream aborted by the provider' })).toBe(false);
    expect(isStoppedTurnError(undefined)).toBe(false);
    expect(isStoppedTurnError(null)).toBe(false);
    expect(isStoppedTurnError('')).toBe(false);
  });
});

describe('turnEndedFromTail : la queue de la conversation tranche', () => {
  test('message assistant complet avec erreur d’arrêt : tour fini', () => {
    expect(turnEndedFromTail([user(), assistant({ type: 'aborted', message: 'Step interrupted' })])).toBe(true);
  });

  test('enregistrement idle après le message : tour fini', () => {
    expect(turnEndedFromTail([user(), assistant(), idle()])).toBe(true);
  });

  test('message assistant complet sans erreur : rien ne prouve la fin (étapes suivantes)', () => {
    expect(turnEndedFromTail([user(), assistant()])).toBe(false);
  });

  test('erreur de provider : le tour peut repartir en retry, on ne touche à rien', () => {
    expect(turnEndedFromTail([user(), assistant({ type: 'Overloaded', message: 'busy' })])).toBe(false);
  });

  test('un message utilisateur après le tour assistant : nouveau tour, rien à corriger', () => {
    expect(turnEndedFromTail([assistant({ type: 'aborted', message: 'Step interrupted' }), user(30)])).toBe(false);
  });

  test('ordre indifférent, queue vide ou sans message décidable', () => {
    const stopped = assistant({ type: 'aborted', message: 'Step interrupted' });
    expect(turnEndedFromTail([stopped, user()])).toBe(true); // ordre d'entrée inversé
    expect(turnEndedFromTail([])).toBe(false);
    expect(turnEndedFromTail([{ id: 'x', type: 'model-switched', time: { created: 5 } }])).toBe(false);
  });
});

/* --- settleStoppedTurns : instance simulée --------------------------------- */

const realFetch = globalThis.fetch;
const calls: string[] = [];
let tails: Record<string, TailMessage[] | 'error'> = {};

beforeEach(() => {
  resetTurnEndCache();
  calls.length = 0;
  tails = {};
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const match = url.match(/^http:\/\/oc\.test\/api\/session\/([^/?]+)\/message/);
    if (!match) return new Response('not found', { status: 404 });
    const tail = tails[decodeURIComponent(match[1])];
    if (tail === undefined) return new Response('not found', { status: 404 });
    if (tail === 'error') throw new Error('instance muette');
    return Response.json({ data: tail });
  }) as typeof fetch;
});

const restoreFetch = () => {
  globalThis.fetch = realFetch;
};

/** Remet un candidat busy dont la conversation prouve l'arrêt. */
function stoppedTail(): TailMessage[] {
  return [
    assistant({ type: 'aborted', message: 'Step interrupted' }, 10),
    user(1),
  ];
}

describe('settleStoppedTurns : statut corrigé sur preuve', () => {
  test('un tour stoppé repasse idle, un tour actif reste busy, une carte idle n’est pas lue', async () => {
    tails = {
      session_stopped: stoppedTail(),
      session_running: [user(1), { id: 'm', type: 'assistant', time: { created: 10 }, content: [] }],
    };
    const rows: SettleCandidate[] = [
      { id: 'session_stopped', status: 'busy', lastUpdateAt: 1_000 },
      { id: 'session_running', status: 'busy', lastUpdateAt: 2_000 },
      { id: 'session_at_rest', status: 'idle', lastUpdateAt: 3_000 },
    ];
    try {
      const result = await settleStoppedTurns(rows, BASE);
      expect(result.settled).toEqual(['session_stopped']);
      expect(result.fresh).toEqual(['session_stopped']);
      expect(rows.map((row) => row.status)).toEqual(['idle', 'busy', 'idle']);
      // la carte au repos n'est jamais lue
      expect(calls.some((url) => url.includes('session_at_rest'))).toBe(false);
    } finally {
      restoreFetch();
    }
  });

  test('instance muette ou réponse absente : on ne décide rien', async () => {
    tails = { session_muette: 'error' };
    const rows: SettleCandidate[] = [
      { id: 'session_muette', status: 'busy', lastUpdateAt: 1_000 },
      { id: 'session_inconnue', status: 'busy', lastUpdateAt: 2_000 },
    ];
    try {
      expect((await settleStoppedTurns(rows, BASE)).settled).toEqual([]);
      expect(rows.map((row) => row.status)).toEqual(['busy', 'busy']);
    } finally {
      restoreFetch();
    }
  });

  test('décision mémorisée par lastUpdateAt : pas de relecture d’une session figée, relecture dès qu’elle bouge', async () => {
    tails = { session_stopped: stoppedTail() };
    const rows: SettleCandidate[] = [{ id: 'session_stopped', status: 'busy', lastUpdateAt: 1_000 }];
    try {
      const first = await settleStoppedTurns(rows, BASE);
      expect(first.fresh).toEqual(['session_stopped']);
      const reads = calls.length;
      // frame suivante : la flotte repart du statut brut (busy) du même
      // lastUpdateAt -> aucune lecture de plus, statut corrigé, journal muet
      rows[0]!.status = 'busy';
      const again = await settleStoppedTurns(rows, BASE);
      expect(again.settled).toEqual(['session_stopped']);
      expect(again.fresh).toEqual([]);
      expect(calls.length).toBe(reads);
      expect(rows[0]?.status).toBe('idle');

      // la session bouge (vrai tour) : on relit
      rows[0]!.status = 'busy';
      rows[0]!.lastUpdateAt = 2_000;
      tails = { session_stopped: [assistant(undefined, 30), user(29)] };
      expect((await settleStoppedTurns(rows, BASE)).settled).toEqual([]);
      expect(calls.length).toBe(reads + 1);
      expect(rows[0]?.status).toBe('busy');
    } finally {
      restoreFetch();
    }
  });

  test('un tour en état retry est vérifié aussi', async () => {
    tails = { session_retry: stoppedTail() };
    const rows: SettleCandidate[] = [{ id: 'session_retry', status: 'retry', lastUpdateAt: 5_000 }];
    try {
      expect((await settleStoppedTurns(rows, BASE)).settled).toEqual(['session_retry']);
      expect(rows[0]?.status).toBe('idle');
    } finally {
      restoreFetch();
    }
  });

  test('le cache ne garde pas les sessions sorties de la flotte', async () => {
    tails = { session_a: stoppedTail(), session_b: stoppedTail() };
    try {
      await settleStoppedTurns([{ id: 'session_a', status: 'busy', lastUpdateAt: 1 }], BASE);
      await settleStoppedTurns([{ id: 'session_b', status: 'busy', lastUpdateAt: 1 }], BASE);
      // session_a oubliée : revenue plus tard avec le même lastUpdateAt, elle est relue
      const before = calls.filter((url) => url.includes('session_a')).length;
      await settleStoppedTurns([{ id: 'session_a', status: 'busy', lastUpdateAt: 1 }], BASE);
      expect(calls.filter((url) => url.includes('session_a')).length).toBe(before + 1);
    } finally {
      restoreFetch();
    }
  });
});
