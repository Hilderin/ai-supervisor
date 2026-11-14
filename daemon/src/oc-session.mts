/**
 * Gestes OpenChamber autour d'une conversation : marquer lue, retirer « In work ».
 *
 * `markSessionRead` fait les deux premiers appels (état « lu » durable d'OpenCode
 * et badge/attention d'OpenChamber) ; `markTaskSessionRead` ajoute le retrait du
 * « In work » à la fermeture d'une tâche. Le chat de supervision utilise
 * `markSessionRead` à la fin de son tour (le mode lecture ne doit pas toucher au
 * marqueur « In work », qu'il garde à null).
 *
 * 1. OpenCode (proxifié par OpenChamber) : POST /api/session/:id/view avec
 *    { idle: <time.idle courant> } : « Mark the idle transition observed by the
 *    viewer as viewed », pose time.viewed (l'état « lu » durable d'OpenCode).
 *    Sauté quand la session n'a pas de time.idle (aucun tour terminé : rien
 *    n'est non lu). Sauté si la lecture de time.idle échoue.
 * 2. OpenChamber : POST /api/sessions/:id/view : réinitialise le badge de
 *    notification natif, et (versions récentes) lève l'attention de session
 *    diffusée sur le flux SSE.
 * 3. OpenChamber : POST /api/openchamber/sessions/:id/metadata avec le patch
 *    { openchamber: { work: { state: 'done', doneAt, suggestDoneAt: null } } } :
 *    le même geste que le bouton « Done » de l'UI OpenChamber.
 *
 * Détails des endpoints et preuves dans le code OpenChamber et OpenCode :
 * docs/analyses/mvp1/fermeture-lu-in-work.md
 */
import { logEvent } from './state.mts';

let base = '';
export function setBase(b: string) {
  base = b.endsWith('/') ? b.slice(0, -1) : b;
}

const TIMEOUT_MS = 5000;

async function ocFetch(path: string, init?: RequestInit): Promise<{ ok: boolean; detail: string; body?: string }> {
  if (!base) return { ok: false, detail: 'OpenChamber pas encore câblé (setBase)' };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, { ...init, signal: ctl.signal });
    if (!res.ok) {
      let more = '';
      try { more = ` (${(await res.text()).slice(0, 160)})`; } catch { /* corps illisible */ }
      return { ok: false, detail: `${path} → ${res.status}${more}` };
    }
    const text = await res.text().catch(() => '');
    return { ok: true, detail: path, body: text };
  } catch (e) {
    return { ok: false, detail: `${path} : ${String(e).slice(0, 160)}` };
  } finally { clearTimeout(t); }
}

/**
 * Marque une session comme lue dans OpenChamber : l'état « lu » durable
 * d'OpenCode (time.viewed sur la transition idle observée) puis le badge natif
 * et l'attention de session. Best-effort, journalisé sous `logId`.
 *
 * Utilisé par la fermeture d'une tâche ET par le chat de supervision quand son
 * tour se termine (le propriétaire n'a plus à marquer lire lui-même).
 */
export async function markSessionRead(sessionId: string, logId = sessionId): Promise<boolean> {
  // 1. état « lu » durable d'OpenCode : time.viewed = transition idle observée
  let read = false;
  const idleRef = await ocFetch(`/api/session/${sessionId}`);
  let idle: number | undefined;
  if (idleRef.ok) {
    try {
      const data = JSON.parse(idleRef.body ?? '{}') as { data?: { time?: { idle?: number } } };
      idle = data.data?.time?.idle;
    } catch { /* réponse illisible : on saute le marquage OpenCode */ }
    if (idle === undefined) {
      logEvent(logId, 'note', 'OpenChamber : rien à marquer lu (aucun tour terminé)');
      read = true;
    } else {
      const view = await ocFetch(`/api/session/${sessionId}/view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idle }),
      });
      if (view.ok) {
        read = true;
        logEvent(logId, 'note', 'OpenChamber : conversation marquée lue (time.viewed)');
      } else {
        logEvent(logId, 'note', `échec best-effort OpenChamber : marquage lu : ${view.detail}`);
        console.warn(`[superviseur] ${sessionId} : échec marquage lu : ${view.detail}`);
      }
    }
  } else {
    logEvent(logId, 'note', `échec best-effort OpenChamber : lecture de la session : ${idleRef.detail}`);
    console.warn(`[superviseur] ${sessionId} : échec lecture session : ${idleRef.detail}`);
  }

  // 2. badge natif + attention de session (OpenChamber)
  const attention = await ocFetch(`/api/sessions/${sessionId}/view`, { method: 'POST' });
  if (!attention.ok) {
    logEvent(logId, 'note', `échec best-effort OpenChamber : badge/attention : ${attention.detail}`);
    console.warn(`[superviseur] ${sessionId} : échec badge/attention : ${attention.detail}`);
  }
  return read;
}

/**
 * Marque la session lue dans OpenChamber et retire son « In work ». Ne lève
 * jamais : la fermeture d'une tâche ne doit pas échouer parce qu'OpenChamber
 * est injoignable ou ne connaît pas la session. Journalise le résultat
 * (succès ou détail de l'échec) dans le journal de la tâche.
 */
export async function markTaskSessionRead(sessionId: string): Promise<{ read: boolean; workDone: boolean }> {
  const read = await markSessionRead(sessionId);

  // 3. retrait du « In work » (le même patch que le « Done » de l'UI)
  const work = await ocFetch(`/api/openchamber/sessions/${sessionId}/metadata`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patch: { openchamber: { work: { state: 'done', doneAt: Date.now(), suggestDoneAt: null } } } }),
  });
  if (work.ok) {
    logEvent(sessionId, 'note', 'OpenChamber : In work retiré');
  } else {
    logEvent(sessionId, 'note', `échec best-effort OpenChamber : retrait In work : ${work.detail}`);
    console.warn(`[superviseur] ${sessionId} : échec retrait In work : ${work.detail}`);
  }
  return { read, workDone: work.ok };
}
