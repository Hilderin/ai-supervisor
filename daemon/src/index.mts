/**
 * Filaire d'entrée du Superviseur.
 * 1. trouve le port d'OpenChamber, 2. start le polling, 3. start le serveur (UI + /api/fleet).
 */
import { discoverOpenChamberPort } from './discover.mts';
import { setBase, startPolling, pollOnce, baseOk, currentFleet } from './fleet.mts';
import { setBase as setCompanionBase } from './companion.mts';
import { setBase as setDeliveryBase } from './delivery.mts';
import { setBase as setPlanBase } from './plan.mts';
import { setActivityBase } from './activity.mts';
import { setVerifierBase } from './verifier.mts';
import { startIndexing } from './message-index.mts';
import { ensureSupervisorSession, ensureSupervisorWorkspace, setBase as setSupervisorBase } from './supervisor.mts';
import { setBase as setModelsBase } from './models.mts';
import { setBase as setTaskModelBase } from './task-model.mts';
import { startServer } from './server.mts';
import { db } from './state.mts';

async function main() {
  const port = await discoverOpenChamberPort();
  const base = `http://127.0.0.1:${port}`;
  setBase(base); setCompanionBase(base); setDeliveryBase(base); setPlanBase(base); setSupervisorBase(base); setVerifierBase(base); setActivityBase(base); setModelsBase(base); setTaskModelBase(base);
  ensureSupervisorWorkspace();
  console.log(`[superviseur] OpenChamber découvert sur 127.0.0.1:${port}`);
  try {
    const sup = await ensureSupervisorSession();
    console.log(`[superviseur] chat de supervision prêt (${sup.id})`);
  } catch (e) {
    console.warn(`[superviseur] chat de supervision indisponible au démarrage : ${String(e)}`);
  }
  startPolling();
  // premier contact avant de servir : si l'instance est morte, on démarre quand même
  // (pollOnce garde une flotte vide, la reconnexion est automatique au prochain tick)
  await pollOnce();
  console.log(`[superviseur] flotte initialisée : ${baseOk() ? 'OK' : 'instance injoignable (réessai auto)'} — db SQLite ouverte`);
  // index local des messages : backfill des tâches vivantes, puis fenêtre
  // glissante à chaque événement message.* (recherche pleine couverture)
  startIndexing(fleetRows);
  startServer();
}

function fleetRows(): Array<{ id: string }> {
  try { return currentFleet().rows.map(r => ({ id: r.id })).filter(r => r.id.startsWith('ses_')); } catch { return []; }
}

process.on('SIGINT', () => { try { db.close(); } finally { process.exit(0); } });
main().catch(e => { console.error('[superviseur] fatal :', e); process.exit(1); });
