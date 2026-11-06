# 08 — Que doit faire le Superviseur ? (cadre adopté : PILOT)

Ce doc répond à « clarifions ce qu'on doit faire avant la stack ». Référence principale : ParallelPilot (arXiv 2609.33113, détails dans doc 07 §1).

## 1. Décision de fond : le Superviseur implémente PILOT, adapté à la stack OpenChamber/OpenCode

ParallelPilot a prouvé, chiffres à l'appui, que les cinq pratiques de supervision suffisent à tenir une flotte. Nous adoptons le même squelette, avec notre environnement (sessions OpenChamber, goals natifs, mémoire, worktrees). Trois différences d'environnement s'imposent :

| Élément | ParallelPilot (leur monde) | Superviseur (notre monde) |
| --- | --- | --- |
| Sessions | CLI Copilot/Claude lancés via terminal + prompt collé | sessions **réelles créées via API** OpenCode, goal injecté nativement (Session Goals) |
| Statuts | détectés par poll SQLite + spinners | statuts fournis par `sessions/status` + flux WS d'OpenChamber |
| Journal | capture readline + 3 niveaux générés par LLM | le même 3 niveaux, mais branché sur les événements natifs `session.*` ; le niveau « mémoire » réutilise aussi le GoalJournal de l'agent |
| Écriture | ils n'écrivent pas dans la conversation, ils font répondre en CLI | à définir : si on connecte les boutons « répondre/autoriser » (doc 05 §10), on gagne l'inline que leur dashboard simule |
| Verification | pas traitée : clôture en simple revue humaine | Parcours D = checklist de clôture contre le goal — c'est notre réponse au trou de leur étude |

## 2. Le principe premier de la flotte : suivant l'attention, pas le cycle de vie

La flotte ne suit ni des tickets ni un workflow de développement ; elle suit **l'attention de l'utilisateur** — peu importe la nature du travail des agents :

- Une tâche « message » (« réponds à Gab, j'ai mergé ses PRs ») est une tâche légale : sa carte vit 5 minutes.
- Une tâche « réunion/demo », « estimation », « exploration » ont un mode par natura, avec ses propres seuils et définition de « fait » ; la flotte n'impose pas de decomposition, de waves, de dépendances à déclarer.
- Les 4 signaux de triage de ParallelPilot restent universels et validés : **complétion, question, blocage, retard anormal** — ce sont eux qui traversent toutes les natures de tâches.

Le triage et la vue reste l'ossature validée du papier (#7 : envision best-validated parts), mais le Planning/Isolating de PILOT devient une **pratique optionnelle par tâche**, jamais une étape obligatoire du produit. La cadence est protégée : lancer une tâche doit rester un acte de quelques secondes ; le contexte peut être enrichi plus tard, pendant que la session tourne.

## 3. Les trois composants du Superviseur (version adaptée)

| Composant ParallelPilot | Notre composant | Ce qu'il fait |
| --- | --- | --- |
| Planning Interface | **Point de lancement** | saisir les tâches, goal, contexte, templates, agent/projet ; (plus tard : hints de dépendances sur les fichiers partagés) ; lancer les sessions avec goal injecté |
| Run-Logger | **Journal flotte (Log)** | 3 niveaux : brut (stockage local), mémoire de session markdown (décisions, changements, résultats), résumé de suivi court ; sert aussi à lancer la session suivante |
| Ambient Dashboard | **Flotte (Observe + Triage)** | colonnes Fini / En cours / Prochain ; cartes 1-ligne ; needs_attention jaune qui signale question/permission/erreur/retard ; réponse inline aux questions binaires et permissions |

Les deux piliers restants :

- **Isolating** : déjà couvert par OpenChamber (worktrees) — le Superviseur n'a qu'à **afficher** la séparation (montrer quelles tâches touchent quels fichiers) et avertir en cas de chevauchement.
- (Triaging et Observing sont dans le dashboard, Logging dans le journal, Planning dans le lancement.)

## 3. Ce que le Superviseur fait EN PLUS de ParallelPilot (pour nos P1-P12)

Ces extras ne sont pas dans le papier — une liste à trancher pour le MVP :

| Extra | Douleur adressée | Dépendance |
| --- | --- | --- |
| Recherche de conversations (message-search OpenChamber + synthèse) | P7 | dans la pile (index déjà présent côté OpenChamber) |
| Éditeur de mémoire + conventions versionnées injectées | P8 | pas de dépendance |
| Cockpit des scheduled tasks + historique de runs | P10 | indexation du flux |
| Coût/tokens par tâche (budgets) | P11 | natif dans OpenCode |
| Digest + DND + snooze | P12 | se greffe sur le flot de notifications OpenChamber |
| Sélecteur de projets / réduction du scroll | P1-P4 | découle du tri par état du dashboard |

## 4. Consciemment hors périmètre (pour l'instant)

- L'analyse automatique des dépendances (« Analyze & Plan » à la leur) : le rôle peut être joué par une session d'analyse (ton workflow analyse→révise→plan). À regarder après le MVP.
- Orchestration auto (vagues automatiques, agent coordinateur).
- PR/revue/merge automatisés — OpenChamber gère déjà.
- Rien de multiutilisateur, rien d'hébergé à distance.

## 5. Critère de succès

Si on ne retient qu'un test : **la flotte, avec des tâches de natures totalement différentes, répond en 3 secondes à « qui m'attend, et qu'est-ce qui tourne ? » sans ouvrir OpenChamber.** Ensuite, les cibles chiffrées inspirées de l'étude : un agent supplémentaire supervisé en simultané, et mesurablement moins d'effort de suivi manuel.

## 6. Hub d'attention : la flotte reçoit du monde extérieur (nouveau)

Idée ajoutée en brainstorming (2026-11-06) : le Superviseur ne se contente pas de lancer et suivre — il **reçoit des hooks** : courriel reçu, message Mattermost/Slack, commentaire sur une PR... et détermine si ça demande ton attention. Le point central « juste commencer une tâche » devient passif autant qu'actif.

**Les trois familles d'actions dans la même flotte** :

| Type de carte | Exemple | Ce qui se passe |
| --- | --- | --- |
| **Relais humain (entrant)** | courriel de Gab après merge de ses PRs | la carte arrive avec le contexte, réponse pré-draftée ou non ; tu cliques, tu tapes, ça repart par le canal d'origine — pas besoin de session d'agent du tout |
| **Acte sortant (venu de toi)** | « envoie un message à Max : absent au meeting aujourd'hui » | la carte naît de ta barre, avec canal et destinataire ; tu tapes le court message (ou tu le délègues à un agent si le contexte est long), envoi, fin — il n'y a ni session à suivre ni goal, juste un acte à ne pas oublier |
| **Travail d'agent** | bug, estimation, présentation, explication | comme au §3 : une session OpenCode, un goal, la flotte de suivi |

Ce que le cas Max enseigne : la **source** de la carte (l'extérieur, l'utilisateur, une session) ne change pas sa forme, seulement son canal de retour. La flotte est donc un **bureau d'actions**, pas seulement un état des sessions : certaines cartes sont des choses qu'on t'attend à faire, d'autres des choses que tu remets à tes agents — même carte, même geste minimum.

Une tâche « Réponds à Gab » n'est donc plus dictée par toi : le signal arrive, on le **relie** d'un clic à la bonne tâche (ou il crée la tâche), et la réponse est un champ inline sur la carte.

**Le triage de l'extérieur** : chaque hook passe le même tamis que les sessions (doc 07 §7 — score d'urgence, digest, suppression adaptative, DND). La valeur ajoutée du Superviseur : **un seul seuil d'attention pour la flotte ET le monde extérieur**, au lieu d'un régulateur par application.

**À décider plus tard** (ne conditionne pas le MVP) : quels canaux en premier (les PRs sont déjà couverts par l'intégration GitHub d'OpenChamber ; courriel et Mattermost demandent des petits ponts à créer), quelle confiance accorder au triage automatique, et la réponse inline part-elle du Superviseur ou renvoie-t-elle au client natif. Le MVP peut exister sans un seul hook — c'est le même modèle de carte qui se prolonge.
