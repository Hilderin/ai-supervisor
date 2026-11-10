/**
 * Bascule de supervision d'une conversation existante (supervision opt-in,
 * docs/analyses/mvp1/supervision-bascule.md). Point unique de la logique :
 * l'endpoint daemon et les tests passent par ici.
 *
 * - activer : le choix est persisté en BD et un kick de cadrage est poussé,
 *   le compagnon tourne au prochain tick (effet immédiat, sans redémarrage) ;
 * - désactiver : les sous-agents existants sont détachés (archivage doux,
 *   historique conservé dans OpenChamber), la conversation elle-même et son
 *   historique ne bougent jamais.
 */
import { isSupervised, setSupervision, logEvent } from './state.mts';
import { wrapOwnerPrompt } from './supervisor.mts';
import { detachCompanion } from './companion.mts';
import { detachVerifier } from './verifier.mts';
import { kick } from './kicks.mts';

export interface SupervisionResult {
  ok: boolean;
  sessionId: string;
  supervised: boolean;
}

export async function applySupervisionToggle(sessionId: string, supervised: boolean): Promise<SupervisionResult> {
  setSupervision(sessionId, supervised);
  if (supervised) {
    // le kick « start » donne un cadrage immédiat au prochain tick compagnon
    kick(sessionId, 'start');
    logEvent(sessionId, 'note', 'supervision activée');
  } else {
    await Promise.allSettled([detachCompanion(sessionId), detachVerifier(sessionId)]);
    logEvent(sessionId, 'note', 'supervision désactivée');
  }
  return { ok: true, sessionId, supervised };
}

/**
 * Le texte du propriétaire part habillé (mise à jour du plan, critères, tool
 * answer) seulement si la conversation est supervisée : une conversation non
 * supervisée reçoit son texte TEL QUEL, sans encadrement du superviseur.
 * Appliqué à l'envoi depuis le panel de détail (/api/fleet/send) ; le chat de
 * supervision n'écrit que dans des tâches supervisées, il n'est pas concerné.
 */
export function ownerPromptFor(sessionId: string, text: string): string {
  return isSupervised(sessionId) ? wrapOwnerPrompt(text) : text;
}
