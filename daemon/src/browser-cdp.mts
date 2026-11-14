/**
 * Navigateur embarqué : le contrat entre le composant et les agents.
 *
 * Le composant (Electron) possède le navigateur, donc c'est lui qui connaît le
 * port CDP qu'il a ouvert. Le daemon n'en est que le conservateur : il reçoit le
 * port (POST /api/fleet/browser), le rejoue sur disque pour les agents qui lisent
 * un fichier, et le sert (GET /api/fleet/browser) avec une sonde de vivacité.
 *
 * Rien ici ne démarre de navigateur : le cycle de vie est au composant, une
 * entrée périmée ne doit donc jamais être présentée comme disponible.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './state.mts';

export interface BrowserCdp {
  port: number;
  wsPath: string | null;
  since: number;
  pid: number | null;
}

export interface BrowserCdpStatus {
  available: boolean;
  cdpUrl: string | null;
  port: number | null;
  since: number | null;
  /** « not_published » : le composant n'a rien annoncé ; « not_responding » : annoncé mais muet. */
  reason?: 'not_published' | 'not_responding';
  browser?: string | null;
}

const FILE = join(dataDir, 'browser-cdp.json');
/** Une sonde coûte un aller-retour HTTP : la même réponse sert deux secondes. */
const PROBE_TTL_MS = 2000;
const PROBE_TIMEOUT_MS = 500;

let published: BrowserCdp | null = null;
let lastProbe: { at: number; ok: boolean; browser: string | null } = { at: 0, ok: false, browser: null };

const writeFile = (value: BrowserCdp): void => {
  try {
    // écriture atomique : un agent peut lire le fichier à tout moment
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ version: 1, ...value }, null, 2)}\n`, 'utf8');
    renameSync(tmp, FILE);
  } catch {
    // disque indisponible : la mémoire suffit au GET, le fichier est un confort
  }
};

/**
 * Le composant annonce son port. Une valeur absurde est refusée : mieux vaut
 * aucune entrée qu'une URL qui enverrait un agent vers un port quelconque.
 */
export function publishBrowserCdp(input: unknown): BrowserCdp | null {
  const raw = (input ?? {}) as Record<string, unknown>;
  const port = Number(raw.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const wsPath = typeof raw.wsPath === 'string' && raw.wsPath.startsWith('/') ? raw.wsPath : null;
  const pid = Number.isInteger(Number(raw.pid)) ? Number(raw.pid) : null;
  const same = published?.port === port && published?.wsPath === wsPath;
  published = { port, wsPath, since: same ? published!.since : Date.now(), pid };
  lastProbe = { at: 0, ok: false, browser: null };
  writeFile(published);
  return published;
}

/** Ce qui a été annoncé, en mémoire puis sur disque (redémarrage du daemon). */
export function readBrowserCdp(): BrowserCdp | null {
  if (published) return published;
  try {
    const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as Partial<BrowserCdp>;
    const port = Number(parsed.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    published = {
      port,
      wsPath: typeof parsed.wsPath === 'string' ? parsed.wsPath : null,
      since: Number.isFinite(Number(parsed.since)) ? Number(parsed.since) : Date.now(),
      pid: Number.isInteger(Number(parsed.pid)) ? Number(parsed.pid) : null,
    };
    return published;
  } catch {
    return null;
  }
}

/** URL à mettre dans un prompt de tâche, sans sonde : le contrat, pas un verdict. */
export function browserCdpUrl(): string | null {
  const entry = readBrowserCdp();
  return entry ? `http://127.0.0.1:${entry.port}` : null;
}

/** Le navigateur répond-il encore ? Sonde /json/version, résultat mis en cache. */
async function probe(port: number): Promise<{ ok: boolean; browser: string | null }> {
  const now = Date.now();
  if (lastProbe.at && now - lastProbe.at < PROBE_TTL_MS) {
    return { ok: lastProbe.ok, browser: lastProbe.browser };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  let ok = false;
  let browser: string | null = null;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: ctl.signal });
    if (res.ok) {
      const body = (await res.json()) as { Browser?: string };
      ok = true;
      browser = typeof body.Browser === 'string' ? body.Browser : null;
    }
  } catch {
    ok = false;
  } finally {
    clearTimeout(timer);
  }
  lastProbe = { at: now, ok, browser };
  return { ok, browser };
}

/** État complet pour GET /api/fleet/browser. */
export async function browserCdpStatus(): Promise<BrowserCdpStatus> {
  const entry = readBrowserCdp();
  if (!entry) return { available: false, cdpUrl: null, port: null, since: null, reason: 'not_published' };
  const cdpUrl = `http://127.0.0.1:${entry.port}`;
  const live = await probe(entry.port);
  if (!live.ok) {
    return { available: false, cdpUrl, port: entry.port, since: entry.since, reason: 'not_responding' };
  }
  return { available: true, cdpUrl, port: entry.port, since: entry.since, browser: live.browser };
}
