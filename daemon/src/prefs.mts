/**
 * Préférences du Superviseur : modèle et agent du chat, modèle des tâches.
 *
 * Une préférence est un choix EXPLICITE. Sans choix (NULL en base), les
 * défauts actuels restent en place : orchestrateur (nom fixe) pour le chat,
 * modèle par défaut d'OpenChamber pour tout le reste. Une valeur inconnue
 * n'est jamais conservée : elle est remplacée par le défaut et signalée par un
 * avertissement lisible, plutôt que de casser un envoi plus tard.
 * (Le modèle du compagnon a disparu avec les sous-agents, 2026-11-12.)
 */

import { getSupervisorPref, logEvent, setSupervisorPref } from './state.mts';
import {
  defaultModelRef, findAgent, findModel, loadCatalog, type AgentOption, type ModelOption,
} from './models.mts';

export type PrefField = 'chatModel' | 'chatAgent' | 'taskModel';

export interface SupervisorPrefs {
  chatModel: string | null;
  chatAgent: string | null;
  taskModel: string | null;
}

export interface ConfigWarning {
  field: PrefField;
  /** valeur refusée, telle qu'elle a été proposée */
  value: string;
  message: string;
}

export interface SupervisorConfig {
  prefs: SupervisorPrefs;
  defaults: {
    /** null = l'orchestrateur (nom fixe) du repo */
    chatAgent: null;
    chatAgentLabel: string;
    /** modèle par défaut d'OpenChamber, null si l'instance ne le donne pas */
    chatModel: string | null;
    taskModel: null;
    taskModelLabel: string;
  };
  models: ModelOption[];
  agents: AgentOption[];
  updatedAt: number | null;
  /** préférences enregistrées devenues invalides, pour les montrer à l'ouverture */
  warnings?: ConfigWarning[];
}

const FIELD_LABEL: Record<PrefField, string> = {
  chatModel: 'Modèle du chat',
  chatAgent: 'Agent du chat',
  taskModel: 'Modèle des tâches',
};

export function prefsFromRow(): SupervisorPrefs {
  const row = getSupervisorPref();
  return {
    chatModel: row.chat_model,
    chatAgent: row.chat_agent,
    taskModel: row.task_model,
  };
}

/** Avertissements déjà journalisés, par champ et valeur : pas un log par poll. */
const warned = new Set<string>();
function warnOnce(field: PrefField, value: string, message: string): void {
  const key = `${field}:${value}`;
  if (warned.has(key)) return;
  warned.add(key);
  logEvent('supervisor', 'note', message.slice(0, 190));
}

/**
 * Les préférences stockées, débarrassées des valeurs devenues invalides.
 * Chaque refus produit un avertissement lisible (montré à l'ouverture du
 * panneau) et un journal unique par champ et valeur : jamais un repli muet.
 */
async function validatedStored(): Promise<{ prefs: SupervisorPrefs; warnings: ConfigWarning[] }> {
  const raw = prefsFromRow();
  const warnings: ConfigWarning[] = [];
  const model = async (field: 'chatModel' | 'taskModel'): Promise<string | null> => {
    const value = raw[field];
    if (!value) return null;
    const found = await findModel(value);
    if (found) return found.ref;
    warnOnce(field, value, `${FIELD_LABEL[field]} « ${value} » introuvable : retour au défaut`);
    warnings.push({
      field,
      value,
      message: `${FIELD_LABEL[field]} « ${value} » introuvable : le défaut s'applique.`,
    });
    return null;
  };
  const agent = async (): Promise<string | null> => {
    const value = raw.chatAgent;
    if (!value) return null;
    const found = await findAgent(value);
    if (found) return found.id;
    warnOnce('chatAgent', value, `Agent du chat « ${value} » introuvable : retour à l'orchestrateur`);
    warnings.push({
      field: 'chatAgent',
      value,
      message: `Agent du chat « ${value} » introuvable : retour à l'orchestrateur.`,
    });
    return null;
  };
  return {
    prefs: {
      chatModel: await model('chatModel'),
      chatAgent: await agent(),
      taskModel: await model('taskModel'),
    },
    warnings,
  };
}

/** Agent choisi pour le chat, encore valide, ou null (orchestrateur). */
export async function chatAgentRef(): Promise<string | null> {
  return (await validatedStored()).prefs.chatAgent;
}

export async function chatModelRef(): Promise<string | null> {
  return (await validatedStored()).prefs.chatModel;
}

/** Modèle des tâches : null = laisser OpenChamber choisir, comme aujourd'hui. */
export async function taskModelRef(): Promise<string | null> {
  return (await validatedStored()).prefs.taskModel;
}

export async function getSupervisorConfig(): Promise<SupervisorConfig> {
  const [catalog, chatModel, stored] = await Promise.all([
    loadCatalog(),
    defaultModelRef(),
    validatedStored(),
  ]);
  return {
    prefs: stored.prefs,
    defaults: {
      chatAgent: null,
      chatAgentLabel: 'Orchestrateur (recommandé)',
      chatModel,
      taskModel: null,
      taskModelLabel: 'Défaut de la session',
    },
    models: catalog.models,
    agents: catalog.agents,
    updatedAt: getSupervisorPref().updated_at,
    ...(stored.warnings.length ? { warnings: stored.warnings } : {}),
  };
}

function readString(input: Record<string, unknown>, field: PrefField): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(input, field)) return undefined;
  const raw = input[field];
  if (raw === null) return null;
  return String(raw).trim() || null;
}

/**
 * Enregistre les préférences transmises, en ignorant proprement les valeurs
 * inconnues. Une valeur refusée retombe sur le défaut (null) et produit un
 * avertissement que l'UI affiche : jamais un succès silencieux.
 */
export async function saveSupervisorConfig(
  input: Record<string, unknown>,
): Promise<{ prefs: SupervisorPrefs; warnings: ConfigWarning[] }> {
  const current = prefsFromRow();
  const next: SupervisorPrefs = { ...current };
  const warnings: ConfigWarning[] = [];

  for (const field of ['chatModel', 'taskModel'] as const) {
    const value = readString(input, field);
    if (value === undefined) continue;
    if (value === null) { next[field] = null; continue; }
    if (await findModel(value)) { next[field] = value; continue; }
    next[field] = null;
    warnings.push({
      field,
      value,
      message: `${FIELD_LABEL[field]} inconnu : le défaut s'applique.`,
    });
  }

  const agent = readString(input, 'chatAgent');
  if (agent !== undefined) {
    if (agent === null) next.chatAgent = null;
    else if (await findAgent(agent)) next.chatAgent = agent;
    else {
      next.chatAgent = null;
      warnings.push({
        field: 'chatAgent',
        value: agent,
        message: 'Agent inconnu : retour à l\'orchestrateur du chat.',
      });
    }
  }

  setSupervisorPref({
    chatModel: next.chatModel,
    chatAgent: next.chatAgent,
    taskModel: next.taskModel,
  });
  // une valeur corrigée ne doit pas rester dans la mémoire des avertissements
  if (!warnings.length) warned.clear();
  const changed = (Object.keys(next) as PrefField[]).filter(f => next[f] !== current[f]);
  if (changed.length) {
    logEvent('supervisor', 'note', `configuration : ${changed.map(f => FIELD_LABEL[f]).join(', ')}`);
  }
  return { prefs: next, warnings };
}

/** Pour les tests : oublie les avertissements déjà journalisés. */
export function resetPrefWarnings(): void { warned.clear(); }
