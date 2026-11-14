import { afterEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BrowserPanel } from './BrowserPanel';
import { normalizeBrowserAddress, type BrowserPanelBridge } from '../lib/browserPanel';

const fakeBridge: BrowserPanelBridge = {
  available: true,
  state: async () => null,
  layout: async () => null,
  navigate: async () => null,
  action: async () => null,
  onState: () => () => {},
};

describe('BrowserPanel', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  test('hors application de bureau : explique pourquoi et propose la fermeture', () => {
    const html = renderToStaticMarkup(<BrowserPanel onClose={() => {}} />);
    expect(html).toContain('data-testid="browser-panel"');
    expect(html).toContain('nécessite l’application de bureau');
    expect(html).toContain('aria-label="Fermer le panneau navigateur"');
    // sans pont, aucun hôte de vue native : rien à poser
    expect(html).not.toContain('data-testid="browser-panel-host"');
  });

  test('avec le pont : hôte de la vue native, adresse et invite', () => {
    (globalThis as { window?: unknown }).window = { superviseurBrowser: fakeBridge };
    const html = renderToStaticMarkup(<BrowserPanel onClose={() => {}} />);
    expect(html).toContain('data-testid="browser-panel-host"');
    expect(html).toContain('Aucune page ouverte');
    expect(html).toContain('placeholder="http://localhost:3000"');
    expect(html).toContain('aria-label="Adresse de la page"');
  });
});

describe('normalizeBrowserAddress', () => {
  test('accepte http(s), ajoute le schéma, refuse le reste', () => {
    expect(normalizeBrowserAddress('localhost:3000')).toBe('http://localhost:3000/');
    expect(normalizeBrowserAddress(' https://exemple.test/a?b=1 ')).toBe('https://exemple.test/a?b=1');
    expect(normalizeBrowserAddress('file:///etc/passwd')).toBeNull();
    expect(normalizeBrowserAddress('javascript:alert(1)')).toBeNull();
    expect(normalizeBrowserAddress('   ')).toBeNull();
  });
});
