/** Lectures bornées des fichiers d'un projet, sans commande ni écriture. */
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const MAX_READ_BYTES = 512 * 1024;
const MAX_READ_CHARS = 24_000;
const MAX_GLOB_FILES = 1200;
const MAX_GREP_FILES = 600;
const MAX_GREP_BYTES = 8 * 1024 * 1024;
const MAX_MATCHES = 80;
const MAX_PATTERN_CHARS = 256;
const MAX_QUERY_CHARS = 500;
const SKIP_DIRS = new Set(['.git', '.superviseur', 'node_modules']);

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function validateRelativePath(path: string): string {
  const value = String(path ?? '').trim();
  if (!value || value.length > 1024 || value.includes('\0') || isAbsolute(value)) throw new Error('chemin relatif requis');
  const parts = value.split(/[\\/]+/);
  if (parts.some(part => part === '..')) throw new Error('sortie du projet interdite');
  if (parts.some(part => SKIP_DIRS.has(part))) throw new Error('chemin protégé');
  if (parts.some(part => /^superviseur\.db(?:-(?:wal|shm|journal))?$/i.test(part))) throw new Error('base de données protégée');
  return parts.filter(part => part && part !== '.').join(sep);
}

async function projectRoot(directory: string): Promise<string> {
  const root = await realpath(directory);
  if (!(await stat(root)).isDirectory()) throw new Error('projet indisponible');
  return root;
}

async function resolveProjectFile(root: string, relativePath: string): Promise<string> {
  const safe = validateRelativePath(relativePath);
  const lexical = resolve(root, safe);
  if (!inside(root, lexical) || lexical === root) throw new Error('chemin hors projet');
  let cursor = root;
  for (const part of relative(root, lexical).split(sep)) {
    cursor = resolve(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error('lien symbolique interdit');
  }
  const resolved = await realpath(lexical);
  if (!inside(root, resolved) || resolved === root) throw new Error('lien symbolique hors projet interdit');
  if (!(await stat(resolved)).isFile()) throw new Error('un fichier est requis');
  return resolved;
}

export async function readProjectFile(directory: string, path: string, startLine?: number, lineCount?: number) {
  try {
    const root = await projectRoot(directory);
    const safe = validateRelativePath(path);
    const file = await resolveProjectFile(root, safe);
    const info = await stat(file);
    if (info.size > MAX_READ_BYTES) return { ok: false, error: 'fichier_trop_volumineux', maxBytes: MAX_READ_BYTES };
    const bytes = await readFile(file);
    if (bytes.includes(0)) return { ok: false, error: 'fichier_binaire_refuse' };
    const lines = bytes.toString('utf8').split(/\r?\n/);
    const from = Math.max(1, Math.floor(Number(startLine) || 1));
    const count = Math.min(400, Math.max(1, Math.floor(Number(lineCount) || 160)));
    const excerpt = lines.slice(from - 1, from - 1 + count).join('\n');
    const content = excerpt.slice(0, MAX_READ_CHARS);
    return {
      ok: true,
      path: safe.split(sep).join('/'),
      startLine: from,
      totalLines: lines.length,
      content,
      truncated: content.length < excerpt.length || from - 1 + count < lines.length,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'lecture_refusee' };
  }
}

/**
 * Résout une IMAGE de preuve avec les MÊMES gardes que readProjectFile
 * (relatif, sans sortie, sans lien symbolique, borné au projet) mais SANS le
 * refus binaire : le vérificateur doit voir la capture réellement
 * (retour du propriétaire, 2026-11-08). Le daemon renvoie le chemin absolu
 * validé et le mime ; c'est le plugin vérificateur qui l'attache à la session
 * (Tool.FileContent), pas une description.
 */
export async function resolveProjectImage(directory: string, path: string, allowedMimes: Record<string, string>) {
  try {
    const ext = String(path).split('.').pop()?.toLowerCase() ?? '';
    const mime = allowedMimes[ext];
    if (!mime) return { ok: false, error: 'format_image_refuse' };
    const root = await projectRoot(directory);
    const safe = validateRelativePath(path);
    const file = await resolveProjectFile(root, safe);
    const info = await stat(file);
    if (info.size > MAX_READ_BYTES) return { ok: false, error: 'fichier_trop_volumineux', maxBytes: MAX_READ_BYTES };
    return { ok: true, abs: file, mime, size: info.size, relative: safe.split(sep).join('/') };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'lecture_refusee' };
  }
}

function globRegex(pattern: string): RegExp {
  if (pattern.length > MAX_PATTERN_CHARS || (pattern.match(/\*/g)?.length ?? 0) > 16) {
    throw new Error('motif trop complexe');
  }
  let source = '^';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') { i++; source += '(?:.*/)?'; }
      else source += '.*';
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`${source}$`);
}

async function walkFiles(root: string, maxFiles: number, maxDepth = 12): Promise<string[]> {
  const files: string[] = [];
  let visited = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth || files.length >= maxFiles || visited >= 5000) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= maxFiles || visited >= 5000) break;
      visited++;
      if (entry.name.includes('\0') || SKIP_DIRS.has(entry.name)) continue;
      const full = resolve(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile()) files.push(full);
    }
  };
  await walk(root, 0);
  return files;
}

export async function globProjectFiles(directory: string, pattern: string) {
  try {
    const root = await projectRoot(directory);
    const safePattern = validateRelativePath(String(pattern || '**/*'));
    const matcher = globRegex(safePattern.split(sep).join('/'));
    const files = await walkFiles(root, MAX_GLOB_FILES);
    const matches = files
      .map(file => relative(root, file).split(sep).join('/'))
      .filter(path => matcher.test(path))
      .slice(0, 100);
    return { ok: true, files: matches, truncated: matches.length === 100 || files.length === MAX_GLOB_FILES };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'recherche_refusee' };
  }
}

export async function grepProjectFiles(
  directory: string,
  query: string,
  pattern = '**/*',
  caseSensitive = false,
) {
  const needle = String(query ?? '');
  if (!needle.trim()) return { ok: false, error: 'texte_requis' };
  if (needle.length > MAX_QUERY_CHARS) return { ok: false, error: 'requete_trop_longue', maxChars: MAX_QUERY_CHARS };
  try {
    const root = await projectRoot(directory);
    const safePattern = validateRelativePath(pattern || '**/*');
    const matcher = globRegex(safePattern.split(sep).join('/'));
    const files = (await walkFiles(root, MAX_GREP_FILES))
      .filter(file => matcher.test(relative(root, file).split(sep).join('/')));
    const matches: Array<{ path: string; line: number; text: string }> = [];
    let bytesScanned = 0;
    const searchNeedle = caseSensitive ? needle : needle.toLocaleLowerCase();
    for (const file of files) {
      if (matches.length >= MAX_MATCHES || bytesScanned >= MAX_GREP_BYTES) break;
      const info = await lstat(file);
      if (!info.isFile() || info.size > MAX_READ_BYTES) continue;
      const bytes = await readFile(file);
      bytesScanned += bytes.length;
      if (bytes.includes(0)) continue;
      const lines = bytes.toString('utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length && matches.length < MAX_MATCHES; i++) {
        const haystack = caseSensitive ? lines[i] : lines[i].toLocaleLowerCase();
        if (haystack.includes(searchNeedle)) {
          matches.push({
            path: relative(root, file).split(sep).join('/'),
            line: i + 1,
            text: lines[i].slice(0, 400),
          });
        }
      }
    }
    return {
      ok: true,
      matches,
      truncated: matches.length === MAX_MATCHES || files.length === MAX_GREP_FILES || bytesScanned >= MAX_GREP_BYTES,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'recherche_refusee' };
  }
}
