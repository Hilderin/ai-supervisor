import type { FormField } from '../types';

export type Choice = Record<string, string | string[]>;

/**
 * Construit l'objet attendu par le daemon : { qN: valeur } complet.
 * - multiselect : valeur en TABLEAU
 * - une sélection d'options prime sur le champ libre du même champ
 * - un multiselect vide + texte libre devient [texte]
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
    if (picked != null) {
      if (f.type === 'multiselect' && Array.isArray(picked) && picked.length === 0) {
        if (value) answer[key] = [value];
      } else {
        answer[key] = picked;
      }
    } else if (value) {
      answer[key] = f.type === 'multiselect' ? [value] : value;
    }
  }
  return answer;
}
