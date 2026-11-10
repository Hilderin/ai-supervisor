/**
 * Build du .exe Windows du Superviseur : 1) build de l'UI (Vite), 2) copie de
 * bun.exe en ressource (le daemon empaqueté est lancé par bun), 3) electron-builder
 * (cible portable : un seul .exe, extraction locale, pas d'installation).
 * Usage : bun run build:exe [-- --skip-ui]
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const step = (msg: string) => console.log(`[build:exe] ${msg}`);

function run(cmd: string, args: string[], opts: Record<string, unknown> = {}): number {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, windowsHide: true, ...opts });
  return r.status ?? 1;
}

const skipUi = process.argv.includes('--skip-ui');
if (!skipUi) {
  step('build de l UI (Vite)');
  if (run(process.execPath, ['run', '--cwd', 'ui', 'build']) !== 0) {
    console.error('[build:exe] build UI en échec');
    process.exit(1);
  }
} else {
  step('build UI sauté (--skip-ui) : ui/dist doit être frais');
}
if (!existsSync(join(root, 'ui', 'dist', 'index.html'))) {
  console.error('[build:exe] ui/dist/index.html absent : lancer le build UI d abord');
  process.exit(1);
}

step('copie de bun.exe en ressource');
const bunPath = Bun.which('bun') ?? Bun.which('bun.exe');
if (!bunPath) {
  console.error('[build:exe] bun introuvable dans le PATH (il fournit le runtime du daemon)');
  process.exit(1);
}
mkdirSync(join(root, 'electron', 'resources'), { recursive: true });
copyFileSync(bunPath, join(root, 'electron', 'resources', 'bun.exe'));
step(`bun.exe copié depuis ${bunPath}`);

step('electron-builder (cible portable Windows)');
// electron-builder pend sous le runtime bun (attente après le 7z, aucun enfant)
// : le lancer avec node (constaté en build local, node >= 22 requis par Electron).
const eb = run('node', ['node_modules/electron-builder/cli.js', '--win', 'portable']);
if (eb !== 0) {
  console.error('[build:exe] electron-builder en échec');
  process.exit(eb);
}
step('terminé : voir release/');
