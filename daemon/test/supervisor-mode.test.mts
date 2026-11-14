import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Mode du chat de supervision (décision du 2026-11-14) :
 * - le message du propriétaire part TEL QUEL (plus de préambule « Mode Piloter :
 *   ... » ni « Mode Investigation : ... ») ;
 * - le mode actif vit dans l'instruction durable de la session
 *   (`PUT /api/experimental/session/:id/instructions/entries/superviseur-mode`),
 *   que le serveur rend au modèle comme message système ; la définition de
 *   l'agent dit où le lire.
 *
 * Le daemon est branché sur un faux serveur OpenChamber : on regarde ce qui part
 * réellement sur le réseau.
 */
const root = await mkdtemp(join(tmpdir(), 'superviseur-mode-'));
process.env.SUPERVISEUR_DATA_DIR = join(root, 'data');
process.env.SUPERVISEUR_HOME = join(root, 'home');

const SESSION = 'ses_chat_mode';
const INSTRUCTION_PATH = `/api/experimental/session/${SESSION}/instructions/entries/superviseur-mode`;
const PROJECT = join(root, 'projet-demo');

interface Call {
  method: string;
  path: string;
  body?: unknown;
}
const calls: Call[] = [];

let server: ReturnType<typeof Bun.serve> | null = null;
let state: typeof import('../src/state.mts');
let supervisor: typeof import('../src/supervisor.mts');

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const path = url.pathname;
      let body: unknown;
      if (req.method !== 'DELETE' && req.method !== 'GET') {
        const raw = await req.text();
        body = raw ? JSON.parse(raw) : undefined;
      }
      calls.push({ method: req.method, path: `${path}${url.search}`, body });
      if (path === '/api/opencode/trust') return Response.json({ trusted: true });
      if (path === `/api/session/${SESSION}` && req.method === 'GET') {
        return Response.json({
          data: { id: SESSION, agent: state.ORCHESTRATOR_AGENT, location: { directory: supervisor.SUPERVISOR_DIR } },
        });
      }
      if (path === `/api/session/${SESSION}/message`) return Response.json({ data: [] });
      if (path === '/api/sessions/status') {
        return Response.json({ sessions: { [SESSION]: { status: 'idle', lastUpdateAt: 1_000 } }, pending: {} });
      }
      if (path === INSTRUCTION_PATH && req.method === 'PUT') return new Response(null, { status: 204 });
      if (path === `/api/session/${SESSION}/prompt` && req.method === 'POST') return Response.json({ ok: true });
      if (path === '/api/message-queue') return Response.json({ sessions: [] });
      if (path.endsWith('/metadata')) return Response.json({ ok: true });
      return new Response('not found', { status: 404 });
    },
  });

  state = await import('../src/state.mts');
  supervisor = await import('../src/supervisor.mts');
  const main = state.db.query('PRAGMA database_list').all() as Array<{ name: string; file: string }>;
  const file = main.find((d) => d.name === 'main')?.file ?? '';
  if (!file.startsWith(root)) throw new Error(`test lié à une base non temporaire : ${file}`);

  supervisor.setBase(`http://127.0.0.1:${server.port}`);
  state.setSupervisorSession({ ocSessionId: SESSION, agent: state.ORCHESTRATOR_AGENT, title: 'Superviseur' });
});

afterAll(async () => {
  server?.stop(true);
  try { await rm(root, { recursive: true, force: true, maxRetries: 5 }); } catch { /* dossier verrouillé */ }
});

beforeEach(() => {
  calls.length = 0;
});

function instructionPut(): Call | undefined {
  return calls.find(c => c.method === 'PUT' && c.path === INSTRUCTION_PATH);
}

function sentPrompt(): string {
  const prompt = calls.find(c => c.method === 'POST' && c.path.endsWith('/prompt'));
  expect(prompt).toBeTruthy();
  return String((prompt!.body as { text?: string }).text ?? '');
}

describe('message du propriétaire', () => {
  test('part tel quel, sans préambule de mode, en mode Piloter', async () => {
    state.setSupervisorMode('pilot', null);
    await supervisor.sendSupervisor('occupe-toi du dashboard');
    expect(sentPrompt()).toBe('occupe-toi du dashboard');
    expect(sentPrompt()).not.toContain('Mode Piloter');
    const put = instructionPut();
    expect(put).toBeTruthy();
    const value = (put!.body as { value?: string }).value ?? '';
    expect(value).toContain('Mode actif : Piloter');
  });

  test('part tel quel en mode Investigation, et le projet est dans l’instruction', async () => {
    state.setSupervisorMode('investigation', PROJECT);
    await supervisor.sendSupervisor('regarde le module auth');
    expect(sentPrompt()).toBe('regarde le module auth');
    expect(sentPrompt()).not.toContain('Mode Investigation');
    const value = (instructionPut()!.body as { value?: string }).value ?? '';
    expect(value).toContain('Mode actif : Investigation');
    expect(value).toContain(PROJECT);
    expect(value).toContain('aucune écriture');
  });

  test('une pièce jointe seule garde son texte de repli, sans préambule', async () => {
    state.setSupervisorMode('pilot', null);
    await supervisor.sendSupervisor('', [
      { name: 'note.txt', mimeType: 'text/plain', dataUrl: 'data:text/plain;base64,QUJD' },
    ]);
    const text = sentPrompt();
    expect(text.startsWith('Mode')).toBe(false);
    expect(text.length).toBeGreaterThan(0);
  });
});

describe('instruction de mode', () => {
  test('n’est pas réécrite à chaque envoi quand le mode ne change pas', async () => {
    state.setSupervisorMode('investigation', `${PROJECT}-bis`);
    await supervisor.sendSupervisor('premier');
    await supervisor.sendSupervisor('second');
    expect(calls.filter(c => c.method === 'PUT' && c.path === INSTRUCTION_PATH).length).toBe(1);
  });

  test('est réannoncée au changement de mode', async () => {
    state.setSupervisorMode('investigation', `${PROJECT}-ter`);
    await supervisor.sendSupervisor('premier');
    state.setSupervisorMode('pilot', null);
    await supervisor.announceSupervisorMode();
    await supervisor.sendSupervisor('second');
    const values = calls
      .filter(c => c.method === 'PUT' && c.path === INSTRUCTION_PATH)
      .map(c => String((c.body as { value?: string }).value ?? ''));
    expect(values.length).toBe(2);
    expect(values[0]).toContain('Investigation');
    expect(values[1]).toContain('Piloter');
    // le second envoi ne réécrit pas l'instruction déjà annoncée
    expect(values.filter(v => v.startsWith('Mode actif : Piloter')).length).toBe(1);
  });
});

describe('dépouillement de l’ancien encadrement', () => {
  test('retire l’ancien préambule Piloter et l’ancien OWNER_WRAP', async () => {
    const { stripOwnerWrap, LEGACY_PILOT_WRAP, OWNER_WRAP } = await import('../src/supervisor-mode.mts');
    expect(stripOwnerWrap(`${LEGACY_PILOT_WRAP}\n\ndemande intacte`)).toBe('demande intacte');
    expect(stripOwnerWrap(`${OWNER_WRAP} ${LEGACY_PILOT_WRAP}\n\ndemande intacte`)).toBe('demande intacte');
    expect(stripOwnerWrap('demande simple')).toBe('demande simple');
  });

  test('retire l’ancien préambule Investigation', async () => {
    const { stripOwnerWrap, LEGACY_INVESTIGATION_WRAP } = await import('../src/supervisor-mode.mts');
    const legacy = `${LEGACY_INVESTIGATION_WRAP}\nProjet sélectionné : C:\\demo\n\ndemande intacte`;
    expect(stripOwnerWrap(legacy)).toBe('demande intacte');
  });
});

describe('sources', () => {
  test('supervisor.mts ne construit plus aucun préambule', async () => {
    const source = await readFile(join(import.meta.dir, '..', 'src', 'supervisor.mts'), 'utf8');
    expect(source).not.toContain('Mode Piloter :');
    expect(source).not.toContain('Mode Investigation :');
    expect(source).not.toContain('wrapSupervisorPrompt');
  });

  test('la définition de l’agent fait lire le mode dans l’instruction de session', async () => {
    const prompt = await readFile(join(import.meta.dir, '..', 'agent', 'superviseur-orchestrateur.md'), 'utf8');
    expect(prompt).toContain('instruction de session');
    expect(prompt).toContain('Mode actif : Piloter');
    expect(prompt).toContain('Mode actif : Investigation');
    // l'ancienne consigne (préambule du daemon) ne doit plus être enseignée
    expect(prompt).not.toContain('Le préambule ajouté par le daemon');
    expect(prompt).not.toContain('Quand le message système indique');
  });

  test('aucun tiret long dans le module ni dans la définition de l’agent', async () => {
    const files = [
      join(import.meta.dir, '..', 'src', 'supervisor-mode.mts'),
      join(import.meta.dir, '..', 'agent', 'superviseur-orchestrateur.md'),
    ];
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      expect(text.includes('\u2014')).toBe(false);
      expect(text.includes('\u2013')).toBe(false);
    }
  });
});
