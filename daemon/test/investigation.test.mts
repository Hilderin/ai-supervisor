import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { globProjectFiles, grepProjectFiles, readProjectFile } from '../src/investigation.mts';
import { isToolAllowedInMode, modeDenial } from '../src/investigation-policy.mts';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'superviseur-investigation-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, '.git'), { recursive: true });
  await mkdir(join(root, '.superviseur'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'secret'), { recursive: true });
  await writeFile(join(root, 'README.md'), '# Projet\nTexte lisible\n');
  await writeFile(join(root, 'src', 'sample.ts'), 'const needle = "alpha";\nconst pattern = "foo.*";\n');
  await writeFile(join(root, '.git', 'config'), 'private');
  await writeFile(join(root, '.superviseur', 'private.txt'), 'private');
  await writeFile(join(root, 'node_modules', 'secret', 'private.ts'), 'private');
  await symlink('/etc/passwd', join(root, 'escape.txt'));
  await symlink(join(root, '.superviseur'), join(root, 'supervisor-alias'));
});

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe('outils de lecture du projet', () => {
  test('lit un extrait de fichier relatif avec des bornes explicites', async () => {
    const result = await readProjectFile(root, 'README.md', 2, 1);
    expect(result).toMatchObject({ ok: true, path: 'README.md', startLine: 2, totalLines: 3, content: 'Texte lisible' });
  });

  test('refuse les chemins absolus, les traversées et les fichiers de base protégés', async () => {
    expect((await readProjectFile(root, '/etc/passwd')).ok).toBe(false);
    expect((await readProjectFile(root, '../outside.txt')).ok).toBe(false);
    expect((await readProjectFile(root, 'data/superviseur.db')).ok).toBe(false);
    expect((await readProjectFile(root, 'data/superviseur.db-wal')).ok).toBe(false);
  });

  test('refuse un lien symbolique qui sort du projet', async () => {
    expect(await readProjectFile(root, 'escape.txt')).toMatchObject({ ok: false });
  });

  test('refuse un alias symbolique vers le dossier de supervision protégé', async () => {
    expect(await readProjectFile(root, 'supervisor-alias/private.txt')).toMatchObject({ ok: false });
  });

  test('liste des fichiers sans traverser les liens ni les répertoires protégés', async () => {
    const result = await globProjectFiles(root, '**/*.ts');
    expect(result).toMatchObject({ ok: true, files: ['src/sample.ts'] });
  });

  test('recherche du texte littéral, sans exécuter une expression régulière', async () => {
    const result = await grepProjectFiles(root, 'foo.*', '**/*.ts');
    expect(result).toMatchObject({
      ok: true,
      matches: [{ path: 'src/sample.ts', line: 2, text: 'const pattern = "foo.*";' }],
    });
  });

  test('les accès fichier n’écrivent rien', async () => {
    await readProjectFile(root, 'README.md');
    await globProjectFiles(root, '**/*');
    await grepProjectFiles(root, 'needle');
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('# Projet\nTexte lisible\n');
  });
});

describe('frontière de permission appliquée par le daemon', () => {
  test('le mode Investigation autorise seulement les trois outils de lecture bornés', () => {
    for (const name of ['read_project', 'glob_project', 'grep_project']) {
      expect(isToolAllowedInMode(name, 'investigation')).toBe(true);
    }
    for (const name of [
      'list_projects', 'list_tasks', 'get_task', 'start_task', 'send_task', 'cancel_question', 'close_task',
      'answer', 'bash', 'edit', 'write', 'read', 'glob', 'grep', 'webfetch', 'planwrite', 'planupdate', 'planread', 'task', 'execute',
      'openchamber_secret', 'unknown_future_tool',
    ]) {
      expect(isToolAllowedInMode(name, 'investigation')).toBe(false);
      expect(modeDenial(name, 'investigation')).toMatchObject({ ok: false, error: 'read_only_mode' });
    }
  });

  test('les lectures de fichiers sont refusées hors mode Investigation', () => {
    for (const name of ['read_project', 'glob_project', 'grep_project']) {
      expect(isToolAllowedInMode(name, 'pilot')).toBe(false);
      expect(modeDenial(name, 'pilot')).toMatchObject({ ok: false, error: 'investigation_mode_required' });
    }
    expect(isToolAllowedInMode('start_task', 'pilot')).toBe(true);
  });
});
