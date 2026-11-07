/**
 * SuperviseurTask
 * -----------------------------------------------------------------------------
 * Plugin OpenCode v2 chargé globalement (comme superviseur-todolist) : il n'expose
 * qu'un outil, `answer`, disponible dans les sessions de tâche du Superviseur.
 *
 * `answer` envoie une réponse au propriétaire humain : elle s'affiche dans le
 * panel de détails de la carte du Superviseur, sous le plan. `question` en
 * option rattache la réponse à une question préalablement posée.
 *
 * Sans logique métier : l'appel part vers le daemon Superviseur
 * (POST /api/task/answer), qui valide la session (une tâche top-level connue,
 * jamais le chat de supervision ni un compagnon), journalise et stocke.
 *
 * Le bilan final de la tâche reste une réponse dans la session OpenChamber :
 * il ne passe PAS par `answer`.
 *
 * Dependence-free ESM, chargé tel quel : mêmes conventions que le plugin
 * superviseur-todolist (ctx.tool.transform, codemode: false).
 */

const DAEMON = process.env.SUPERVISEUR_DAEMON ?? "http://127.0.0.1:5180";

const DESCRIPTION = [
  "Envoie une réponse au propriétaire dans le Superviseur, visible dans le panel de détails de la tâche.",
  "À utiliser pour une information attendue par le propriétaire : une réponse à une question posée au démarrage, un point à valider, un résultat demandé.",
  "Si le propriétaire n'attend rien (validation de rendu, commentaire de confort), ne pas l'utiliser : le rendu se vérifie avec le build, les tests ou la flotte, et le bilan s'écrit en dernier message.",
  "Le texte accepte le markdown (titres, gras, listes, code) : il est rendu tel quel dans le Superviseur, rédige-le de façon lisible (listes, gras) quand la réponse le justifie, sans forcer la longueur.",
  "Le propriétaire ne voit pas la conversation de la tâche (ni un rendu `openchamber_render`, ni un tableau laissé dans la session) : la réponse doit être autonome ; reproduis dans le texte tout tableau ou classement utile, ne renvoie jamais vers le chat.",
  "`question` est optionnel : s'il est présent, il rattache la réponse à la question concernée.",
  "Ce tool n'est pas pour le bilan final : il continue de s'écrire en dernier message de la session.",
].join(" ");

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
              description: "Réponse au propriétaire ; le markdown est rendu tel quel dans le Superviseur : des titres, du gras ou des listes quand la réponse le justifie, sans forcer la longueur. Le propriétaire ne voit pas la conversation : inclue dans le texte tout tableau ou liste importante, sans renvoyer au chat.",
            },
            question: {
              type: "string",
              description: "Question du propriétaire à laquelle la réponse c'est raccrochée, optionnel.",
            },
          },
          required: ["text"],
          additionalProperties: false,
        },
        async execute(input, context) {
          try {
            const res = await fetch(`${DAEMON}/api/task/answer`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId: context?.sessionID ?? "",
                directory: context?.directory ?? "",
                args: { text: input?.text, question: input?.question },
              }),
            });
            const data = (await res.json().catch(() => null)) ?? { ok: false, error: `réponse illisible (${res.status})` };
            if (!res.ok) {
              data.error = data?.error ?? `envoi refusé (${res.status})`;
            }
            return {
              content: JSON.stringify(data, null, 2),
              metadata: data && typeof data === "object" ? data : { ok: false },
            };
          } catch (error) {
            const data = { ok: false, error: String(error?.message ?? error) };
            return { content: JSON.stringify(data), metadata: data };
          }
        },
      });
    });
  },
};
