/**
 * SuperviseurTask
 * -----------------------------------------------------------------------------
 * Plugin OpenCode v2 chargé globalement : il n'expose qu'un outil, `answer`,
 * disponible dans les sessions de tâche du Superviseur.
 *
 * `answer` envoie une réponse au propriétaire humain : elle s'affiche dans le
 * panel de détails de la carte du Superviseur, sous le plan. `question` en
 * option rattache la réponse à une question préalablement posée.
 *
 * Migration « réponses natives session » (décision du propriétaire, 2026-11-13,
 * même pattern que superviseur-criteria) : AUCUN appel au daemon. La réponse
 * vit dans le tool part de la session (metadata {ok, at, text, question}) :
 * l'agent peut répondre même quand le Superviseur est fermé, rien n'est perdu.
 * Le daemon LIT ces tool parts (harvest, daemon/src/answers.mts) pour la flotte
 * (compteur de non-lues) et le panel de détails ; l'état de lecture (« Got it »)
 * reste daemon, c'est un état du propriétaire.
 *
 * Le bilan final de la tâche reste une réponse dans la session OpenChamber :
 * il ne passe PAS par `answer`.
 *
 * Dependence-free ESM, chargé tel quel : mêmes conventions que
 * superviseur-plan (ctx.tool.transform, codemode: false).
 */

const DESCRIPTION = [
  "Envoie une réponse au propriétaire dans le Superviseur, visible dans le panel de détails de la tâche.",
  "À utiliser pour une information attendue par le propriétaire : une réponse à une question posée au démarrage, un point à valider, un résultat demandé.",
  "Si le propriétaire n'attend rien (validation de rendu, commentaire de confort), ne pas l'utiliser : le rendu se vérifie avec le build, les tests ou la flotte, et le bilan s'écrit en dernier message.",
  "Le texte accepte le markdown (titres, gras, listes, code) : il est rendu tel quel dans le Superviseur, rédige-le de façon lisible (listes, gras) quand la réponse le justifie, sans forcer la longueur.",
  "Un bloc `openui-lang` de structure (root = Stack([...]) avec Steps, Table, Callout) y est aussi dessiné ; un composant non dessiné ou un bloc invalide s'affiche en code brut.",
  "Pour poser une question au propriétaire, utilise le tool `question`, jamais un bloc openui-lang interactif (Choice, Input, Button) : un bloc interactif resterait inerte.",
  "Le propriétaire ne voit pas la conversation de la tâche (ni un rendu `openchamber_render`, ni un tableau laissé dans la session) : la réponse doit être autonome ; reproduis dans le texte tout tableau ou classement utile, ne renvoie jamais vers le chat.",
  "`question` est optionnel : s'il est présent, il rattache la réponse à la question concernée.",
  "Ce tool n'est pas pour le bilan final : il continue de s'écrire en dernier message de la session.",
].join(" ");

const MAX_TEXT = 8000;
const MAX_QUESTION = 500;

export default {
  id: "superviseur-task",

  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "answer",
        description: DESCRIPTION,
        // outil direct (pas derrière `execute`), comme les autres outils superviseur
        options: { codemode: false, permission: "answer" },
        input: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "Réponse au propriétaire ; le markdown est rendu tel quel dans le Superviseur : des titres, du gras ou des listes quand la réponse le justifie, sans forcer la longueur. Un bloc openui-lang de structure (Steps, Table, Callout) y est dessiné. Le propriétaire ne voit pas la conversation : inclue dans le texte tout tableau ou liste importante, sans renvoyer au chat.",
            },
            question: {
              type: "string",
              description: "Question du propriétaire à laquelle la réponse c'est raccrochée, optionnel.",
            },
          },
          required: ["text"],
          additionalProperties: false,
        },
        async execute(input) {
          const body = String(input?.text ?? "").trim().slice(0, MAX_TEXT);
          if (!body) {
            const data = { ok: false, error: "invalid", message: "texte requis : une réponse vide ne se lit nulle part" };
            return { content: JSON.stringify(data, null, 2), metadata: data };
          }
          const attached = String(input?.question ?? "").trim().slice(0, MAX_QUESTION) || null;
          // la réponse vit dans le tool part (session) : le daemon la lit
          // (harvest) pour la flotte et le panel de détails
          const data = { ok: true, at: Date.now(), text: body, question: attached };
          return { content: JSON.stringify(data, null, 2), metadata: data };
        },
      });
    });
  },
};
