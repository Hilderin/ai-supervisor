/**
 * Serveur HTTP du Superviseur : /api/fleet (lecture), /api/fleet/* (actions), l'UI statique.
 * Node stdlib uniquement (http + fs + node:sqlite dans state.mts).
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentFleet, openchamberUrl, pollOnce, type Fleet } from './fleet.mts';
import { ackAnswers, getAnswers, unreadAnswerCounts } from './answers.mts';
import { ackRenders, getRenders, unreadRenderCounts } from './renders.mts';
import { getDelivery } from './delivery.mts';
import { readSessionAsset } from './assets.mts';
import { openChamberMiniChatUrl } from './openchamber-link.mts';
import { getSupervisorSession, logEvent, upsertTaskState, getTaskState, reopenTaskState } from './state.mts';
import { abortSupervisor, applySupervisorChatConfig, cancelQueuedSupervisor, getSupervisorState, newSupervisorConversation, queueSupervisor, revertSupervisor, sendSupervisor, takeQueuedSupervisor, SUPERVISOR_DIR } from './supervisor.mts';
import { getSupervisorConfig, saveSupervisorConfig } from './prefs.mts';
import { getTaskModelInfo, setTaskModel } from './task-model.mts';
import { cancelPendingForms, configureSupervisorMode, pendingFor, runTool, supervisorProjects } from './tools.mts';
import { criteriaCounts, readCriteria } from './criteria.mts';
import { toPromptFiles } from './attachments.mts';
import { markTaskSessionRead } from './oc-session.mts';
import { restoreConversation, searchConversations } from './search.mts';

const here = dirname(fileURLToPath(import.meta.url));
// le build Vite (bun run build:ui) ; le daemon ne sert que des fichiers produits
const uiDir = join(here, '..', '..', 'ui', 'dist');
const PORT = Number(process.env.SUPERVISEUR_PORT ?? 5180);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

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

/** Flotte enrichie (état local des tâches) : même vue pour GET /api/fleet et le SSE. */
function enrichedFleet(): Fleet {
  const fleet = currentFleet();
  const supervisorId = getSupervisorSession()?.oc_session_id;
  // compteur de réponses non lues : une seule requête par frame, réparti ici
  // (jamais dans buildFleet : la flotte brute vient d'OpenChamber, la table
  // task_answer nous appartient)
  const unread = unreadAnswerCounts();
  // idem pour les rendus OpenChamber non vus (table task_render)
  const unreadRenders = unreadRenderCounts();
  return {
    ...fleet,
    rows: fleet.rows.flatMap((r) => {
      if (supervisorId && r.id === supervisorId) return [];
      if (r.dir === SUPERVISOR_DIR) return [];
      const st = getTaskState(r.id) as { closed_at?: number } | null;
      const counters = {
        unreadAnswers: unread.get(r.id) ?? 0,
        unreadRenders: unreadRenders.get(r.id) ?? 0,
      };
      if (st?.closed_at) {
        // activité postérieure à la fermeture ? (nouveau prompt dans OpenChamber, ou
        // un tool answer livré après clôture) → réouverture
        const last = Math.max(r.lastUpdateAt ?? 0, r.busy ?? 0);
        if (last > (st.closed_at ?? 0)) {
          reopenTaskState(r.id);
          return [{ ...r, task: getTaskState(r.id), ...counters }];
        }
        return [];
      }
      return [{ ...r, task: st, ...counters }];
    }),
  };
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const path = url.pathname;
  if (path === '/api/fleet' && req.method === 'GET') {
    // même enrichissement que le SSE : sinon les cartes fermées côté daemon
    // réapparaissent à chaque frame SSE et disparaissent au poll suivant (flicker)
    const fleet = enrichedFleet();
    void pollOnce();
    json(res, 200, fleet);
    return;
  }
  if (path === '/api/supervisor' && req.method === 'GET') {
    json(res, 200, await getSupervisorState());
    return;
  }
  if (path === '/api/supervisor/config' && req.method === 'GET') {
    // catalogue frais (modèles, providers, agents) + préférences enregistrées
    try { json(res, 200, await getSupervisorConfig()); }
    catch (e) { json(res, 502, { error: String(e) }); }
    return;
  }
  if (path === '/api/supervisor/config' && req.method === 'POST') {
    // enregistre, puis applique À CHAUD : agent et modèle du chat sur la
    // session vivante (plus de modèle compagnon : les sous-agents sont retirés)
    const body = await readBody(req);
    try {
      const saved = await saveSupervisorConfig(body);
      const applied = await applySupervisorChatConfig().catch((e) => ({
        sessionId: null, agent: null, model: null, applied: false, error: String(e),
      }));
      json(res, 200, {
        ok: true,
        config: await getSupervisorConfig(),
        warnings: saved.warnings,
        applied,
      });
    } catch (e) {
      json(res, 502, { ok: false, error: String(e) });
    }
    return;
  }
  if (path === '/api/openchamber/mini-chat' && req.method === 'GET') {
    const sessionId = url.searchParams.get('sessionId')?.trim() ?? '';
    const target = openChamberMiniChatUrl(openchamberUrl('/'), sessionId);
    if (!target) {
      json(res, 400, { error: 'sessionId invalide' });
      return;
    }
    json(res, 200, { url: target });
    return;
  }
  if (path === '/api/supervisor/projects' && req.method === 'GET') {
    try { json(res, 200, { projects: await supervisorProjects() }); }
    catch (e) { json(res, 502, { error: String(e) }); }
    return;
  }
  if (path === '/api/supervisor/mode' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const result = await configureSupervisorMode(body.mode, body.projectDirectory);
      json(res, result.ok ? 200 : result.error === 'supervisor_busy' ? 409 : 400, result);
    } catch (e) {
      json(res, 502, { ok: false, error: String(e) });
    }
    return;
  }
  if (path === '/api/supervisor/messages' && req.method === 'GET') {
    const state = await getSupervisorState();
    json(res, 200, { sessionId: state.sessionId, status: state.status, messages: state.messages, queued: state.queued, error: state.error });
    return;
  }
  if (path === '/api/supervisor/send' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      json(res, 200, await sendSupervisor(String(body.text ?? ''), body.attachments));
    } catch (e) {
      json(res, 502, { error: String(e) });
    }
    return;
  }
  if (path === '/api/supervisor/queue' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      json(res, 200, await queueSupervisor(String(body.text ?? ''), body.attachments));
    } catch (e) {
      json(res, 502, { error: String(e) });
    }
    return;
  }
  if (path === '/api/supervisor/queue/cancel' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      json(res, 200, await cancelQueuedSupervisor(String(body.itemId ?? '')));
    } catch (e) {
      json(res, 502, { error: String(e) });
    }
    return;
  }
  if (path === '/api/supervisor/queue/take' && req.method === 'POST') {
    // Reprendre un message de la file (geste OpenChamber « Modifier » et
    // « Envoyer maintenant ») : l'item quitte la file, contenu complet renvoyé.
    const body = await readBody(req);
    try {
      json(res, 200, await takeQueuedSupervisor(String(body.itemId ?? '')));
    } catch (e) {
      json(res, 502, { error: String(e) });
    }
    return;
  }
  if (path === '/api/supervisor/revert' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      json(res, 200, await revertSupervisor(String(body.messageId ?? '')));
    } catch (e) {
      json(res, 502, { error: String(e) });
    }
    return;
  }
  if (path === '/api/supervisor/new' && req.method === 'POST') {
    try {
      json(res, 200, await newSupervisorConversation());
    } catch (e) {
      json(res, 502, { error: String(e) });
    }
    return;
  }
  if (path === '/api/supervisor/abort' && req.method === 'POST') {
    await abortSupervisor();
    json(res, 200, { ok: true });
    return;
  }
  if (path.startsWith('/api/tools/') && req.method === 'POST') {
    const name = path.slice('/api/tools/'.length);
    const body = await readBody(req);
    const args = (body.args ?? {}) as Record<string, unknown>;
    const result = await runTool(name, String(body.sessionId ?? ''), args);
    json(res, 200, result);
    return;
  }
  if (path === '/api/fleet/model' && req.method === 'GET') {
    // modèle de la tâche, à la demande : la flotte ne transporte pas la liste
    // des modèles ; le panneau de détail l'affiche et le change ici
    const sessionId = (url.searchParams.get('sessionId') ?? '').trim();
    if (!sessionId) { json(res, 400, { error: 'sessionId requis' }); return; }
    const supervisorId = getSupervisorSession()?.oc_session_id;
    const row = currentFleet().rows.find(r => r.id === sessionId);
    if (sessionId === supervisorId || row?.dir === SUPERVISOR_DIR) {
      json(res, 400, { error: 'not_task' });
      return;
    }
    json(res, 200, await getTaskModelInfo(sessionId));
    return;
  }
  if (path === '/api/fleet/model' && req.method === 'POST') {
    // changer le modèle d'une tâche : la session vivante d'abord, puis le
    // brief et le registre de reprise ; aucune session recréée
    const body = await readBody(req);
    const sessionId = String(body.sessionId ?? '').trim();
    if (!sessionId) { json(res, 400, { error: 'sessionId requis' }); return; }
    const supervisorId = getSupervisorSession()?.oc_session_id;
    const row = currentFleet().rows.find(r => r.id === sessionId);
    if (sessionId === supervisorId || row?.dir === SUPERVISOR_DIR) {
      json(res, 400, { error: 'not_task' });
      return;
    }
    const result = await setTaskModel(sessionId, body.model == null ? '' : String(body.model));
    json(res, result.ok ? 200 : 400, result);
    return;
  }
  if (path === '/api/fleet/criteria' && req.method === 'GET') {
    // liste détaillée des critères d'une tâche, à la demande (la flotte ne
    // transporte que les comptes) ; rechargée quand lastUpdateAt change.
    // L'état vit dans la session (plugin superviseur-criteria) : lecture des
    // tool parts par criteria.mts, repli criteria_known.
    const sessionId = (url.searchParams.get('sessionId') ?? '').trim();
    if (!sessionId) { json(res, 400, { error: 'sessionId requis' }); return; }
    const rows = await readCriteria(sessionId);
    json(res, 200, { sessionId, criteria: rows, counts: criteriaCounts(rows) });
    return;
  }
  if (path === '/api/fleet/answers' && req.method === 'GET') {
    // panel de détails : toutes les réponses de la tâche, lues et non lues.
    // Réponses natives session (2026-11-13) : moissonnage des tool parts `answer`
    // puis lecture de la table (historique pré-migration compris).
    const sessionId = (url.searchParams.get('sessionId') ?? '').trim();
    if (!sessionId) { json(res, 400, { error: 'sessionId requis' }); return; }
    json(res, 200, { sessionId, answers: await getAnswers(sessionId) });
    return;
  }
  if (path === '/api/fleet/answers/ack' && req.method === 'POST') {
    const body = await readBody(req);
    const sessionId = String(body.sessionId ?? '');
    if (!sessionId) { json(res, 400, { error: 'sessionId requis' }); return; }
    const ids = Array.isArray(body.ids) ? body.ids.map((n) => Number(n)) : undefined;
    const acked = ackAnswers(sessionId, ids);
    json(res, 200, { ok: true, acked });
    return;
  }
  if (path === '/api/fleet/renders' && req.method === 'GET') {
    // panel de détails : tous les rendus OpenChamber de la tâche, vus et non vus.
    // Moissonnage des tool parts `openchamber_render` puis lecture de la table.
    const sessionId = (url.searchParams.get('sessionId') ?? '').trim();
    if (!sessionId) { json(res, 400, { error: 'sessionId requis' }); return; }
    json(res, 200, { sessionId, renders: await getRenders(sessionId) });
    return;
  }
  if (path === '/api/fleet/renders/ack' && req.method === 'POST') {
    const body = await readBody(req);
    const sessionId = String(body.sessionId ?? '');
    if (!sessionId) { json(res, 400, { error: 'sessionId requis' }); return; }
    const ids = Array.isArray(body.ids) ? body.ids.map((n) => Number(n)) : undefined;
    const acked = ackRenders(sessionId, ids);
    json(res, 200, { ok: true, acked });
    return;
  }
  if (path === '/api/fleet/delivery' && req.method === 'GET') {
    // à la demande : la flotte (GET + SSE) ne transporte pas les messages.
    const sessionId = (url.searchParams.get('sessionId') ?? '').trim();
    if (!sessionId) { json(res, 400, { error: 'sessionId requis' }); return; }
    json(res, 200, await getDelivery(sessionId));
    return;
  }
  if (path === '/api/fleet/asset' && req.method === 'GET') {
    // image locale citée par une réponse agent (capture, graphique) : le
    // navigateur ne peut pas lire un chemin du disque, le daemon le sert.
    const sessionId = (url.searchParams.get('sessionId') ?? '').trim();
    const source = url.searchParams.get('path') ?? '';
    if (!sessionId || !source) { json(res, 400, { error: 'sessionId et path requis' }); return; }
    const row = currentFleet().rows.find(r => r.id === sessionId);
    if (!row || !row.dir) { json(res, 404, { error: 'session inconnue' }); return; }
    const asset = await readSessionAsset(row.dir, source);
    if (!asset.ok) {
      res.writeHead(asset.status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(asset.error);
      return;
    }
    res.writeHead(200, {
      'Content-Type': asset.type,
      'Content-Length': asset.body.length,
      'Cache-Control': 'private, max-age=60',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(asset.body);
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
    // Sans projet choisi, la session ne doit pas tomber dans le dossier courant
    // d'OpenChamber (home sous Windows) : défaut = dossier de supervision.
    const requested = typeof body.directory === 'string' ? body.directory.trim() : '';
    const directory = requested || SUPERVISOR_DIR;
    try {
      const out = await relay('/api/openchamber/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, prompt: prompt || title, directory }) });
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
    const files = toPromptFiles(body.attachments);
    if (!sessionId || (!text && !files.length)) { json(res, 400, { error: 'sessionId et text (ou une pièce jointe) requis' }); return; }
    const pending = await pendingFor(sessionId);
    if (pending.permissions) {
      json(res, 409, { error: 'waiting_human', kind: 'permission', message: 'une permission attend sur la carte' });
      return;
    }
    try {
      let cancelledQuestion: string | null = null;
      if (pending.forms.length) {
        const cancelled = await cancelPendingForms(sessionId, pending.forms.map(f => f.id));
        if (!cancelled.ok) {
          json(res, 502, { error: 'cancel_failed', message: cancelled.error });
          return;
        }
        cancelledQuestion = pending.forms[0].text;
        logEvent(sessionId, 'note', `question annulée par message : ${cancelledQuestion}`);
      }
      const promptText = text || 'Voir la pièce jointe.';
      logEvent(sessionId, 'note', '→ prompt : ' + promptText.slice(0, 120)
        + (files.length ? ` (+${files.length} fichier${files.length > 1 ? 's' : ''})` : ''));
      // le texte part tel quel (encadrement OWNER_WRAP retiré, 2026-11-12)
      const out = await relay(`/api/session/${sessionId}/prompt`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: promptText,
          delivery: body.delivery ?? 'steer',
          ...(files.length ? { files } : {}),
        }),
      });
      json(res, 200, { ...(out as object), cancelledQuestion });
    } catch (e) { json(res, 502, { error: String(e) }); }
    return;
  }
  if (path === '/api/fleet/cancel-question' && req.method === 'POST') {
    const body = await readBody(req);
    const sessionId = String(body.sessionId ?? '');
    const formId = body.formId ? String(body.formId) : undefined;
    const message = body.message ? String(body.message) : undefined;
    const pending = await pendingFor(sessionId);
    if (!pending.forms.length) { json(res, 409, { error: 'no_question' }); return; }
    const ids = formId ? [formId] : pending.forms.map(f => f.id);
    if (formId && !pending.forms.some(f => f.id === formId)) {
      json(res, 404, { error: 'question inconnue' });
      return;
    }
    const out = await cancelPendingForms(sessionId, ids, message);
    if (!out.ok) { json(res, 502, { error: 'cancel_failed', message: out.error }); return; }
    logEvent(sessionId, 'note', 'question annulée depuis la carte');
    json(res, 200, { ok: true, cancelled: out.cancelled });
    return;
  }
  if (path === '/api/fleet/done' && req.method === 'POST') {
    const body = await readBody(req);
    const sessionId = String(body.sessionId ?? '');
    const note = String(body.note ?? '');
    const force = body.force === true;
    if (!sessionId) { json(res, 400, { error: 'sessionId requis' }); return; }
    const pending = await pendingFor(sessionId);
    const hasPending = pending.forms.length > 0 || pending.permissions > 0;
    if (hasPending && !force) {
      const text = pending.forms[0]?.text ?? 'Une permission attend ta réponse.';
      json(res, 409, {
        error: 'waiting_human',
        kind: pending.forms.length ? 'question' : 'permission',
        question: text,
        canForce: true,
      });
      return;
    }
    if (pending.forms.length) {
      await cancelPendingForms(sessionId, pending.forms.map(f => f.id), 'La tâche est fermée depuis le Superviseur : la question est abandonnée.').catch(() => undefined);
    }
    // Fermer = retirer du Superviseur. PAS d'archivage : une activité future dans
    // OpenChamber (nouveau prompt) remet la carte dans la flotte (ouverture à la volée).
    upsertTaskState(sessionId, { closedAt: Date.now(), closure: 'terminé' });
    logEvent(sessionId, 'done', note ? 'fermé : ' + note.slice(0, 80) : pending.forms.length ? 'fermé en abandonnant la question' : pending.permissions ? 'fermé en abandonnant une permission' : 'fermé du Superviseur');
    // Geste OpenChamber best-effort (lu + In work retiré) : la fermeture est
    // déjà effective en base, un échec ne fait qu'ajouter une ligne au journal.
    await markTaskSessionRead(sessionId);
    json(res, 200, { ok: true });
    return;
  }
  if (path === '/api/search' && req.method === 'GET') {
    // recherche des conversations : titres (catalogue) + messages (index OpenChamber)
    const answer = await searchConversations(url.searchParams.get('q') ?? '');
    json(res, 200, { ...answer, query: url.searchParams.get('q') ?? '' });
    return;
  }
  if (path === '/api/fleet/restore' && req.method === 'POST') {
    // remettre dans le tableau une carte fermée en « Terminé »
    const body = await readBody(req);
    const sessionId = String(body.sessionId ?? '').trim();
    if (!sessionId) { json(res, 400, { error: 'sessionId requis' }); return; }
    const restored = restoreConversation(sessionId);
    if (!restored.ok) {
      json(res, 404, {
        error: restored.error ?? 'restore_failed',
        message: 'la conversation n’existe plus dans OpenChamber',
      });
      return;
    }
    logEvent('supervisor', 'note', `carte restaurée depuis la recherche : ${sessionId.slice(-6)}`);
    json(res, 200, { ok: true, sessionId });
    return;
  }
  if (path === '/api/fleet/stream' && req.method === 'GET') {
    // SSE : pousse la flotte enrichie, identique à GET /api/fleet (pas de cartes fermées)
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const send = () => { try { res.write(`data: ${JSON.stringify(enrichedFleet())}\n\n`); } catch { /* client parti */ } };
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
      // anti-traversée : ui/dist et son contenu uniquement
      if (file !== uiDir && !file.startsWith(uiDir + sep)) { res.writeHead(403).end(); return; }
      const body = await readFile(file);
      const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 (UI non buildée ? lancer : bun run build:ui)');
    }
  }).listen(PORT, '127.0.0.1', () => console.log(`[superviseur] UI + daemon sur http://127.0.0.1:${PORT}/fleet`));
}
