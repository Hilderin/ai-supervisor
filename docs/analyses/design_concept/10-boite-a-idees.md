# Boîte à idées

Idées et suggestions en vrac, à creuser (ou non) plus tard. Rien d'engagé ici : une idée peut être ajoutée en deux lignes, puis promue vers un doc de conception si elle tient.

## Sommaire par importance

L'importance est jugée sur l'apport au cœur du Superviseur (voir ce qui tourne, comprendre où ça va, intervenir à temps), puis sur le coût quand deux idées se valent. Un gros pari pas encore tranché (le chat permanent) descend, parce qu'on ne peut pas le prioriser avant les signaux de base. C'est un jugement de travail, révisable.

Les idées à faire sont triées par priorité. Les idées complétées ou closes sont listées ensuite ; les sections détaillées conservent l'ordre d'origine.

### À faire

| # | Idée | Pourquoi ce rang | Coût | État |
|---|------|------------------|------|------|
| 18 | Supporter Markdown dans le chat du superviseur | Lisibilité de ce qu'écrivent les agents, d'abord dans le chat du superviseur où le texte d'agent est le plus dense (brief, questions et tooltips restent l'analyse de fond) ; coût faible | faible | Partiel : chat seulement |
| 22 | Rendre les blocs `openui-lang` des agents : chat du superviseur, réponses `answer`, résultat | OpenChamber sait dessiner ces blocs nativement ; le Superviseur les laisse en texte brut, alors que Steps, Table ou Callout disent mieux qu'un paragraphe ce qu'un agent a fait | moyen | À faire |
| 23 | Le chat du superviseur gère le tool `question` (et le préfère aux blocs openui-lang) | Une question de l'orchestrateur est aujourd'hui du texte à recopier ; le tool `question` donne une carte répondable, et l'instruction évite des blocs openui-lang inertes dans le Superviseur | faible à moyen | À faire |
| 19 | Un petit bouton config dans la conversation | Confort (modèle et agent à chaud), le plus simple des deux réglages de modèle ; utile dès que la flotte tourne | faible | À faire |
| 20 | Choisir le modèle du chat, des tâches et du compagnon | Le modèle est un levier de coût et de qualité invisible aujourd'hui ; il manque un geste simple pour régler chaque type de conversation | faible à moyen | À faire |
| 1 | Le superviseur fixe l'objectif, et peut stopper ou rediriger un agent qui dérape | Protège du travail qui part dans la mauvaise direction, né d'un cas réel : c'est la raison d'être du Superviseur (porter l'attention) | moyen | À faire |
| 24 | Stop et revert pour une tâche (comme pour le chat) | Une erreur sur une tâche ne se rattrape pas : ni stop du tour, ni retrait de la file, ni revert, alors que le chat sait déjà faire les deux et que l'idée 1 suppose ce geste | moyen | À faire |
| 5 | Envoyer des instructions pendant qu'une tâche travaille | Capacité de pilotage centrale (queue, direct, fork, btw), mais dépend de ce que l'API permet réellement | moyen à élevé | Partiel : file d'attente |
| 7 | Un mode plan pour le superviseur : lire le projet avant de cadrer une carte | Le brief d'une tâche est deviné à partir d'une phrase : sans lecture du projet, l'objectif et les critères restent génériques et l'humain corrige ce que l'agent n'a pas pu lire ; même outils que le mode discussion, autre intention | moyen | Partiel : mode Investigation et lecture bornée |
| 8 | Un vrai mode conversationnel : brainstormer sans lancer de tâche | Le chat existe, mais son agent est un aiguilleur sans accès au projet : il manque la posture (discuter) et des outils de lecture ; le coût est surtout du prompt et une bascule explicite | faible à moyen | À faire |
| 12 | Notifications desktop + badge d'attention sur l'icône | Le Superviseur doit venir vers l'utilisateur quand il n'est pas devant ; sans ça, tout le reste suppose l'œil sur la fenêtre | moyen | À faire |
| 13 | Chemins de fichiers et URL cliquables dans les résultats | Aller du résultat au fichier sans copier-coller ; s'appuie sur le rendu existant de la livraison et sur `/api/fleet/asset` | faible à moyen | À faire |
| 15 | Always on top + une UI qui tient dans un coin | Définit le mode d'usage (patch d'écran) ; à faire une fois les signaux essentiels arrêtés | moyen | À faire |
| 21 | Coller des images dans le chat et les cartes | Le presse-papiers est le chemin le plus court pour montrer une maquette, une erreur ou un rendu cassé ; confort réel, mais secondaire face au pilotage | faible à moyen | À faire |

> Ordre révisé le 2026-11-08 : le markdown du chat, les blocs `openui-lang`, le tool `question` du chat puis les deux réglages de modèle passent en tête ; le reste garde son ordre d'origine. Les raisons de rang sont celles d'origine, ajustées seulement là où elles contredisaient la nouvelle position.

### Complétées / closes

| # | Idée | Pourquoi ce rang | Coût | État |
|---|------|------------------|------|------|
| 2 | Ordre des cartes figé : les nouvelles en bas, rien ne bouge sous le curseur | L'instabilité de l'écran empêche de lire la flotte pendant qu'on travaille ; bénéfice quotidien pour un coût faible | faible | Fait |
| 3 | Une ligne « action en cours » : ce que l'agent fait vraiment, tout de suite | Répond au doute « est-ce que ça avance ? » dès les premières secondes, sans attendre l'analyse du compagnon | faible à moyen | Couvert autrement : étape courante du plan |
| 4 | Voir une erreur de session sur la carte (et le retry qui suit) | Un tour qui échoue et réessaie ressemble à un tour qui avance : sans signal, on confond erreur et lenteur ; l'événement d'échec arrive déjà au daemon, il est simplement jeté | faible à moyen | Fait |
| 6 | Un tool « dire à l'utilisateur » : informer sans arrêter le travail | Complète le canal utilisateur → tâche (rang 5) par le sens inverse : la tâche peut répondre ou signaler au fil du tour, sans tour ni question bloquante ; le récepteur existe déjà (le chat sait afficher), c'est la sortie qui manque | faible à moyen | Fait : tool `answer` |
| 9 | Mettre à jour une étape du plan sans réécrire la liste | Répare un signal déjà affiché qui ment : la barre reste vide puis saute à 100 % ; une barre fausse coûte plus qu'une ligne absente | moyen | Fait : `todoupdate` |
| 10 | Objectif courant affiché sur la carte, en plus du résumé | Complète les rangs 1 et 3 : savoir où va la carte, pas seulement ce qu'elle fait ; un champ à ajouter | faible | Clos : les critères d'acceptation portent l'objectif sur la carte |
| 11 | Numéroter les tâches, avec un préfixe par projet | Une référence stable pour suivre et désigner une tâche (« reprends la 42 ») alors que le titre change ; peu coûteux et utile partout (carte, chat, notifications) | faible | Clos : les cartes sont fixes à l'écran |
| 14 | Pinner des conversations / indiquer une priorité | Triage quand la flotte grossit ; secondaire tant que l'ordre des cartes n'est pas stabilisé | faible à moyen | Clos : l'ordre des cartes est stable |
| 16 | Date et heure de la dernière activité sur une conversation | Petit signal complémentaire (session vivante ou morte), peu coûteux, non bloquant | faible | Fait |
| 17 | Un chat permanent, à droite ? (le « poste de commandement » conversationnel) | Gros pari d'architecture, à trancher après les signaux de base : il peut réorienter toute l'UI | élevé | Fait : chat à gauche |

## Idées

### Le superviseur fixe l'objectif, et peut stopper ou rediriger un agent qui dérape

Idée du 6 nov, née d'un vrai cas : la demande portait sur l'ajout d'une idée dans la boîte (la confiance non définie) ; l'agent l'a comprise comme « implémente-la » et est parti en implémentation. En réunion, avec la flotte qui roule en parallèle, ce genre de glissement passe inaperçu : une demande de conception est devenue un chantier de code sans garde-fou, et on ne s'en aperçoit qu'après coup. (L'implémentation en question est conservée : elle était presque terminée et utile ; mais le cas montre bien le manque.)

Ce que le superviseur devrait savoir faire :

- **fixer l'objectif de chaque conversation** : l'objectif explicite, fixé (ou confirmé) par l'utilisateur au lancement, devient la référence de jugement, pas juste une info affichée (c'est la suite logique de l'idée « objectif courant », plus bas) ;
- **détecter le dérapage** : l'analyste compare le travail observé à l'objectif et remonte un signal quand il part du champ gauche : périmètre élargi sans mandat, type de sortie inattendu (du code au lieu d'une note, par exemple), ou objectif qui a changé sous le coude ;
- **arrêter ou rediriger en un clic depuis la carte** : stopper (interrupt / kill), recentrer (send direct avec consigne de realignement, les modes d'envoi déjà listés ici), ou fork pour tester une autre voie sans perdre l'original ;
- potentiellement un garde-fou symétrique pour l'agent du superviseur lui-même : une demande d'écriture dans cette boîte à idées n'est pas une demande d'implémentation ; au delà du cas particulier, une règle générale à écrire : « dérive d'entendement à valider avant d'agir hors du périmètre explicite ».

Lien : Goal du doc 02, niveaux de signal du doc 03, PILOT du doc 08. C'est précisément le cas où le Superviseur porte l'attention : sentir un dérapage d'un coup d'œil, depuis un meeting, pendant que la flotte roule.

### Ordre des cartes figé : les nouvelles en bas, rien ne bouge sous le curseur

Discussion du 6 nov : pendant qu'on lit la flotte, et surtout pendant qu'on écrit dans une carte, de nouvelles tâches surgissent et les cartes se réordonnent. Les titres changent de place sous le curseur, et une carte peut quitter la zone qu'on était en train de lire. Demande : les tâches en cours ne doivent jamais changer d'ordre à l'écran, et les nouvelles doivent se ranger en bas.

Constat sur le code actuel :

- `daemon/src/fleet.mts` retrie à chaque poll : cartes en attente (formulaire / permission) d'abord, puis `busy`, puis `turnStartedAt` décroissant. Un nouveau tour, ou une carte qui devient `busy`, remonte donc au-dessus des autres ;
- `FleetBoard.tsx` ne fait que répartir les lignes reçues dans les trois sections : c'est le daemon qui décide de l'ordre relatif ;
- `ui/src/lib/placement.ts` ne stabilise que le passage EN COURS ↔ TERMINÉ (hystérésis de 8 s) : l'ordre interne d'une section n'a aucun garde-fou. Le même type d'hystérésis, appliqué à l'ordre, serait la piste naturelle.

Piste : un ordre d'arrivée strict, tenu côté UI (l'ordre reçu n'est plus suivi) : une carte garde sa position tant qu'elle est affichée, les nouvelles sont ajoutées à la fin, et les changements d'état ne réordonnent pas.

Sous-question soulevée le même jour, à trancher : **faut-il supprimer les sections et n'avoir qu'une seule liste, toujours dans le même ordre ?** Avantages : plus de saut d'une section à l'autre, une carte ne change jamais de place, et on retrouve une carte par sa position (mémoire spatiale). Coûts : on perd le triage « ce qui m'attend » en haut, qui est le signal principal du dashboard ; il faut le remplacer par un marqueur d'état (badge, couleur, liseré d'attention) et par un moyen de faire remonter une carte urgente (voir l'idée « pinner des conversations »).

À creuser avant d'implémenter :

- ordre d'arrivée ou ordre de création de la session (une session ancienne relancée est-elle « nouvelle » et repart-elle en bas ?) ;
- sort d'une carte terminée : elle reste à sa place et pâlit, ou elle descend en bas une fois le verdict stabilisé (ce qui est déjà un déplacement, donc une exception assumée) ;
- compagnon qui change d'avis : une carte qui repasse EN COURS revient-elle à sa position d'origine, ou reste-t-elle là où elle est ;
- interaction avec la liste fermée (`closed`) et avec le filtre des sessions enfant : un retrait ne doit pas faire glisser toutes les cartes vers le haut ;
- cohérence SSE / GET : l'ordre figé doit être porté par un état persistant de l'UI, sinon chaque snapshot reconstruit depuis `fleet.rows` réintroduit le tri du daemon.

> Fait le 2026-11-07 : l'ordre vit côté UI (`ui/src/lib/order.ts`, persisté sous `superviseur.fleet.order.v1`, avec une grâce de 2 min pour une disparition brève), un changement d'état ne déplace plus une carte et les nouvelles prennent le rang suivant. Les sections sont conservées.

### Une ligne « action en cours » : ce que l'agent fait vraiment, tout de suite

Discussion du 6 nov : au démarrage d'un tour, il se passe un moment avant que la carte ne montre qu'il avance. Le compagnon n'analyse qu'à idle + 5 min, et un tour qui commence par des tool calls n'a pas encore de texte ; en attendant, la carte affiche « Réflexion en cours… » (cas `isStaleTurn`) ou le résumé du tour précédent, et on ne sait pas si la tâche démarre, patine ou est déjà partie ailleurs.

Demande : afficher sur la carte, **en une ligne**, la vraie action en cours de l'agent, dès le début du tour : le dernier tool call et son objet court (« lecture `daemon/src/fleet.mts` », « `bun test` », « écriture `ui/src/components/SessionCard.tsx` »). Un signal factuel immédiat, avant que le résumé du compagnon ne prenne le relais.

Constat sur le code actuel :

- `SessionCard.tsx` n'affiche que `row.sup.resume` (ou `briefRow`, ou « Réflexion en cours… ») : rien de l'activité brute du tour en cours ;
- le digest du compagnon sait déjà extraire le `reasoning` du dernier assistant quand le tour n'est pas fini (`daemon/src/companion.mts`) : la matière première existe, elle n'est simplement pas rendue en une ligne d'action ;
- le SSE pousse des événements de message : de quoi rafraîchir la ligne sans attendre une analyse.

À creuser avant d'implémenter :

- d'où vient la ligne : tool call + argument court, déduit des messages (factuel, gratuit, mais brut), ou champ produit par le compagnon (interprété, mais coûte un tour et arrive trop tard pour le besoin) ? Le premier répond mieux à l'urgence ; le second peut rester le résumé de fond ;
- la forme : une seule ligne tronquée (anti wall-of-text, doc 03), avec le détail complet en tooltip ;
- l'anti-flicker : par nature la ligne change souvent ; ne la mettre dans le sig de la carte que si la valeur change, et éventuellement la lisser (garder la dernière action lisible quelques secondes) pour éviter un texte qui clignote ;
- l'articulation avec le résumé : la ligne d'action est l'info « à chaud » pendant `busy`, le résumé prend le relais au repos ; ne pas afficher les deux quand ils disent la même chose ;
- coût côté daemon : garder l'état du tour en cours (dernier tool call, horodatage) dans la ligne de flotte, plutôt que de le relire à chaque frame.

Lien : états et signaux du doc 03, idée « objectif courant affiché sur la carte » (plus bas) : même emplacement, même souci de ne pas transformer la carte en mur de texte.

> Fait autrement le 2026-11-07 : pas de ligne de tool call. Le plan est toujours présent (`todowrite`), et la carte affiche l'étape courante (`Étape : <texte>`, l'étape `in_progress`, à défaut la première `pending`, dans `SessionCard.tsx`) : le doute « est-ce que ça avance ? » est couvert par la progression du plan, et la piste du dernier tool call n'est pas retenue.

### Voir une erreur de session sur la carte (et le retry qui suit)

Discussion du 7 nov : quand une requête au LLM échoue, OpenChamber va réessayer tout seul, mais le Superviseur n'affiche rien : la carte reste « en cours », avec son brief habituel. Une tâche qui réessaie ressemble à une tâche qui travaille ; on ne sait ni qu'un problème existe, ni s'il faut intervenir (stopper, relancer), ni quand la prochaine tentative aura lieu.

Demande : un état d'erreur distinct de « en cours » au niveau de la carte (et du chat) : une mention courte, visible d'un coup d'œil (« erreur, nouvelle tentative »), et le détail en tooltip (message, numéro de tentative, temps restant si OpenChamber l'annonce).

Constat sur le code actuel :

- l'événement SSE `session.execution.failed` arrive déjà au daemon, mais ne sert qu'à fermer le cycle du compagnon (`daemon/src/kicks.mts`) : l'échec n'est jamais retenu pour la flotte ;
- `FleetRow` n'a pas de champ d'erreur : la carte n'a rien à afficher tant que la ligne de flotte ne porte pas l'info ;
- les deux états d'erreur du chat (`sendError`, `refreshError`) parlent du superviseur lui-même, pas des tâches qu'il surveille.

À creuser avant d'implémenter :

- **ce que l'événement expose** : le payload de `session.execution.failed` (message, code), et si OpenChamber annonce ses tentatives et leur programmation quelque part ; s'il n'expose rien, commencer par « le dernier tour a échoué », sans prétendre connaître le plan de retry ;
- **états** : une mention sur la carte existante plutôt qu'une quatrième section ; l'erreur peut toucher une carte « en cours » comme une carte au repos (le tour a échoué, la session est idle en attente du retry) ;
- **faux signal de réflexion** : un tour en retry ne produit pas de tool call, donc la carte passe vite en « Réflexion en cours… » ; la mention d'erreur doit remplacer ce faux plutôt que cohabiter ;
- **fin du retry** : quand la reprise réussit, la carte revient à l'état normal sans bandeau résiduel ; en cas d'échec répété, épaisser la mention plutôt que la répéter à l'identique ;
- **anti-flicker** : l'état change plus souvent que done/running ; le garder hors du sig pendant ses oscillations, ou le passer à l'hystérésis de `placement.ts` ;
- **sortie** : l'erreur est le moment où le superviseur veut agir ; lier la mention aux gestes du rang 1 (stop, message direct) pour éviter un signal sans action.

Lien : idée « une ligne action en cours » (la ligne peut porter la mention quand il n'y a pas de tool call), doc 03 (états et signaux), leçons sig et hystérésis dans `ui/src/lib/placement.ts`.

> Fait le 2026-11-07 : le daemon retient les événements `session.execution.failed` et `session.retry.scheduled` par session. Les cartes distinguent « Erreur OpenCode » et « Nouvel essai », le détail expose message/type/code et numéro de tentative. La reprise, la réussite, l'interruption ou un nouveau prompt efface le signal. Un retry ne republie pas `session.execution.started` (il marque le tour, pas la tentative) : le signal « Nouvel essai » porte donc son échéance `at` et s'efface quand la tentative reprend, au lieu de rester pendant tout le travail rattrapé jusqu'à la fin du tour (corrigé le 2026-11-08). Tests : `daemon/test/session-issues.test.mts`, `ui/src/lib/cardState.test.ts`, `ui/src/components/SessionCard.test.tsx` et `ui/src/components/TaskInspector.test.tsx`.

### Envoyer des instructions pendant qu'une tâche travaille

Comme le fait OpenChamber : pouvoir envoyer un message à une session **même quand sa tâche est en cours d'exécution**, sans attendre qu'elle se termine ou qu'elle pose une question.

Deux modes d'envoi :

- **Mode « queue »** : le message est mis en file et sera traité par la session dès qu'elle a fini son tour actuel. Pour les demandes qui peuvent attendre (« ensuite, ajoute aussi un test », « quand tu as fini, commit »).
- **Mode « send direct »** : le message part immédiatement dans la conversation en cours. Pour les corrections de cap (« non, pas ce fichier », « arrête, change d'approche »), utile justement quand on voit la tâche partir dans la mauvaise direction depuis le Superviseur.
- **Mode « fork »** : le message fork la conversation en cours ; la session courante continue sa vie et le fork part avec le message, sans perturber l'original. Pour tester une variante d'approche ou explorer une sous-question sans risquer la session principale.
- **Mode « btw »** : poser une question **sans déclencher d'action** : la session répond à côté (ou une fois son tour fini ?) mais ne modifie pas son plan ni son travail en cours. Pour les questions du type « au fait, tu utilises quelle lib pour ça ? » qu'on ne veut pas voir transformées en instruction.

Implications à creuser :

- Dans l'UI : comment distinguer visuellement les deux modes (champ unique avec un toggle ? deux boutons d'envoi ?) sans que ce soit un geste compliqué.
- Comment représenter la file d'attente d'une session (les messages en attente sont-ils visibles ? annulables ? réordonnables ?).
- Ce que l'API OpenCode server / OpenChamber permet réellement pour injecter un message dans une session active (voir doc 05).
- Lien avec le concept de « débloquer » du doc 04 : le send direct est le cas général de « répondre à une question bloquante ».

### Un tool « dire à l'utilisateur » : informer sans arrêter le travail

Discussion du 7 nov : pour informer l'utilisateur, une tâche n'a que la question bloquante (le tool question, qui met la carte en attente d'un choix) ou le texte final de son tour (la livraison). Si l'utilisateur pose une question pendant un tour, la réponse attend la fin du travail ; si l'agent découvre quelque chose d'utile en route, il doit soit interrompre son ordre de priorité pour en parler, soit attendre d'avoir terminé. Un tool léger, un aparté, remplirait le trou : répondre ou signaler une information utile sans arrêter le travail.

Demande : un tool disponible dans les sessions de travail qui pousse une information courte vers le superviseur : un aparté sur la carte (« la tâche dit : ... ») et un message dans le chat du superviseur, sans créer de tour, sans bloquer, et sans toucher au plan.

Constat sur le code actuel :

- les sorties existantes : le texte final (livraison, en fin de tour), le tool question (bloquant, attend un choix humain), ou l'analyse du compagnon (différée, idle puis 5 min) : rien entre les deux ;
- le daemon lit déjà les tool parts des messages de la session de travail (le plan vient du part `todowrite`, `daemon/src/todos.mts`) : un tool part « dire » peut être lu de la même façon, sans nouveau réseau ni authentification ;
- le plugin global SuperviseurTodoList (`daemon/plugin/superviseur-todolist`, référencé dans `opencode.jsonc`) est le précédent pour outiller toutes les sessions de tâches avec des tools directs (sans codemode) ;
- le sens inverse existe : le chat sait envoyer à une tâche pendant son tour (mode file, message-queue) ; il n'y a juste pas de trace d'un mode où l'agent répond sans tour.

À creuser avant d'implémenter :

- **nom et charge** : un aparté par information, texte court (une à trois phrases, markdown inline au plus) ; un aparté n'est pas un log d'exécution ;
- **chemin de lecture** : tool part lu passivement par le daemon (gratuit, résiste à l'indisponibilité de l'instance) contre un POST du plugin vers le daemon (temps réel, mais auth et réseau) ; commencer passif : quelques secondes de latence de poll suffisent ;
- **affichage** : aparté d'une ligne sur la carte (les derniers d'abord, dans le sig de la carte) et message « la tâche X dit » dans le chat ; la livraison reste le résultat du tour, l'aparté reste l'information en route ;
- **pas de retour** : l'aparté ne doit jamais repartir dans la session (ni file d'attente, ni direct), sinon chaque aparté crée un tour ; écriture hors session, comme les métadonnées ;
- **anti-spam** : une limite d'apartés par tour (2 ou 3) et un clamp sur la carte, sinon le canal devient un mur ; l'historique complet reste lisible dans le chat ;
- **prompt** : une consigne courte dans les agents (signaler par aparté quand l'information n'a pas besoin de réponse), le tool question restant réservé aux véritables choix ;
- **relation avec l'analyse** : le compagnon reformule après coup ; donner l'aparté en matière première plutôt que de répéter son contenu en double dans le résumé.

Lien : idée « envoyer des instructions pendant qu'une tâche travaille » (l'autre sens du canal, les modes d'envoi), leçon « Livraison inline » dans `AGENTS.md` (le dernier texte assistant n'est pas la réponse), doc [mvp1/chat-superviseur.md](../mvp1/chat-superviseur.md), `daemon/src/todos.mts` pour la lecture des tool parts.

> Fait le 2026-11-07 : le tool `answer` (plugin `superviseur-task`, route `POST /api/task/answer`) écrit dans `task_answer` ; la carte affiche le compteur de réponses non lues, le panneau de détails lit la liste complète, et « Got it » les marque comme lues. Livré sous une autre forme que l'idée : pas de message dans le chat, et rien ne repart dans la session (la réponse est un enregistrement hors session).

### Un mode plan pour le superviseur : lire le projet avant de cadrer une carte

Discussion du 7 nov : le superviseur crée des cartes à partir de quelques phrases et de l'état de la flotte. Il n'a ni fichiers, ni recherche, ni web : le brief (objectif, critères, contraintes) reste générique, les hypothèses sont devinées, et le compagnon doit ensuite juger un objectif que personne n'a vérifié. L'humain corrige à la main ce que l'agent n'a pas pu lire, ou découvre trop tard que la carte visait à côté.

Demande : un mode plan, dans le chat, où le superviseur peut explorer avant de cadrer : lire les docs et le code du projet visé, chercher dans les conversations passées, puis proposer une carte complète (but, périmètre, critères de fin, hypothèses, risques) à valider avant le lancement. Aucune écriture : il lit, il propose, l'humain lance.

Constat sur le code actuel :

- `daemon/agent/superviseur-orchestrateur.md` a `read`, `glob`, `grep`, `webfetch` désactivés ; le prompt compense par des règles génériques (« propose une tâche, demande la précision minimale ») ;
- `start_task` accepte un `context` (repris dans `composePrompt`) mais le chat n'a rien pour le remplir autrement qu'avec la phrase de l'utilisateur ;
- le chat vit dans `~/.superviseur`, pas dans le dossier du projet : la lecture doit être cadrée sur un projet désigné (comme le fait `list_projects` pour le lancement) ;
- la flotte garde déjà de la matière (états, verdicts, journal), mais aucun outil ne l'expose au chat pour retrouver une tâche ou une décision passée.

À trancher :

- **mode explicite ou posture par défaut** : un sélecteur (Piloter / Planifier) ou le mode plan automatique à chaque demande de tâche ? Le mode explicite est prévisible ; le plan par défaut alourdirait les lancements évidents ;
- **outils** : `read`, `glob`, `grep` sur le dossier du projet ; `webfetch` seulement s'il est autorisé ; rien en écriture, pas de `bash`, pas de `todowrite`. Un agent distinct (`superviseur-plan-<hash>`) évite de mélanger les consignes et respecte le cache par nom ;
- **lecture seule n'est pas sans risque** : borner les chemins au dossier du projet (même validation que `/api/fleet/asset`), et ne pas laisser le chat lire `~/.superviseur` ni la base ;
- **proposition de carte** : un rendu structuré (objectif, critères, contraintes, hypothèses) que l'utilisateur valide, puis `start_task` avec ce contexte ; sans ce rendez-vous, l'exploration ne change pas la qualité du brief ;
- **coût et latence** : lire quelques fichiers avant de lancer prend du temps et des tokens ; le mode plan doit pouvoir s'arrêter (« assez lu ») et les lancements triviaux rester directs ;
- **rapport avec le mode discussion** (rang 8) : mêmes outils de lecture, intention différente ; ne pas construire deux mécanismes de sélection de projet.

Lien : idée « un vrai mode conversationnel » (le pendant discussion), idée « objectif courant » (rang 10) et rang 1 (la qualité de l'objectif est la référence du jugement), `daemon/agent/superviseur-orchestrateur.md`, `daemon/src/tools.mts` (`start_task` et `context`), doc [mvp1/chat-superviseur.md](../mvp1/chat-superviseur.md).

> Implémenté en partie le 2026-11-07 : sélecteur explicite Piloter / Investigation dans le chat ; projet choisi dans le catalogue OpenChamber ; outils daemon `read_project`, `glob_project`, `grep_project`, chemins relatifs, liens symboliques refusés, tailles et retours bornés. Le dispatch serveur refuse toutes les opérations hors lecture en Investigation. Le cadrage est proposé dans le fil ; l'utilisateur repasse explicitement en mode Piloter avant `start_task`.
>
> Écarts conservés : la recherche dans les conversations passées (`message-search`) n'est pas exposée, car son contrat et sa qualité n'ont pas encore été vérifiés ; aucun `webfetch` ni outil natif n'est donné à l'agent. La proposition est du texte structuré dans le fil, pas encore un bloc de carte avec validation dédiée. Voir la décision dans [06](06-questions-ouvertes.md) et le contrat dans [chat-superviseur.md](../mvp1/chat-superviseur.md).

### Un vrai mode conversationnel : brainstormer sans lancer de tâche

Discussion du 7 nov : le Superviseur est bon pour partir des tâches et surveiller une flotte, mais pas pour penser à deux. Le chat parle déjà, seulement son agent est un aiguilleur : il cadre une intention et lance une session, et le reste du temps il renvoie vers une tâche. Pour brainstormer (« est-ce que cette idée tient ? », « comment aborder ce sujet ? »), deux murs : la posture (tout finit en brief) et l'accès (le chat n'a ni fichiers, ni web, ni exécution : il ne peut pas lire le projet dont on parle).

Demande : un mode conversationnel assumé dans le chat : discuter d'une idée, la retourner, proposer des pistes, sans créer de tâche ni de plan, et sans transformer la discussion en brief. Si elle converge, un geste explicite peut en faire une tâche, en reprenant l'objectif et le contexte de l'échange.

Constat sur le code actuel :

- l'agent du chat (`daemon/agent/superviseur-orchestrateur.md`) n'a pas les outils de lecture, le même manque que l'idée « mode plan » ci-dessus : rien pour explorer le sujet ;
- son prompt pousse à l'action : « transforme une intention en tâche », « ne réponds pas seulement je ne peux pas : c'est souvent une intention de tâche », et « intention implicite : demande tu veux que je lance ? » ;
- le chat vit dans `~/.superviseur` : même avec la lecture activée, il ne verrait pas le dossier du projet dont on parle sauf à le désigner ;
- la leçon du rang 1 (une idée lue comme un chantier) montre le risque : un mode qui lance dès qu'il entend un verbe d'action.

Options, à trancher :

- **mode explicite « Discuter » / « Piloter »** : prévisible, il change la consigne et les outils ; en discussion, lecture seule sur un projet désigné, pas d'écriture, pas de `start_task` sauf demande. Coût : un état de plus dans l'UI, et il faut y penser ;
- **registre inféré** : plus fluide, mais c'est exactement le glissement que le rang 1 veut empêcher ; à ne pas retenir seul, éventuellement en secours du mode explicite ;
- **atelier séparé** : une session en lecture sur le dossier du projet, distincte du chat d'orchestration ; plus puissante pour lire le code, mais deux fils à suivre et la bascule vers la tâche moins directe.

Préférence (à confirmer) : mode explicite dans le chat, lecture seule sur un projet choisi, et un bouton « en faire une tâche » à la convergence, qui reprend le contexte de la discussion.

À creuser avant d'implémenter :

- **outils du mode discussion** : `read`, `glob`, `grep`, éventuellement `webfetch` ; jamais `edit`, `todowrite` ni `start_task` sans demande. Qui les porte : un agent distinct (le prompt est mis en cache par nom) ou le même agent avec une consigne de mode ?
- **dossier** : la session du chat est dans `~/.superviseur` ; le mode discussion doit désigner un projet (le dernier utilisé ?), sinon la lecture ne sert à rien ;
- **sortie** : pas de livraison et pas de carte ; à la convergence, le résumé devient le contexte d'une tâche (`start_task` a déjà `context`) ou une note dans cette boîte ;
- **modèle** : brainstormer appelle un modèle fort, aiguiller un modèle rapide ; lien avec l'idée « changer de modèle facilement » ;
- **mémoire** : une discussion utile doit rester retrouvable ; la session OpenChamber la garde, mais rien ne la relie à une idée ou un projet dans le Superviseur ;
- **longueur** : pas de carte donc pas de clamp, le chat redevient un fil normal ; c'est le but, mais ça change le ton et la densité des réponses (déjà la règle du prompt : pas de tableau décoratif).

Lien : idée « un chat permanent » (rang 17), idée rang 1 (dérive), idée « changer de modèle facilement », `daemon/agent/superviseur-orchestrateur.md`, doc [mvp1/chat-superviseur.md](../mvp1/chat-superviseur.md).

### Mettre à jour une étape du plan sans réécrire toute la liste

Discussion du 6 nov : la progression d'une carte est calculée depuis le dernier `todowrite` de la session de travail. Or cet outil remplace la liste entière : pour cocher une étape, le modèle doit recopier toutes les autres. Le geste est cher, donc les modèles le repoussent et n'écrivent le plan qu'une fois le travail fini : la barre reste vide pendant le tour, puis saute à 100 %.

Ce n'est pas un oubli de consigne : le prompt de démarrage dit déjà « marque `in_progress` quand tu commences une étape et `completed` quand elle est finie », mais dans la même phrase que « Remplace la liste complète à chaque changement ». La consigne et l'outil se contredisent, et c'est l'outil qui gagne.

Demande, en deux volets :

- **un outil d'update partiel** : passer l'étape (index ou id) et son nouvel état, sans renvoyer la liste ; la liste stockée reste l'unique source, l'outil la modifie sur place ;
- **un prompt cohérent** : garder la mise à jour au fil de l'eau, retirer l'obligation de tout réécrire, et dire qu'une étape se marque `in_progress` avant d'être commencée, pas après.

Constat sur le code actuel :

- le plugin vit dans un dépôt séparé (`OpenCodeTodoList/opencode-plugin`) et n'expose que `todowrite` (remplacement complet) et `todoread` ;
- `daemon/src/todos.mts` ne reconnaît que le nom `todowrite` (`isTodoTool`) : un nouvel outil doit y être lu aussi, sinon la barre reste vide malgré les mises à jour ;
- le daemon garde le dernier événement d'une fenêtre de 80 messages : le contrat « dernier plan connu » doit survivre à deux noms d'outils ;
- `composePrompt` (`daemon/src/tools.mts`) porte déjà la consigne de progression, couplée à « remplace la liste complète ».

À creuser avant d'implémenter :

- **contrat de l'outil** : index stable ou id d'étape ? Un index se décale dès qu'une étape est insérée ou supprimée ; un id oblige à le stocker et à le rendre à la lecture ;
- **métadonnées** : le tool part `todoupdate` doit exposer la liste complète résultante (`state.metadata.todos`), pour que le daemon n'ait pas à rejouer un état partiel et garde sa règle « plan identique, progression qui ne baisse pas » ;
- **compatibilité** : garder `todowrite` pour créer ou remplacer un plan, ajouter `todoupdate` pour les changements d'état ; les sessions en cours et l'historique restent lisibles ;
- **coût d'appel** : l'update partiel doit être visiblement moins cher qu'un `todowrite` complet, sinon le modèle revient à l'ancien geste ;
- **erreur lisible** : un index ou un id inconnu produit une erreur explicite, pas un plan inchangé ;
- **petites tâches** : ne pas transformer chaque tour en cérémonie ; le plan reste de 3 à 6 étapes, et rien à afficher quand il n'y a pas de plan.

Lien : idée « une ligne action en cours » (même besoin de signal à chaud), leçon « Todo list de tâche » dans `AGENTS.md`, `daemon/src/todos.mts` pour la lecture, `daemon/src/tools.mts` pour le prompt.

> Fait le 2026-11-07, sous le nom **SuperviseurTodoList** (`daemon/plugin/superviseur-todolist`, référencé dans `~/.config/opencode/opencode.jsonc`) : le plugin expose un `todoupdate` par numéro, transactionnel (état inconnu ou numéro hors bornes refusés, sans réécrire la liste), et chaque tool part porte la liste complète. Côté daemon, `composePrompt` demande désormais la mise à jour par numéro (`todoupdate`) plutôt que le remplacement complet ; les numéros restent l'index du tableau, rien de persistant de plus côté daemon.

### Objectif courant affiché sur la carte, en plus du résumé

Discussion du 6 nov : ajouter une ligne « objectif courant » sur chaque carte, en plus du `resume` du compagnon. Le résumé dit ce qui se passe, pas où ça va ; sur une flotte, c'est l'info qui manque au retour (« c'est quoi le but de cette carte ? ») et l'entité Goal du doc 02 n'est jamais rendue à l'écran.

> Clos le 2026-11-08 : les critères d'acceptation de la tâche (barre et compteur sur la carte, liste dans le détail) disent déjà où elle va ; une ligne « objectif » de plus ferait doublon sur une carte déjà dense.

En l'état, le verdict du compagnon (`Verdict` dans `ui/src/types.ts`) n'a pas de champ goal : le digest passe le premier message humain comme contexte, et le prompt de l'analyste ne le réutilise qu'au détour d'un tour vide (« je travaille sur ta demande : <objectif court> »).

Avis et réserves (à trancher avant d'implémenter) :

- pas une deuxième phrase de texte : une ligne courte, de type « Objectif : migrer le schéma v2 », sinon la carte devient un mur (anti wall-of-text, doc 03) ;
- éviter la redondance : pour une petite tâche, objectif = résumé ; l'analyste ne remplit le champ que s'il apporte quelque chose de distinct ;
- champ de plus à produire à chaque tour : risque de plateau, donc le mettre dans le sig de la carte et ne l'afficher que s'il change (leçon anti flicker) ;
- coût d'implémentation faible si validé : clé en anglais `goal` déclarée requise dans le JSON de l'analyste (leçon clés en anglais), puis une ligne dans `SessionCard`.

### Numéroter les tâches, avec un préfixe par projet

Discussion du 6 nov : dans la flotte, une tâche ne s'identifie que par son titre, qui peut changer (la session le réécrit) et se ressemble d'une carte à l'autre. Pour suivre la flotte, et surtout pour en parler (« reprends la 42 »), un identifiant court serait plus fiable qu'un titre. Demande : numéroter les tâches, avec éventuellement un préfixe par projet (`ais-42`, `mvp1-7`).

> Clos le 2026-11-08 : les cartes sont désormais fixes à l'écran, une tâche se retrouve par sa position et se désigne par son titre ; un numéro n'apporterait pas la référence stable qui manquait.

Ce que ça apporterait :

- une référence **stable dans le temps**, même quand le titre change ;
- un moyen de désigner une tâche **hors de l'écran** : dans le chat du superviseur, dans une notification, dans un doc ou une note ;
- un repère de mémoire (« la 12, c'est la plus ancienne encore ouverte »).

Constat sur le code actuel :

- l'identité d'une tâche est `session_id` (clé primaire de `task_state`), un id opaque du type `ses_...` : inutilisable à l'oral ;
- `task_state` n'a pas de compteur ; `task_log.id` est un `AUTOINCREMENT`, mais c'est un journal d'événements, pas des tâches ;
- le titre vient de la session OpenCode et peut changer en cours de route.

À creuser avant d'implémenter :

- **stabilité** : le numéro doit être alloué une fois et jamais réutilisé, même après archivage, suppression de session ou reset de la flotte. Il ne peut donc pas être un simple rang d'affichage, ni l'ordre d'insertion de `task_state` (créé à la volée quand une session apparaît). Une table `task_number(session_id, project, n)` avec un compteur par projet, allouée à la première vue, tient la contrainte ;
- **préfixe par projet** : le daemon ne connaît aujourd'hui que le dossier de la session (`dir`), il n'y a pas de notion de projet. Le préfixe viendrait d'une correspondance dossier → préfixe (ou d'une forme courte du nom de dossier), avec un cas par défaut quand le dossier est inconnu ;
- **portée** : numéroter par projet (`ais-42`) ou en global (`42`) ? Le global est plus simple, mais ambigu dès qu'on parle à quelqu'un d'autre ou qu'on mélange deux flottes ;
- **affichage** : préfixe discret dans l'en-tête de carte, avant le titre, sans prendre la place du titre et sans casser la lisibilité en petit format ;
- **réutilisation** : le même numéro doit servir dans le chat du superviseur, les notifications, les tooltips et la recherche ; c'est ce qui donne sa valeur à l'idée ;
- sessions enfant (compagnon) : elles ne sont pas des tâches et ne doivent pas consommer de numéro.

Lien : idée « objectif courant affiché sur la carte » (même zone d'en-tête), idée « un chat permanent » (le numéro devient la poignée pour désigner une tâche), doc 02 (entité Task).

### Notifications desktop + badge d'attention sur l'icône

Comme le fait OpenChamber :

- des **notifications desktop** quand quelque chose mérite l'attention (tâche bloquée sur une question, tâche terminée, échec...) : le Superviseur étant une fenêtre qu'on ne regarde pas en continu, c'est lui qui doit venir vers l'utilisateur ;
- un **badge de compte sur l'icône** de l'app : le nombre de tâches ayant besoin de mon attention, visible sans ouvrir la fenêtre.

À creuser : le seuil de notification (tout ou filtré par priorité ? risque de spam inversé : l'habituer, c'est le tuer), la déduplication (une notification qui reste valable ne doit pas se répéter), et l'alignement avec le badge (qu'est-ce qui « consomme » une notification : la lecture de la carte ? la réponse à la session ?).

### Chemins de fichiers et URL cliquables dans les résultats

Discussion du 6 nov : les résultats d'un agent sont pleins de chemins (`daemon/src/fleet.mts:42`) et d'URL, et le Superviseur les affiche comme du texte. Pour aller voir le fichier cité, il faut copier le chemin, ouvrir l'éditeur, coller : un aller-retour par ligne lue.

Constat sur le code actuel :

- `DeliveryMarkdown` rend déjà les liens markdown (`[x](url)`) en `target="_blank"`, et `remark-gfm` transforme les URL nues en liens ;
- en revanche un chemin nu (`daemon/src/fleet.mts`, `ui/src/components/SessionCard.tsx:28`) n'est jamais un lien, ni dans la livraison ni dans le brief de carte : c'est du texte ;
- les images locales ont déjà leur route (`/api/fleet/asset`), avec validation du chemin dans le dossier de la session : le précédent existe pour un accès fichier contrôlé.

Demande : rendre cliquables les chemins de fichiers et les URL là où ils apparaissent (livraison, brief de carte, ligne d'action en cours, questions), avec le geste attendu : ouvrir le fichier dans l'éditeur à la bonne ligne, ouvrir l'URL dans le navigateur.

À creuser avant d'implémenter :

- **ce qu'on ouvre** : pas de `file://` depuis un navigateur ; il faut un schéma d'app (`vscode://file/...`, `zed://`, `openchamber-ui://`) ou un bouton « ouvrir dans l'éditeur », avec un défaut par OS. Vérifier ce qu'OpenChamber expose déjà : la carte utilise `openchamber-ui://session/:id` ;
- **détection** : une regex de chemins (avec `:ligne:colonne`) attrape aussi des faux positifs (`http://`, `1/2`, versions, noms de paquets). Restreindre aux chemins qui existent réellement dans le dossier de la session, ou exiger un préfixe connu (`src/`, `./`, extension) ;
- **sécurité** : un chemin cliquable ne doit pas permettre de sortir du dossier de la session (même validation que `/api/fleet/asset`) ; une URL s'ouvre dans le navigateur, jamais chargée dans l'UI ;
- **rendu** : dans un contexte d'une ligne (brief de carte), le lien ne doit pas casser le clamp ni transformer la carte en arc-en-ciel ; un style discret, souligné au survol ;
- **chemins inexistants** : afficher un état (grisé, tooltip « introuvable ») plutôt qu'un lien mort ;
- **copier** : le clic ouvre, mais le chemin doit rester sélectionnable pour être copié.

Lien : idée « markdown dans l'affichage » (le rendu inline est le prérequis pour le brief), leçon « Images locales de la livraison » dans `AGENTS.md`, route `/api/fleet/asset`.

### Pinner des conversations / indiquer une priorité

Pouvoir **pinner** des conversations, ou leur **indiquer une priorité**, pour qu'elles remontent en haut de la liste, au-dessus des autres. Complète le triage : ce qui est urgent à mes yeux reste visible même quand la flotte bouge beaucoup.

> Clos le 2026-11-07 : l'ordre des cartes est désormais stable ; elles ne bougent plus selon leur activité. Le pin ou la priorité ne sont donc plus nécessaires pour compenser les déplacements.

### Always on top + une UI qui tient dans un coin

Deux compléments, pensés pour **laisser le Superviseur visible en permanence sans lui dédier un écran** :

- **« Always on top »** : une option pour garder la fenêtre au premier plan, au-dessus des autres (le patch à l'écran unique) : je code/joue/regarde Netflix, et le Superviseur reste lisible dans le coin.
- **une UI qui fonctionne en petit format** : s'assurer que tout (ou l'essentiel) se dégrade proprement dans une fenêtre réduite : la liste de la flotte compacte, une carte par ligne active, l'essentiel des signaux visibles. Si la fenêtre fait 300-400 px de large, je dois encore voir *ce qui tourne* et *ce qui m'attend*.

À creuser : est-ce un mode dédié (un « mode coin d'écran » avec densité maximale, défini dès la conception) ou juste une responsive correcte ? Quels parcours restent possibles en petit format (lire oui, mais débloquer / répondre ?) et à partir de quelle taille bascule-t-on sur l'interface complète.

### Date et heure de la dernière activité sur une conversation

Chaque conversation affiche **la date et l'heure de sa dernière activité**, doublée d'un temps relatif restimé en continu : « 4 nov 14h45 (3j) », « 9h34 (2h) ». L'absolu pour vérifier, le relatif pour sentir d'un coup d'œil si la session est vivante.

> Fait le 2026-11-07 : la date et l'heure de la dernière activité sont affichées sur la conversation, avec un temps relatif pour estimer sa fraîcheur d'un coup d'œil.

### Un chat permanent, à droite ? (le « poste de commandement » conversationnel)

Observation : dans PILOT, tout un panneau de chat vit à droite en permanence. Question ouverte ici : **le Superviseur devrait-il avoir ce chat**, et pourrait-il **remplacer la textbox en haut** ?

L'idée :

- un chat **simple**, bien séparé des tâches de la flotte : il **ne crée pas de tâches** de lui-même, il est un espace pour demander au superviseur (à un agent assistant dans l'UI) ;
- on peut pourtant **démarrer des tâches depuis ce chat** : le chat est en fait **une session OpenCode/OpenChamber à part entière**, qui a accès à un **MCP dédié au serveur Superviseur**. Elle pilote alors la flotte par outils, un peu comme le ferait l'utilisateur avec des clics ;
- ce que ce MCP de supervision pourrait exposer :
  - démarrer une session / lancer une tâche ;
  - voir l'état des sessions (et leur historique de signaux) ;
  - répondre dans une session (les modes d'envoi ci-dessus : queue, send direct, fork, btw) ;
  - mettre à jour l'état d'une session (ex. en marquer une en attente, priorisée) ;
  - **rechercher dans les conversations passées** (le superviseur comme cerveau de la mémoire de la flotte) ;
  - **réouvrir des sessions marquées terminées**.

Ce que cette idée réduirait ou changerait :

- la textbox en haut n'est plus un formulaire spécial « lancer une tâche », le même surface sert au bavardage et au lancement ; une seule entrée de parole vers le système ;
- la distinction « Parler au superviseur » vs « Lancer un agent » devient une distinction **d'intention interprétée par l'assistant**, plus une distinction d'UI. Risque : contrôle réduit (l'utilisateur doit-il confirmer le lancement d'une tâche ? voir doc 06) ;
- relation au phare : si l'utilisateur passe son temps dans le chat, le dashboard ne doit pas devenir secondaire ; le chat est le bras, le dashboard reste la tête.

Questions à trancher plus tard : ce chat est-il un agent distinct (quel modèle ?) ou une session OpenChamber ordinaire ? Sécurité du MCP de supervision (l'assistant peut tout faire ? confirmation humaine pour les actions d'écriture ?).

> Approfondi, tranché le 2026-11-06 et livré : le chat est retenu comme **surface d'orchestration**, finalement **à gauche** de la flotte, et non comme chat de tâche. Voir [mvp1/chat-superviseur.md](../mvp1/chat-superviseur.md).

### Markdown dans l'affichage (hors livraison)

Discussion du 6 nov : les agents écrivent du markdown par nature (gras, `code`, listes, liens, chemins), et le Superviseur ne le rend qu'à un seul endroit : la livraison. Partout ailleurs le texte sort brut, avec ses astérisques et ses backticks, ce qui rend les chemins et les commandes moins lisibles.

> Périmètre resserré le 2026-11-08 : le rang vise d'abord le chat du superviseur (entrée renommée « Supporter Markdown dans le chat du superviseur ») ; le brief de carte, les questions et les tooltips restent l'analyse de fond, pas l'objet du rang.

Constat sur le code actuel :

- seul `DeliveryMarkdown` passe par `react-markdown` (avec `skipHtml`, sans `rehype-raw`), et seulement pour le bloc de livraison ;
- restent en texte brut : le `brief` de `SessionCard` (`resume` du compagnon, `briefRow`, « Réflexion en cours… »), la ligne ✋, la question et les options de `QuestionBox`, le texte de permission, et le tooltip de confiance (`note`).

Demande : rendre le markdown partout où le texte vient d'un agent ou d'un humain, à deux niveaux :

- **inline seulement** (gras, italique, `code`, lien) pour les contextes d'une ligne : brief de carte, question, options, tooltip. Le but est la lisibilité, pas la mise en page ;
- **bloc complet** (listes, titres, tableaux, blocs de code) réservé à la livraison, où il y a la place : c'est déjà en place.

À creuser avant d'implémenter :

- ne pas transformer la carte en mur : le brief reste une ligne (clamp), donc pas de titres ni de listes dedans ; le markdown ne doit pas pouvoir casser la hauteur d'une carte ;
- liens : ouverture externe, jamais de navigation dans l'UI ; images locales réécrites vers `/api/fleet/asset` comme la livraison ;
- sécurité : `skipHtml` et pas de `rehype-raw` partout, y compris dans les tooltips (une bulle en HTML brut serait un vecteur) ;
- perf et flicker : rendre du markdown à chaque frame coûte plus qu'un `span` ; garder en cache le rendu par valeur de texte (le `resume` est déjà dans le sig de la carte) et ne re-rendre que s'il change ;
- options de formulaire : le libellé part aussi dans la réponse (`{qN: valeur}`), donc le markdown ne doit exister qu'à l'affichage, jamais dans la valeur envoyée ;
- copier-coller : un chemin rendu en `code` doit rester sélectionnable tel quel.

Lien : anti wall-of-text du doc 03, leçons « Rendu openchamber_render » et « Images locales de la livraison » dans `AGENTS.md`.

### Un petit bouton config dans la conversation

Dans l'en-tête d'une conversation (sans doute à côté du modèle/agent affiché), un petit bouton de config permettant d'ajuster à chaud :

- **le modèle** de la session (ex. besoin de passer sur un modèle plus fort ou plus rapide en cours de route) ;
- **l'agent** (ex. changer `build` pour un `plan`, ou brancher un agent spécialisé).

À creuser : le changement s'applique-t-il immédiatement (au prochain tour de la session) ou seulement nouvel envoi ? Faut-il une confirmation avant de basculer ? Comment signaler dans l'historique qu'un changement de modèle/agent a eu lieu (traçabilité des échanges) ?

### Choisir le modèle du chat, des tâches et du compagnon

Discussion du 7 nov : le modèle devient un choix de pilotage (un modèle fort pour réfléchir, un modèle rapide et bon marché pour les petites tâches), mais le Superviseur ne permet pas de le choisir : tout est régi par défaut de la session, invisible, et le changer suppose de ressortir de l'interface.

Demande, quatre endroits :

- **dans le chat du superviseur** : un sélecteur court près du composer (quelques modèles favoris, la valeur courante marquée), ou une commande simple (« passe sur ... » vers un modèle précis) que l'orchestrateur applique à sa propre session ;
- **à la création d'une tâche** : un champ modèle au moment du lancement, avec un défaut par projet (reprendre le modèle de la tâche précédente) ; le paramètre existe déjà côté outil (`start_task` accepte `model`), il n'a pas d'UI ;
- **sur la carte d'une session lancée** : c'est le terrain de l'idée « un petit bouton config » (au-dessus) ; les deux idées se rejoignent là ;
- **pour le compagnon de supervision** : un réglage dédié du modèle utilisé par ses conversations d'analyse, indépendant du modèle du chat et des tâches. Le changement doit aussi être propagé aux conversations de compagnon déjà en cours, afin que leurs prochaines analyses utilisent le modèle choisi, et pas seulement aux nouveaux compagnons.

Constat sur le code actuel :

- le message du chat part avec le modèle courant de la session : la file d'attente exige un `sendConfig` (`providerID`, `modelID`) lu dans les métadonnées de la session (`sendConfigOf`, `daemon/src/supervisor.mts`) ; la variante y est déjà prévue (`variant`) ;
- `start_task` accepte un modèle (`args.model`, `daemon/src/tools.mts`) et le stocke dans le task brief : l'orchestrateur peut le passer quand on le nomme, mais rien ne le propose dans le chat ;
- le daemon n'a pas de liste de modèles : le catalogue viendrait de l'API OpenCode/OpenChamber, à réduire en favoris pour éviter un sélecteur démesuré.

À creuser avant d'implémenter :

- **ce que l'API permet** : changer le modèle d'une session existante (au prochain tour ? par message ?) ou seulement à la création ; c'est la même question que l'idée « config dans la conversation », à trancher une fois pour les deux ;
- **propagation au compagnon** : déterminer comment mettre à jour les sessions de compagnon existantes quand le réglage change, pour que le nouveau modèle s'applique à leurs prochaines analyses sans attendre leur recréation ;
- **chat : un état explicite** : le sélecteur du chat porte la session du superviseur, donc un changement s'applique aux conversations suivantes ; afficher le modèle courant choisi (et la variante), pas seulement un réglage fugitif du composer ;
- **modèle + variante** : proposer le couple (modèle, variante), sinon on change de modèle sans pouvoir choisir « thinking » ou sa variante rapide ;
- **visibilité** : montrer le modèle en usage sur la carte et dans le chat ; sans ça, on ne sait pas ce que le geste a changé ;
- **défaillance** : un modèle indisponible ne doit pas laisser la tâche sans tour ; s'aligner sur l'idée « voir une erreur de session » (mention, nouvelle tentative) ;
- **coût** : un modèle plus fort coûte plus cher ; une mention du modèle courant suffit à rendre le choix éclairé, sans tableau de consommation pour l'instant.

Lien : idée « un petit bouton config dans la conversation » (le changement sur une carte lancée), `daemon/src/supervisor.mts` (`sendConfigOf`), leçon « File d'attente OpenChamber » dans `AGENTS.md` (`sendConfig` obligatoire), doc [mvp1/chat-superviseur.md](../mvp1/chat-superviseur.md) pour le composer.

### Coller des images dans le chat et les cartes

Discussion du 6 nov : on colle souvent une capture dans une conversation (maquette, message d'erreur, rendu cassé), et le Superviseur n'accepte aujourd'hui que du texte. Il faut d'abord enregistrer le fichier, le nommer, puis demander à l'agent de l'ouvrir : un aller-retour pour une information que le presse-papiers portait déjà.

Demande : un collage direct (Ctrl+V) dans la zone de saisie du chat superviseur et dans le composer d'une carte, avec un aperçu avant l'envoi (vignette, nom, poids), la possibilité de retirer la pièce jointe, et l'envoi de l'image avec le texte dans le même message.

Constat sur le code actuel :

- les deux composers sont des `textarea` qui n'envoient qu'une chaîne (le texte du prompt) : aucun champ de pièce jointe ;
- le chat affiche le markdown via `ChatMarkdown`, qui masque volontairement les images (`img: () => null`) : une image collée ne serait pas visible dans la conversation ;
- la livraison a déjà le chemin pour les images locales (`/api/fleet/asset`, raster seulement, 10 Mo), mais c'est une lecture de fichier existant, pas un envoi depuis l'UI.

À creuser avant d'implémenter :

- **où vit l'image** : un fichier sur disque (dossier du chat ou de la session, puis route asset) ou une data URL dans le message ? Le fichier évite de gonfler l'historique et réutilise la validation existante ;
- **ce que l'API accepte** : vérifier qu'un message OpenCode peut porter une part image, et que la file d'attente (`/api/message-queue`) transporte aussi la pièce jointe, sinon un collage pendant un tour busy est perdu ;
- **formats et limites** : png, jpeg, webp, gif, taille maximale, et un message clair quand l'image est refusée ;
- **gestes** : collage et glisser-déposer, plus un bouton trombone quand le presse-papiers n'est pas accessible ;
- **affichage** : vignette dans le message, clic pour agrandir, jamais de HTML brut ; une image refusée affiche un texte, pas une icône cassée ;
- **capture sans nom** : le presse-papiers fournit souvent l'image seule ; prévoir un nom généré et un texte facultatif ;
- **brouillon** : la pièce jointe doit survivre à un changement de section de carte, comme le texte (le brouillon vit déjà dans le store).

Lien : leçons « Images locales de la livraison » et « Rendu openchamber_render » dans `AGENTS.md`, idée « chemins de fichiers et URL cliquables » (même route asset), doc [mvp1/chat-superviseur.md](../mvp1/chat-superviseur.md) pour le composer du chat.

### Rendre les blocs `openui-lang` des agents (étapes, tableaux, graphiques)

Discussion du 7 nov : OpenChamber sait dessiner des blocs d'interface écrits en `openui-lang`, son petit langage de composants (Stack, Steps, Callout, Table, Badge, Progress, graphiques) : un agent qui écrit un tel bloc dans une conversation OpenChamber obtient un rendu natif, par exemple un parcours d'étapes avec flèches et un encadré d'avertissement. Le Superviseur, lui, n'a pas ce rendu.

Demande : un petit moteur de rendu `openui-lang` dans le Superviseur, appliqué là où le markdown est déjà rendu (livraison, panneau de détails) : un agent pourrait livrer un parcours d'étapes, un tableau comparatif ou un graphique sans que le Superviseur ait à construire une page HTML complète via `openchamber_render`.

Constat sur le code actuel :

- la livraison rend le markdown (`DeliveryMarkdown` : GFM, `skipHtml`, sans `rehype-raw`) et les pages `openchamber_render` via iframe sandboxée (`SandboxedRender`) ; entre les deux, rien : un `Steps` ou un `Callout` reste du texte brut ;
- le langage est un DSL simple, une instruction par ligne (`root = Stack([...])`, composants et arguments), parseable côté UI sans dépendance lourde ;
- les blocs servent déjà ailleurs : le chat OpenChamber les rend nativement, et le prompt de l'orchestrateur les interdit explicitement aujourd'hui (« pas de bloc `openui-lang`, pas de tableau décoratif ») : l'instruction devra évoluer en même temps que le moteur.

À creuser avant d'implémenter :

- **périmètre du moteur** : commencer par les composants utiles à une livraison (Steps, Callout, Table, Badge, Progress, graphiques simples) et refuser le reste explicitement, plutôt que tout supporter d'emblée ;
- **sécurité** : le DSL ne doit pas pouvoir produire du HTML arbitraire : rendu par composants React typés, jamais d'interpolation dans le DOM ; le markdown reste `skipHtml` ;
- **où** : livraison d'abord, panneau de détails ensuite ; le chat peut attendre (un bloc y serait surtout décoratif) ;
- **repli** : un bloc non reconnu ou non supporté s'affiche en code (monospace) plutôt qu'en vide, comme une image refusée affiche un placeholder ;
- **flicker et perf** : un bloc rendu coûte plus cher qu'un paragraphe ; même cache par contenu que le markdown (le sig de la carte) ;
- **usage** : une règle pour les agents dans `composePrompt` et les prompts : bloc = structure (étapes, tableau, graphique), jamais décoratif ; sinon le canal se remplit d'encadrés inutiles.

Lien : idée « markdown dans l'affichage » (même terrain, un cran au-dessus), idée « coller des images » (le même canal d'affichage riche), `ui/src/components/DeliveryMarkdown.tsx` et `SandboxedRender.tsx`, leçon « Rendu openchamber_render » dans `AGENTS.md`.

### Le chat gère le tool `question` (et le préfère aux blocs openui-lang)

Discussion du 7 nov : quand l'orchestrateur a besoin d'une réponse (« tu veux que je lance ? », un choix entre deux approches), il la pose en texte : le propriétaire doit recopier sa réponse dans le composer, et rien ne marque la question comme en attente ni comme répondue. Le tool `question`, qui existe déjà pour les tâches, donnerait une carte de formulaire dans le chat : choix multiples, champs, réponse en un clic.

Demande, deux volets :

- **le chat gère le tool `question`** : activer le tool pour l'orchestrateur et rendre la question en attente comme une carte de formulaire dans le fil du chat (réutilisant le chemin des tâches : `replyForm` / `cancelQuestion`, déjà en place) ;
- **une instruction générale** : dans `composePrompt` et les prompts d'agents, toute question attendue du lecteur passe par le tool `question`, jamais par un bloc openui-lang (`Choice`, `Input`) ; ces blocs ne sont pas rendus par le Superviseur (idée 22) et resteraient un texte mort, alors qu'une question du tool est traçable, annulable et affichée.

Constat sur le code actuel :

- l'orchestrateur a `question: false` (`daemon/agent/superviseur-orchestrateur.md`) : ses questions sont du texte, sans état en attente ;
- le chemin des formulaires est déjà câblé pour les tâches : `QuestionBox` dans le panneau de détails, réponse par `/api/fleet/reply`, annulation par `/api/fleet/cancel-question` ;
- la leçon « Les questions passent par le tool `question` » de `AGENTS.md` dit déjà pourquoi : seule une question en formulaire s'affiche avec ses boutons ; le même principe s'applique au chat du superviseur.

À creuser avant d'implémenter :

- **UI du chat** : réutiliser `QuestionBox` dans le fil (la question du chat vit dans la même session que le fil, donc pas de séparation carte/détail) ; le composer du chat doit rester utilisable pour répondre en texte libre, comme OpenChamber le permet ;
- **annulation** : une question du chat doit pouvoir être annulée (l'agent reprend sans réponse), même geste que pour les tâches ; un « Nettoyer » ou une consigne suivante ne doit pas laisser une question orpheline en attente ;
- **session bloquée** : le tool `question` met le tour en attente ; acceptable dans le chat (c'est le but), mais l'état « attend une réponse » doit être visible sur le chat lui-même, pas seulement dans OpenChamber ;
- **abus du canal** : une seule question en attente à la fois, annulable, et l'instruction interdit les questions rhétoriques déguisées en formulaire ; sinon le chat devient une suite de pop-ups ;
- **portée de l'instruction** : la règle « question = tool `question`, jamais openui-lang » s'écrit dans `composePrompt` (les tâches naissent hors de ce repo) et dans les prompts des agents du Superviseur ; le plugin `superviseur-task` peut porter le même garde-fou dans la description du tool ;
- **articulation avec l'idée 22** : openui-lang reste pour la structure (étapes, tableaux, graphiques), `question` pour ce qui attend une réponse ; les deux instructions se rédigent ensemble.

Lien : idée « rendre les blocs `openui-lang` » (la complémentarité des deux canaux), leçon « Les questions passent par le tool `question` » dans `AGENTS.md`, `ui/src/components/QuestionBox.tsx`, `ui/src/lib/api.ts` (`replyForm`, `cancelQuestion`), doc [mvp1/chat-superviseur.md](../mvp1/chat-superviseur.md).

### Stop et revert pour une tâche (comme pour le chat)

Discussion du 7 nov : quand on se trompe (mauvaise consigne envoyée, direction qui dérape, message mis en file par erreur), le chat du superviseur sait s'arrêter et revenir en arrière, mais une tâche non : ni stop du tour en cours, ni retrait de la file, ni revert vers un message. Le seul recours est d'aller dans OpenChamber et de refaire le geste à la main.

Demande : les mêmes trois commandes pour une tâche, depuis la carte ou le détail :

- **stop** : interrompre le tour en cours (abort ou interrupt, la version diffère selon l'instance) ;
- **retirer de la file** : annuler un message en attente (`/api/message-queue/.../:itemId`) ;
- **revert** : revenir à un message du passé (stage + commit, abort avant, restaurer le texte du composer), le geste déjà implémenté pour le chat (`revertSupervisor`).

Constat sur le code actuel :

- le chat a son Stop (`canStop` quand busy, `/api/supervisor/abort`) et son revert (`/api/supervisor/revert`, stage + commit, texte restauré) : le chemin daemon existe, il vise la session du superviseur ;
- pour une tâche, `/api/fleet/send` met en file, mais rien n'expose l'annulation d'un item ni l'interruption du tour ; `/api/fleet/done` retire la carte, c'est tout ;
- l'idée 1 suppose ce geste (stopper ou rediriger un agent qui dérape) : ces commandes en sont les fondations.

À creuser avant d'implémenter :

- **où** : le détail porte déjà l'écriture depuis la suppression du composer de carte ; stop et revert y vivent naturellement, et la carte peut garder un stop court ;
- **revert = destructif** : confirmation avant commit, et un texte clair sur ce qui disparaît (les tours après le message) ; une question en attente est annulée d'abord (même garde que `close_task`) ;
- **état après stop** : une tâche interrompue n'est pas terminée ; la carte repart au repos sans verdict trompeur (le compagnon ne doit pas lire l'interruption comme un bilan) ;
- **file visible** : le retrait et le revert supposent de voir les messages en attente de la tâche (l'idée 5 le demande déjà) ;
- **abort vs interrupt** : la version d'OpenCode expose l'un ou l'autre ; `abortSupervisor` envoie déjà les deux par sécurité, même approche à reprendre ;
- **après revert** : restaurer le texte utilisateur dans le composer du détail si l'instruction doit être corrigée et renvoyée (le brouillon vit dans le store).

Lien : idée 1 (stopper ou rediriger, le concept), idée 5 (les messages en attente visibles), `/api/supervisor/abort` et `revertSupervisor` (`daemon/src/supervisor.mts`) comme implémentations à généraliser, leçon « Revert depuis un message » dans `AGENTS.md`.

### Remettre dans le board la carte d'une conversation terminée

Idée du 8 nov : une conversation close (geste `Terminé`) sort de la flotte, et n'y revient que si elle reçoit une activité depuis OpenChamber. Demande : un geste dans le Superviseur pour remettre sa carte dans le board, sans recréer la conversation ; elle reste accessible avec son historique et reprend sa place comme une carte ordinaire.

Constat sur le code actuel :

- la clôture vit dans `task_state` (`closed_at`, `closure`) : `enrichedFleet` (`daemon/src/server.mts`) écarte ces cartes de la flotte, sauf si une activité postérieure à la fermeture les rouvre ;
- `reopenTaskState` (`daemon/src/state.mts`) remet déjà `closed_at` et `closure` à NULL, efface le verdict et réarme la reprise : le chemin daemon existe, aucun geste ne l'appelle ;
- une carte close n'est plus publiée dans la flotte, donc introuvable depuis le Superviseur une fois la frame passée : il faut rouvrir OpenChamber pour la retrouver.

À creuser avant d'implémenter :

- **où trouver la carte close** : une liste des fermées (titre, heure de clôture, projet) dans le board, ou un geste depuis le chat (« remets la tâche X dans le board »), qui suppose de la désigner par son titre ou son numéro (idée 11) ;
- **ce que le geste fait** : `reopenTaskState` seul, ou une décision sur le verdict effacé et le brief : la carte revient au repos, avec son historique, sans bilan trompeur ;
- **portée** : une session archivée ou supprimée dans OpenChamber n'est pas une conversation close ; le geste ne doit pas la ressusciter silencieusement.

Lien : idée « un chat permanent » (la liste des gestes du MCP mentionne « réouvrir des sessions marquées terminées », sans entrée dédiée), idée « numéroter les tâches » (désigner une carte absente de l'écran), leçon « Fermer le détail n'est pas fermer la tâche » dans `AGENTS.md`, `reopenTaskState` (`daemon/src/state.mts`).
