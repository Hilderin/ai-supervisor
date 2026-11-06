# 05 — Ce que la stack expose réellement (vérifié dans le code)

Référentiels : code OpenChamber = `/home/guillaume/Documents/Projects/openchamber` (v2.6.1), code OpenCode = `/home/guillaume/Documents/Projects/opencode`. Ce doc ne contient que des faits vérifiés dans le code (fichiers cités) ou marqués explicitement « à vérifier ».

Découverte structurante : OpenChamber n'est pas un simple client d'OpenCode. C'est un serveur Express (port 3000 par défaut) qui expose sa propre API `/api/*` et qui relaie le reste vers le serveur OpenCode. Le superviseur s'intégrera donc **à OpenChamber**, pas directement au serveur OpenCode brut.

## 1. Point d'ancrage architecture

- OpenChamber lance le serveur OpenCode ou s'y attache ; les requêtes OpenCode passent par son proxy, et il lit les flux SSE d'OpenCode pour les re-diffuser aux clients en **WebSocket** : `/api/global/event/ws` et `/api/event/ws`, avec replay borné (2 048 événements, 8 MiB). Source : `server/lib/event-stream/*`.
- Pour le superviseur : soit consommer ces WebSockets (même rôle qu'un onglet OpenChamber), soit lire le SSE d'OpenCode directement. **Première option recommandée** : c'est le flux déjà consommé par les interfaces OpenChamber, agrémenté d'événements propriétaires (`openchamber:session-status`, `openchamber:session-activity`, `openchamber:notification`...).

## 2. Sessions : l'état vivant fourni prêt à l'emploi

OpenChamber fait déjà une grande partie du travail de supervision :

- `GET /api/sessions/status` et `/api/sessions/snapshot` (`server/lib/notifications/routes.js:282-308`) : état vivant par session (busy / idle / non lu) **plus** permissions en attente et formulaires (questions) en attente par session. Un seul appel alimente la base de notre état `waiting`.
- `GET /api/session-activity` : activité dérivée du hub SSE.
- L'archivage et le marquage « vu » vivent dans OpenCode même (`time.archived`, `time.viewed`) ; OpenChamber ne garde presque rien en local. Source : `server/lib/openchamber-sessions/*`.
- Les métadonnées propriétaires sont stockées **dans OpenCode** sous `session.metadata.openchamber.*` (merge patch sur `PATCH /api/session/{id}`) : goal, durée du dernier tour, pins de contexte. Le superviseur peut écrire dans le même espace ou garder son propre petit store local — à trancher.

## 3. Session Goals : le mécanisme existe déjà

D'après `server/lib/session-goal/DOCUMENTATION.md` :

- Stockage : `session.metadata.openchamber.goal` (objective, status `active|paused|blocked|budgetLimited|complete`, budgets token/tours) ; le texte long vit dans `<data-dir>/goals/<sessionId>.md`. Routes `PUT/GET/DELETE /api/goals/objective/:sessionId`.
- **Runtime de continuation intégré** : quand une session devient idle, un audit vérifie l'avancement (3 questions oui/non posées à un petit modèle : finir, reste à faire, besoin de l'humain) et relance la session automatiquement jusqu'à 20 tours auto ou épuisement de budget.
- Création : par l'UI ( « le prochain prompt devient l'objectif » ), par tâches planifiées, ou par CLI.

Décision impactée : **ne pas réinventer le goal.** La carte Tâche du superviseur lit le goal OpenChamber (metadata + fichier) et lui ajoute notre couche : titre, journal, template de lancement. Mappage provisoire des états : `active→running`, `blocked→blocked`, `budgetLimited→attention`, `complete→done`.

## 4. Événements et notifications : deux canaux prêts

- SSE agrégé : `GET /api/openchamber/events` (notifications web + événements de runs de tâches planifiées, p.ex. `openchamber:scheduled-task-ran`).
- Notifications : le transport existe — desktop via Electron, **web push VAPID** (`POST /api/push/subscribe`) avec atténuation si la fenêtre a déjà le focus, APNs iOS. Déclencheurs existants : complétion, erreur, question, permission (débounced).
- Politique d'auto-accept des permissions par session : `/api/permission-auto-accept`.

Implication : **ne pas reconstruire le transport des notifications.** Le superviseur branchera son calibrage de signaux sur le canal OpenChamber ; sa valeur ajoutée = priorisation (score d'urgence), digest, snooze avec escalade (cf. doc 07 §7).

## 5. Mémoire : existe, lisible et corrigeable via HTTP

`server/lib/agent-memory/*` — le point d'appui de notre axe mémoire :

- Store JSON : **global** `<data-dir>/memory.json` (60 entrées max) et **par projet** `<data-dir>/projects/<projectId>/memory.json` (200 max). Entrées `{ id, title (60c max), body (2000c max), type: fact|preference|reference, dates }`.
- **Aucun embedding ni recherche vectorielle** : déduplication par recouvrement de mots (seuil 0,75). C'est probablement l'origine du « fonctionne pas très bien » ressenti.
- Exposition à l'agent : outil natif `openchamber_memory` (read/list/save/delete) + injection d'un **index des titres** à chaque session, avant chaque prompt ; l'agent lit le titre puis tire le corps via l'outil.
- HTTP : `GET /api/agent-memory/all`, `PATCH /api/agent-memory/:id` (correction), `DELETE` (purge). La création reste côté agent.

Implication : un **éditeur de mémoire** dans le superviseur est immédiatement possible (lister, fusionner, promouvoir une préférence vers des conventions versionnées, purger l'obsolète). Voir doc 07 §9 pour les artefacts à construire autour.

## 6. « Retrouve la conversation » : une recherche existe déjà (à tester)

`GET /api/openchamber/message-search` avec statut d'index sémantique. Non testé en conditions réelles : premier spike prévu pour en mesurer la qualité. Si l'index tient la route, la fonction « qu'a-t-on fait sur X ? » se fait par recherche + synthèse, pas par un système RAG maison.

## 7. Tâches planifiées : gérables, mais avec des trous

D'après `server/lib/scheduled-tasks/DOCUMENTATION.md` :

- Stockage par projet : `~/.config/openchamber/projects/<projectId>.json` (définition des tâches + état du run : `lastRunAt/nextRunAt/lastStatus/lastError/lastSessionId/lastDurationMs`).
- Support des « loop files » markdown dans `.agents/loops/*.md` (frontmatter schedule/model/agent, corps = prompt).
- Les runs peuvent partir dans un worktree isolé avec branche dédiée et nettoyage auto.
- **Trou identifié** : pas d'historique conservé (`lastStatus` uniquement, « no per-run history » explicitement documenté) et les sessions créées polluent la liste des sessions — ta douleur exacte.

Implication : le superviseur peut (a) fournir le cockpit de gestion des tâches planifiées, (b) tenir un **historique de runs** en indexant `openchamber:scheduled-task-ran` sur le flux, (c) distinguer visuellement les sessions issues du planificateur (la provenance `scheduledTask` est tracée sur le message) pour qu'elles ne noient plus la flotte.

## 8. Projets, worktrees, config

- Projets enregistrés par chemin (id dérivé `path_<base64url>`), config par projet dans `~/.config/openchamber/projects/<id>.json` + un éventuel `<repo>/.openchamber/project.json` partagé (projectActions, draftStarters, magicPrompts...), routes `GET/PUT /api/projects/:id/config`. On peut réutiliser les projectActions comme raccourcis de lancement.
- Worktrees : module git complet (création, bootstrap, teardown, archives) sous `/api/git/worktrees`.
- Le CLI orchestrateur passe déjà par `POST /api/openchamber/sessions` — notre parcours B peut faire de même.

## 9. Auth et ports

- OpenChamber : port 3000 par défaut, mot de passe UI (`--ui-password`), cookie de session. Sans mot de passe, tout est accepté (acceptable en local).
- Les outils agents `openchamber_*` (dont la mémoire) ne sont injectés que si OpenChamber **gère** le serveur OpenCode ; sur serveur externe attaché, ils sont absents. À vérifier quel mode tu utilises — cela conditionne ce que le superviseur peut supposer présent.

⚠️ **Mise en garde versions** : le checkout OpenCode local (`~/Projects/opencode`) est une refonte majeure (Effect, `packages/server`, contract `packages/protocol`) vraisemblablement **en avance sur la version installée** qu'OpenChamber v2.6.1 pilote (client `@opencode/client` 2.2.5). Exemple visible : la doc en ligne documente `GET /session/:id/todo`, le checkout ne connaît plus cet endpoint. Règle : concevoir contre la doc de la version installée, vérifier à l'exécution via `GET /openapi.json`** du serveur réel, et ne jamais coder contre le checkout sans re-vérifier.

## 10. Côté OpenCode (vérifié dans le checkout local)

Points qui changent le design, au-delà des endpoints déjà listés :

- **Le contrat est généré et stable** : `GET /openapi.json` sur le serveur (fichier source `packages/protocol/openapi.json`), client TS officiel `@opencode/client`. Le superviseur doit utiliser ce client ou un codegen — pas de endpoints à la main.
- **Liste des sessions avec recherche serveur** : `GET /api/session` supporte `search`, `archived`, `parentID`, `directory|project`, tri et pagination par curseur (`packages/schema/src/session.ts:65-146`). La douleur P3/P4 (scroll, retrouver) a une vraie base API — croisements avec la recherche de messages d'OpenChamber (§6).
- **Statut : rien de magique**. Il n'existe pas d'endpoint `/session/status` dans ce checkout, et les événements `session.status`/`session.idle` sont **déclarés mais jamais publiés** dans le code (à re-vérifier sur la version installée). La méthode sûre, celle du client officiel : `session.execution.started|succeeded|failed|interrupted` + `session.retry.scheduled` + `GET /api/session/active` à la reconnexion. OpenChamber dérive et synthétise déjà tout ça dans son `/api/sessions/status` → encore un argument pour passer par OpenChamber.
- **« En attente de l'humain » n'est pas un statut de session** : ce sont deux magasins séparés — questions (`form.created/settled`, API `GET/POST /api/session/{id}/form`, réponse `POST .../{formID}/reply`) et permissions (`permission.asked`, réponse `{decision: "once"|"always"|"reject"}`). Pièges : les forms sont en mémoire (10 min après réponse, disparus au redémarrage) ; une question ignorée est annulée au bout de son TTL. → Le superviseur doit indexer les événements au vol, pas les re-lire après coup.
- **Envoyer un prompt = `POST /api/session/{id}/prompt`** avec `delivery: "steer"` (réveille une exécution en cours) ou `"queue"` (file d'attente) — durabilité native, plus de séquence sync/async à gérer. `POST .../interrupt` pour interrompre (l'ancien `abort`).
- **Todos : pas d'endpoint HTTP** dans ce checkout — reconstruire la liste depuis les événements/outils `todowrite` (metadata de `session.tool.*`). À re-vérifier sur la version installée (la doc en ligne connaît `GET /session/:id/todo`).
- **Coût et tokens par session sont natifs** : `Session.Info.cost`, `tokens{...}`, événement `session.usage.updated`, plus un agrégat `GET /api/experimental/session/stats`. → Le budget par tâche (session goal) est fourni clé en main.
- **Injection de contexte** : aucun « memory » natif dans OpenCode ; les entrées d'instruction (`/api/experimental/session/{id}/instructions/entries`) sont le canal utilisé par OpenChamber pour injecter son index mémoire — c'est aussi notre canal si on injecte nos conventions au lancement.
- **Un serveur, plusieurs projets** : chaque requête peut cibler un dossier (`?location[directory]=`, header `x-opencode-directory`), le SSE est global à tout le serveur avec un champ `location` par événement. Possible de connecter plusieurs serveurs, comme fait l'app officielle.
- **Auth** : HTTP Basic (`opencode:<password>`) ou token pairing (`POST /api/pair`).

## 11. Plan d'intégration provisoire (révisé)

Le superviseur = un **client OpenChamber de plus** (comme le desktop, le web, VS Code), qui lui-même s'appuie sur le contrat généré d'OpenCode :

1. Lire `GET /api/sessions/snapshot` / `status` → machine à états (avec pending permissions + questions par session) ;
2. S'abonner à `/api/global/event/ws` → détection continue (fall back : events `session.execution.*` d'OpenCode si besoin) ;
3. Indexer au vol les événements `form.created` et `permission.asked` (état mémoire, TTL) — ne jamais dépendre d'une relecture après coup ;
4. Réutiliser goals (`/api/goals/objective`), mémoire (`/api/agent-memory`), scheduled tasks et message-search ;
5. Écrire le minimum : `session.prompt` (steer/queue), réponses form/permission, interrupt ;
6. Tenir son propre store local : tâches déclarées, journaux, templates, seuils, historique de runs de scheduled tasks. (Variante à trancher : écrire aussi dans `metadata.openchamber.*`.)
