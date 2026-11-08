import type { FormField } from '../types';

export type Choice = Record<string, string | string[]>;

/**
 * Sentinelle du choix « Autre », associé au champ de texte libre.
 * Elle ne vit que dans l'état local du formulaire : `buildAnswer` la remplace
 * TOUJOURS par le texte saisi, elle n'est jamais envoyée au daemon.
 */
export const OTHER = '\u0000autre';

export function isOther(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) return value.includes(OTHER);
  return value === OTHER;
}

/** État du formulaire : la sélection et le texte libre, tenus ensemble. */
export interface AnswerState {
  choice: Choice;
  free: Record<string, string>;
}

/**
 * Clic sur un choix : une option remplace la sélection (mono) ou s'ajoute
 * (multi), et le texte libre du champ est effacé, pour qu'aucun texte fantôme
 * ne subsiste à côté d'une option choisie. Le choix « Autre », lui, garde le
 * texte déjà saisi : il ne fait que rendre le champ libre actif.
 */
export function selectOption(
  state: AnswerState,
  key: string,
  value: string,
  multi: boolean,
): AnswerState {
  if (value === OTHER) {
    return { choice: { ...state.choice, [key]: OTHER }, free: state.free };
  }
  const prev = state.choice[key];
  let picked: string | string[];
  if (!multi) {
    picked = value;
  } else {
    const cur = Array.isArray(prev) ? prev.filter((v) => v !== OTHER) : [];
    picked = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
  }
  return {
    choice: { ...state.choice, [key]: picked },
    free: { ...state.free, [key]: '' },
  };
}

/**
 * Frappe dans le champ libre : dès qu'un texte est saisi, « Autre » devient le
 * choix actif et les options du champ sont désélectionnées. Effacer le texte
 * laisse « Autre » actif (la soumission reste bloquée, avec le retour visuel).
 * Un champ sans options garde le comportement d'avant : pas de choix « Autre »,
 * le texte est simplement la réponse.
 */
export function typeText(
  state: AnswerState,
  key: string,
  text: string,
  withOther = true,
): AnswerState {
  const free = { ...state.free, [key]: text };
  if (!withOther || text === '') return { choice: state.choice, free };
  return { choice: { ...state.choice, [key]: OTHER }, free };
}

/** Champs où « Autre » est actif sans texte : la soumission doit être refusée. */
export function otherWithoutText(
  fields: FormField[],
  choice: Choice,
  free: Record<string, string>,
): string[] {
  const keys: string[] = [];
  for (const f of fields) {
    const key = f.key ?? 'q0';
    if (isOther(choice[key]) && !(free[key] ?? '').trim()) keys.push(key);
  }
  return keys;
}

/**
 * Construit l'objet attendu par le daemon : { qN: valeur } complet.
 * - un texte saisi est TOUJOURS la réponse du champ (choix « Autre »), exactement
 *   le texte, sans libellé ajouté : il ne peut plus être remplacé par une option
 * - « Autre » actif sans texte : rien (la soumission est bloquée en amont par
 *   `otherWithoutText`)
 * - multiselect : valeur en TABLEAU
 * - multiselect vide sans texte : rien
 */
export function buildAnswer(
  fields: FormField[],
  choice: Choice,
  free: Record<string, string>,
): Record<string, unknown> {
  const answer: Record<string, unknown> = {};
  for (const f of fields) {
    const key = f.key ?? 'q0';
    const picked = choice[key];
    const value = (free[key] ?? '').trim();
    if (value) {
      answer[key] = f.type === 'multiselect' ? [value] : value;
      continue;
    }
    if (isOther(picked)) continue;
    if (picked != null) {
      if (f.type === 'multiselect' && Array.isArray(picked) && picked.length === 0) continue;
      answer[key] = picked;
    }
  }
  return answer;
}
