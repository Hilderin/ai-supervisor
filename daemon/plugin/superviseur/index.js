/**
 * Outils de lecture bornée du chat de supervision. Plugin OpenCode projet-local,
 * chargé dans ~/.superviseur uniquement : les autres conversations n'ont pas
 * besoin de ces lectures (elles ont leurs propres tools natifs) et le projet
 * sélectionné est celui du mode Investigation du chat.
 *
 * Il ne contient aucune logique métier : les appels partent vers le daemon
 * Superviseur, qui vérifie que l'appelant est bien la session de supervision,
 * en mode Investigation, et lit uniquement dans le projet sélectionné.
 *
 * Les tools de flotte (list/start/send/close) sont chargés GLOBALEMENT par le
 * plugin superviseur-fleet : toutes les conversations les ont.
 */

const DAEMON = "http://127.0.0.1:5180";

const toolOptions = (name) => ({ codemode: false, permission: name });

async function call(name, input, context) {
  try {
    const res = await fetch(`${DAEMON}/api/tools/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: context?.sessionID ?? "",
        directory: context?.directory ?? "",
        args: input ?? {},
      }),
    });
    const data = await res.json().catch(() => ({ ok: false, error: `réponse illisible (${res.status})` }));
    return {
      content: JSON.stringify(data, null, 2),
      metadata: data && typeof data === "object" ? data : { ok: false },
    };
  } catch (error) {
    const data = { ok: false, error: String(error?.message ?? error) };
    return { content: JSON.stringify(data), metadata: data };
  }
}

export default {
  id: "superviseur-tools",

  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "read_project",
        description:
          "Lit un fichier texte du projet sélectionné en mode investigation. Chemin relatif à la racine du projet uniquement ; aucune écriture, commande ou lecture hors projet.",
        options: toolOptions("read_project"),
        input: {
          type: "object",
          properties: {
            path: { type: "string", description: "Chemin relatif du fichier dans le projet sélectionné." },
            start_line: { type: "integer", minimum: 1, description: "Première ligne (facultative)." },
            line_count: { type: "integer", minimum: 1, maximum: 400, description: "Nombre de lignes (maximum 400)." },
          },
          required: ["path"],
          additionalProperties: false,
        },
        execute(input, context) {
          return call("read_project", input, context);
        },
      });

      editor.add({
        name: "glob_project",
        description:
          "Liste les chemins du projet sélectionné qui correspondent à un motif glob (par exemple **/*.ts). Lecture seule, sans suivre les liens symboliques.",
        options: toolOptions("glob_project"),
        input: {
          type: "object",
          properties: { pattern: { type: "string", description: "Motif relatif, par défaut **/*." } },
          additionalProperties: false,
        },
        execute(input, context) {
          return call("glob_project", input, context);
        },
      });

      editor.add({
        name: "grep_project",
        description:
          "Recherche une chaîne littérale dans les fichiers texte du projet sélectionné. Retour borné, lecture seule, sans exécuter de regex.",
        options: toolOptions("grep_project"),
        input: {
          type: "object",
          properties: {
            query: { type: "string", description: "Texte exact à rechercher." },
            pattern: { type: "string", description: "Filtre glob relatif optionnel, par exemple **/*.md." },
            case_sensitive: { type: "boolean", description: "Respecter la casse." },
          },
          required: ["query"],
          additionalProperties: false,
        },
        execute(input, context) {
          return call("grep_project", input, context);
        },
      });
    });
  },
};
