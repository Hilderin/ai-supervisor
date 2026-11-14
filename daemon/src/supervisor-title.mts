/**
 * Nom des conversations du chat de supervision (2026-11-14).
 *
 * Toutes les conversations s'appelaient « Superviseur » : impossible de s'y
 * retrouver dans OpenChamber une fois plusieurs conversations créées par le
 * bouton « Nouvelle conversation ». Le nom porte maintenant la date et l'heure
 * de création, en heure locale : « Superviseur 2026-11-14 14:32 ».
 *
 * Deux fonctions pures (aucune base, aucun réseau) : le format et la détection
 * du nom générique, pour renommer une conversation existante sans toucher à un
 * nom que le propriétaire aurait choisi lui-même.
 */

const pad = (n: number): string => String(n).padStart(2, '0');

/** « Superviseur 2026-11-14 14:32 » (heure locale, minute près). */
export function supervisorTitle(at: number = Date.now()): string {
  const d = new Date(at);
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `Superviseur ${day} ${time}`;
}

/**
 * Nom générique d'avant le 2026-11-14 ('Superviseur', éventuellement suffixé par
 * OpenChamber) : seul cas où le daemon se permet de renommer une conversation.
 */
export function isGenericSupervisorTitle(title: string | undefined | null): boolean {
  const value = String(title ?? '').trim();
  return /^superviseur(\s*\(\d+\))?$/i.test(value);
}
