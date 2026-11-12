/**
 * SuperviseurFleet
 * -----------------------------------------------------------------------------
 * Plugin OpenCode v2 chargé GLOBALEMENT (décision du 2026-11-12) : les tools
 * de gestion de flotte du Superviseur sont disponibles à TOUTE conversation
 * (une tâche, une discussion quelconque, le chat de supervision). Un agent peut
 * lister les projets et tâches, démarrer une nouvelle tâche, lui parler,
 * annuler sa question ou la fermer.
 *
 * Sans logique métier : l'appel part vers le daemon Superviseur
 * (POST /api/tools/:name), qui journalise et agit. Les tools de lecture bornée
 * du projet d'investigation (read_project, glob_project, grep_project) restent
 * réservés au chat de supervision (plugin projet-local `superviseur`).
 */

const DAEMON = process.env.SUPERVISEUR_DAEMON ?? "http://127.0.0.1:5180";

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
  id: "superviseur-fleet",

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
          "Liste les tâches de la flotte du Superviseur avec leur état, leur progression (plan) et la question en attente. À appeler avant de répondre sur l'état d'une tâche ou avant d'en parler.",
        options: toolOptions("list_tasks"),
        input: {
          type: "object",
          properties: {
            section: {
              type: "string",
              enum: ["waiting", "running", "all"],
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
          "Détail borné d'une tâche de la flotte : goal, critères du brief, plan/todos, progression, question en attente, dernière livraison. Ne renvoie pas le transcript complet.",
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
        name: "start_task",
        description:
          "Crée une tâche dans la flotte du Superviseur : une session de travail top-level dans un projet, avec son goal, ses critères et son brief. À utiliser quand l'utilisateur demande de démarrer une tâche, ou sur accord après une proposition ; appeler seulement quand le goal est clair et le projet résolu (list_projects). Ne crée pas de sous-agent.",
        options: toolOptions("start_task"),
        input: {
          type: "object",
          properties: {
            title: { type: "string", description: "Titre court et humain de la tâche." },
            goal: { type: "string", description: "Résultat attendu, 1 à 3 phrases." },
            project: { type: "string", description: "Nom, identifiant ou chemin d'un projet connu (voir list_projects)." },
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
          "Envoie un texte à une tâche de la flotte, sur ordre explicite de l'utilisateur. Si une question est en attente sur cette tâche, elle est annulée d'abord puis le texte part ; une permission en attente reste sur la carte.",
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
