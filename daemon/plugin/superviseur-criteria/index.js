/**
 * SuperviseurCriteria
 * -----------------------------------------------------------------------------
 * Plugin OpenCode v2 chargé globalement (comme superviseur-task) : il expose à
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
 *
 * L'agent est SON PROPRE juge (plus de sous-agent vérificateur) : les
 * instructions d'usage honnête vivent dans les descriptions des tools. Le
 * propriétaire lit la liste, les preuves et les notes : une validation à tort
 * se voit.
 *
 * Sans logique métier : l'appel part vers le daemon Superviseur
 * (POST /api/criteria/:name), qui valide la session (une tâche connue, jamais
 * le chat de supervision), applique la machine à états et répond avec la liste
 * à jour.
 *
 * Dependence-free ESM, chargé tel quel : mêmes conventions que superviseur-task
 * (ctx.tool.transform, codemode: false).
 */

const DAEMON = process.env.SUPERVISEUR_DAEMON ?? "http://127.0.0.1:5180";

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

export default {
  id: "superviseur-criteria",

  async setup(ctx) {
    /** Appel daemon commun : la route applique la machine à états et répond. */
    const call = async (name, input, context) => {
      try {
        const res = await fetch(`${DAEMON}/api/criteria/${name}`, {
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
          return call("criteria_list", {}, context);
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
          return call("criteria_add", input, context);
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
          return call("criteria_remove", input, context);
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
          return call("criteria_update", input, context);
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
          return call("criteria_to_validate", input, context);
        },
      });

      editor.add({
        name: "criteria_set_status",
        description: [
          REFERENCE,
          "JUGE le critère {ref, status: \"validated\" | \"to_fix\", note} après avoir vérifié sa preuve (criteria_to_validate) ou le travail directement.",
          "status=\"validated\" : le critère est atteint et vérifié. note = ce que tu as réellement vérifié (test passé, fichier consulté, rendu contrôlé) ; une note vide ne prouve rien.",
          "status=\"to_fix\" : le critère n'est pas atteint ou la preuve ne tient pas. note = la raison, OBLIGATOIRE : elle guide la correction et reste visible du propriétaire. Corrige puis resoumets une preuve (criteria_to_validate) et re-juge.",
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
          return call("criteria_set_status", input, context);
        },
      });
    });
  },
};
