/**
 * Outils du chat de supervision. Plugin OpenCode projet-local, chargé dans
 * ~/.superviseur. Il ne contient aucune logique métier : les appels partent
 * vers le daemon Superviseur, qui valide, journalise et agit.
 *
 * Le daemon vérifie que `sessionId` est bien la session de supervision : ces
 * outils ne sont pas des outils de tâche et ne peuvent pas être utilisés depuis
 * une session de travail.
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

const empty = { type: "object", properties: {}, additionalProperties: false };

export default {
  id: "superviseur-tools",

  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "list_projects",
        description:
          "Liste les projets OpenChamber connus (nom, dossier, identifiant). À utiliser pour résoudre un projet avant start_task.",
        options: toolOptions("list_projects"),
        input: empty,
        execute(input, context) {
          return call("list_projects", input, context);
        },
      });

      editor.add({
        name: "list_tasks",
        description:
          "Liste les tâches de la flotte avec leur état, leur résumé, leur progression et la question en attente. À appeler avant de répondre sur l'état d'une tâche.",
        options: toolOptions("list_tasks"),
        input: {
          type: "object",
          properties: {
            section: {
              type: "string",
              enum: ["waiting", "running", "done", "all"],
              description: "Filtre de section. all par défaut.",
            },
            include_closed: { type: "boolean", description: "Inclure les tâches fermées." },
          },
          additionalProperties: false,
        },
        execute(input, context) {
          return call("list_tasks", input, context);
        },
      });

      editor.add({
        name: "get_task",
        description:
          "Détail borné d'une tâche : goal, résumé, prochain, plan/todos, progression, question en attente. Ne renvoie pas le transcript complet.",
        options: toolOptions("get_task"),
        input: {
          type: "object",
          properties: {
            task: { type: "string", description: "Identifiant ou titre de la tâche." },
          },
          required: ["task"],
          additionalProperties: false,
        },
        execute(input, context) {
          return call("get_task", input, context);
        },
      });

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

      editor.add({
        name: "start_task",
        description:
          "Crée une session de travail top-level dans un projet, avec son goal, ses critères et son brief. Action réelle : appeler seulement quand le global est clair et le projet résolu. Ne crée pas de sous-agent.",
        options: toolOptions("start_task"),
        input: {
          type: "object",
          properties: {
            title: { type: "string", description: "Titre court et humain de la tâche." },
            goal: { type: "string", description: "Résultat attendu, 1 à 3 phrases." },
            project: { type: "string", description: "Nom, identifiant ou chemin d'un projet connu." },
            done_criteria: {
              type: "array",
              items: { type: "string" },
              description: "Critères vérifiables de fin, 2 à 5 idéalement.",
            },
            constraints: {
              type: "array",
              items: { type: "string" },
              description: "Contraintes de fichiers, techno, style ou délai.",
            },
            agent: { type: "string", description: "Profil OpenCode de la session, optionnel." },
            model: { type: "string", description: "Modèle de la session, optionnel." },
            context: { type: "string", description: "Contexte, liens ou décisions utiles." },
          },
          required: ["title", "goal", "project"],
          additionalProperties: false,
        },
        execute(input, context) {
          return call("start_task", input, context);
        },
      });

      editor.add({
        name: "send_task",
        description:
          "Envoie un texte à une tâche existante, sur ordre explicite. Si une question est en attente, l'annule d'abord puis envoie le texte ; une permission en attente reste sur la carte.",
        options: toolOptions("send_task"),
        input: {
          type: "object",
          properties: {
            task: { type: "string", description: "Identifiant ou titre de la tâche." },
            text: { type: "string", description: "Texte exact à envoyer à l'agent." },
          },
          required: ["task", "text"],
          additionalProperties: false,
        },
        execute(input, context) {
          return call("send_task", input, context);
        },
      });

      editor.add({
        name: "cancel_question",
        description:
          "Annule la question en attente d'une tâche. L'agent reprend sans réponse. À utiliser quand l'utilisateur dit explicitement d'annuler ou d'ignorer la question.",
        options: toolOptions("cancel_question"),
        input: {
          type: "object",
          properties: {
            task: { type: "string", description: "Identifiant ou titre de la tâche." },
            message: { type: "string", description: "Raison courte transmise à l'agent, optionnelle." },
          },
          required: ["task"],
          additionalProperties: false,
        },
        execute(input, context) {
          return call("cancel_question", input, context);
        },
      });

      editor.add({
        name: "close_task",
        description:
          "Ferme une tâche et la retire de la flotte, sur ordre explicite. Refuse une tâche qui attend une question ou une permission ; `force` seulement si l'utilisateur confirme explicitement l'abandon.",
        options: toolOptions("close_task"),
        input: {
          type: "object",
          properties: {
            task: { type: "string", description: "Identifiant ou titre de la tâche." },
            note: { type: "string", description: "Note de clôture, optionnelle." },
            force: { type: "boolean", description: "Fermer en abandonnant la question ou la permission en attente." },
          },
          required: ["task"],
          additionalProperties: false,
        },
        execute(input, context) {
          return call("close_task", input, context);
        },
      });
    });
  },
};
