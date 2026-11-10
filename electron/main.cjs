/**
 * Main process Electron du Superviseur : encapsule le daemon existant, sans le modifier.
 * 1. verrou single-instance (pas de double app), 2. détecte le port d'OpenChamber
 * (ss absent sous Windows), 3. spawn le watchdog (bun) qui possède le process daemon,
 * 4. ouvre la fenêtre sur l'UI servie par le daemon (http://127.0.0.1:5180/fleet),
 * 5. à la fermeture (et au crash), tue l'arbre watchdog+daemon : aucun process résiduel.
 */
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const SUPERVISEUR_PORT = Number(process.env.SUPERVISEUR_PORT ?? 5180);
const UI_URL = `http://127.0.0.1:${SUPERVISEUR_PORT}/fleet`;

// Racine du code applicatif : <resources>/app dans le .exe, le repo en dev.
const appRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.join(__dirname, '..');
const bunExe = app.isPackaged
  ? path.join(process.resourcesPath, 'bun.exe')
  : (process.env.BUN_EXE || 'bun');

let watchdog = null;      // process bun que nous possédons (spawné par nous)
let win = null;
let quitting = false;
let respawnAttempts = 0;
let logFd = null;

// Une écriture asynchrone sur un stdout fermé (pipe rompu, app lancée depuis un
// terminal qui meurt) émet un 'error' non géré : sans ce garde, EPIPE tue l'app
// via uncaughtException (constaté en test).
for (const stream of [process.stdout, process.stderr]) {
  if (stream) stream.on('error', () => { /* pipe rompu : on journalise dans le fichier */ });
}

function log(line) {
  const text = `[${new Date().toISOString()}] [electron] ${line}\n`;
  try { process.stdout.write(text); } catch {}
  if (logFd !== null) { try { fs.writeSync(logFd, text); } catch {} }
}

function openLog() {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    logFd = fs.openSync(path.join(app.getPath('userData'), 'superviseur.log'), 'a');
  } catch (e) { log(`log indisponible : ${e}`); }
}

/** Sondage : le daemon du Superviseur répond-il déjà sur ce port ? */
function probeSuperviseur(timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: SUPERVISEUR_PORT, path: '/api/supervisor', timeout: timeoutMs },
      (res) => { res.resume(); resolve(res.statusCode === 200); }
    );
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

/**
 * Port d'OpenChamber : OPENCHAMBER_PORT fait foi ; sinon détection Windows
 * (ss n'existe pas) : le process OpenChamber.exe principal est celui dont le
 * parent n'est pas lui-même un OpenChamber.exe (les services d'extensions
 * écoutent aussi, mais sont ses enfants). Renverra null si introuvable :
 * le daemon ne démarrera pas (dialog explicatif), sans jamais inventer un port.
 */
function detectOpenChamberPort() {
  if (process.env.OPENCHAMBER_PORT) return process.env.OPENCHAMBER_PORT;
  const script = `
$ps = Get-CimInstance Win32_Process -Filter "Name='OpenChamber.exe'" -ErrorAction SilentlyContinue
if (-not $ps) { exit 1 }
$openPids = @($ps | ForEach-Object { $_.ProcessId })
$main = @($ps | Where-Object { -not ($openPids -contains $_.ParentProcessId) }) | Select-Object -First 1
if (-not $main) { exit 1 }
$c = Get-NetTCPConnection -OwningProcess $main.ProcessId -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalAddress -in @('127.0.0.1','::1','0.0.0.0','::') } | Select-Object -First 1
if ($c) { $c.LocalPort } else { exit 1 }`;
  const out = spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', timeout: 20000, windowsHide: true });
  const port = Number((out.stdout || '').trim());
  if (Number.isInteger(port) && port > 0) return String(port);
  log(`port OpenChamber non détecté (${out.status}) : ${String(out.stderr || '').trim()}`);
  return null;
}

function childEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // Données hors du dossier de l'app (portable s'extrait dans %TEMP%) : userData est stable.
  if (app.isPackaged) env.SUPERVISEUR_DATA_DIR = app.getPath('userData');
  const port = detectOpenChamberPort();
  if (port) { env.OPENCHAMBER_PORT = port; } else { delete env.OPENCHAMBER_PORT; }
  env.SUPERVISEUR_LOG_FILE = logFd === null ? '' : path.join(app.getPath('userData'), 'superviseur.log');
  return env;
}

/** Mode du watchdog : « own » s'il doit démarrer le daemon, « adopt » s'il existe déjà. */
function watchdogMode(adopted) { return adopted ? 'adopt' : 'own'; }

function spawnWatchdog(adopted) {
  const exeName = path.basename(process.argv0 || 'electron.exe');
  const args = [
    path.join(appRoot, 'electron', 'watchdog.mts'),
    String(process.pid),            // parent à surveiller
    String(SUPERVISEUR_PORT),       // port de l'UI
    exeName,                        // nom attendu du process parent (anti-réutilisation de PID)
    watchdogMode(adopted),
  ];
  watchdog = spawn(bunExe, args, {
    cwd: appRoot,
    env: childEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  watchdog.stdout.on('data', (d) => log(`[watchdog] ${String(d).trim()}`));
  watchdog.stderr.on('data', (d) => log(`[watchdog] ${String(d).trim()}`));
  watchdog.on('exit', (code) => {
    log(`watchdog terminé (code=${code})`);
    watchdog = null;
    if (!quitting) scheduleRespawn();
  });
  log(`watchdog démarré (pid=${watchdog.pid}, mode=${watchdogMode(adopted)})`);
  // un watchdog qui tient plus de 60 s remet le compteur de relances à zéro
  setTimeout(() => { if (watchdog) respawnAttempts = 0; }, 60000);
}

function killWatchdogTree() {
  if (!watchdog) return;
  const pid = watchdog.pid;
  watchdog = null;
  try {
    // /T : l'arbre entier (watchdog + daemon enfant) ; /F : forcé.
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    log(`arbre watchdog (pid=${pid}) arrêté`);
  } catch (e) { log(`taskkill a échoué : ${e}`); }
}

function scheduleRespawn() {
  respawnAttempts += 1;
  const delay = Math.min(3000 * respawnAttempts, 30000);
  log(`relance du watchdog dans ${delay} ms (essai ${respawnAttempts})`);
  setTimeout(() => {
    if (quitting) return;
    probeSuperviseur().then((up) => spawnWatchdog(up));
  }, delay);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    title: 'Superviseur',
    show: false,
    backgroundColor: '#111113',
  });
  Menu.setApplicationMenu(null);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
}

function loadUiWhenReady() {
  let failures = 0;
  const started = Date.now();
  const tick = setInterval(async () => {
    if (quitting) { clearInterval(tick); return; }
    if (await probeSuperviseur()) {
      clearInterval(tick);
      win.loadURL(UI_URL).catch(() => {});
      log(`UI chargée : ${UI_URL}`);
    } else if (Date.now() - started > 90000) {
      clearInterval(tick);
      log(`daemon jamais prêt après 90 s`);
      dialog.showErrorBox(
        'Superviseur : daemon inaccessible',
        `Le daemon du Superviseur n'a pas répondu sur http://127.0.0.1:${SUPERVISEUR_PORT} après 90 s.\n` +
        `Causes possibles : OpenChamber n'est pas lancé (port introuvable), le port ${SUPERVISEUR_PORT} est occupé par une autre application, ou bun a échoué.\n` +
        `Journal : ${path.join(app.getPath('userData'), 'superviseur.log')}`
      );
      loadUiWhenReady(); // on continue d'essayer : la fenêtre finira par s'ouvrir si ça revient
    }
  }, 500);
}

function setupAppLifecycle() {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.on('before-quit', () => {
    if (quitting) return;
    quitting = true;
    killWatchdogTree();
  });

  // Dernier filet : process.exit passe ici même en cas de crash géré.
  process.on('exit', () => { if (!quitting) { quitting = true; killWatchdogTree(); } });
  process.on('uncaughtException', (e) => {
    log(`crash : ${e && e.stack ? e.stack : String(e)}`);
    quitting = true;
    killWatchdogTree();
    app.exit(1);
  });

  app.on('window-all-closed', () => app.quit());
}

// Un seul .exe actif : le second lancement quitte immédiatement (event
// second-instance côté premier : la fenêtre existante est mise au premier plan).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    openLog();
    log(`démarrage (packaged=${app.isPackaged}, appRoot=${appRoot}, bun=${bunExe})`);
    setupAppLifecycle();
    createWindow();

    const alreadyUp = await probeSuperviseur();
    if (alreadyUp) log('daemon déjà en marche sur le port : adoption, pas de nouveau daemon');
    spawnWatchdog(alreadyUp);
    loadUiWhenReady();
  });
}
