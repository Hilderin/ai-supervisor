/**
 * Main process Electron du Superviseur : encapsule le daemon existant, sans le modifier.
 * 1. verrou single-instance (pas de double app), 2. détecte le port d'OpenChamber
 * (ss absent sous Windows), 3. spawn le watchdog (bun) qui possède le process daemon,
 * 4. ouvre la fenêtre sur l'UI servie par le daemon (http://127.0.0.1:5180/fleet),
 * 5. à la fermeture (et au crash), tue l'arbre watchdog+daemon : aucun process résiduel.
 */
const { app, BrowserWindow, Menu, WebContentsView, dialog, ipcMain, shell } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const SUPERVISEUR_PORT = Number(process.env.SUPERVISEUR_PORT ?? 5180);
const UI_URL = `http://127.0.0.1:${SUPERVISEUR_PORT}/fleet`;

// Port CDP du navigateur embarqué, choisi par Chromium (0 = libre) : c'est ce
// port publié qui permet à un agent de s'attacher au navigateur du propriétaire
// au lieu de lancer son propre Chrome. Doit être posé avant le ready.
app.commandLine.appendSwitch('remote-debugging-port', '0');

// userData surchargeable (SUPERVISEUR_USER_DATA) : permet de faire tourner une
// seconde instance sur un autre port avec ses propres données et SON PROPRE
// verrou single-instance. Sans surcharge, dev et empaqueté partagent le même
// dossier (%APPDATA%\superviseur, le nom du package.json ne diffère de
// productName que par la casse, ignorée par Windows) : les deux instances se
// bloquent l'une l'autre.
if (process.env.SUPERVISEUR_USER_DATA) {
  app.setPath('userData', process.env.SUPERVISEUR_USER_DATA);
}

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
  // un daemon qui repart a perdu l'annonce (il la relit du disque, on la refait)
  void publishBrowserCdp();
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

// ---------------------------------------------------------------------------
// Navigateur embarqué
//
// Le composant possède le navigateur, donc c'est lui qui publie le port CDP :
// les agents s'y rattachent (Playwright connectOverCDP) et pilotent la page que
// le propriétaire voit, au lieu de lancer un Chrome jetable à profil temporaire.
//
// Une seule page, volontairement : pas d'onglets, donc pas d'onglets parasites ;
// fermer le panneau cache la vue sans détruire la page (on la retrouve intacte).
//
// Deux règles rendent le panneau visible quand une tâche ouvre une page :
// la page existe dès le démarrage (une tâche n'a aucune cible à créer : mesuré,
// Target.createTarget répond « Not supported »), et toute navigation de cette
// page révèle le panneau, même fermé par le propriétaire.
//
// Le port est en loopback mais NON authentifié : tout processus local peut
// piloter ce navigateur, et aussi l'UI du Superviseur. C'est le prix de
// l'attache, à assumer explicitement (comme l'API locale du daemon).
// ---------------------------------------------------------------------------
const BROWSER_PARTITION = 'persist:superviseur-browser';
let browserView = null;
let browserAttached = false;
let browserVisible = false;
let browserBounds = { x: 0, y: 0, width: 0, height: 0 };
let cdpInfo = null;             // { port, wsPath, cdpUrl }
let cdpPublishTimer = null;
let cdpReadAttempts = 0;

/** Chromium écrit le port retenu dans DevToolsActivePort, à la racine du profil. */
function readDevToolsPort() {
  try {
    const raw = fs.readFileSync(path.join(app.getPath('userData'), 'DevToolsActivePort'), 'utf8');
    const [portLine, wsPath] = raw.split('\n').map((line) => line.trim());
    const port = Number(portLine);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { port, wsPath: wsPath || null, cdpUrl: `http://127.0.0.1:${port}` };
  } catch {
    return null;
  }
}

/** POST minimal vers le daemon (pas de dépendance HTTP dans le main process). */
function postToDaemon(pathname, body) {
  return new Promise((resolve) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1',
      port: SUPERVISEUR_PORT,
      path: pathname,
      method: 'POST',
      timeout: 3000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
    }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end(payload);
  });
}

/**
 * Annonce le port au daemon, qui le sert (GET /api/fleet/browser) et le rejoue
 * sur disque. Le daemon peut démarrer après nous : on réessaie sans bloquer.
 */
async function publishBrowserCdp() {
  if (!cdpInfo) {
    cdpInfo = readDevToolsPort();
    if (!cdpInfo) {
      cdpReadAttempts += 1;
      if (cdpReadAttempts <= 10) {
        setTimeout(() => { void publishBrowserCdp(); }, 1000);
      } else {
        log('navigateur : DevToolsActivePort introuvable, port CDP non publié');
      }
      return;
    }
  }
  const ok = await postToDaemon('/api/fleet/browser', {
    port: cdpInfo.port,
    wsPath: cdpInfo.wsPath,
    pid: process.pid,
  });
  if (ok) {
    log(`navigateur : port CDP ${cdpInfo.port} publié (${cdpInfo.cdpUrl})`);
    if (win && !win.isDestroyed()) win.webContents.send('superviseur:browser:state', browserState());
    return;
  }
  if (cdpPublishTimer) return;
  cdpPublishTimer = setTimeout(() => { cdpPublishTimer = null; void publishBrowserCdp(); }, 2000);
}

const isHttpUrl = (value) => {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

function browserContents() {
  return browserView && !browserView.webContents.isDestroyed() ? browserView.webContents : null;
}

/** Electron a déplacé ces prédicats dans navigationHistory : on accepte les deux. */
function canGo(wc, direction) {
  try {
    const history = wc.navigationHistory;
    if (history && typeof history[`canGo${direction}`] === 'function') return history[`canGo${direction}`]();
  } catch { /* ancienne API */ }
  try {
    return Boolean(wc[`canGo${direction}`]());
  } catch {
    return false;
  }
}

function browserState() {
  const wc = browserContents();
  const rawUrl = wc ? wc.getURL() : '';
  return {
    available: true,
    open: browserVisible,
    // about:blank = document initial de la vue, pas une page : le panneau doit
    // garder son invite « Aucune page ouverte » au lieu d'afficher une adresse.
    url: rawUrl && rawUrl !== 'about:blank' ? rawUrl : '',
    title: wc ? wc.getTitle() : '',
    loading: wc ? wc.isLoading() : false,
    canGoBack: wc ? canGo(wc, 'Back') : false,
    canGoForward: wc ? canGo(wc, 'Forward') : false,
    cdpUrl: cdpInfo ? cdpInfo.cdpUrl : null,
    port: cdpInfo ? cdpInfo.port : null,
  };
}

function pushBrowserState() {
  if (win && !win.isDestroyed()) win.webContents.send('superviseur:browser:state', browserState());
}

/**
 * Une navigation de la page du panneau révèle le panneau dans l'UI : ce qu'une
 * tâche ouvre devient visible sans que le propriétaire ait à cliquer.
 *
 * Seule une navigation appelle cette fonction, jamais un changement d'état ni la
 * fermeture du panneau : fermer ne navigue pas, donc le panneau ne peut pas se
 * rouvrir en boucle. Panneau déjà affiché : rien à faire.
 */
function revealBrowserPanel() {
  if (browserVisible) return;
  if (win && !win.isDestroyed()) win.webContents.send('superviseur:browser:reveal');
}

/**
 * Une page, toujours la même : une demande de nouvel onglet (`target=_blank`,
 * `window.open`) charge dans cette page au lieu d'en créer une. C'est ce qui
 * supprime la prolifération d'onglets, côté composant comme côté agent.
 */
function ensureBrowserView() {
  const existing = browserContents();
  if (existing) return browserView;
  const view = new WebContentsView({
    webPreferences: {
      partition: BROWSER_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  browserView = view;
  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) void wc.loadURL(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => { if (!isHttpUrl(url)) event.preventDefault(); });
  // Electron récent : un objet details en premier argument (les positionnels sont
  // dépréciés) ; on lit les deux formes pour ne pas dépendre de la version.
  wc.on('did-start-navigation', (details, url, isInPlace, isMainFrame) => {
    const target = String(details?.url ?? url ?? '');
    const sameDocument = details?.isSameDocument ?? isInPlace === true;
    const mainFrame = details?.isMainFrame ?? isMainFrame !== false;
    // Seule une vraie page se montre : document principal, http(s) ; une ancre
    // (même document) ne change pas la page, et l'initialisation de la vue en
    // about:blank n'est pas une navigation de tâche.
    if (!mainFrame || sameDocument || !isHttpUrl(target)) return;
    revealBrowserPanel();
  });
  for (const name of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading', 'page-title-updated', 'render-process-gone']) {
    wc.on(name, () => pushBrowserState());
  }
  // Document initial : sans lui la page n'a pas de frame, et un client CDP reste
  // muet sur les commandes qui en dépendent (mesuré : Page.enable sans réponse,
  // alors que Playwright l'appelle en s'attachant). Chargé avant toute attache.
  void wc.loadURL('about:blank').catch(() => { /* vue détruite entre-temps */ });
  return view;
}

/** La vue native couvre exactement le rectangle rapporté par l'UI. */
function applyBrowserLayout() {
  if (!win || win.isDestroyed()) return;
  const usable = browserVisible && browserBounds.width >= 1 && browserBounds.height >= 1;
  if (!usable) {
    if (browserView && browserAttached) {
      try { win.contentView.removeChildView(browserView); } catch { /* déjà détachée */ }
      browserAttached = false;
    }
    return;
  }
  const view = ensureBrowserView();
  if (!browserAttached) {
    win.contentView.addChildView(view);
    browserAttached = true;
  }
  view.setBounds(browserBounds);
}

function setupBrowserIpc() {
  const fromOwnWindow = (event) => Boolean(win && !win.isDestroyed() && event.sender === win.webContents);

  ipcMain.handle('superviseur:browser:state', (event) => (fromOwnWindow(event) ? browserState() : null));

  ipcMain.handle('superviseur:browser:layout', (event, layout) => {
    if (!fromOwnWindow(event)) return null;
    const num = (value, fallback) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback);
    browserBounds = {
      x: num(layout?.x, 0),
      y: num(layout?.y, 0),
      width: Math.max(0, num(layout?.width, 0)),
      height: Math.max(0, num(layout?.height, 0)),
    };
    browserVisible = layout?.visible === true;
    applyBrowserLayout();
    return browserState();
  });

  ipcMain.handle('superviseur:browser:navigate', async (event, url) => {
    if (!fromOwnWindow(event)) return null;
    const target = String(url ?? '').trim();
    if (!isHttpUrl(target)) return { ...browserState(), error: 'invalid_url' };
    browserVisible = true;
    const view = ensureBrowserView();
    applyBrowserLayout();
    await view.webContents.loadURL(target).catch(() => { /* page refusée : l'état le dit */ });
    return browserState();
  });

  ipcMain.handle('superviseur:browser:action', (event, action) => {
    if (!fromOwnWindow(event)) return null;
    const wc = browserContents();
    if (wc) {
      try {
        if (action === 'reload') wc.reload();
        else if (action === 'back') wc.navigationHistory ? wc.navigationHistory.goBack() : wc.goBack();
        else if (action === 'forward') wc.navigationHistory ? wc.navigationHistory.goForward() : wc.goForward();
      } catch { /* course avec une destruction de page */ }
    }
    if (action === 'hide') {
      browserVisible = false;
      applyBrowserLayout();
    }
    return browserState();
  });
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
    webPreferences: {
      // Pont du panneau navigateur : la page native (WebContentsView) est
      // possédée par ce process, l'UI ne fait que lui donner un rectangle.
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.once('ready-to-show', () => win.show());
  // La page du panneau existe dès le démarrage, même panneau fermé : c'est la
  // seule cible qu'une tâche peut piloter (elle ne peut pas en créer), donc elle
  // doit être là avant que le propriétaire ouvre quoi que ce soit. Détachée de la
  // fenêtre tant que le panneau est fermé, elle coûte un process de rendu vide.
  ensureBrowserView();
  win.on('closed', () => {
    win = null;
    browserAttached = false;
    browserVisible = false;
    // la fenêtre ferme la page avec elle : aucun navigateur fantôme ne survit
    if (browserView) {
      try { browserView.webContents.close(); } catch { /* déjà détruite */ }
      browserView = null;
    }
  });
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
    setupBrowserIpc();
    createWindow();
    void publishBrowserCdp();

    const alreadyUp = await probeSuperviseur();
    if (alreadyUp) log('daemon déjà en marche sur le port : adoption, pas de nouveau daemon');
    spawnWatchdog(alreadyUp);
    loadUiWhenReady();
  });
}
