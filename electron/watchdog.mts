/**
 * Watchdog du daemon Superviseur, lancé par le main process Electron (bun).
 * Possède le process daemon (bun daemon/src/index.mts) et garantit l'absence
 * de process résiduel : si le parent Electron disparaît (crash inclus), le
 * daemon est tué (arbre taskkill). Deux modes :
 * - own   : le watchdog démarre le daemon et le tue à la mort du parent ;
 * - adopt : un daemon répond déjà sur le port (lancé à la main) : le watchdog
 *   ne le possède pas, il se contente de surveiller le parent et de sortir
 *   sans rien tuer.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { appendFileSync, openSync } from 'node:fs';
import { join } from 'node:path';

const [, , parentPidArg, portArg, parentNameArg, modeArg] = process.argv;
const parentPid = Number(parentPidArg);
const port = Number(portArg);
const parentName = (parentNameArg || 'electron.exe').toLowerCase();
const mode = modeArg === 'adopt' ? 'adopt' : 'own';
const appRoot = join(import.meta.dir, '..');
const logFile = process.env.SUPERVISEUR_LOG_FILE;

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] [watchdog:${mode}] ${msg}\n`;
  try { process.stdout.write(line); } catch {}
  if (logFile) { try { appendFileSync(logFile, line); } catch {} }
}

/** Le parent est-il vivant ? (kill 0 + contrôle du nom : un PID recyclé ne doit pas tromper) */
function parentAlive(): boolean {
  try {
    process.kill(parentPid, 0);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return true;
    return false; // ESRCH : plus aucun process à ce PID
  }
  const out = spawnSync('tasklist', ['/FI', `PID eq ${parentPid}`, '/FO', 'CSV', '/NH'],
    { encoding: 'utf8', timeout: 10000, windowsHide: true });
  const line = (out.stdout || '').trim();
  if (!line) return false;
  const name = (line.split('","')[0] || '').replace(/^"/, '').toLowerCase();
  return name === parentName;
}

function portOwnerPid(): number | null {
  const out = spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command',
      `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)`],
    { encoding: 'utf8', timeout: 15000, windowsHide: true });
  const pid = Number((out.stdout || '').trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

async function superviseurUp(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/supervisor`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch { return false; }
}

function killDaemonTree(pid: number | null, reason: string): void {
  if (!pid) return;
  log(`arrêt du daemon (pid=${pid}) : ${reason}`);
  try {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  } catch (e) { log(`taskkill a échoué : ${String(e)}`); }
}

let daemonPid: number | null = null;
let daemon: ChildProcess | null = null;

async function main(): Promise<void> {
  if (!Number.isInteger(parentPid) || parentPid <= 0 || !Number.isInteger(port)) {
    log('arguments invalides');
    process.exit(2);
  }

  if (await superviseurUp()) {
    daemonPid = portOwnerPid();
    log(`daemon déjà en marche sur le port ${port} (pid=${daemonPid}) : adoption`);
  } else if (mode === 'adopt') {
    log('mode adopt mais rien ne répond sur le port : le daemon sera démarré par une relance du parent');
    process.exit(0);
  } else {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    daemon = spawn(process.execPath, [join(appRoot, 'daemon', 'src', 'index.mts')], {
      cwd: appRoot,
      env,
      stdio: logFile ? ['ignore', openSync(logFile, 'a'), openSync(logFile, 'a')] : 'ignore',
      windowsHide: true,
    });
    daemonPid = daemon.pid ?? null;
    log(`daemon démarré (pid=${daemonPid})`);
    daemon.on('exit', (code, signal) => {
      log(`daemon terminé (code=${code} signal=${signal})`);
      // Le parent Electron relancera un watchdog (nouveau sondage, nouveau spawn).
      process.exit(1);
    });
  }

  // Boucle de surveillance : mort du parent => fin propre du daemon.
  const timer = setInterval(() => {
    if (parentAlive()) return;
    log(`parent (pid=${parentPid}) disparu`);
    if (mode === 'own') killDaemonTree(daemonPid, 'parent disparu');
    else log('mode adopt : daemon non possédé, rien à tuer');
    clearInterval(timer);
    process.exit(0);
  }, 1000);
}

process.on('SIGINT', () => { if (mode === 'own') killDaemonTree(daemonPid, 'SIGINT'); process.exit(0); });
process.on('SIGTERM', () => { if (mode === 'own') killDaemonTree(daemonPid, 'SIGTERM'); process.exit(0); });
process.on('uncaughtException', (e) => {
  log(`crash watchdog : ${String(e)}`);
  if (mode === 'own') killDaemonTree(daemonPid, 'crash watchdog');
  process.exit(1);
});

main().catch((e) => { log(`fatal : ${String(e)}`); process.exit(1); });
