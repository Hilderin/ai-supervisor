import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  deliveryEventRelevant,
  getDelivery,
  invalidateDelivery,
  parseDelivery,
  resetDeliveryCache,
  setBase,
} from '../src/delivery.mts';

const user = (created: number, text: string) => ({ id: `u${created}`, type: 'user', time: { created }, text });
const assistant = (created: number, content: unknown[]) => ({ id: `a${created}`, type: 'assistant', time: { created }, content });
const text = (value: string) => ({ type: 'text', text: value });
const render = (html: string, title: string, ok = true, root = false) => ({
  type: 'tool',
  name: 'openchamber_render',
  state: {
    status: 'completed',
    input: root ? { html, title } : { parameters: { html, title } },
    metadata: { openchamber: { ok } },
  },
});

describe('parseDelivery', () => {
  test('dernier texte assistant + rendu du même tour', () => {
    const d = parseDelivery('s1', [
      user(1, 'fais le graphique'),
      assistant(2, [{ type: 'reasoning', text: 'je réfléchis' }]),
      assistant(3, [render('<h1>Ventes</h1>', 'Ventes')]),
      assistant(4, [text('Voici le graphique.')]),
    ], 1000);

    expect(d.state).toBe('ok');
    expect(d.markdown).toBe('Voici le graphique.');
    expect(d.render).toEqual({ html: '<h1>Ventes</h1>', title: 'Ventes' });
    expect(d.createdAt).toBe(4);
    expect(d.turnStartedAt).toBe(1);
    expect(d.messageId).toBe('a4');
  });

  test('le dernier message assistant peut être un tool call sans texte', () => {
    const d = parseDelivery('s1', [
      user(1, 'demande'),
      assistant(2, [text('Réponse utile.')]),
      assistant(3, [{ type: 'tool', name: 'shell', state: { status: 'completed', input: { command: 'ls' } } }]),
    ]);
    expect(d.markdown).toBe('Réponse utile.');
  });

  test('ignore la réponse du tour précédent quand le tour courant n’a pas de texte', () => {
    const d = parseDelivery('s1', [
      user(1, 'ancienne demande'),
      assistant(2, [text('ancienne réponse')]),
      user(3, 'nouvelle demande'),
      assistant(4, [{ type: 'tool', name: 'shell', state: { status: 'running', input: { command: 'ls' } } }]),
    ]);
    expect(d.state).toBe('empty');
    expect(d.markdown).toBeUndefined();
    expect(d.turnStartedAt).toBe(3);
  });

  test('accepte le HTML à la racine de l’input (variante du tool)', () => {
    const d = parseDelivery('s1', [
      user(1, 'demande'),
      assistant(2, [render('<p>ok</p>', 'Titre racine', true, true), text('fini')]),
    ]);
    expect(d.render?.html).toBe('<p>ok</p>');
    expect(d.render?.title).toBe('Titre racine');
  });

  test('accepte une forme générique action=render.page', () => {
    const d = parseDelivery('s1', [
      user(1, 'demande'),
      assistant(2, [{
        type: 'tool',
        name: 'openchamber',
        state: {
          status: 'completed',
          input: { action: 'render.page', parameters: { html: '<p>générique</p>', title: 'Générique' } },
          metadata: { openchamber: { ok: true } },
        },
      }, text('fini')]),
    ]);
    expect(d.render?.html).toBe('<p>générique</p>');
    expect(d.render?.title).toBe('Générique');
  });

  test('ignore un rendu refusé ou une page ui (pas du HTML)', () => {
    const refused = parseDelivery('s1', [
      user(1, 'demande'),
      assistant(2, [render('<p>non</p>', 'Non', false), text('fini')]),
    ]);
    expect(refused.render).toBeUndefined();

    const ui = parseDelivery('s1', [
      user(1, 'demande'),
      assistant(2, [{
        type: 'tool',
        name: 'openchamber_render',
        state: { status: 'completed', input: { parameters: { ui: 'root = Stack([])' } }, metadata: { openchamber: { ok: true } } },
      }, text('fini')]),
    ]);
    expect(ui.render).toBeUndefined();
  });

  test('déduit le titre de la page quand il manque', () => {
    const d = parseDelivery('s1', [
      user(1, 'demande'),
      assistant(2, [render('<html><head><title>Mon rapport</title></head><body></body></html>', '')]),
    ]);
    expect(d.render?.title).toBe('Mon rapport');
  });

  test('joint les parts texte et tronque les réponses trop longues', () => {
    const long = 'x'.repeat(40_050);
    const d = parseDelivery('s1', [user(1, 'demande'), assistant(2, [text('début'), text(long)])]);
    expect(d.truncated).toBe(true);
    expect(d.markdown?.length).toBe(40_000);
    expect(d.markdown?.startsWith('début')).toBe(true);
  });

  test('fenêtre sans message humain : garde le dernier texte assistant', () => {
    const d = parseDelivery('s1', [assistant(2, [text('réponse dans la fenêtre')])]);
    expect(d.markdown).toBe('réponse dans la fenêtre');
    expect(d.turnStartedAt).toBeUndefined();
  });
});

describe('cache de livraison', () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  beforeEach(() => {
    calls = 0;
    resetDeliveryCache();
    setBase('http://oc.test');
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({
        data: [
          assistant(2, [text('réponse fraîche')]),
          user(1, 'demande'),
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setBase('');
    resetDeliveryCache();
  });

  test('deux lectures rapprochées ne font qu’une requête, l’invalidation en refait une', async () => {
    const a = await getDelivery('s1');
    const b = await getDelivery('s1');
    expect(a.markdown).toBe('réponse fraîche');
    expect(b).toEqual(a);
    expect(calls).toBe(1);

    invalidateDelivery('s1');
    await getDelivery('s1');
    expect(calls).toBe(2);
  });

  test('single-flight : deux demandes simultanées partagent la requête', async () => {
    const [a, b] = await Promise.all([getDelivery('s2'), getDelivery('s2')]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
  });

  test('une invalidation pendant le fetch ne cache pas la réponse périmée', async () => {
    let resolveFirst!: (r: Response) => void;
    let first = true;
    globalThis.fetch = (() => {
      calls += 1;
      if (first) {
        first = false;
        return new Promise<Response>((resolve) => { resolveFirst = resolve; });
      }
      return Promise.resolve(new Response(JSON.stringify({
        data: [assistant(2, [text('réponse fraîche')]), user(1, 'demande')],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }) as unknown as typeof fetch;

    const pending = getDelivery('s5');
    await Promise.resolve();
    invalidateDelivery('s5');
    resolveFirst(new Response(JSON.stringify({
      data: [assistant(2, [text('réponse périmée')]), user(1, 'demande')],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const stale = await pending;
    expect(stale.markdown).toBe('réponse périmée');
    const fresh = await getDelivery('s5');
    expect(fresh.markdown).toBe('réponse fraîche');
    expect(calls).toBe(2);
  });

  test('un appel après invalidation ne rejoint pas le fetch périmé en vol', async () => {
    let resolveFirst!: (r: Response) => void;
    let first = true;
    globalThis.fetch = (() => {
      calls += 1;
      if (first) {
        first = false;
        return new Promise<Response>((resolve) => { resolveFirst = resolve; });
      }
      return Promise.resolve(new Response(JSON.stringify({
        data: [assistant(2, [text('réponse fraîche')]), user(1, 'demande')],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }) as unknown as typeof fetch;

    const oldCall = getDelivery('s6');
    await Promise.resolve();
    invalidateDelivery('s6');
    const newCall = getDelivery('s6');
    resolveFirst(new Response(JSON.stringify({
      data: [assistant(2, [text('réponse périmée')]), user(1, 'demande')],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const [oldResult, newResult] = await Promise.all([oldCall, newCall]);
    expect(oldResult.markdown).toBe('réponse périmée');
    expect(newResult.markdown).toBe('réponse fraîche');
    expect(calls).toBe(2);
  });

  test('une erreur OpenChamber devient un état unavailable', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const d = await getDelivery('s3');
    expect(d.state).toBe('unavailable');
    expect(d.error).toContain('500');
  });

  test('une session supprimée dans le corps (200) devient unavailable', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ _tag: 'SessionNotFoundError' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
    const d = await getDelivery('s4');
    expect(d.state).toBe('unavailable');
    expect(d.error).toBe('session introuvable');
  });

  test('les événements de message ou de tour invalident le cache', () => {
    expect(deliveryEventRelevant('message.updated')).toBe(true);
    expect(deliveryEventRelevant('session.execution.succeeded')).toBe(true);
    expect(deliveryEventRelevant('session.text.ended')).toBe(true);
    expect(deliveryEventRelevant('session.step.ended')).toBe(true);
    expect(deliveryEventRelevant('session.idle')).toBe(true);
    expect(deliveryEventRelevant('session.agent.selected')).toBe(false);
    expect(deliveryEventRelevant('server.connected')).toBe(false);
  });
});
