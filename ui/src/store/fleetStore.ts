import { create } from 'zustand';
import type { Fleet, FleetRow } from '../types';
import { updatePlacements, type Placement } from '../lib/placement';

interface FleetState {
  fleet: Fleet | null;
  error: string | null;
  /** placement stable des cartes (hystérésis EN COURS ↔ TERMINÉ) */
  placements: Record<string, Placement>;
  /** sessions fermées localement : id → horodatage de fermeture */
  closed: Record<string, number>;
  /** brouillons du composer, conservés même si la carte change de section */
  drafts: Record<string, string>;
  /** composer qui tient le focus : restauré quand React démonte/remonte la carte */
  focused: string | null;
  setFleet: (fleet: Fleet) => void;
  setError: (error: string | null) => void;
  closeSession: (id: string, at?: number) => void;
  setDraft: (id: string, text: string) => void;
  clearDraft: (id: string) => void;
  setFocus: (id: string | null) => void;
}

export const useFleetStore = create<FleetState>((set) => ({
  fleet: null,
  error: null,
  placements: {},
  closed: {},
  drafts: {},
  focused: null,
  setFleet: (fleet) =>
    set((s) => {
      // un GET /api/fleet plus ancien peut arriver après un frame SSE plus récent :
      // ne jamais écraser la flotte par un snapshot d'horodatage inférieur
      if (s.fleet && fleet.at < s.fleet.at) return s;
      return {
        fleet,
        placements: updatePlacements(s.placements, fleet.rows, Date.now()),
      };
    }),
  setError: (error) => set({ error }),
  closeSession: (id, at = Date.now()) =>
    set((s) => ({ closed: { ...s.closed, [id]: at } })),
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
