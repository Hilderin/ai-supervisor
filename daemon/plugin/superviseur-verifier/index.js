/**
 * SuperviseurVerifier
 * -----------------------------------------------------------------------------
 * Plugin OpenCode v2 chargé globalement : expose au sous-agent vérificateur
 * cinq outils de lecture bornée de la conversation de l'agent principal de la
 * tâche qu'il vérifie :
 *
 *   - `verifier_messages`    : liste des messages (60 max), textes tronqués
 *   - `verifier_tools`       : tool calls récents (40 max), callId stable
 *   - `verifier_tool_result` : entrée/sortie d'un call, sortie par plages
 *   - `verifier_artifact`    : artefact de preuve ; image TRANSMISE (vue)
 *   - `verifier_search`      : recherche sur l'index local puis le listing
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
        name: "verifier_tool_result",
        description: [
          "Inspecte UN tool call précis de l'agent principal avec son entrée et sa sortie COMPLÈTES : la façon de vérifier une preuve « sortie de test » plutôt que sa description.",
          ...LIMITS,
          "Entrée : {callId} (identifiant STABLE renvoyé par verifier_tools, à privilégier) ou {index} ou {tool} + {query?} ; la sortie se lit PAR PAGES : {offset?, length?} (page par défaut 2000, max 10000) : un résumé en fin de sortie volumineuse se lit en pages successives, pas de plafond fixe.",
          "Résultat : {toolCall: {callId, at, name, status, input, output, total, offset, truncated?, nextOffset?, detail}, count}.",
        ].join(" "),
        options: { codemode: false, permission: "verifier_tool_result" },
        input: {
          type: "object",
          properties: {
            callId: { type: "string", description: "Identifiant stable du tool call (messageId:partIndex), renvoyé par verifier_tools." },
            index: { type: "number", description: "Position dans la liste des tool calls récents (0 = le plus récent), repli sans callId." },
            tool: { type: "string", description: "Nom du tool cherché (shell, read, criteria_add...) ; avec query, premier call correspondant." },
            query: { type: "string", description: "Texte que l'entrée du tool call doit contenir." },
            offset: { type: "number", description: "Décalage de lecture dans la sortie (0 par défaut) ; passe nextOffset pour la page suivante." },
            length: { type: "number", description: "Longueur de la page de sortie (défaut 2000, max 10000)." },
            since: { type: "number", description: "Epoch ms, optionnel." },
          },
          additionalProperties: false,
        },
        async execute(input, context) { return call("verifier_tool_result", input, context); },
      });

      editor.add({
        name: "verifier_artifact",
        description: [
          "Lit un artefact référencé par une preuve, borné au dossier du projet du parent (chemin relatif, sans sortie ni lien symbolique).",
          "Une IMAGE est TRANSMISE : le fichier réel est attaché à ta session et tu le VOIS (rendu visuel) : juge l'alignement, l'état affiché, le texte lisible directement, sans la description de l'agent.",
          "Un extrait de code se lit avec start_line/line_count ; un texte ou document en entier (borné).",
          ...LIMITS,
          "Entrée : {path, start_line?, line_count?}.",
        ].join(" "),
        options: { codemode: false, permission: "verifier_artifact" },
        input: {
          type: "object",
          properties: {
            path: { type: "string", description: "Chemin relatif au projet du parent (celui cité dans la preuve)." },
            start_line: { type: "number", description: "Première ligne (extrait de code)." },
            line_count: { type: "number", description: "Nombre de lignes (extrait de code)." },
          },
          required: ["path"],
          additionalProperties: false,
        },
        async execute(input, context) {
          const data = await call("verifier_artifact", input, context);
          // le daemon renvoie {ok, image: {path, mime, ...}} pour une image de
          // preuve : le fichier VALIDÉ est attaché à la session (le modèle le
          // voit), jamais une description générée par l'agent principal.
          const img = data?.metadata?.image;
          if (data?.metadata?.ok && img?.path && img?.mime) {
            return {
              content: [
                { type: "file", uri: `file://${img.path}`, mime: img.mime, name: img.name ?? null },
                { type: "text", text: `Preuve image « ${input.path} » : tu la vois ci-dessus. Juge le rendu visuel directement.` },
              ],
              metadata: data.metadata,
            };
          }
          return data;
        },
      });

      editor.add({
        name: "verifier_search",
        description: [
          "Cherche un texte dans la conversation de l'agent principal (insensible à la casse) : dans les messages ET dans les entrées des tool calls.",
          ...LIMITS,
          "La recherche interroge d'abord l'INDEX LOCAL alimenté par le daemon (pleine couverture de ce qui a coulé pendant sa vie, y compris le centre d'une longue conversation que le listing ne remonte plus : l'API ignore offset/curseurs et refuse limit > 200) puis complete avec le listing live ; la réponse porte indexed (taille de l'index) : coverage rapportée honnêtement.",
          "Entrée : {query (500 caractères max), since?}. Chaque match : {id, type, at, field (message|tool_input), tool?, excerpt}.",
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
