/**
 * Preuve screenshot : racine de résolution du chemin relatif.
 *
 * Régression constatée le 2026-11-16 (tâche « Atelier Windows ») : le plugin
 * lisait le dossier projet sur `context.directory`, un champ du contexte
 * d'exécution v1 que l'hôte v2 ne remplit pas. `projectDir` restait vide et
 * TOUTE preuve à chemin était refusée (« dossier du projet inconnu : preuve à
 * chemin impossible à valider »), captures comprises : rien n'arrivait dans le
 * panneau des critères.
 *
 * Le test monte le plugin avec un ctx factice (storage en Map, registre de
 * tools) et un `ctx.session.get` qui porte la vérité de l'hôte
 * (`location.directory`) : aucun dossier n'est fourni sur le contexte du tool,
 * exactement comme en production. Il vérifie aussi que le chemin accepté est
 * ensuite SERVI par la route d'assets du daemon (la même que l'UI appelle),
 * donc que la capture s'affiche, pas seulement qu'elle est stockée.
 *
 * Aucune base ouverte : ni state.mts ni OpenCode.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import criteriaPlugin from '../plugin/superviseur-criteria/index.js';
import { readSessionAsset } from '../src/assets.mts';
import { collectEvidenceImages } from '../../ui/src/lib/evidenceGallery.ts';

/** PNG 1x1 valide : le contenu importe peu, les octets doivent ressortir identiques. */
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
  '0000000d49444154789c6360000000020001e221bc330000000049454e44ae426082',
  'hex',
);

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'criteria-evidence-'));
  mkdirSync(join(root, 'captures'), { recursive: true });
  writeFileSync(join(root, 'captures', 'ecran.png'), PNG);
  return root;
}

interface Harness {
  tools: Map<string, { execute: (input: unknown, context: unknown) => Promise<any> }>;
}

/**
 * Monte le plugin. `sessionInfo` est ce que rend `ctx.session.get` ; `undefined`
 * simule une session illisible, `throwOnGet` une erreur de l'appel.
 */
async function mount(options: {
  sessionInfo?: unknown;
  throwOnGet?: boolean;
  location?: { directory?: string };
} = {}): Promise<Harness> {
  const store = new Map<string, unknown>();
  const tools = new Map<string, { execute: (input: unknown, context: unknown) => Promise<any> }>();
  const ctx: Record<string, any> = {
    storage: {
      get: async (k: string) => store.get(k),
      set: async (k: string, v: unknown) => { store.set(k, v); },
    },
    tool: {
      transform: async (fn: (editor: unknown) => void) =>
        fn({ add: (tool: { name: string }) => tools.set(tool.name, tool) }),
    },
    session: {
      hook: async () => {},
      get: async () => {
        if (options.throwOnGet) throw new Error('session illisible');
        return options.sessionInfo;
      },
    },
  };
  if (options.location) ctx.location = options.location;
  await criteriaPlugin.setup(ctx);
  return { tools };
}

const hostSession = (directory: string) => ({ id: 'ses_test', location: { directory } });

describe('preuve screenshot : racine = dossier de la session', () => {
  test("sans context.directory, la racine vient de la session (location.directory) et la capture est servie", async () => {
    const root = makeProject();
    const { tools } = await mount({ sessionInfo: hostSession(root) });

    await tools.get('criteria_add')!.execute(
      { title: 'Capture de l\'écran', methods: ['screenshot'] },
      { sessionID: 'ses_test' },
    );

    // contexte du tool SANS directory : la situation réelle du 2026-11-16
    const res = await tools.get('criteria_to_validate')!.execute(
      {
        ref: 'AC-01',
        evidence: [{ kind: 'screenshot', text: 'écran relu', path: 'captures\\ecran.png' }],
      },
      { sessionID: 'ses_test' },
    );

    expect(res.metadata.ok).toBe(true);
    const [criterion] = res.metadata.criteria;
    expect(criterion.status).toBe('to_validate');
    expect(criterion.evidence[0].path).toBe('captures/ecran.png');

    // la vignette du panneau des critères se construit depuis cette preuve
    // (même helper que CriterionRow) ; la route d'assets du daemon sert
    // ensuite le fichier réel, octets compris
    const images = collectEvidenceImages(
      [{ id: 1, ref: criterion.ref, title: criterion.title, evidence: criterion.evidence } as any],
      'ses_test',
    );
    expect(images).toHaveLength(1);
    const url = new URL(images[0].src, 'http://127.0.0.1:5180');
    expect(url.pathname).toBe('/api/fleet/asset');
    expect(url.searchParams.get('sessionId')).toBe('ses_test');
    const asset = await readSessionAsset(root, url.searchParams.get('path') ?? '');
    expect(asset.ok).toBe(true);
    if (asset.ok) {
      expect(asset.type).toBe('image/png');
      expect(Buffer.compare(asset.body, PNG)).toBe(0);
    }
  });

  test('un contexte qui porte déjà directory reste prioritaire (hôte v1), sans appel session', async () => {
    const root = makeProject();
    const { tools } = await mount({ throwOnGet: true });
    await tools.get('criteria_add')!.execute(
      { title: 'Capture', methods: ['screenshot'] },
      { sessionID: 'ses_test' },
    );
    const res = await tools.get('criteria_to_validate')!.execute(
      { ref: 'AC-01', evidence: [{ kind: 'screenshot', text: 'vue', path: 'captures/ecran.png' }] },
      { sessionID: 'ses_test', directory: root },
    );
    expect(res.metadata.ok).toBe(true);
    expect(res.metadata.criteria[0].status).toBe('to_validate');
  });

  test('aucune racine résoluble : refus explicite qui nomme le chemin, rien n\'est deviné', async () => {
    const { tools } = await mount({ throwOnGet: true });
    await tools.get('criteria_add')!.execute(
      { title: 'Capture', methods: ['screenshot'] },
      { sessionID: 'ses_test' },
    );
    const res = await tools.get('criteria_to_validate')!.execute(
      { ref: 'AC-01', evidence: [{ kind: 'screenshot', text: 'vue', path: 'captures/ecran.png' }] },
      { sessionID: 'ses_test' },
    );
    expect(res.metadata.ok).toBe(false);
    expect(res.metadata.error).toBe('invalid_evidence');
    expect(res.metadata.message).toContain('captures/ecran.png');
    expect(res.metadata.criteria[0].status).toBe('todo');
  });
});

describe('preuves sans chemin : aucune régression', () => {
  test('texte et commande restent acceptées même sans racine de session', async () => {
    const { tools } = await mount({ throwOnGet: true });
    await tools.get('criteria_add')!.execute(
      { title: 'Preuves texte', methods: ['command'] },
      { sessionID: 'ses_test' },
    );
    const res = await tools.get('criteria_to_validate')!.execute(
      {
        ref: 'AC-01',
        evidence: [
          { kind: 'text', text: 'relecture du fichier de sortie' },
          { kind: 'command', text: 'bun test daemon/test/criteria-evidence.test.mts' },
        ],
      },
      { sessionID: 'ses_test' },
    );
    expect(res.metadata.ok).toBe(true);
    expect(res.metadata.criteria[0].status).toBe('to_validate');
    expect(res.metadata.criteria[0].evidence.map((e: { kind: string }) => e.kind)).toEqual(['text', 'command']);
  });
});
