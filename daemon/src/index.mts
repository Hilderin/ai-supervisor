/**
 * Filaire d'entrée du Superviseur.
 * 1. trouve le port d'OpenChamber, 2. start le polling, 3. start le serveur (UI + /api/fleet).
 */
import { discoverOpenChamberPort } from './discover.mts';
import { setBase, startPolling, pollOnce, baseOk } from './fleet.mts';
import { setBase as setCompanionBase } from './companion.mts';
import { setBase as setDeliveryBase } from './delivery.mts';
import { startServer } from './server.mts';
import { db } from './state.mts';

async function main() {
  const port = await discoverOpenChamberPort();
  const base = `http://127.0.0.1:${port}`;
  setBase(base); setCompanionBase(base); setDeliveryBase(base);
  console.log(`[superviseur] OpenChamber découvert sur 127.0.0.1:${port}`);
  startPolling();
  // premier contact avant de servir : si l'instance est morte, on démarre quand même
  // (pollOnce garde une flotte vide, la reconnexion est automatique au prochain tick)
  await pollOnce();
  console.log(`[superviseur] flotte initialisée : ${baseOk() ? 'OK' : 'instance injoignable (réessai auto)'} — db SQLite ouverte`);
  startServer();
}

process.on('SIGINT', () => { try { db.close(); } finally { process.exit(0); } });
main().catch(e => { console.error('[superviseur] fatal :', e); process.exit(1); });
