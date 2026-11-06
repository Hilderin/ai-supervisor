/** Concatène des classes conditionnelles (équivalent minimal de clsx). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
