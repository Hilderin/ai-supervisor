/**
 * Serveur HTTP du Superviseur : /api/fleet (lecture), /api/fleet/* (actions), l'UI statique.
 * Node stdlib uniquement (http + fs + node:sqlite dans state.mts).
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentFleet, openchamberUrl, pollOnce, type Fleet } from './fleet.mts';
import { companionSessionOf } from './companion.mts';
import { logEvent, upsertTaskState, getTaskState, reopenTaskState } from './state.mts';

const here = dirname(fileURLToPath(import.meta.url));
const uiDir = join(here, '..', '..', 'ui');
const PORT = Number(process.env.SUPERVISEUR_PORT ?? 5180);

const json = (res: http.ServerResponse, code: number, body: unknown) => {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': buf.length });
  res.end(buf);
};

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const ch of req) chunks.push(ch as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

async function relay(path: string, init?: RequestInit): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(openchamberUrl(path), { ...init, signal: ctl.signal });
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    return { ocStatus: res.status, ocOk: res.ok, body };
  } finally { clearTimeout(t); }
}

function sendReplyPath(sessionId: string, form?: { id?: string }, requestID?: string): string {
  if (form?.id) return `/api/session/${sessionId}/form/${form.id}/reply`;
  if (requestID) return `/api/session/${sessionId}/permission/${requestID}/reply`;
  throw new Error('ni formID ni requestID');
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const path = url.pathname;
  if (path === '/api/fleet' && req.method === 'GET') {
    const fleet: Fleet = currentFleet();
    void pollOnce();
    const enriched = {
      ...fleet,
      rows: fleet.rows
        .map(r => {
          const st = getTaskState(r.id) as { closed_at?: number } | null;
          if (st?.closed_at) {
            // activité postérieure à la fermeture ? (nouveau prompt dans OpenChamber) → réouverture
            const last = Math.max(r.lastUpdateAt ?? 0, r.busy ?? 0);
            if (last > (st.closed_at ?? 0)) reopenTaskState(r.id);
            else return null;
          }
          return ({ ...r, task: getTaskState(r.id) });
        })
        .filter(Boolean),
    };
    json(res, 200, enriched);
    return;
  }
  if (path === '/api/fleet/reply' && req.method === 'POST') {
    const body = await readBody(req);
    const sessionId = String(body.sessionId ?? '');
    const formId = body.formId ? String(body.formId) : undefined;
    const requestID = body.requestID ? String(body.requestID) : undefined;
    const answer = (body.answer ?? {}) as Record<unknown, unknown>;
    const decision = body.decision ? String(body.decision) : undefined;
    try {
      if (formId) {
        const answer = (body.answer ?? {}) as Record<string, unknown>;
        const payload = { answer: Object.keys(answer).length ? answer : { q0: decision ?? '' } };
        logEvent(sessionId, 'reply', `→ form ${formId} : ${JSON.stringify(payload.answer).slice(0, 160)}`);
        json(res, 200, await relay(sendReplyPath(sessionId, { id: formId }), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }));
      } else if (requestID) {
        logEvent(sessionId, 'reply', `→ permission ${requestID} : ${decision}`);
        json(res, 200, await relay(sendReplyPath(sessionId, undefined, requestID), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: decision ?? 'once' }) }));
      } else {
        json(res, 400, { error: 'formId ou requestID requis' });
      }
    } catch (e) {
      json(res, 502, { error: String(e) });
    }
    return;
  }
  if (path === '/api/fleet/create' && req.method === 'POST') {
    const body = await readBody(req);
    const title = String(body.title ?? '').slice(0, 80) || 'Nouvelle tâche';
    const prompt = String(body.prompt ?? '');
    try {
      const out = await relay('/api/openchamber/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, prompt: prompt || title }) });
      logEvent('new', 'open', title);
      json(res, 200, out);
    } catch (e) {
      json(res, 502, { error: String(e) });
    }
    return;
  }
  if (path === '/api/fleet/send' && req.method === 'POST') {
    const body = await readBody(req);
    const sessionId = String(body.sessionId ?? '');
    const text = String(body.text ?? '').trim();
    if (!sessionId || !text) { json(res, 400, { error: 'sessionId et text requis' }); return; }
    try {
      logEvent(sessionId, 'note', '→ prompt : ' + text.slice(0, 120));
      json(res, 200, await relay(`/api/session/${sessionId}/prompt`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, delivery: body.delivery ?? 'steer' }),
      }));
    } catch (e) { json(res, 502, { error: String(e) }); }
    return;
  }
  if (path === '/api/fleet/done' && req.method === 'POST') {
    const body = await readBody(req);
    const sessionId = String(body.sessionId ?? '');
    const note = String(body.note ?? '');
    if (!sessionId) { json(res, 400, { error: 'sessionId requis' }); return; }
    // Fermer = retirer du Superviseur. PAS d'archivage : une activité future dans
    // OpenChamber (nouveau prompt) remet la carte dans la flotte (ouverture à la volée).
    upsertTaskState(sessionId, { closedAt: Date.now(), closure: 'terminé' });
    logEvent(sessionId, 'done', note ? 'fermé — ' + note.slice(0, 80) : 'fermé du Superviseur');
    json(res, 200, { ok: true });
    return;
  }
  if (path === '/api/fleet/stream' && req.method === 'GET') {
    // SSE : pousse la flotte dès qu'elle est rafraîchie (les événements OpenChamber déclenchent un poll immédiat)
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const send = () => { try { res.write(`data: ${JSON.stringify(currentFleet())}\n\n`); } catch { /* client parti */ } };
    send();
    const t = setInterval(send, 500);
    req.on('close', () => clearInterval(t));
    return;
  }
  json(res, 404, { error: `route inconnue : ${path}` });
}

export function startServer(): void {
  http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
    try {
      if (url.pathname.startsWith('/api/')) { await handleApi(req, res, url); return; }
      const rel = (url.pathname === '/' || url.pathname === '/fleet') ? 'index.html'
        : normalize(url.pathname).replace(/^([/\\])+/, '');
      const file = join(uiDir, rel);
      if (!file.startsWith(uiDir)) { res.writeHead(403).end(); return; }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404');
    }
  }).listen(PORT, '127.0.0.1', () => console.log(`[superviseur] UI + daemon sur http://127.0.0.1:${PORT}/fleet`));
}
