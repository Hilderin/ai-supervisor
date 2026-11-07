const INVESTIGATION_TOOLS = new Set(['read_project', 'glob_project', 'grep_project']);

/** Permission check used by the daemon tool dispatcher, never by the UI alone. */
export function isToolAllowedInMode(name: string, mode: 'pilot' | 'investigation'): boolean {
  return mode === 'investigation' ? INVESTIGATION_TOOLS.has(name) : !INVESTIGATION_TOOLS.has(name);
}

export function modeDenial(name: string, mode: 'pilot' | 'investigation'):
  { ok: false; error: string; message: string } | null {
  if (isToolAllowedInMode(name, mode)) return null;
  return {
    ok: false,
    error: mode === 'investigation' ? 'read_only_mode' : 'investigation_mode_required',
    message: mode === 'investigation'
      ? 'le mode investigation interdit toute action autre que la lecture du projet'
      : 'active le mode investigation pour lire les fichiers du projet',
  };
}
