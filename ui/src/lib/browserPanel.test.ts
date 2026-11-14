import { describe, expect, test } from 'bun:test';
import {
  normalizeBrowserAddress,
  watchBrowserReveal,
  type BrowserPanelBridge,
  type BrowserPanelState,
} from './browserPanel';

const idleState: BrowserPanelState = {
  available: true,
  open: false,
  url: '',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  cdpUrl: 'http://127.0.0.1:9333',
  port: 9333,
};

/** Pont factice : garde le handler de révélation pour le déclencher à la main. */
function fakeBridge() {
  let reveal: (() => void) | null = null;
  let unsubscribed = false;
  const bridge: BrowserPanelBridge = {
    available: true,
    state: async () => idleState,
    layout: async () => idleState,
    navigate: async () => idleState,
    action: async () => idleState,
    onState: () => () => {},
    onReveal: (handler) => {
      reveal = handler;
      return () => {
        unsubscribed = true;
        reveal = null;
      };
    },
  };
  return {
    bridge,
    // une navigation de la page du panneau, telle que le composant la signale
    navigatePage: () => reveal?.(),
    unsubscribe: () => unsubscribed,
  };
}

describe('watchBrowserReveal', () => {
  test('une navigation de la page du panneau ouvre le panneau', () => {
    const fake = fakeBridge();
    let opened = 0;
    watchBrowserReveal(fake.bridge, () => { opened += 1; });
    expect(opened).toBe(0);
    fake.navigatePage();
    expect(opened).toBe(1);
    fake.navigatePage();
    expect(opened).toBe(2);
  });

  test('le désabonnement rend le pont à son état initial', () => {
    const fake = fakeBridge();
    let opened = 0;
    const stop = watchBrowserReveal(fake.bridge, () => { opened += 1; });
    stop();
    expect(fake.unsubscribe()).toBe(true);
    fake.navigatePage();
    expect(opened).toBe(0);
  });

  test('sans pont (page web, rendu serveur) il n’y a rien à révéler', () => {
    let opened = 0;
    const stop = watchBrowserReveal(null, () => { opened += 1; });
    expect(typeof stop).toBe('function');
    stop(); // ne jette pas
    expect(opened).toBe(0);
  });

  test('un pont plus ancien que l’UI (sans onReveal) ne casse pas le montage', () => {
    const legacy = {
      available: true,
      state: async () => idleState,
      layout: async () => idleState,
      navigate: async () => idleState,
      action: async () => idleState,
      onState: () => () => {},
    } as unknown as BrowserPanelBridge;
    let opened = 0;
    const stop = watchBrowserReveal(legacy, () => { opened += 1; });
    expect(typeof stop).toBe('function');
    expect(opened).toBe(0);
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
