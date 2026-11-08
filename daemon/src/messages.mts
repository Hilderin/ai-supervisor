/**
 * Lecture du texte d'un message OpenChamber.
 * Piège : sur la version installée, le prompt humain est à la racine (`text`),
 * pas dans `payload.text` (ancienne forme). Lire les deux, sinon le compagnon
 * ne voit aucun message utilisateur et invente l'objectif à partir de l'agent seul.
 */
export interface MessageLike {
  type: string;
  text?: string;
  content?: Array<{ type: string; text?: string }>;
  payload?: { text?: string };
}

export function messageText(m: MessageLike): string {
  const direct = (m.text ?? m.payload?.text ?? '').trim();
  if (direct) return direct;
  return (m.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join(' ').trim();
}

/**
 * Les notifications du daemon à une tâche (critères, rappels) arrivent comme
 * des messages « user » dans la conversation : elles ne doivent JAMAIS devenir
 * l'objectif de la tâche (déjà arrivé : la notification « AC-08 validé » a
 * écrasé la consigne du propriétaire dans task_state.objective).
 */
export function isDaemonNotice(m: MessageLike): boolean {
  return messageText(m).startsWith('[superviseur]');
}
