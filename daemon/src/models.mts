/**
 * Catalogue des modèles, providers et agents d'OpenChamber.
 *
 * Le Superviseur ne tient pas sa propre liste : les providers et les modèles
 * viennent de l'instance (`GET /api/provider`, `GET /api/model`) et les agents
 * de `GET /api/agent`. Le catalogue est mis en cache quelques secondes : une
 * ouverture de config ou un tick de reprise ne doit pas relire 171 modèles à
 * chaque tour. Un refus (instance lente, réseau) laisse l'appelant décider
 * (défaut, pas d'écriture) : on n'invente jamais un modèle.
 */

let base = '';
export function setBase(b: string) { base = b.replace(/\/$/, ''); }

const TIMEOUT_MS = 8000;
const TTL_MS = 30_000;

async function jget(path: string, timeoutMs = TIMEOUT_MS): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, { signal: ctl.signal });
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

export interface ModelOption {
  /** référence stable `providerID/modelID`, celle qui est stockée */
  ref: string;
  providerID: string;
  modelID: string;
  name: string;
  providerName: string;
  /** taille de contexte si l'instance la donne (aide au choix, pas un critère) */
  context?: number;
}

export interface AgentOption {
  id: string;
  name: string;
  description?: string;
}

interface WireModel {
  id?: string;
  modelID?: string;
  providerID?: string;
  name?: string;
  type?: string;
  enabled?: boolean;
  status?: string;
  limit?: { context?: number };
}

/** Les agents du Superviseur (analyste, vérificateur, versions de l'orchestrateur) ne sont pas des choix. */
function selectableAgent(id: string): boolean {
  if (!id) return false;
  if (id === 'superviseur-verificateur') return false;
  if (id.startsWith('superviseur-analyste')) return false;
  if (id.startsWith('superviseur-orchestrateur')) return false;
  return true;
}

interface Catalog {
  at: number;
  models: ModelOption[];
  agents: AgentOption[];
}

let cache: Catalog | null = null;
let loading: Promise<Catalog> | null = null;

export function resetCatalogCache(): void { cache = null; }

/**
 * Charge (ou relit) le catalogue. `force` sert à une revalidation explicite :
 * l'ouverture du panneau de config doit voir les modèles fraîchement ajoutés.
 * Les appels concurrents partagent la même requête : un poll de flotte et une
 * validation de préférence ne lisent pas 158 modèles deux fois.
 */
export async function loadCatalog(force = false): Promise<Catalog> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache;
  if (loading) return loading;
  loading = (async (): Promise<Catalog> => {
    const [modelsBody, providersBody, agentsBody] = await Promise.all([
      jget('/api/model'),
      jget('/api/provider').catch(() => ({ data: [] })),
      jget('/api/agent').catch(() => ({ data: [] })),
    ]);
    const providerNames = new Map<string, string>();
    for (const p of (providersBody as { data?: Array<{ id?: string; name?: string }> }).data ?? []) {
      if (p?.id) providerNames.set(p.id, p.name?.trim() || p.id);
    }
    const models: ModelOption[] = ((modelsBody as { data?: WireModel[] }).data ?? [])
      // OpenChamber marque les modèles d'une source custom sans `type` (la
      // source Skytech, par exemple) et les traite comme des modèles de chat :
      // exiger `type === 'chat'` les faisait disparaître du sélecteur alors que
      // le modèle par défaut pouvait en venir.
      .filter(m => (m?.type ?? 'chat') === 'chat' && m.enabled !== false && m.status !== 'disabled')
      .map((m) => {
        const providerID = String(m.providerID ?? '');
        const modelID = String(m.modelID ?? m.id ?? '');
        return {
          ref: `${providerID}/${modelID}`,
          providerID,
          modelID,
          name: String(m.name ?? modelID),
          providerName: providerNames.get(providerID) ?? providerID,
          ...(m.limit?.context ? { context: m.limit.context } : {}),
        };
      })
      .filter(m => !!m.providerID && !!m.modelID)
      .sort((a, b) => a.providerName.localeCompare(b.providerName, 'fr') || a.name.localeCompare(b.name, 'fr'));
    const agents: AgentOption[] = ((agentsBody as { data?: Array<{ id?: string; name?: string; mode?: string; hidden?: boolean; description?: string }> }).data ?? [])
      .filter(a => !!a?.id && a.mode === 'primary' && !a.hidden && selectableAgent(String(a.id)))
      .map(a => ({
        id: String(a.id),
        name: String(a.name ?? a.id),
        ...(a.description ? { description: String(a.description) } : {}),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    cache = { at: Date.now(), models, agents };
    return cache;
  })().finally(() => { loading = null; });
  return loading;
}

/** Le modèle par défaut de l'UI (sélecteur OpenChamber), avec le repli `/api/model/default`. */
export async function defaultModelRef(): Promise<string | null> {
  try {
    const settings = await jget('/api/config/settings?directory=') as { defaultModel?: string };
    const ref = typeof settings?.defaultModel === 'string' ? settings.defaultModel.trim() : '';
    if (/^[^/]+\/[^/]+$/.test(ref)) return ref;
  } catch { /* repli plus bas */ }
  try {
    const d = await jget('/api/model/default') as { data?: { providerID?: string; id?: string; modelID?: string } };
    const provider = d?.data?.providerID;
    const model = d?.data?.id ?? d?.data?.modelID;
    if (provider && model) return `${provider}/${model}`;
  } catch { /* modèle inconnu : l'appelant décide */ }
  return null;
}

/** Découpe une référence `provider/model` (le premier slash sépare le provider). */
export function splitModelRef(ref: string): { providerID: string; modelID: string } | null {
  const clean = String(ref ?? '').trim();
  const slash = clean.indexOf('/');
  if (slash <= 0 || slash === clean.length - 1) return null;
  return { providerID: clean.slice(0, slash), modelID: clean.slice(slash + 1) };
}

export function modelPayload(ref: string): { providerID: string; id: string } | null {
  const split = splitModelRef(ref);
  return split ? { providerID: split.providerID, id: split.modelID } : null;
}

/**
 * Le modèle existe-t-il encore dans le catalogue ? Utilisé pour valider un
 * choix et pour ne pas envoyer une référence morte à OpenChamber.
 */
export async function findModel(ref: string): Promise<ModelOption | null> {
  const clean = String(ref ?? '').trim();
  if (!clean) return null;
  try {
    const { models } = await loadCatalog();
    return models.find(m => m.ref === clean) ?? null;
  } catch {
    return null;
  }
}

export async function findAgent(id: string): Promise<AgentOption | null> {
  const clean = String(id ?? '').trim();
  if (!clean) return null;
  try {
    const { agents } = await loadCatalog();
    return agents.find(a => a.id === clean) ?? null;
  } catch {
    return null;
  }
}

/** Nom lisible d'un modèle pour l'en-tête du chat ; la référence si le catalogue manque. */
export async function modelLabel(ref: string | null | undefined): Promise<string | null> {
  const clean = String(ref ?? '').trim();
  if (!clean) return null;
  const found = await findModel(clean);
  return found?.name ?? clean;
}
