/**
 * Pont vers le panneau navigateur du composant (Electron).
 *
 * La page affichée est une vue native possédée par le main process : elle n'est
 * pas dans le DOM. L'UI ne peut donc que lui donner un rectangle et lui envoyer
 * des gestes (adresse, recharger, historique, cacher). Hors application de
 * bureau, le pont est absent : le panneau le dit au lieu de faire semblant.
 */
export interface BrowserPanelState {
  available: boolean;
  open: boolean;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  cdpUrl: string | null;
  port: number | null;
  error?: string;
}

export interface BrowserPanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface BrowserPanelBridge {
  available: true;
  state: () => Promise<BrowserPanelState | null>;
  layout: (bounds: BrowserPanelBounds) => Promise<BrowserPanelState | null>;
  navigate: (url: string) => Promise<BrowserPanelState | null>;
  action: (name: 'reload' | 'back' | 'forward' | 'hide') => Promise<BrowserPanelState | null>;
  onState: (handler: (state: BrowserPanelState) => void) => () => void;
}

export function browserPanelBridge(): BrowserPanelBridge | null {
  // rendu serveur (tests, prévisualisation) : pas de window, donc pas de pont
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { superviseurBrowser?: BrowserPanelBridge }).superviseurBrowser;
  return candidate && candidate.available === true ? candidate : null;
}

/** L'adresse tapée est-elle une adresse http(s) que le composant acceptera ? */
export function normalizeBrowserAddress(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const parsed = new URL(withScheme);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}
