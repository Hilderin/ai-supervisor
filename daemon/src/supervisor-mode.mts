/**
 * Mode du chat de supervision (Piloter / Investigation).
 *
 * Le mode N'EST PLUS préfixé au message du propriétaire (décision du
 * 2026-11-14) : il vit dans une instruction durable de la session OpenChamber
 * (`PUT /api/experimental/session/:id/instructions/entries/superviseur-mode`),
 * que le serveur rend au modèle comme message système au pas suivant. La
 * définition de l'agent rappelle où lire ce mode ; le message du propriétaire
 * part tel quel, sans préambule.
 *
 * Ce module est PUR (aucune base, aucun réseau) pour être testable seul : les
 * anciens encadrements y restent connus, le temps de dépouiller l'historique
 * déjà écrit dans les conversations existantes.
 */

/** Clé de l'instruction durable qui porte le mode (namespace `api/` côté serveur). */
export const MODE_INSTRUCTION_KEY = 'superviseur-mode';

export type SupervisorModeName = 'pilot' | 'investigation';

export interface ModeProject {
  name: string;
  directory: string;
}

/**
 * Texte de l'instruction de mode : le SEUL endroit où le mode actif est
 * annoncé au modèle. Court : il est redit à chaque changement, pas à chaque
 * message du propriétaire.
 */
export function modeInstruction(mode: SupervisorModeName, project: ModeProject | null): string {
  if (mode === 'investigation' && project) {
    return `Mode actif : Investigation, en lecture seule sur le projet « ${project.name} » (${project.directory}). `
      + 'Tu explores uniquement ce dossier avec les outils de lecture bornée, puis tu proposes un cadrage à valider. '
      + 'Aucune création de tâche, aucune écriture, aucune commande. '
      + 'Le propriétaire repasse en mode Piloter pour lancer.';
  }
  return 'Mode actif : Piloter. Tu cadres les intentions, tu lances et tu pilotes les tâches de la flotte '
    + "selon les règles de ta définition d'agent.";
}

/**
 * Ancien encadrement des instructions du propriétaire (retiré le 2026-11-12).
 * Conservé uniquement pour dépouiller l'historique déjà écrit.
 */
export const OWNER_WRAP =
  "Nouvelle instruction de l\u2019utilisateur : mets ton plan à jour au besoin ; "
  + "définis ou mets à jour tes critères d\u2019acceptation (criteria_add, criteria_to_validate : "
  + "le vérificateur du Superviseur juge tes preuves) ; "
  + "les réponses pour le propriétaire partent avec le tool `answer` (elles s\u2019affichent dans le Superviseur) :";

/**
 * Anciens préambules de mode (avant le 2026-11-14). Plus jamais envoyés : le
 * mode passe par l'instruction durable ci-dessus. Conservés pour dépouiller les
 * messages déjà encadrés dans l'historique.
 */
export const LEGACY_PILOT_WRAP = 'Mode Piloter : tu peux cadrer et lancer des tâches selon tes règles habituelles.';
export const LEGACY_INVESTIGATION_WRAP = 'Mode Investigation : lecture seule du projet sélectionné, sans création de tâche ni modification de fichier.';

/**
 * Dépouille les anciens encadrements (OWNER_WRAP, préambules de mode) des
 * messages déjà écrits dans l'historique : les conversations d'avant les
 * retraits restent affichées propres. Les nouveaux envois ne sont plus encadrés.
 */
export function stripOwnerWrap(text: string): string {
  let clean = String(text ?? '');
  // les préambules ont pu être écrits dans plusieurs ordres (OWNER_WRAP puis
  // mode, ou mode seul, ou investigation avec son projet) : on retire tout ce
  // qui reste en tête, plusieurs fois si nécessaire.
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const prefix of [OWNER_WRAP, LEGACY_PILOT_WRAP, LEGACY_INVESTIGATION_WRAP]) {
      if (!clean.startsWith(prefix)) continue;
      clean = clean.slice(prefix.length).replace(/^\s+/, '');
      stripped = true;
    }
  }
  clean = clean.replace(/^Projet sélectionné\s*:[^\n]*\n+/, '');
  return clean.trim();
}

/** Texte qui part réellement dans la session : le message du propriétaire, tel quel. */
export function outgoingSupervisorText(text: string): string {
  const clean = String(text ?? '').trim();
  return clean || 'Voir la pièce jointe.';
}
