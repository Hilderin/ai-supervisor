import { create } from 'zustand';
import type { Fleet, FleetRow } from '../types';
import { assignOrder, loadOrder, saveOrder, type OrderState } from '../lib/order';
import { updatePlacements, type Placement } from '../lib/placement';

const initialOrder = loadOrder();
// Les rangs persistés sont considérés comme vus au chargement : une première
// frame vide (daemon pas encore prêt) ne doit pas les purger.
const initialSeenAt = Object.fromEntries(
  Object.keys(initialOrder.order).map((id) => [id, Date.now()]),
);

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
  /** composer qui tient le focus : restauré quand React démonte/remonte la carte */
  focused: string | null;
  setFleet: (fleet: Fleet) => void;
  setError: (error: string | null) => void;
  setSelected: (id: string | null) => void;
  closeSession: (id: string, at?: number) => void;
  setDraft: (id: string, text: string) => void;
  clearDraft: (id: string) => void;
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
  selected: null,
  closed: {},
  drafts: {},
  focused: null,
  setFleet: (fleet) =>
    set((s) => {
      // un GET /api/fleet plus ancien peut arriver après un frame SSE plus récent :
      // ne jamais écraser la flotte par un snapshot d'horodatage inférieur
      if (s.fleet && fleet.at < s.fleet.at) return s;
      const now = Date.now();
      const visible = fleet.rows.filter((row) => !isClosedRow(row, s.closed));
      if (!s.orderHydrated && visible.length === 0) {
        // Avant le premier snapshot utile, une frame vide ne doit pas toucher
        // aux rangs persistés (le daemon peut répondre avant d'avoir lu la flotte).
        return {
          fleet,
          placements: updatePlacements(s.placements, fleet.rows, now),
          order: s.order,
          nextRank: s.nextRank,
          seenAt: s.seenAt,
          orderHydrated: false,
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
      return {
        fleet,
        placements: updatePlacements(s.placements, fleet.rows, now),
        order: assigned.state.order,
        nextRank: assigned.state.nextRank,
        seenAt: assigned.state.seenAt,
        orderHydrated: s.orderHydrated || visible.length > 0,
      };
    }),
  setError: (error) => set({ error }),
  setSelected: (id) =>
    set((s) => (s.selected === id ? s : { selected: id })),
  closeSession: (id, at = Date.now()) =>
    set((s) => {
      // une session fermée puis rouverte repart en bas : on oublie son rang.
      const order = { ...s.order };
      const seenAt = { ...s.seenAt };
      delete order[id];
      delete seenAt[id];
      saveOrder(order, s.nextRank);
      return { closed: { ...s.closed, [id]: at }, order, seenAt };
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
