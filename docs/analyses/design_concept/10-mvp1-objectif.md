# 10 — MVP1 : le Superviseur flotte (objectif figé)

Référence visuelle de l'objectif : `mockups/04-flotte-rendus.html` (la maquette « pas mal intéressante »), validée par Guillaume le 2026-11-06..Adjugé.

## 1. L'objectif en une phrase

**MVP1 = la flotte telle que maquettée : chaque carte se règle ici, la consultation des résultats se fait ici, OpenChamber devient l'exception.**

## 2. Ce que MVP1 fait (dans l'ordre du critical path)

| # | Capacité | Détail Maquette v4 | Données réelles |
| --- | --- | --- | --- |
| 1 | **Saisie → session** | Entrée dans la barre = une session « En cours » | `POST /api/openchamber/sessions` (ou proxy OpenCode `session.create` + `prompt`) |
| 2 | **Cartes d'état** | dot + titre + phrase d'activité + progression + point confiance | `sessions/status` + événementsWS ; progression = todos (voix A du doc 03) |
| 3 | **Question inline** | chip « attends ta réponse » + Oui/Non + champ libre → reprise | questions = `form/*`, permissions = `permission/*` via proxy OpenCode |
| 4 | **Livraison inline** | le rendu (graph, table, synthèse) s'affiche dans la carte LIVRÉS | rendu du dernier message agent (markdown/HTML) ; `openchamber_render` en增强之后 |
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
2. **Une journée réelle** : une session lancée, une question répondue, une clôture — entièrement depuis le Superviseur, avec le même résultat que si tôt des sessions.
3. **Zéro douleur nouvelle** : la flotte ajoute moins d'une action par consultation par rapport à ce que coûte le scroll manuel.

## 5. Prochain pas

Spike d'intégration (~1 h sur la config réelle de Guillem) :
- vérifier `GET /openapi.json` de son serveur + `sessions/snapshot` (statut, questions, permissions) ;
- créer une session de test via `POST /api/openchamber/sessions`, lui envoyer un prompt, lire ses todos, lui répondre une form, l'abort ;
- ouvrir un deep-link de session et noter le format exact ;
- décider l'hébergement du daemon (process qui maintient les SSE) et le stockage local.
