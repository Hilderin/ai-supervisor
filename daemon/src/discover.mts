/**
 * Découverte du serveur OpenChamber local.
 * Stratégie : OPENCHAMBER_PORT si défini, sinon parsing de `ss -tlnp`
 * à la recherche du process "openchamber" (AppImage desktop : port auto-alloué).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

export interface Discovered { port: number; }

export async function discoverOpenChamberPort(): Promise<number> {
  const envPort = process.env.OPENCHAMBER_PORT;
  if (envPort) {
    const p = Number(envPort);
    if (!Number.isInteger(p) || p <= 0) throw new Error('OPENCHAMBER_PORT invalide');
    return p;
  }
  const { stdout } = await run('ss', ['-tlnp'], { timeout: 5000 });
  for (const line of stdout.split('\n')) {
    if (!line.includes('"openchamber"')) continue;
    const m = line.match(/(?:127\.0\.0\.1|\[::1\]|0\.0\.0\.0|\*):(\d+)\s/);
    if (m) return Number(m[1]);
  }
  throw new Error('OpenChamber introuvable — instance pas en marche ? (ou définir OPENCHAMBER_PORT)');
}
