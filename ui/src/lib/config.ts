/**
 * Helpers purs du panneau de configuration du chat (modèles et agent).
 *
 * Le panneau n'invente rien : il affiche le catalogue renvoyé par le daemon
 * (modèles d'OpenChamber groupés par provider, agents primaires) et la
 * préférence enregistrée. Une préférence nulle signifie « défaut », jamais
 * « aucun modèle ».
 */
import type {
  SupervisorAgentOption, SupervisorConfigWarning, SupervisorModelOption,
} from '../types';

export interface ProviderGroup {
  providerID: string;
  providerName: string;
  models: SupervisorModelOption[];
}

/** Groupe les modèles par provider, dans l'ordre alphabétique déjà donné. */
export function groupModelsByProvider(models: SupervisorModelOption[]): ProviderGroup[] {
  const groups = new Map<string, ProviderGroup>();
  for (const model of models) {
    const providerID = model.providerID || 'autre';
    const current = groups.get(providerID);
    if (current) current.models.push(model);
    else {
      groups.set(providerID, {
        providerID,
        providerName: model.providerName || providerID,
        models: [model],
      });
    }
  }
  return [...groups.values()].sort((a, b) => a.providerName.localeCompare(b.providerName, 'fr'));
}

/** Libellé court d'un modèle : son nom, ou sa référence si le catalogue manque. */
export function modelLabelOf(model: { name?: string; ref?: string } | null | undefined): string {
  return model?.name?.trim() || model?.ref?.trim() || '';
}

/** Libellé de l'option « défaut » d'un modèle du chat, avec le nom du défaut courant. */
export function defaultModelLabel(
  models: SupervisorModelOption[],
  defaultRef: string | null,
  fallback = 'Défaut OpenChamber',
): string {
  if (!defaultRef) return fallback;
  const name = models.find(m => m.ref === defaultRef)?.name ?? defaultRef;
  return `Défaut (${name})`;
}

/** L'agent sélectionné est-il l'orchestrateur par défaut ? */
export function isDefaultAgent(agent: string | null, agents: SupervisorAgentOption[]): boolean {
  if (!agent) return true;
  return !agents.some(a => a.id === agent);
}

/**
 * Avertissement affiché sous l'agent quand un agent standard est choisi :
 * le chat perd les consignes de supervision et ses outils dédiés.
 */
export function customAgentHint(agent: string | null, agents: SupervisorAgentOption[]): string | null {
  if (!agent || isDefaultAgent(agent, agents)) return null;
  return 'Un agent standard ne porte pas les consignes de supervision du chat.';
}

/** Message lisible d'un avertissement de sauvegarde, champ par champ. */
export function warningText(warning: SupervisorConfigWarning): string {
  return warning.message?.trim() || `Valeur refusée pour ${warning.field}.`;
}

/** Valeur d'un select : la préférence, ou la chaîne vide pour « défaut ». */
export function prefValue(value: string | null | undefined): string {
  return value?.trim() || '';
}
