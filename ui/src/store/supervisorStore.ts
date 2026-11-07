import { create } from 'zustand';
import { abortSupervisor, fetchSupervisor, newSupervisor, sendSupervisor } from '../lib/api';
import type { SupervisorState } from '../types';

interface SupervisorStore {
  state: SupervisorState | null;
  loading: boolean;
  refreshing: boolean;
  sending: boolean;
  /** création d'une nouvelle session : ce n'est pas un tour LLM */
  creating: boolean;
  /** erreur d'un envoi : ne doit pas être effacée par le poll suivant */
  sendError: string | null;
  /** erreur du dernier poll */
  refreshError: string | null;
  draft: string;
  setDraft: (text: string) => void;
  clearErrors: () => void;
  refresh: () => Promise<void>;
  send: (text: string) => Promise<void>;
  newConversation: () => Promise<void>;
  stop: () => Promise<void>;
}

export const useSupervisorStore = create<SupervisorStore>((set, get) => ({
  state: null,
  loading: true,
  refreshing: false,
  sending: false,
  creating: false,
  sendError: null,
  refreshError: null,
  draft: '',

  setDraft: (draft) => set({ draft }),

  clearErrors: () => set({ sendError: null, refreshError: null }),

  refresh: async () => {
    if (get().refreshing || get().sending || get().creating) return;
    set({ refreshing: true });
    try {
      const state = await fetchSupervisor();
      // un refresh parti avant l'envoi ne doit pas écraser le message
      // optimiste ni la réponse qui vient d'arriver, ni la nouvelle session
      if (get().sending || get().creating) return;
      set({ state, refreshError: state.error ?? null, loading: false });
    } catch {
      set({ refreshError: 'Superviseur injoignable. Vérifie que le daemon tourne, puis réessaie.', loading: false });
    } finally {
      set({ refreshing: false });
    }
  },

  send: async (text) => {
    const value = text.trim();
    if (!value || get().sending) return;
    const before = get().state;
    const temp = before
      ? {
          ...before,
          status: 'busy' as const,
          messages: [
            ...before.messages,
            { id: `local-${Date.now()}`, role: 'user' as const, at: Date.now(), text: value, tools: [] },
          ],
        }
      : before;
    set({ state: temp, sending: true, sendError: null, refreshError: null, draft: '' });
    try {
      const next = await sendSupervisor(value);
      set({ state: next, sending: false, loading: false, sendError: null });
    } catch {
      // le message n'est pas parti : on retire la bulle optimiste, on rend le
      // brouillon et on garde une erreur locale que le poll ne peut pas effacer
      set({ state: before, sending: false, sendError: 'Envoi impossible. Le superviseur ne répond pas.', draft: value });
    }
  },

  newConversation: async () => {
    if (get().sending || get().creating) return;
    const before = get().state;
    // retour immédiat à l'écran vide : la création OpenChamber peut prendre
    // une seconde ou deux, ce n'est pas un tour LLM et ça ne doit pas bloquer
    set({
      creating: true,
      sendError: null,
      refreshError: null,
      draft: '',
      state: before ? { ...before, sessionId: null, messages: [], status: 'idle', error: undefined } : before,
    });
    try {
      const next = await newSupervisor();
      set({ state: next, creating: false, loading: false });
    } catch {
      set({ state: before, creating: false, sendError: 'Nouvelle conversation impossible. Le superviseur ne répond pas.' });
    }
  },

  stop: async () => {
    try {
      await abortSupervisor();
    } catch {
      set({ refreshError: 'Arrêt impossible. Le superviseur ne répond pas.' });
    }
    await get().refresh();
  },
}));
