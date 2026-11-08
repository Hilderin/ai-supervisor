/**
 * Sélection du panneau de détail quand la tâche sélectionnée quitte la liste
 * affichée : le panneau glisse vers sa voisine au lieu de se fermer, ce qui
 * évite de recliquer et de voir la mise en page bouger.
 *
 * La candidate est la tâche immédiatement AU-DESSUS dans l'ordre affiché
 * (index plus petit) ; à défaut seulement, celle juste en dessous. Seules les
 * tâches de la liste visible sont retenues : jamais une carte masquée par un
 * filtre ou repliée.
 */
export function neighborSelection(
  previous: readonly string[],
  removed: string,
  visible: ReadonlySet<string>,
): string | null {
  const index = previous.indexOf(removed);
  if (index === -1) return null;
  for (let i = index - 1; i >= 0; i -= 1) {
    const id = previous[i];
    if (visible.has(id)) return id;
  }
  for (let i = index + 1; i < previous.length; i += 1) {
    const id = previous[i];
    if (visible.has(id)) return id;
  }
  return null;
}

/**
 * Nouvelle sélection après un changement de la liste affichée.
 * Sans sélection courante, rien ne s'ouvre (pas de sélection automatique au
 * démarrage). Une sélection encore visible est conservée telle quelle.
 */
export function selectionAfterChange(
  current: string | null,
  previous: readonly string[],
  visible: readonly string[],
): string | null {
  if (!current) return null;
  const ids = new Set(visible);
  if (ids.has(current)) return current;
  return neighborSelection(previous, current, ids);
}
