/**
 * SuperviseurVerifier
 * -----------------------------------------------------------------------------
 * Plugin OpenCode v2 chargé globalement : expose au sous-agent vérificateur
 * trois outils de lecture bornée de la conversation de l'agent principal de la
 * tâche qu'il vérifie :
 *
 *   - `verifier_messages` : liste des messages (60 max), textes tronqués
 *   - `verifier_tools`    : tool calls récents (40 max) : nom, statut, entrée résumée
 *   - `verifier_search`   : recherche d'un texte (30 matches max)
 *
 * Le vérificateur n'a AUCUN tool de gestion des critères : il répond par un
 * JSON que le daemon applique. Les appels partent vers le daemon
 * (POST /api/verifier/:name), qui vérifie que l'appelant est bien le
 * vérificateur de la tâche (verifier_map) et n'interroge OpenChamber que pour
 * la session parent.
 *
 * Dependence-free ESM, chargé tel quel : mêmes conventions que superviseur-task.
 */

const DAEMON = process.env.SUPERVISEUR_DAEMON ?? "http://127.0.0.1:5180";

const call = async (name, input, context) => {
  try {
    const res = await fetch(`${DAEMON}/api/verifier/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: context?.sessionID ?? "",
        directory: context?.directory ?? "",
        args: input ?? {},
      }),
    });
    const data = (await res.json().catch(() => null)) ?? { ok: false, error: `réponse illisible (${res.status})` };
    if (!res.ok) data.error = data?.error ?? `appel refusé (${res.status})`;
    return { content: JSON.stringify(data, null, 2), metadata: data };
  } catch (error) {
    const data = { ok: false, error: String(error?.message ?? error) };
    return { content: JSON.stringify(data), metadata: data };
  }
};

const LIMITS = [
  "Lectures bornées : l'outil n'accède qu'à la conversation de l'agent principal de la tâche, en lecture seule.",
  "`since` est optionnel (epoch ms) pour limiter la fenêtre aux messages récents.",
];

export default {
  id: "superviseur-verifier",

  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "verifier_messages",
        description: [
          "Liste les messages récents de la conversation de l'agent principal de la tâche vérifiée.",
          ...LIMITS,
          "Entrée : {limit? (1..60, défaut 30), since?}. Chaque message : {id, type, at, text, toolCalls?}.",
        ].join(" "),
        options: { codemode: false, permission: "verifier_messages" },
        input: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Nombre de messages (1..60, défaut 30)." },
            since: { type: "number", description: "Epoch ms : messages créés après cet instant, optionnel." },
          },
          additionalProperties: false,
        },
        async execute(input, context) { return call("verifier_messages", input, context); },
      });

      editor.add({
        name: "verifier_tools",
        description: [
          "Liste les tool calls récents de l'agent principal : nom, statut, entrée résumée. Pour recouper une preuve (sortie de test, fichier touché).",
          ...LIMITS,
          "Entrée : {limit? (1..40, défaut 20), since?}.",
        ].join(" "),
        options: { codemode: false, permission: "verifier_tools" },
        input: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Nombre de tool calls (1..40, défaut 20)." },
            since: { type: "number", description: "Epoch ms, optionnel." },
          },
          additionalProperties: false,
        },
        async execute(input, context) { return call("verifier_tools", input, context); },
      });

      editor.add({
        name: "verifier_search",
        description: [
          "Cherche un texte dans la conversation de l'agent principal (insensible à la casse) et renvoie les extraits autour des matches.",
          ...LIMITS,
          "Entrée : {query (500 caractères max), since?}. Chaque match : {id, type, at, excerpt}.",
        ].join(" "),
        options: { codemode: false, permission: "verifier_search" },
        input: {
          type: "object",
          properties: {
            query: { type: "string", description: "Texte cherché (500 caractères max)." },
            since: { type: "number", description: "Epoch ms, optionnel." },
          },
          required: ["query"],
          additionalProperties: false,
        },
        async execute(input, context) { return call("verifier_search", input, context); },
      });
    });
  },
};
