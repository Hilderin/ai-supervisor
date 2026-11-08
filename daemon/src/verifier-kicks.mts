/**
 * Kicks du vérificateur (module neutre : évite les imports circulaires entre
 * criteria-tools, kicks et verifier, comme kicks.mts pour le compagnon).
 *   - `criteria`   : une transition de critère (tool criteria ou JSON vérificateur)
 *   - `turn`       : fin de tour de la tâche (session.execution.* / session.idle)
 */
const kicks = new Map<string, { criteria: boolean; turn: boolean }>();

export function verifierKick(sid: string, kind: 'criteria' | 'turn') {
  if (!sid) return;
  const k = kicks.get(sid) ?? { criteria: false, turn: false };
  if (kind === 'criteria') k.criteria = true;
  else k.turn = true;
  kicks.set(sid, k);
}

export function takeVerifierKick(sid: string): { criteria: boolean; turn: boolean } | undefined {
  const k = kicks.get(sid);
  if (k) kicks.delete(sid);
  return k;
}
