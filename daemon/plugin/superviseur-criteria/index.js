/**
 * SuperviseurCriteria
 * -----------------------------------------------------------------------------
 * Plugin OpenCode v2 chargé globalement (comme superviseur-plan) : il expose à
 * l'agent d'une tâche du Superviseur les outils des critères d'acceptation :
 *
 *   - `criteria_list`         lire la liste complète (lecture, ne déclenche rien)
 *   - `criteria_add`          créer un critère (titre, détail, au moins une méthode)
 *   - `criteria_remove`       retirer un critère (la ref n'est jamais réattribuée)
 *   - `criteria_update`       modifier titre/détail/méthodes : un critère non
 *                             « à faire » repasse « à faire » (preuve invalidée)
 *   - `criteria_to_validate`  soumettre une preuve : « à faire » ou « à corriger »
 *                             devient « à valider »
 *   - `criteria_set_status`   juger : « validé » ou « à corriger » (raison)
 *   - `criteria_import`       remplacer la liste entière (reprise automatique :
 *                             le daemon réinjecte le dernier état connu de la
 *                             tâche perdue dans la session neuve)
 *
 * Migration « critères natifs session » (décision du propriétaire, 2026-11-13) :
 * la machine à états vit DANS le plugin (state.js), l'état dans le storage du
 * plugin (`ctx.storage`, clé `session/<sessionID>`, mêmes conventions que
 * superviseur-plan). AUCUN appel au daemon : les outils marchent même quand le
 * Superviseur est fermé. Le daemon LIT la liste (metadata de chaque résultat,
 * forme {ok, criteria, counts}) dans les tool parts de la session pour la
 * flotte et le détail de la carte.
 *
 * L'agent est SON PROPRE juge (plus de sous-agent vérificateur) : les
 * instructions d'usage honnête vivent dans les descriptions des tools. Le
 * propriétaire lit la liste, les preuves et les notes : une validation à tort
 * se voit.
 *
 * Dependence-free ESM (node:fs, node:path, node:child_process seulement),
 * chargé tel quel : mêmes conventions que superviseur-plan
 * (ctx.tool.transform, codemode: false).
 */

import {
  CriteriaError, addCriterion, criteriaView, importCriteria, listCriteria,
  normalizeState, removeCriterion, setStatusCriterion, statusLabel,
  submitEvidence, updateCriterion,
} from './state.js';

/** Storage keys are namespaced per session inside the plugin's own store. */
const STORAGE_PREFIX = "session/";

/** Upper bound on the criteria rendered into the model context, to bound tokens. */
const MAX_INJECTED = 24;

const METHODS =
  "unit_test, e2e, browser_nav, screenshot, human, text, code_excerpt, artifact, command, diff, doc";

const REFERENCE = [
  "Critères d'acceptation de la tâche (AC-01, AC-02, ...) : chaque critère porte un titre, un détail, au moins une méthode de validation et un statut.",
  "États : à faire, à valider (preuve soumise), à corriger (raison enregistrée), validé.",
  "Tu es le seul juge : il n'y a PAS de vérificateur extérieur. Tu soumets une preuve réelle avec criteria_to_validate, puis tu juges avec criteria_set_status.",
  "Honnêteté obligatoire : ne marque « validé » qu'après une vérification RÉELLE (test passé constaté, fichier ouvert, rendu contrôlé). Le propriétaire lit la liste, les preuves et tes notes : une validation à tort se voit et détruit la confiance.",
  "Les méthodes de validation possibles : " + METHODS + ".",
  "Une preuve à chemin (screenshot, code_excerpt, artifact) doit pointer vers un fichier existant du projet (chemin relatif).",
  "Le cycle type : criteria_add quand le critère naît ; criteria_to_validate avec la preuve quand tu penses l'avoir atteint ; criteria_set_status « validated » quand tu as vérifié, ou « to_fix » avec la raison si le critère n'est pas atteint (puis corrige et revalide).",
].join(" ");

const COMMON = {
  type: "object",
  properties: {
    ref: {
      type: "string",
      description: "Référence du critère (AC-01, AC-02, ...), telle que renvoyée par criteria_list.",
    },
  },
  required: ["ref"],
  additionalProperties: false,
};

/** Rendu compact de la liste pour l'injection de contexte (survit à la compaction). */
const render = (rows) =>
  rows.map((c) => `- ${c.ref} (${statusLabel(c.status)}) ${c.title}`).join("\n");

export default {
  id: "superviseur-criteria",

  async setup(ctx) {
    const key = (sessionID) => STORAGE_PREFIX + sessionID;

    /**
     * Une seule écriture à la fois par session : des tool calls lancés en
     * parallèle (plusieurs criteria_add dans un même tour) lisent-modifient-
     * écrivent sinon en concurrence et le dernier écrivain écrase les autres
     * (constaté le 2026-11-13 : des criteria_add parallèles ont réduit la
     * liste aux deux derniers). Le plugin tourne dans un seul process : une
     * file de promesses par session suffit ; l'entrée est retirée quand la
     * queue retombée au repos n'est plus la nôtre (pas de fuite).
     */
    const queues = new Map();
    const serialize = (sessionID, fn) => {
      const prev = queues.get(sessionID) ?? Promise.resolve();
      const run = prev.then(fn, fn);
      const settled = run.catch(() => {});
      queues.set(sessionID, settled);
      void settled.then(() => {
        if (queues.get(sessionID) === settled) queues.delete(sessionID);
      });
      return run;
    };

    /** État du critère pour une session, coercé en forme propre. */
    const read = async (sessionID) => normalizeState(await ctx.storage.get(key(sessionID)));

    /** Exécute un changement d'état puis persiste ; renvoie la vue complète.
     *  Sérialisé par session : le read-modify-write est atomique face aux
     *  appels parallèles. */
    const apply = (sessionID, mutation) =>
      serialize(sessionID, async () => {
        const state = await read(sessionID);
        try {
          const row = await mutation(state);
          await ctx.storage.set(key(sessionID), state);
          const view = criteriaView(state);
          return { content: JSON.stringify(view, null, 2), metadata: view };
        } catch (error) {
          if (!(error instanceof CriteriaError)) throw error;
          const data = { ok: false, error: error.code, message: error.message, criteria: listCriteria(state) };
          return { content: JSON.stringify(data, null, 2), metadata: data };
        }
      });

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "criteria_list",
        description: [
          REFERENCE,
          "Lis la liste courante des critères avec leurs états, preuves et notes ; lecture seule, ne déclenche rien.",
        ].join(" "),
        options: { codemode: false, permission: "criteria_list" },
        input: { type: "object", properties: {}, additionalProperties: false },
        async execute(input, context) {
          const state = await read(context.sessionID);
          const view = criteriaView(state);
          return { content: JSON.stringify(view, null, 2), metadata: view };
        },
      });

      editor.add({
        name: "criteria_add",
        description: [
          REFERENCE,
          "Crée un critère : {title, detail?, methods[]} ; il démarre « à faire » au prochain numéro libre.",
          "Détail utile : ce qui prouve exactement le critère (commande à passer, parcours à suivre, ce qu'on doit voir).",
        ].join(" "),
        options: { codemode: false, permission: "criteria_add" },
        input: {
          type: "object",
          properties: {
            title: { type: "string", description: "Titre court du critère (ce qui doit être vrai)." },
            detail: { type: "string", description: "Ce qui prouve exactement le critère : commande, parcours, ce qu'on doit voir." },
            methods: {
              type: "array",
              description: "Au moins une méthode de validation (" + METHODS + ").",
              items: { type: "string" },
              minItems: 1,
            },
          },
          required: ["title", "methods"],
          additionalProperties: false,
        },
        async execute(input, context) {
          return apply(context.sessionID, async (state) => addCriterion(state, input ?? {}));
        },
      });

      editor.add({
        name: "criteria_remove",
        description: [
          REFERENCE,
          "Retire un critère {ref} ; sa référence n'est jamais réattribuée (l'historique garde le trou).",
        ].join(" "),
        options: { codemode: false, permission: "criteria_remove" },
        input: COMMON,
        async execute(input, context) {
          return apply(context.sessionID, async (state) => removeCriterion(state, input?.ref));
        },
      });

      editor.add({
        name: "criteria_update",
        description: [
          REFERENCE,
          "Modifie {ref, title?, detail?, methods?} : un critère non « à faire » (à valider, à corriger, validé) repasse « à faire », sa preuve et son jugement sont invalidés.",
          "À utiliser quand le périmètre du critère change, ou quand le propriétaire redéfinit une attente.",
        ].join(" "),
        options: { codemode: false, permission: "criteria_update" },
        input: {
          type: "object",
          properties: {
            ref: COMMON.properties.ref,
            title: { type: "string", description: "Nouveau titre, optionnel." },
            detail: { type: "string", description: "Nouveau détail, optionnel." },
            methods: {
              type: "array",
              description: "Nouvelles méthodes (" + METHODS + "), optionnel ; la liste complète remplace l'ancienne.",
              items: { type: "string" },
              minItems: 1,
            },
          },
          required: ["ref"],
          additionalProperties: false,
        },
        async execute(input, context) {
          return apply(context.sessionID, async (state) => updateCriterion(state, input?.ref, input ?? {}));
        },
      });

      editor.add({
        name: "criteria_to_validate",
        description: [
          REFERENCE,
          "Soumets une preuve {ref, evidence[]} pour passer le critère « à valider » : depuis « à faire » ou « à corriger ».",
          "Chaque preuve est un objet {kind, text, path?, start_line?, line_count?} : text = ce qui prouve (sortie de test, parcours suivi, commande et sa sortie), path = fichier du projet requis pour screenshot, code_excerpt et artifact (code_excerpt exige aussi start_line et line_count).",
          "Enchaîne ensuite avec criteria_set_status : la preuve ne se juge pas toute seule.",
        ].join(" "),
        options: { codemode: false, permission: "criteria_to_validate" },
        input: {
          type: "object",
          properties: {
            ref: COMMON.properties.ref,
            evidence: {
              type: "array",
              description: "Au moins une preuve ({kind, text, path?, start_line?, line_count?}).",
              items: {
                type: "object",
                properties: {
                  kind: { type: "string", description: "Type de preuve (" + METHODS + ")." },
                  text: { type: "string", description: "Ce qui prouve : sortie de test, parcours suivi, observation, commande et sa sortie." },
                  path: { type: "string", description: "Fichier relatif au projet (screenshot, code_excerpt, artifact) : il doit exister." },
                  start_line: { type: "number", description: "Première ligne (code_excerpt)." },
                  line_count: { type: "number", description: "Nombre de lignes (code_excerpt)." },
                },
                required: ["kind", "text"],
                additionalProperties: false,
              },
              minItems: 1,
            },
          },
          required: ["ref", "evidence"],
          additionalProperties: false,
        },
        async execute(input, context) {
          const projectDir = context?.directory ?? "";
          return apply(context.sessionID, async (state) =>
            submitEvidence(state, input?.ref, input?.evidence, projectDir || undefined));
        },
      });

      editor.add({
        name: "criteria_set_status",
        description: [
          REFERENCE,
          "JUGE le critère {ref, status: \"validated\" | \"to_fix\", note} après avoir vérifié sa preuve (criteria_to_validate) ou le travail directement.",
          'status="validated" : le critère est atteint et vérifié. note = ce que tu as réellement vérifié (test passé, fichier consulté, rendu contrôlé) ; une note vide ne prouve rien.',
          'status="to_fix" : le critère n\'est pas atteint ou la preuve ne tient pas. note = la raison, OBLIGATOIRE : elle guide la correction et reste visible du propriétaire. Corrige puis resoumets une preuve (criteria_to_validate) et re-juge.',
          "Interdits : valider un critère sans vérification réelle, valider « pour avancer », ou réutiliser une preuve d'un autre critère. En cas de doute : « to_fix » avec la raison.",
          "« À valider » ne se pose pas ici : il vient de criteria_to_validate (une preuve est exigée).",
        ].join(" "),
        options: { codemode: false, permission: "criteria_set_status" },
        input: {
          type: "object",
          properties: {
            ref: COMMON.properties.ref,
            status: {
              type: "string",
              enum: ["validated", "to_fix"],
              description: "« validated » = validé après vérification réelle ; « to_fix » = à corriger (note obligatoire).",
            },
            note: {
              type: "string",
              description: "Jugement : ce qui a été vérifié (validated) ou la raison du refus (to_fix, obligatoire).",
            },
          },
          required: ["ref", "status"],
          additionalProperties: false,
        },
        async execute(input, context) {
          const projectDir = context?.directory ?? "";
          return apply(context.sessionID, async (state) =>
            setStatusCriterion(state, input?.ref, input?.status, input?.note, projectDir || undefined));
        },
      });

      editor.add({
        name: "criteria_import",
        description: [
          "Remplace la liste complète des critères de la session par celle fournie {criteria: [...]}.",
          "Usage borné : la reprise automatique d'une tâche (le message de reprise porte la liste connue de la session précédente).",
          "Ne l'utilise QUE sur instruction explicite du message de reprise : un import remplace l'état courant, preuves et jugements compris.",
        ].join(" "),
        options: { codemode: false, permission: "criteria_import" },
        input: {
          type: "object",
          properties: {
            criteria: {
              type: "array",
              description: "La liste complète à installer (critères avec ref, title, methods, status, evidence...).",
              items: { type: "object" },
            },
          },
          required: ["criteria"],
          additionalProperties: false,
        },
        async execute(input, context) {
          // sérialisé : un import qui remplace l'état pendant une mutation
          // parallèle écraserait son résultat
          return serialize(context.sessionID, async () => {
            const state = importCriteria(input?.criteria);
            await ctx.storage.set(key(context.sessionID), state);
            const view = criteriaView(state);
            return { content: JSON.stringify(view, null, 2), metadata: view };
          });
        },
      });
    });

    // Réinjection compacte avant chaque requête modèle : la liste survit à la
    // compaction (même mécanisme que superviseur-plan). Ligne par critère,
    // plafonnée : le détail complet reste dans criteria_list.
    await ctx.session.hook("context", async (event) => {
      const state = await read(event.sessionID);
      const rows = listCriteria(state);
      if (rows.length === 0) return;

      const shown = rows.slice(0, MAX_INJECTED);
      const remaining = rows.length - shown.length;
      const done = rows.filter((c) => c.status === "validated").length;

      event.system.push({
        type: "text",
        text: [
          "<criteria_list>",
          `Critères d'acceptation : ${done}/${rows.length} validés. Détail et preuves : criteria_list.`,
          render(shown),
          remaining > 0 ? `... et ${remaining} autres` : "",
          "</criteria_list>",
        ]
          .filter(Boolean)
          .join("\n"),
      });
    });
  },
};
