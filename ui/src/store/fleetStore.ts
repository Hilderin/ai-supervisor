import { create } from 'zustand';
import type { Fleet, FleetRow } from '../types';
import type { ComposerAttachment } from '../lib/attachments';
import { assignOrder, loadOrder, saveOrder, sortByOrder, type OrderState } from '../lib/order';
import { updatePlacements, type Placement } from '../lib/placement';
import { selectionAfterChange } from '../lib/selection';

const initialOrder = loadOrder();
// Les rangs persistés sont considérés comme vus au chargement : une première
// frame vide (daemon pas encore prêt) ne doit pas les purger.
const initialSeenAt = Object.fromEntries(
  Object.keys(initialOrder.order).map((id) => [id, Date.now()]),
);

/** Session dont le panneau de détail était ouvert à la dernière visite. */
export const SELECTED_STORAGE_KEY = 'superviseur.selected';

function loadSelected(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(SELECTED_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function saveSelected(id: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (id) window.localStorage.setItem(SELECTED_STORAGE_KEY, id);
    else window.localStorage.removeItem(SELECTED_STORAGE_KEY);
  } catch {
    /* stockage plein ou désactivé : l'ouverture reste en mémoire */
  }
}

/**
 * Liste réellement affichée par la flotte : mêmes fermetures écartées et même
 * tri que `FleetBoard`. Sert aussi à décider où glisse la sélection quand une
 * tâche disparaît, pour ne jamais retenir une carte que l'écran ne montre pas.
 */
export function visibleRows(
  fleet: Fleet | null,
  order: Record<string, number>,
  closed: Record<string, number>,
): FleetRow[] {
  return sortByOrder(
    (fleet?.rows ?? []).filter((row) => !isClosedRow(row, closed)),
    order,
  );
}

interface FleetState {
  fleet: Fleet | null;
  error: string | null;
  /** placement stable des cartes (hystérésis EN COURS ↔ TERMINÉ), pour la décoration */
  placements: Record<string, Placement>;
  /** ordre d'arrivée stable, indépendant de l'état */
  order: Record<string, number>;
  nextRank: number;
  /** dernière frame vue par session, pour tolérer une disparition brève */
  seenAt: Record<string, number>;
  /** le premier snapshot non vide a-t-il déjà réconcilié les rangs persistés ? */
  orderHydrated: boolean;
  /** tâche sélectionnée pour le panneau de détail à droite */
  selected: string | null;
  /** sessions fermées localement : id → horodatage de fermeture */
  closed: Record<string, number>;
  /** brouillons du composer, conservés même si la carte change de section */
  drafts: Record<string, string>;
  /** pièces jointes du brouillon, par session (même raison que les brouillons) */
  attachments: Record<string, ComposerAttachment[]>;
  /** composer qui tient le focus : restauré quand React démonte/remonte la carte */
  focused: string | null;
  setFleet: (fleet: Fleet) => void;
  setError: (error: string | null) => void;
  setSelected: (id: string | null) => void;
  closeSession: (id: string, at?: number) => void;
  setDraft: (id: string, text: string) => void;
  clearDraft: (id: string) => void;
  setAttachments: (id: string, next: ComposerAttachment[]) => void;
  setFocus: (id: string | null) => void;
}

export const useFleetStore = create<FleetState>((set) => ({
  fleet: null,
  error: null,
  placements: {},
  order: initialOrder.order,
  nextRank: initialOrder.nextRank,
  seenAt: initialSeenAt,
  orderHydrated: false,
  selected: loadSelected(),
  closed: {},
  drafts: {},
  attachments: {},
  focused: null,
  setFleet: (fleet) =>
    set((s) => {
      // un GET /api/fleet plus ancien peut arriver après un frame SSE plus récent :
      // ne jamais écraser la flotte par un snapshot d'horodatage inférieur
      if (s.fleet && fleet.at < s.fleet.at) return s;
      const now = Date.now();
      const visible = fleet.rows.filter((row) => !isClosedRow(row, s.closed));
      // liste affichée AVANT ce frame : elle donne la position qu'occupait la
      // tâche sélectionnée, donc sa voisine en cas de disparition
      const before = visibleRows(s.fleet, s.order, s.closed);
      const slide = (rows: FleetRow[]) =>
        selectionAfterChange(
          s.selected,
          before.map((row) => row.id),
          rows.map((row) => row.id),
        );
      if (!s.orderHydrated && visible.length === 0) {
        // Avant le premier snapshot utile, une frame vide ne doit pas toucher
        // aux rangs persistés (le daemon peut répondre avant d'avoir lu la flotte),
        // ni refermer la tâche dont le détail était ouvert à la dernière visite.
        return {
          fleet,
          placements: updatePlacements(s.placements, fleet.rows, now),
          order: s.order,
          nextRank: s.nextRank,
          seenAt: s.seenAt,
          orderHydrated: false,
          selected: s.selected,
        };
      }
      const firstMeaningful = !s.orderHydrated && visible.length > 0;
      let previous: OrderState = { order: s.order, nextRank: s.nextRank, seenAt: s.seenAt };
      if (firstMeaningful) {
        // Les rangs des sessions présentes sont conservés ; ceux des sessions
        // absentes au premier snapshot non vide sont périmés (rouvertes en bas).
        const present = new Set(visible.map((row) => row.id));
        const seenAt = { ...s.seenAt };
        for (const id of Object.keys(s.order)) seenAt[id] = present.has(id) ? now : 0;
        previous = { ...previous, seenAt };
      }
      const assigned = assignOrder(previous, visible, now);
      if (assigned.changed) saveOrder(assigned.state.order, assigned.state.nextRank);
      const selected = slide(visibleRows(fleet, assigned.state.order, s.closed));
      if (selected !== s.selected) saveSelected(selected);
      return {
        fleet,
        placements: updatePlacements(s.placements, fleet.rows, now),
        order: assigned.state.order,
        nextRank: assigned.state.nextRank,
        seenAt: assigned.state.seenAt,
        orderHydrated: s.orderHydrated || visible.length > 0,
        selected,
      };
    }),
  setError: (error) => set({ error }),
  setSelected: (id) =>
    set((s) => {
      if (s.selected === id) return s;
      saveSelected(id);
      return { selected: id };
    }),
  closeSession: (id, at = Date.now()) =>
    set((s) => {
      // même glissement que pour une disparition reçue du daemon : clôturer la
      // tâche sélectionnée ouvre sa voisine sans refermer le panneau
      const before = visibleRows(s.fleet, s.order, s.closed);
      // une session fermée puis rouverte repart en bas : on oublie son rang.
      const order = { ...s.order };
      const seenAt = { ...s.seenAt };
      delete order[id];
      delete seenAt[id];
      const closed = { ...s.closed, [id]: at };
      saveOrder(order, s.nextRank);
      const after = visibleRows(s.fleet, order, closed);
      const selected = selectionAfterChange(
        s.selected,
        before.map((row) => row.id),
        after.map((row) => row.id),
      );
      if (selected !== s.selected) saveSelected(selected);
      return { closed, order, seenAt, selected };
    }),
  setDraft: (id, text) =>
    set((s) => ({ drafts: { ...s.drafts, [id]: text } })),
  clearDraft: (id) =>
    set((s) => {
      if (!(id in s.drafts)) return s;
      const drafts = { ...s.drafts };
      delete drafts[id];
      return { drafts };
    }),
  setAttachments: (id, next) =>
    set((s) => {
      const attachments = { ...s.attachments };
      if (next.length) attachments[id] = next;
      else delete attachments[id];
      return { attachments };
    }),
  setFocus: (id) =>
    set((s) => {
      if (s.focused === id) return s;
      return { focused: id };
    }),
}));

/**
 * Une carte fermée reste cachée tant que la session n'a pas bougé depuis la fermeture.
 * Même règle que le daemon : une activité postérieure (nouveau prompt OpenChamber) rouvre.
 */
export function isClosedRow(row: FleetRow, closed: Record<string, number>): boolean {
  const at = closed[row.id];
  if (!at) return false;
  const last = Math.max(row.lastUpdateAt ?? 0, row.busy ?? 0);
  return last <= at;
}
