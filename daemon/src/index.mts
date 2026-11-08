/**
 * Filaire d'entrée du Superviseur.
 * 1. trouve le port d'OpenChamber, 2. start le polling, 3. start le serveur (UI + /api/fleet).
 */
import { discoverOpenChamberPort } from './discover.mts';
import { setBase, startPolling, pollOnce, baseOk } from './fleet.mts';
import { setBase as setCompanionBase } from './companion.mts';
import { setBase as setDeliveryBase } from './delivery.mts';
import { setBase as setPlanBase } from './plan.mts';
import { setVerifierBase } from './verifier.mts';
import { ensureSupervisorSession, ensureSupervisorWorkspace, setBase as setSupervisorBase } from './supervisor.mts';
import { startServer } from './server.mts';
import { db } from './state.mts';

async function main() {
  const port = await discoverOpenChamberPort();
  const base = `http://127.0.0.1:${port}`;
  setBase(base); setCompanionBase(base); setDeliveryBase(base); setPlanBase(base); setSupervisorBase(base); setVerifierBase(base);
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
  startServer();
}

process.on('SIGINT', () => { try { db.close(); } finally { process.exit(0); } });
main().catch(e => { console.error('[superviseur] fatal :', e); process.exit(1); });
