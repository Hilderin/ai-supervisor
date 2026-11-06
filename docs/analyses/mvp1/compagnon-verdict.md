# Compagnon d'analyse : contrat du verdict

Décisions prises le 2026-11-06 après l'audit des 358 verdicts des sessions
« comp. supervision ». L'objectif est de rendre la carte compréhensible sans
relire la conversation, et de retirer au LLM les décisions qui peuvent être
déduites de faits.

## Symptômes constatés

- 96 verdicts sur 358 affichaient un `attend` ; une minorité seulement
  correspondait à un vrai blocage humain. Les autres demandaient au lecteur de
  relancer ou vérifier le travail de l'agent, ou décrivaient l'attente de
  l'analyste lui-même.
- 33 verdicts étaient `done` avec 85, 90 ou 95 %. 15 baisses de plus de 10
  points, dont 90 → 0 et 85 → 10.
- 108 résumés contenaient du jargon, 171 de la télémétrie, 78 étaient identiques
  au précédent, 18 affichaient un identifiant `ses_…`.

## Contrat

Le verdict JSON du compagnon contient :

| Champ | Rôle | Règle dure |
|---|---|---|
| `state` | `working`, `waiting_human`, `done`, `blocked` | `done` est refusé si le job est `busy` |
| `summary` | ce qui est vrai ou disponible maintenant | 1 à 2 phrases, 240 caractères, français, troisième personne pour l'agent |
| `next` | ce qui reste ou ce qui se passe ensuite | vide si `done` |
| `plan` | 3 à 6 étapes vérifiables | stable tant que l'objectif ne change pas |
| `progress` | calculé par le daemon | `null` sans plan ; 100 seulement si `done` |
| `confidence` | 0 à 1, ou `null` si rien à juger | `null` produit les pastilles grises |
| `confidence_reason` | ce qui soutient et ce qui manque | obligatoire |
| `human_request` | `{needs, source, ask}` | gaté par un signal réel |

## Décisions

1. **L'attente humaine ne vient pas du LLM.** Le daemon la déduit des
   formulaires (`question_tool`), des permissions, ou d'une question explicite
   du dernier message de l'agent (`agent_ask`). Le compagnon ne fait que
   reformuler. Sans signal, `attend` est vide même si le modèle insiste.
2. **La progression vient du plan.** Le daemon calcule les étapes faites sur
   les étapes du plan. Un plan absent donne `progress: null` et pas de barre.
   Une étape faite sans objectif vérifié plafonne à 99 %.
3. **`done` implique 100**, et `busy` interdit `done`.
4. **Un nouvel objectif change la version.** Une consigne longue avec un verbe
   d'action incrémente `objective_version`, remet le plan à zéro et crée un
   nouveau plan. Une réponse courte (« oui », « Bun ») ne change pas l'objectif.
5. **Pas de baisse silencieuse.** À plan identique, une baisse de plus de 5
   points est refusée. Une baisse n'est permise que si l'objectif change ou si
   le plan change réellement.
6. **Le résumé parle du travail, pas de la mécanique.** Interdits : identifiants,
   commits, branches, numéros de document, noms de fichiers, d'outils et de
   tests, pourcentages, « idle », « busy », « extrait », « aucun changement »,
   « le compagnon » pour l'agent, et toute allusion au plan, au contrat ou au
   JSON.
7. **L'agent est une entité distincte du lecteur.** Le compagnon est une session
   enfant : son interlocuteur technique est la session parente, pas l'humain.
   Le prompt le dit explicitement, et le digest nomme le propriétaire `[TOI]`,
   jamais `[HUMAIN]`.
8. **Le digest porte des faits.** Les actions d'outils (fichier écrit, commande,
   test) sont ajoutées au digest. Le raisonnement brut reste indicatif et ne
   doit pas être recopié.
9. **Le prompt est versionné par nom d'agent.** OpenChamber met en cache le
   prompt d'un agent par nom : changer le contenu du fichier ne suffit pas. Le
   daemon crée `superviseur-analyste-<hash>` (symlink vers le fichier canonique)
   et recrée le compagnon si `companion_map.agent` ne correspond pas.
10. **Un digest inchangé n'est pas réanalysé.** Intervalle minimal de 20 s par
    session, 3 analyses simultanées au maximum, migration prioritaire pour
    éviter que deux sessions busy affament les sessions au repos.
11. **Ménage des compagnons.** `bun daemon/scripts/cleanup-companions.mts`
    (simulation) puis `--apply` garde le compagnon de `companion_map` et archive
    les autres, ainsi que les compagnons de parents disparus ou archivés.

## Fichiers

- `daemon/src/verdict.mts` : parsing, normalisation, plan, linter, détection de
  question, résolution d'objectif. Fonctions pures testées.
- `daemon/src/companion.mts` : digest incrémental, actions d'outils, injection,
  reprise unique, dédoublonnage, concurrence et migration.
- `daemon/agent/superviseur-analyste.md` : contrat et exemples.
- `daemon/src/state.mts` : objectif, version, plan, état, source humaine, agent.
- `daemon/scripts/cleanup-companions.mts` : ménage des sessions enfants.
- `daemon/test/verdict.test.mts` : 29 tests unitaires.
- `daemon/test/companion-loop.mts` : 16 assertions e2e réelles.

## Vérifications

- `bun test daemon/test ui/src` : 104 tests au vert.
- `bun run typecheck:ui` : 0 erreur.
- `bun daemon/test/companion-loop.mts` : 16 pass, 0 fail.
- Ménage réel : 62 compagnons actifs → 24, idempotent, zéro mapping orphelin.
- UI réelle : cartes à 40 %, 80 % et 100 %, aucune attente inventée, résumés en
  français à la troisième personne.
