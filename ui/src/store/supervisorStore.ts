import { create } from 'zustand';
import {
  abortSupervisor, cancelQueuedSupervisor, fetchSupervisor, newSupervisor,
  queueSupervisor, revertSupervisor, sendSupervisor, takeQueuedSupervisor, updateSupervisorMode,
} from '../lib/api';
import type { TakenQueueItem } from '../lib/api';
import type { ComposerAttachment } from '../lib/attachments';
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
  /** pièces jointes du brouillon : collées, déposées ou choisies */
  attachments: ComposerAttachment[];
  setDraft: (text: string) => void;
  setAttachments: (next: ComposerAttachment[]) => void;
  clearErrors: () => void;
  refresh: () => Promise<void>;
  send: (text: string, forcedAttachments?: ComposerAttachment[], opts?: { immediate?: boolean }) => Promise<void>;
  /** « Envoyer maintenant » : reprend l'item de la file et l'envoie tout de suite. */
  sendQueued: (itemId: string) => Promise<void>;
  /** « Modifier » : reprend l'item de la file et le rend au composer. */
  editQueued: (itemId: string) => Promise<void>;
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
  attachments: [],

  setDraft: (draft) => set({ draft }),

  setAttachments: (attachments) => set({ attachments }),

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

  send: async (text, forcedAttachments, opts) => {
    const value = text.trim();
    const attachments = forcedAttachments ?? get().attachments;
    if ((!value && !attachments.length) || get().modeUpdating) return;
    const label = value || 'Pièce jointe';
    const before = get().state;
    // une question du tool `question` attend une réponse : l'envoi la REMPLACE.
    // Le message part tout de suite (le daemon annule la question), jamais en
    // file : elle ne serait livrée qu'à la fin d'un tour bloqué sur la question.
    // « Envoyer maintenant » depuis la file force aussi le chemin immédiat.
    const waiting = (before?.pendingForms?.length ?? 0) > 0;
    // pendant un tour (ou juste après un envoi), le message part en file :
    // OpenChamber le livrera dès que la session redevient idle
    if (!opts?.immediate && (get().sending || (before?.status === 'busy' && !waiting))) {
      const temp = before
        ? {
            ...before,
            queued: [
              ...(before.queued ?? []),
              { id: `local-queue-${Date.now()}`, text: label, at: Date.now() },
            ],
          }
        : before;
      set({ state: temp, sendError: null, refreshError: null, draft: '', attachments: [] });
      try {
        const next = await queueSupervisor(value, attachments);
        set({ state: next, loading: false, sendError: null });
      } catch {
        set({
          state: before,
          sendError: 'Mise en file impossible. Le superviseur ne répond pas.',
          draft: value,
          attachments,
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
            { id: `local-${Date.now()}`, role: 'user' as const, at: Date.now(), text: label, tools: [] },
          ],
        }
      : before;
    set({ state: temp, sending: true, sendError: null, refreshError: null, draft: '', attachments: [] });
    try {
      const next = await sendSupervisor(value, attachments);
      set({ state: next, sending: false, loading: false, sendError: null });
    } catch {
      // le message n'est pas parti : on retire la bulle optimiste, on rend le
      // brouillon (et ses pièces jointes) avec une erreur locale que le poll
      // ne peut pas effacer
      set({
        state: before,
        sending: false,
        sendError: 'Envoi impossible. Le superviseur ne répond pas.',
        draft: value,
        attachments,
      });
    }
  },

  sendQueued: async (itemId) => {
    if (get().sending) return;
    let taken: TakenQueueItem;
    try {
      taken = await takeQueuedSupervisor(itemId);
    } catch {
      set({ sendError: 'Envoi du message en attente impossible. Le superviseur ne répond pas.' });
      return;
    }
    // la reprise OpenChamber a déjà retiré l'item de la file : on l'ôte de la
    // liste locale en attendant le prochain poll (état lu AU MOMENT du set :
    // un poll plus frais pendant l'attente ne doit pas être écrasé)
    const cur = get().state;
    set({
      state: cur ? { ...cur, queued: (cur.queued ?? []).filter((item) => item.id !== itemId) } : cur,
      sendError: null,
    });
    // envoi immédiat : le daemon livre en steer, et annule une question en
    // attente le cas échéant
    await get().send(taken.text, taken.attachments, { immediate: true });
  },

  editQueued: async (itemId) => {
    try {
      const taken = await takeQueuedSupervisor(itemId);
      // état lu AU MOMENT du set : un poll plus frais pendant l'attente ne
      // doit pas être écrasé par l'instantané d'avant l'attente
      const cur = get().state;
      set({
        draft: taken.text,
        attachments: taken.attachments,
        sendError: null,
        state: cur ? { ...cur, queued: (cur.queued ?? []).filter((item) => item.id !== itemId) } : cur,
      });
    } catch {
      set({ sendError: 'Reprise du message impossible. Le superviseur ne répond pas.' });
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
      attachments: [],
      state: before ? { ...before, sessionId: null, messages: [], queued: [], pendingForms: [], status: 'idle', error: undefined } : before,
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
