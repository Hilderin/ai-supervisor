import type { FleetRow } from '../types';

/** Ordre d'affichage stable, porté par l'UI : un rang par session, jamais par état. */
export interface OrderState {
  order: Record<string, number>;
  nextRank: number;
  /** dernière frame où la session a été vue, pour tolérer une disparition brève */
  seenAt: Record<string, number>;
}

export const ORDER_STORAGE_KEY = 'superviseur.fleet.order.v1';
/** Une session absente moins de 2 min retrouve son rang (incident SSE, pas fermeture). */
export const ORDER_GRACE_MS = 2 * 60_000;
/** Une session absente depuis 1 h est oubliée, pour ne pas faire grossir le stockage. */
export const ORDER_PRUNE_MS = 60 * 60_000;
export const ORDER_MAX = 500;

export function emptyOrder(): OrderState {
  return { order: {}, nextRank: 1, seenAt: {} };
}

/**
 * Attribue un rang aux nouvelles sessions, conserve celui des sessions connues.
 * L'ordre d'entrée (tri du daemon) ne sert qu'à départager les nouvelles : après
 * le premier passage, un changement d'état ne peut plus déplacer une carte.
 */
export function assignOrder(
  previous: OrderState,
  rows: Array<Pick<FleetRow, 'id'>>,
  now: number,
): { state: OrderState; changed: boolean } {
  const order = { ...previous.order };
  const seenAt = { ...previous.seenAt };
  let nextRank = previous.nextRank;
  let changed = false;
  const present = new Set(rows.map((row) => row.id));

  for (const row of rows) {
    const id = row.id;
    const rank = order[id];
    const lastSeen = seenAt[id];
    const keep = rank !== undefined && (lastSeen === undefined || now - lastSeen <= ORDER_GRACE_MS);
    if (!keep) {
      order[id] = nextRank;
      nextRank += 1;
      changed = true;
    }
    seenAt[id] = now;
  }

  // Oublie les sessions absentes depuis longtemps (fermées, archivées, supprimées).
  for (const id of Object.keys(order)) {
    if (present.has(id)) continue;
    const lastSeen = seenAt[id] ?? 0;
    if (now - lastSeen > ORDER_PRUNE_MS) {
      delete order[id];
      delete seenAt[id];
      changed = true;
    }
  }

  // Garde-fou de taille : purge les plus anciennes absentes.
  if (Object.keys(order).length > ORDER_MAX) {
    const absent = Object.keys(order)
      .filter((id) => !present.has(id))
      .sort((a, b) => (seenAt[a] ?? 0) - (seenAt[b] ?? 0));
    for (const id of absent) {
      if (Object.keys(order).length <= ORDER_MAX) break;
      delete order[id];
      delete seenAt[id];
      changed = true;
    }
  }

  return { state: { order, nextRank, seenAt }, changed };
}

/** Tri stable par rang ; l'ordre d'entrée départage les rangs manquants. */
export function sortByOrder<T extends { id: string }>(
  rows: T[],
  order: Record<string, number>,
): T[] {
  return rows
    .map((row, index) => ({
      row,
      index,
      rank: order[row.id] ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ row }) => row);
}

export function loadOrder(): { order: Record<string, number>; nextRank: number } {
  if (typeof window === 'undefined') return { order: {}, nextRank: 1 };
  try {
    const raw = window.localStorage.getItem(ORDER_STORAGE_KEY);
    if (!raw) return { order: {}, nextRank: 1 };
    const parsed = JSON.parse(raw) as { order?: unknown; nextRank?: unknown };
    const order: Record<string, number> = {};
    if (parsed.order && typeof parsed.order === 'object') {
      for (const [id, value] of Object.entries(parsed.order as Record<string, unknown>)) {
        if (typeof value === 'number' && Number.isFinite(value)) order[id] = value;
      }
    }
    const max = Math.max(0, ...Object.values(order));
    const persistedNext = typeof parsed.nextRank === 'number' && Number.isFinite(parsed.nextRank)
      ? parsed.nextRank
      : 0;
    return { order, nextRank: Math.max(persistedNext, max + 1, 1) };
  } catch {
    return { order: {}, nextRank: 1 };
  }
}

export function saveOrder(order: Record<string, number>, nextRank: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify({ order, nextRank }));
  } catch {
    /* stockage plein ou désactivé : l'ordre reste en mémoire */
  }
}
