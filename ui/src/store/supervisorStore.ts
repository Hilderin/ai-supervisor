import { create } from 'zustand';
import {
  abortSupervisor, cancelQueuedSupervisor, fetchSupervisor, newSupervisor,
  queueSupervisor, revertSupervisor, sendSupervisor, updateSupervisorMode,
} from '../lib/api';
import type { SupervisorState } from '../types';

interface SupervisorStore {
  state: SupervisorState | null;
  loading: boolean;
  refreshing: boolean;
  sending: boolean;
  /** création d'une nouvelle session : ce n'est pas un tour LLM */
  creating: boolean;
  /** revert en cours : les actions de message sont verrouillées */
  reverting: boolean;
  modeUpdating: boolean;
  /** erreur d'un envoi : ne doit pas être effacée par le poll suivant */
  sendError: string | null;
  /** erreur du dernier poll */
  refreshError: string | null;
  draft: string;
  setDraft: (text: string) => void;
  clearErrors: () => void;
  refresh: () => Promise<void>;
  send: (text: string) => Promise<void>;
  removeQueued: (itemId: string) => Promise<void>;
  revert: (messageId: string, restoreText?: string) => Promise<void>;
  newConversation: () => Promise<void>;
  stop: () => Promise<void>;
  setMode: (mode: 'pilot' | 'investigation', projectDirectory: string | null) => Promise<void>;
}

export const useSupervisorStore = create<SupervisorStore>((set, get) => ({
  state: null,
  loading: true,
  refreshing: false,
  sending: false,
  creating: false,
  reverting: false,
  modeUpdating: false,
  sendError: null,
  refreshError: null,
  draft: '',

  setDraft: (draft) => set({ draft }),

  clearErrors: () => set({ sendError: null, refreshError: null }),

  refresh: async () => {
    if (get().refreshing || get().sending || get().creating || get().reverting) return;
    set({ refreshing: true });
    try {
      const state = await fetchSupervisor();
      // un refresh parti avant l'envoi ne doit pas écraser le message
      // optimiste ni la réponse qui vient d'arriver, ni la nouvelle session
      if (get().sending || get().creating || get().reverting) return;
      set({ state, refreshError: state.error ?? null, loading: false });
    } catch {
      set({ refreshError: 'Superviseur injoignable. Vérifie que le daemon tourne, puis réessaie.', loading: false });
    } finally {
      set({ refreshing: false });
    }
  },

  send: async (text) => {
    const value = text.trim();
    if (!value || get().modeUpdating) return;
    const before = get().state;
    // pendant un tour (ou juste après un envoi), le message part en file :
    // OpenChamber le livrera dès que la session redevient idle
    if (get().sending || before?.status === 'busy') {
      const temp = before
        ? {
            ...before,
            queued: [
              ...(before.queued ?? []),
              { id: `local-queue-${Date.now()}`, text: value, at: Date.now() },
            ],
          }
        : before;
      set({ state: temp, sendError: null, refreshError: null, draft: '' });
      try {
        const next = await queueSupervisor(value);
        set({ state: next, loading: false, sendError: null });
      } catch {
        set({
          state: before,
          sendError: 'Mise en file impossible. Le superviseur ne répond pas.',
          draft: value,
        });
      }
      return;
    }
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

  removeQueued: async (itemId) => {
    const before = get().state;
    if (!before) return;
    set({
      state: { ...before, queued: (before.queued ?? []).filter((item) => item.id !== itemId) },
      sendError: null,
    });
    try {
      const next = await cancelQueuedSupervisor(itemId);
      set({ state: next, loading: false });
    } catch {
      set({ state: before, sendError: 'Retrait de la file impossible. Le superviseur ne répond pas.' });
    }
  },

  revert: async (messageId, restoreText) => {
    if (get().reverting) return;
    const before = get().state;
    set({ reverting: true, sendError: null, refreshError: null });
    try {
      const next = await revertSupervisor(messageId);
      set({
        state: next,
        reverting: false,
        loading: false,
        draft: restoreText ?? get().draft,
      });
    } catch {
      set({ state: before, reverting: false, sendError: 'Impossible de revenir à ce message.' });
    }
  },

  newConversation: async () => {
    if (get().sending || get().creating || get().reverting) return;
    const before = get().state;
    // retour immédiat à l'écran vide : la création OpenChamber peut prendre
    // une seconde ou deux, ce n'est pas un tour LLM et ça ne doit pas bloquer
    set({
      creating: true,
      sendError: null,
      refreshError: null,
      draft: '',
      state: before ? { ...before, sessionId: null, messages: [], queued: [], status: 'idle', error: undefined } : before,
    });
    try {
      const next = await newSupervisor();
      set({ state: next, creating: false, loading: false });
    } catch {
      set({ state: before, creating: false, sendError: 'Nettoyage impossible. Le superviseur ne répond pas.' });
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

  setMode: async (mode, projectDirectory) => {
    if (get().modeUpdating) return;
    set({ modeUpdating: true, sendError: null });
    try {
      const next = await updateSupervisorMode(mode, projectDirectory);
      const state = get().state;
      if (state) set({ state: { ...state, mode: next.mode, projectDirectory: next.projectDirectory } });
    } finally {
      set({ modeUpdating: false });
    }
  },
}));
