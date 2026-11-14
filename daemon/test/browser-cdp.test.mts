import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile, rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Contrat du navigateur embarqué. L'import est dynamique APRÈS l'affectation de
 * SUPERVISEUR_DATA_DIR : state.mts ouvre la base au chargement du module, et un
 * import statique écrirait dans la base de production (leçon du 2026-11-08).
 */
let dir = '';
let live: ReturnType<typeof Bun.serve> | null = null;
let deadPort = 0;
let mod: typeof import('../src/browser-cdp.mts');

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'superviseur-browser-cdp-'));
  if (!dir.includes('superviseur-browser-cdp-')) throw new Error('garde-fou : dossier temporaire attendu');
  process.env.SUPERVISEUR_DATA_DIR = dir;

  // faux composant : répond à /json/version comme le vrai navigateur
  live = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/json/version') return Response.json({ Browser: 'Chrome/test (Electron)' });
      return new Response('nope', { status: 404 });
    },
  });

  // un port libéré : le composant annoncé ne répond plus
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('x') });
  deadPort = Number(probe.port);
  probe.stop(true);

  mod = await import('../src/browser-cdp.mts');
});

afterAll(async () => {
  live?.stop(true);
  // la base ouverte par state.mts verrouille le dossier sous Windows
  try { (await import('../src/state.mts')).db.close(); } catch { /* déjà fermée */ }
  await rm(dir, { recursive: true, force: true });
});

describe('browser-cdp', () => {
  test('sans annonce : not_published, jamais « disponible »', async () => {
    expect(mod.readBrowserCdp()).toBeNull();
    const status = await mod.browserCdpStatus();
    expect(status.available).toBe(false);
    expect(status.reason).toBe('not_published');
    expect(mod.browserCdpUrl()).toBeNull();
  });

  test('refuse un port invalide sans effacer l’annonce précédente', () => {
    expect(mod.publishBrowserCdp({ port: 0 })).toBeNull();
    expect(mod.publishBrowserCdp({ port: 70000 })).toBeNull();
    expect(mod.publishBrowserCdp({ port: 'abc' })).toBeNull();
    expect(mod.publishBrowserCdp({})).toBeNull();
    expect(mod.readBrowserCdp()).toBeNull();
  });

  test('annonce vivante : disponible, URL et version du navigateur', async () => {
    const port = Number(live!.port);
    const entry = mod.publishBrowserCdp({ port, wsPath: '/devtools/browser/abc', pid: 4321 });
    expect(entry?.port).toBe(port);
    expect(mod.browserCdpUrl()).toBe(`http://127.0.0.1:${port}`);
    const status = await mod.browserCdpStatus();
    expect(status.available).toBe(true);
    expect(status.cdpUrl).toBe(`http://127.0.0.1:${port}`);
    expect(status.reason).toBeUndefined();
    expect(status.browser).toContain('Chrome/test');
  });

  test('annonce rejouée sur disque : port, wsPath et pid', async () => {
    const raw = JSON.parse(await readFile(join(dir, 'browser-cdp.json'), 'utf8')) as Record<string, unknown>;
    expect(raw.version).toBe(1);
    expect(raw.port).toBe(Number(live!.port));
    expect(raw.wsPath).toBe('/devtools/browser/abc');
    expect(raw.pid).toBe(4321);
    expect(Number.isFinite(Number(raw.since))).toBe(true);
  });

  test('annonce muette : not_responding avec le port conservé', async () => {
    const entry = mod.publishBrowserCdp({ port: deadPort });
    expect(entry?.port).toBe(deadPort);
    const status = await mod.browserCdpStatus();
    expect(status.available).toBe(false);
    expect(status.reason).toBe('not_responding');
    expect(status.port).toBe(deadPort);
    expect(status.cdpUrl).toBe(`http://127.0.0.1:${deadPort}`);
  });

  test('le prompt des tâches porte l’endpoint et l’interdit du Chrome jetable', async () => {
    const source = await readFile(join(import.meta.dir, '..', 'src', 'tools.mts'), 'utf8');
    expect(source).toContain('browserCdpUrl');
    expect(source).toContain('Navigateur embarqué du Superviseur');
    expect(source).toContain('connectOverCDP');
    expect(source).toContain('about:blank');
  });
});
