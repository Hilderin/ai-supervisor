import { describe, expect, test } from 'bun:test';
import {
  ActivityTracker,
  baseName,
  deriveActivityFromMessages,
  toolActivity,
  type WireMessage,
} from '../src/activity.mts';

describe('toolActivity : une ligne par type d’outil', () => {
  test('réflexion et écriture de texte', () => {
    const tracker = new ActivityTracker(() => 1000);
    tracker.ingest('session.reasoning.started', { sessionID: 'ses_a' });
    expect(tracker.get('ses_a')).toEqual({ kind: 'thinking', label: 'Réflexion', at: 1000 });
    tracker.ingest('session.text.delta', { sessionID: 'ses_a' });
    expect(tracker.get('ses_a')).toEqual({ kind: 'writing', label: 'Rédaction', at: 1000 });
  });

  test('édition et écriture de fichier : nom seul, chemin complet en infobulle', () => {
    expect(toolActivity('edit', { path: '/projet/src/lib/activity.mts' }, 10)).toEqual({
      kind: 'edit',
      label: 'Édition',
      detail: 'activity.mts',
      title: '/projet/src/lib/activity.mts',
      at: 10,
    });
    expect(toolActivity('write', { filePath: 'docs/analyse.md' }, 11)).toEqual({
      kind: 'write',
      label: 'Écriture',
      detail: 'analyse.md',
      title: 'docs/analyse.md',
      at: 11,
    });
  });

  test('recherche : motif sur une ligne', () => {
    expect(toolActivity('grep', { pattern: 'activityOf' }, 12)).toEqual({
      kind: 'search',
      label: 'Recherche',
      detail: 'activityOf',
      title: 'activityOf',
      at: 12,
    });
  });

  test('commande shell : première ligne, espaces normalisés, tronquée', () => {
    const long = `bun test daemon/test/${'x'.repeat(120)}.test.mts\n&& echo suite`;
    const activity = toolActivity('shell', { command: long }, 13);
    expect(activity.kind).toBe('shell');
    expect(activity.label).toBe('Commande');
    expect(activity.detail).not.toContain('\n');
    expect(activity.detail!.length).toBeLessThanOrEqual(96);
    expect(activity.detail!.endsWith('…')).toBe(true);
    expect(activity.title).toBe(activity.title?.trim());
  });

  test('outil inconnu : libellé générique et nom en détail', () => {
    expect(toolActivity('openchamber_render', undefined, 14)).toEqual({
      kind: 'tool',
      label: 'Rendu',
      at: 14,
    });
    expect(toolActivity('un_outil_exotique', { path: 'x' }, 15)).toEqual({
      kind: 'tool',
      label: 'Outil',
      detail: 'un_outil_exotique',
      title: 'un_outil_exotique',
      at: 15,
    });
  });

  test('baseName gère les deux séparateurs et ne renvoie jamais un chemin vide', () => {
    expect(baseName('/a/b/c.ts')).toBe('c.ts');
    expect(baseName('C:\\projet\\fichier.md')).toBe('fichier.md');
    expect(baseName('/a/b/')).toBe('b');
  });
});

describe('ActivityTracker : événements SSE', () => {
  test('tool.input.started donne le type, tool.called précise le sujet', () => {
    const tracker = new ActivityTracker(() => 20);
    tracker.ingest('session.tool.input.started', { sessionID: 'ses_a', name: 'edit' });
    expect(tracker.get('ses_a')).toEqual({ kind: 'edit', label: 'Édition', at: 20 });
    tracker.ingest('session.tool.called', {
      sessionID: 'ses_a',
      name: 'edit',
      input: { path: '/projet/src/a.ts' },
    });
    expect(tracker.get('ses_a')).toEqual({
      kind: 'edit',
      label: 'Édition',
      detail: 'a.ts',
      title: '/projet/src/a.ts',
      at: 20,
    });
  });

  test('forme réelle de l’instance : reasoning.ended puis tool.called SANS name', () => {
    // constaté sur OpenChamber 2.6 : input.started porte id+name, reasoning.ended
    // arrive ensuite, puis called porte input mais pas name. Sans la table des
    // ids, la carte restait sur « Réflexion » pendant toute la commande.
    const tracker = new ActivityTracker(() => 25);
    tracker.ingest('session.reasoning.started', { sessionID: 'ses_a' });
    tracker.ingest('session.tool.input.started', { sessionID: 'ses_a', id: 'call_1', name: 'shell' });
    tracker.ingest('session.reasoning.ended', { sessionID: 'ses_a' });
    expect(tracker.get('ses_a')).toEqual({ kind: 'shell', label: 'Commande', at: 25 });
    tracker.ingest('session.tool.called', {
      sessionID: 'ses_a',
      id: 'call_1',
      input: { command: 'bun test daemon/test/activity.test.mts' },
      executed: false,
    });
    expect(tracker.get('ses_a')).toEqual({
      kind: 'shell',
      label: 'Commande',
      detail: 'bun test daemon/test/activity.test.mts',
      title: 'bun test daemon/test/activity.test.mts',
      at: 25,
    });
    tracker.ingest('session.tool.progress', { sessionID: 'ses_a', id: 'call_1', metadata: { shellID: 'sh_1' } });
    expect(tracker.get('ses_a')?.detail).toBe('bun test daemon/test/activity.test.mts');
  });

  test('un outil terminé garde la ligne jusqu’au prochain événement', () => {
    const tracker = new ActivityTracker(() => 30);
    tracker.ingest('session.tool.called', { sessionID: 'ses_a', name: 'shell', input: { command: 'ls' } });
    tracker.ingest('session.tool.success', { sessionID: 'ses_a' });
    expect(tracker.get('ses_a')?.label).toBe('Commande');
  });

  test('réflexion, nouvel outil, puis fin de tour : la ligne est remplacée puis effacée', () => {
    const tracker = new ActivityTracker(() => 40);
    tracker.ingest('session.reasoning.started', { sessionID: 'ses_a' });
    expect(tracker.get('ses_a')?.kind).toBe('thinking');
    tracker.ingest('session.tool.called', { sessionID: 'ses_a', name: 'read', input: { path: 'a.md' } });
    expect(tracker.get('ses_a')?.kind).toBe('read');
    tracker.ingest('session.execution.succeeded', { sessionID: 'ses_a' });
    expect(tracker.get('ses_a')).toBeUndefined();
  });

  test('les fins de tour échouées/interrompues effacent aussi, jamais au repos', () => {
    for (const type of ['session.execution.failed', 'session.execution.interrupted', 'session.idle']) {
      const tracker = new ActivityTracker(() => 50);
      tracker.ingest('session.tool.called', { sessionID: 'ses_a', name: 'shell', input: { command: 'sleep 1' } });
      tracker.ingest(type, { sessionID: 'ses_a' });
      expect(tracker.get('ses_a')).toBeUndefined();
    }
  });

  test('un événement sans session ou d’une autre session ne touche pas la ligne', () => {
    const tracker = new ActivityTracker(() => 60);
    tracker.ingest('session.tool.called', { sessionID: 'ses_a', name: 'shell', input: { command: 'ls' } });
    tracker.ingest('session.execution.succeeded', {});
    tracker.ingest('session.execution.succeeded', { sessionID: 'ses_b' });
    expect(tracker.get('ses_a')?.label).toBe('Commande');
  });
});

describe('deriveActivityFromMessages : filet après coupure', () => {
  const message = (content: WireMessage['content'], created = 1): WireMessage => ({
    time: { created },
    content,
  });

  test('un outil en cours dans le message le plus récent gagne', () => {
    const messages: WireMessage[] = [
      message([{ type: 'tool', tool: 'read', state: { status: 'completed', input: { path: 'vieux.md' } } }], 1),
      message(
        [
          { type: 'reasoning', text: 'je regarde' },
          {
            type: 'tool',
            tool: 'shell',
            state: { status: 'running', input: { command: 'bun test daemon/test/activity.test.mts' } },
          },
        ],
        2,
      ),
    ];
    // la fenêtre de l'API arrive en ordre descendant
    const activity = deriveActivityFromMessages([...messages].reverse(), 1000);
    expect(activity).toEqual({
      kind: 'shell',
      label: 'Commande',
      detail: 'bun test daemon/test/activity.test.mts',
      title: 'bun test daemon/test/activity.test.mts',
      at: 1000,
    });
  });

  test('raisonnement seul ou texte seul', () => {
    expect(deriveActivityFromMessages([message([{ type: 'reasoning', text: '…' }])], 2000)?.kind).toBe('thinking');
    expect(deriveActivityFromMessages([message([{ type: 'text', text: 'je rédige' }])], 2000)?.kind).toBe('writing');
  });

  test('outil tout juste terminé : la ligne reste quelques secondes, puis réflexion', () => {
    const parts = [
      { type: 'tool' as const, tool: 'edit', state: { status: 'completed', input: { path: 'a.ts' }, time: { end: 9_000 } } },
    ];
    expect(deriveActivityFromMessages([message(parts)], 10_000)?.kind).toBe('edit');
    expect(deriveActivityFromMessages([message(parts)], 20_000)?.kind).toBe('thinking');
  });

  test('message vide : aucune activité inventée', () => {
    expect(deriveActivityFromMessages([], 1)).toBeUndefined();
    expect(deriveActivityFromMessages([message([])], 1)).toBeUndefined();
  });
});
