import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComposerActions, CleanChatButton, MessageMeta, SentTaskBlock } from '../components/SupervisorChat';
import type { Fleet, SupervisorState } from '../types';
import { useSupervisorStore } from './supervisorStore';

const base = (over: Partial<SupervisorState> = {}): SupervisorState => ({
  sessionId: 'ses_test',
  status: 'idle',
  agent: 'orchestrateur',
  directory: '/tmp/superviseur',
  mode: 'pilot',
  projectDirectory: null,
  messages: [],
  queued: [],
  pendingForms: [],
  ...over,
});

let calls: Array<{ url: string; body: Record<string, unknown> | null }> = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  useSupervisorStore.setState({
    state: base(),
    loading: false,
    refreshing: false,
    sending: false,
    creating: false,
    reverting: false,
    sendError: null,
    refreshError: null,
    draft: '',
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
    });
    if (url === '/api/supervisor/queue/take') {
      return new Response(
        JSON.stringify({ id: 'q1', text: 'texte repris', at: 1, attachments: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify(base()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('supervisorStore : envoi direct, file et actions', () => {
  test('au repos, le message part directement', async () => {
    await useSupervisorStore.getState().send('bonjour');
    expect(calls[0]?.url).toBe('/api/supervisor/send');
    expect(calls[0]?.body?.text).toBe('bonjour');
  });

  test('pendant un tour, le message part dans la file OpenChamber', async () => {
    useSupervisorStore.setState({ state: base({ status: 'busy' }) });
    await useSupervisorStore.getState().send('plus tard');
    expect(calls[0]?.url).toBe('/api/supervisor/queue');
    expect(calls[0]?.body?.text).toBe('plus tard');
    expect(useSupervisorStore.getState().draft).toBe('');
  });

  test('un retrait de la file appelle la route dédiée', async () => {
    useSupervisorStore.setState({ state: base({ queued: [{ id: 'q1', text: 'x', at: 1 }] }) });
    await useSupervisorStore.getState().removeQueued('q1');
    expect(calls[0]?.url).toBe('/api/supervisor/queue/cancel');
    expect(calls[0]?.body?.itemId).toBe('q1');
  });

  test('une question en attente : le message part immédiatement, jamais en file', async () => {
    useSupervisorStore.setState({
      state: base({ status: 'busy', pendingForms: [{ id: 'form_1', metadata: { kind: 'question' } }] }),
    });
    await useSupervisorStore.getState().send('réponds plutôt à ça');
    expect(calls[0]?.url).toBe('/api/supervisor/send');
    expect(calls[0]?.body?.text).toBe('réponds plutôt à ça');
    expect(calls.some((c) => c.url === '/api/supervisor/queue')).toBe(false);
  });

  test('« Envoyer maintenant » reprend l’item de la file puis l’envoie tout de suite', async () => {
    useSupervisorStore.setState({ state: base({ status: 'busy', queued: [{ id: 'q1', text: 'en file', at: 1 }] }) });
    await useSupervisorStore.getState().sendQueued('q1');
    expect(calls[0]?.url).toBe('/api/supervisor/queue/take');
    expect(calls[0]?.body?.itemId).toBe('q1');
    expect(calls[1]?.url).toBe('/api/supervisor/send');
    expect(calls[1]?.body?.text).toBe('texte repris');
    expect(useSupervisorStore.getState().state?.queued).toHaveLength(0);
  });

  test('« Modifier » reprend l’item et remet son texte dans le brouillon', async () => {
    useSupervisorStore.setState({ state: base({ queued: [{ id: 'q1', text: 'en file', at: 1 }] }) });
    await useSupervisorStore.getState().editQueued('q1');
    expect(calls[0]?.url).toBe('/api/supervisor/queue/take');
    expect(useSupervisorStore.getState().draft).toBe('texte repris');
    expect(useSupervisorStore.getState().state?.queued).toHaveLength(0);
    expect(calls.some((c) => c.url === '/api/supervisor/send')).toBe(false);
  });

  test('revenir à un message restaure son texte dans le brouillon', async () => {
    await useSupervisorStore.getState().revert('msg_1', 'texte initial');
    expect(calls[0]?.url).toBe('/api/supervisor/revert');
    expect(calls[0]?.body?.messageId).toBe('msg_1');
    expect(useSupervisorStore.getState().draft).toBe('texte initial');
  });

  test('le changement de mode passe par la route daemon avec le projet choisi', async () => {
    await useSupervisorStore.getState().setMode('investigation', '/tmp/projet');
    expect(calls[0]?.url).toBe('/api/supervisor/mode');
    expect(calls[0]?.body).toEqual({ mode: 'investigation', projectDirectory: '/tmp/projet' });
  });

  test('le composer ne démarre pas un tour pendant la bascule de mode', async () => {
    useSupervisorStore.setState({ modeUpdating: true });
    await useSupervisorStore.getState().send('inspecte le projet');
    expect(calls).toHaveLength(0);
  });
});

describe('CleanChatButton : sens explicite', () => {
  const render = (busy = false, creating = false) =>
    renderToStaticMarkup(
      <CleanChatButton
        busy={busy}
        creating={creating}
        disabled={busy || creating}
        onClick={() => {}}
      />,
    );

  test('affiche l’icône seule, avec un libellé accessible explicite', () => {
    const out = render();
    expect(out).toContain('aria-label="Nettoyer le chat"');
    expect(out).toContain('ancienne conversation reste dans OpenChamber');
    expect(out).not.toContain('>Nettoyer<');
  });

  test('pendant un tour, l’infobulle explique l’attente', () => {
    expect(render(true)).toContain('Attends la fin du tour');
  });
});

describe('SentTaskBlock : destinataire et texte complet', () => {
  const fleet: Fleet = {
    at: 1,
    concern: null,
    rows: [
      {
        id: 'ses_task',
        title: 'Nom actuel de la tâche',
        status: 'busy',
        pendingForms: [],
        pendingPermissions: [],
      },
    ],
  };
  const tool = {
    name: 'send_task',
    status: 'completed',
    label: 'a envoyé un message à une tâche',
    ok: true,
    taskId: 'ses_task',
    title: 'Ancien nom',
    text: '',
  };
  const render = (over: Partial<typeof tool> = {}, target: Fleet | null = fleet) =>
    renderToStaticMarkup(<SentTaskBlock tool={{ ...tool, ...over }} fleet={target} />);

  test('résout le titre courant à l’affichage, pas le titre mémorisé', () => {
    const out = render({ text: 'bonjour' });
    expect(out).toContain('Nom actuel de la tâche');
    expect(out).not.toContain('Ancien nom');
  });

  test('garde le texte envoyé tel quel, sans troncature', () => {
    const long = 'ligne très longue\n' + 'x'.repeat(600);
    expect(render({ text: long })).toContain(long);
  });

  test('repli lisible si la tâche n’est plus dans la flotte', () => {
    const out = render({ text: 'bonjour' }, { at: 1, concern: null, rows: [] });
    expect(out).toContain('une tâche qui n’est plus dans la flotte');
  });
});

describe('MessageMeta : heure et actions sur une ligne', () => {
  const message = (over: Partial<Parameters<typeof MessageMeta>[0]['message']> = {}) => ({
    id: 'msg_1',
    role: 'user' as const,
    at: Date.now(),
    text: 'salut',
    tools: [],
    ...over,
  });
  const render = (over: Partial<Parameters<typeof MessageMeta>[0]['message']> = {}) =>
    renderToStaticMarkup(<MessageMeta message={message(over)} disabled={false} onRevert={() => {}} />);

  test('les actions sont des icônes avec un libellé accessible, sans texte visible', () => {
    const out = render();
    expect(out).toContain('aria-label="Copier le message"');
    expect(out).toContain('aria-label="Revenir à partir d&#x27;ici"');
    expect(out).not.toContain('>Copier<');
    expect(out).not.toContain('>Revenir');
  });

  test('l’utilisateur garde l’heure et les icônes à droite', () => {
    const out = render();
    expect(out).toContain('justify-end');
    expect(out).not.toContain('justify-start');
  });

  test('les messages de l’agent gardent l’heure et les icônes à gauche', () => {
    const out = render({ role: 'assistant' });
    expect(out).toContain('justify-start');
    expect(out).not.toContain('justify-end');
  });

  test('un message sans texte n’a pas d’action Copier', () => {
    expect(render({ text: '' })).not.toContain('data-testid="message-copy"');
  });
});

describe('ComposerActions : Envoyer et Stop', () => {
  const render = (canStop: boolean, hasText: boolean, disabled = false, waiting = false) =>
    renderToStaticMarkup(
      <ComposerActions
        canStop={canStop}
        hasText={hasText}
        disabled={disabled}
        waiting={waiting}
        onSend={() => {}}
        onStop={() => {}}
      />,
    );

  test('au repos, le bouton Envoyer est présent', () => {
    const out = render(false, false, true);
    expect(out).toContain('data-testid="supervisor-send"');
    expect(out).not.toContain('data-testid="supervisor-stop"');
  });

  test('pendant un tour sans texte, seul le carré Stop occupe la place', () => {
    const out = render(true, false);
    expect(out).toContain('data-testid="supervisor-stop"');
    expect(out).not.toContain('data-testid="supervisor-queue-send"');
    expect(out).not.toContain('data-testid="supervisor-send"');
  });

  test('pendant un tour avec du texte, Envoyer met en file et le Stop reste à droite', () => {
    const out = render(true, true);
    expect(out).toContain('data-testid="supervisor-queue-send"');
    expect(out).toContain('data-testid="supervisor-stop"');
    expect(out.indexOf('supervisor-queue-send')).toBeLessThan(out.indexOf('supervisor-stop'));
    expect(out).toContain('Mettre le message en file');
  });

  test('quand une question attend, Envoyer annonce l’annulation de la question', () => {
    const out = render(true, true, false, true);
    expect(out).toContain('data-testid="supervisor-queue-send"');
    expect(out).toContain('Envoyer maintenant et annuler la question');
    expect(out).not.toContain('Mettre le message en file');
  });
});
