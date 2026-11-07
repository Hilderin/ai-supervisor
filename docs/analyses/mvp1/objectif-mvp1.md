# MVP1 — Objectif du Superviseur flotte (figé)

> Doc déplacé depuis `design_concept/10-mvp1-objectif.md`. Suite continue dans ce dossier : `spike-integration.md` (constats réels), puis plan d'implémentation.

## 0. État au 2026-11-06 (après les premières tuiles)

| # | Capacité | État | Détail |
| --- | --- | --- | --- |
| 1 | Saisie → session | ✔ | chat de supervision à gauche + `start_task` ; barre du haut retirée ; détail : [chat-superviseur.md](chat-superviseur.md) |
| 2 | Cartes d'état | ✔ | statut vivant, âge, titre, projet, progression `x/y` lue dans le `todowrite` de la tâche, confiance du compagnon |
| 3 | Réponse inline | ✔ | questions mono et multi-parts (multiselect, champ libre, Répondre) testées de bout en bout ; **permissions : mode YOLO, parcours non développé** ([permissions-yolo.md](permissions-yolo.md)) |
| 4 | Livraison inline | ✔ | bloc « Résultat » dans la carte : dernier texte markdown + rendu `openchamber_render` sandboxé, route dédiée `GET /api/fleet/delivery`, cache invalidé par événements (détail : `implementation-ui-react.md` §5) |
| 5 | Clôture | ◐ | endpoint daemon `/api/fleet/done` existe ; fermeture carte + `close_task` du chat ; **Repartir pas encore** |
| 6 | ↗ OpenChamber | ✔ | mini chat web dans un panneau latéral, deep-link `/mini-chat.html?mode=session&sessionId={id}`, CSP autorisée via `OPENCHAMBER_FRAME_ANCESTORS` |
| — | SSE instantané | ✖ | le poll 3 s porte tout (tuile planifiée I5) |

> Design tranché et implémenté le 2026-11-06 : chat de supervision à gauche
> + outil `start_task`, barre du haut retirée. La progression vient du
> `todowrite` de la tâche. Voir [chat-superviseur.md](chat-superviseur.md) et
> [chat-superviseur-tests.md](chat-superviseur-tests.md).
>
> Ajout du 2026-11-07 : l'auto-restart (session d'une tâche détruite → nouvelle
> session sur le modèle default courant, carte reprise sans doublon).
> Détail : [auto-restart.md](auto-restart.md).

Un jalon reste **central et testable tout de suite** : le steer pendant un tour en cours (composer sur carte busy) — l'endpoint répond, mais on n'a jamais envoyé un texte dans une session **effectivement busy**.

## 1. L'objectif en une phrase

**MVP1 = la flotte telle que maquettée : chaque carte se règle ici, la consultation des résultats se fait ici, OpenChamber devient l'exception.**

Référence visuelle de l'objectif : `mockups/04-flotte-rendus.html` (la maquette « pas mal intéressante »), validée par Guillaume le 2026-11-06.

## 2. Ce que MVP1 fait (dans l'ordre du critical path)

| # | Capacité | Détail Maquette v4 | Données réelles |
| --- | --- | --- | --- |
| 1 | **Saisie → session** | Entrée dans la barre = une session « En cours » | `POST /api/openchamber/sessions` (ou proxy OpenCode `session.create` + `prompt`) |
| 2 | **Cartes d'état** | dot + titre + phrase d'activité + progression + point confiance | `sessions/status` + événements WS ; progression = todos (voix A du doc 03) |
| 3 | **Question inline** | chip « attends ta réponse » + Oui/Non + champ libre → reprise | questions = `form/*`, permissions = `permission/*` via proxy OpenCode |
| 4 | **Livraison inline** | le rendu (graph, table, synthèse) s'affiche dans la carte LIVRÉS | rendu du dernier message agent (markdown/HTML) ; `openchamber_render` lu dans les tool parts du dernier tour, rendu en iframe sandboxée |
| 5 | **Clôture** | « Repartir » (nouvelle session liée) ou « Terminer » | archivage natif d'OpenCode + note de clôture dans le store local |
| 6 | **↗ OpenChamber** | icône coin haut-droite | deep-link session natif d'OpenChamber |

Note sur l'état « attends ta réponse » : maquette v4 = chip sur la carte, remontée en tête de « En cours ». Si l'usage réel montre un besoin de section dédiée, c'est un détail d'affichage, pas de modèle.

## 3. Ce que MVP1 ne fait PAS (vu de plus tard, pas supprimé)

- Hooks externes (courriel, Mattermost, PRs) — doc 08 §6 ;
- Digest du matin, DND, snooze ;
- Recherche de conversations (P7) ;
- Éditeur de mémoire et conventions versionnées (P8) ;
- Cockpit des scheduled tasks (P10) ;
- Tool `supervisor.report` (confiance déclarée voie B du doc 03) — MVP1 = confiance voie A uniquement ;
- Palette, mobile, multi-thèmes.

## 4. Conditions de succès (critères de validation)

1. **Le test du phare** : 3 s après l'ouverture, la flotte dit qui travaille, qui m'attend, qui a livré — sans ouvrir OpenChamber.
2. **Une journée réelle** : une session lancée, une question répondue, une clôture — entièrement depuis le Superviseur, avec le même résultat que si tout s'était fait dans les sessions elles-mêmes.
3. **Zéro douleur nouvelle** : la flotte ajoute moins d'une action par consultation par rapport à ce que coûte le scroll manuel.

## 5. Prochain pas

Spike d'intégration (~1 h sur la config réelle de Guillaume) :
- vérifier `GET /openapi.json` de son serveur + `sessions/snapshot` (statut, questions, permissions) ;
- créer une session de test via `POST /api/openchamber/sessions`, lui envoyer un prompt, lire ses todos, lui répondre une form, l'abort ;
- ouvrir un deep-link de session et noter le format exact ;
- décider l'hébergement du daemon (process qui maintient les SSE) et le stockage local.
