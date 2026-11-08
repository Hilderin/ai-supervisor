/**
 * Largeurs du panneau central (flotte) et du panneau de droite (détail).
 *
 * Le détail est le panneau souple : quand la fenêtre se rétrécit, il cède de la
 * largeur pour que le central garde celle que l'utilisateur lui a donnée. Une
 * fois son minimum atteint, seul le central continue de se réduire. Le détail
 * ne dépasse jamais 70 % de la fenêtre, ni la place réellement disponible.
 *
 * Le calcul est sans état : les largeurs voulues viennent des préférences
 * enregistrées (poignée ou clavier), la fenêtre ne fait que les contraindre.
 * Un redimensionnement de fenêtre n'écrase donc jamais une préférence.
 */

/** Largeur minimale utilisable du détail. */
export const MIN_INSPECTOR_WIDTH = 280;
/** Part maximale de la fenêtre occupée par le détail. */
export const MAX_INSPECTOR_RATIO = 0.7;

export interface PanelWidths {
  /** largeur affichée du détail */
  inspector: number;
  /** largeur affichée du panneau central */
  center: number;
}

/**
 * Plafond du détail : 70 % de la fenêtre, borné par la place disponible
 * (le central ne peut pas devenir négatif).
 */
export function inspectorMaxWidth(windowWidth: number, availableWidth: number): number {
  const ratioCap = Math.floor(Math.max(0, windowWidth) * MAX_INSPECTOR_RATIO);
  return Math.max(0, Math.min(ratioCap, Math.floor(Math.max(0, availableWidth))));
}

/** Largeur du détail posée par la poignée ou le clavier, bornée minimum/plafond. */
export function clampInspectorWidth(
  width: number,
  windowWidth: number,
  availableWidth: number,
): number {
  const max = inspectorMaxWidth(windowWidth, availableWidth);
  const min = Math.min(MIN_INSPECTOR_WIDTH, max);
  const value = Number.isFinite(width) ? Math.round(width) : min;
  return Math.max(min, Math.min(value, max));
}

/**
 * Répartition effective à partir des largeurs voulues.
 *
 * `availableWidth` est la place partagée par le central et le détail (fenêtre
 * moins le chat et les poignées). Le détail prend ce qu'il veut tant que le
 * central garde sa largeur voulue ; en dessous de son minimum, le central
 * cède le reste.
 */
export function panelWidths(input: {
  windowWidth: number;
  availableWidth: number;
  inspectorWanted: number;
  centerWanted: number;
}): PanelWidths {
  const available = Math.max(0, Math.floor(input.availableWidth));
  const max = inspectorMaxWidth(input.windowWidth, available);
  const min = Math.min(MIN_INSPECTOR_WIDTH, max);
  const wantedInspector = Math.round(input.inspectorWanted);
  const wantedCenter = Math.max(0, Math.round(input.centerWanted));
  // Ce que le détail peut prendre sans entamer la largeur voulue du central.
  const roomForInspector = available - wantedCenter;
  const inspector = Math.max(min, Math.min(Math.min(wantedInspector, roomForInspector), max));
  return { inspector, center: Math.max(0, available - inspector) };
}
