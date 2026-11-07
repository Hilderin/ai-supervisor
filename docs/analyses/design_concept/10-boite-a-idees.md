# Boîte à idées

Idées et suggestions en vrac, à creuser (ou non) plus tard. Rien d'engagé ici : une idée peut être ajoutée en deux lignes, puis promue vers un doc de conception si elle tient.

## Sommaire par importance

L'importance est jugée sur l'apport au cœur du Superviseur (voir ce qui tourne, comprendre où ça va, intervenir à temps), puis sur le coût quand deux idées se valent. Un gros pari pas encore tranché (le chat permanent) descend, parce qu'on ne peut pas le prioriser avant les signaux de base. C'est un jugement de travail, révisable : déplacer une section suffit, le tableau suit.

Les sections ci-dessous sont dans cet ordre.

| # | Idée | Pourquoi ce rang | Coût |
|---|------|------------------|------|
| 1 | Le superviseur fixe l'objectif, et peut stopper ou rediriger un agent qui dérape | Protège du travail qui part dans la mauvaise direction, né d'un cas réel : c'est la raison d'être du Superviseur (porter l'attention) | moyen |
| 2 | Ordre des cartes figé : les nouvelles en bas, rien ne bouge sous le curseur | L'instabilité de l'écran empêche de lire la flotte pendant qu'on travaille ; bénéfice quotidien pour un coût faible | faible |
| 3 | Une ligne « action en cours » : ce que l'agent fait vraiment, tout de suite | Répond au doute « est-ce que ça avance ? » dès les premières secondes, sans attendre l'analyse du compagnon | faible à moyen |
| 4 | Envoyer des instructions pendant qu'une tâche travaille | Capacité de pilotage centrale (queue, direct, fork, btw), mais dépend de ce que l'API permet réellement | moyen à élevé |
| 5 | Objectif courant affiché sur la carte, en plus du résumé | Complète les rangs 1 et 3 : savoir où va la carte, pas seulement ce qu'elle fait ; un champ à ajouter | faible |
| 6 | Numéroter les tâches, avec un préfixe par projet | Une référence stable pour suivre et désigner une tâche (« reprends la 42 ») alors que le titre change ; peu coûteux et utile partout (carte, chat, notifications) | faible |
| 7 | Notifications desktop + badge d'attention sur l'icône | Le Superviseur doit venir vers l'utilisateur quand il n'est pas devant ; sans ça, tout le reste suppose l'œil sur la fenêtre | moyen |
| 8 | Chemins de fichiers et URL cliquables dans les résultats | Aller du résultat au fichier sans copier-coller ; s'appuie sur le rendu existant de la livraison et sur `/api/fleet/asset` | faible à moyen |
| 9 | Pinner des conversations / indiquer une priorité | Triage quand la flotte grossit ; secondaire tant que l'ordre des cartes n'est pas stabilisé | faible à moyen |
| 10 | Always on top + une UI qui tient dans un coin | Définit le mode d'usage (patch d'écran) ; à faire une fois les signaux essentiels arrêtés | moyen |
| 11 | Date et heure de la dernière activité sur une conversation | Petit signal complémentaire (session vivante ou morte), peu coûteux, non bloquant | faible |
| 12 | Un chat permanent, à droite ? (le « poste de commandement » conversationnel) | Gros pari d'architecture, à trancher après les signaux de base : il peut réorienter toute l'UI | élevé |
| 13 | Markdown dans l'affichage (hors livraison) | Lisibilité de ce qu'écrivent les agents partout (brief, questions, tooltips), pour un coût faible ; c'est du confort, pas du pilotage | faible |
| 14 | Un petit bouton config dans la conversation | Confort (modèle et agent à chaud), le plus simple ; n'a d'intérêt qu'une fois le pilotage en place | faible |

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

### Objectif courant affiché sur la carte, en plus du résumé

Discussion du 6 nov : ajouter une ligne « objectif courant » sur chaque carte, en plus du `resume` du compagnon. Le résumé dit ce qui se passe, pas où ça va ; sur une flotte, c'est l'info qui manque au retour (« c'est quoi le but de cette carte ? ») et l'entité Goal du doc 02 n'est jamais rendue à l'écran.

En l'état, le verdict du compagnon (`Verdict` dans `ui/src/types.ts`) n'a pas de champ goal : le digest passe le premier message humain comme contexte, et le prompt de l'analyste ne le réutilise qu'au détour d'un tour vide (« je travaille sur ta demande : <objectif court> »).

Avis et réserves (à trancher avant d'implémenter) :

- pas une deuxième phrase de texte : une ligne courte, de type « Objectif : migrer le schéma v2 », sinon la carte devient un mur (anti wall-of-text, doc 03) ;
- éviter la redondance : pour une petite tâche, objectif = résumé ; l'analyste ne remplit le champ que s'il apporte quelque chose de distinct ;
- champ de plus à produire à chaque tour : risque de plateau, donc le mettre dans le sig de la carte et ne l'afficher que s'il change (leçon anti flicker) ;
- coût d'implémentation faible si validé : clé en anglais `goal` déclarée requise dans le JSON de l'analyste (leçon clés en anglais), puis une ligne dans `SessionCard`.

### Numéroter les tâches, avec un préfixe par projet

Discussion du 6 nov : dans la flotte, une tâche ne s'identifie que par son titre, qui peut changer (la session le réécrit) et se ressemble d'une carte à l'autre. Pour suivre la flotte, et surtout pour en parler (« reprends la 42 »), un identifiant court serait plus fiable qu'un titre. Demande : numéroter les tâches, avec éventuellement un préfixe par projet (`ais-42`, `mvp1-7`).

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

À creuser : pin simple vs échelle de priorité (combien de niveaux ?), position et signal visuel des cartes épinglées (section dédiée en haut ? badge sur la carte ?), et lien avec les signaux déjà existants (une tâche bloquée mais non épinglée doit-elle passer devant une épinglée qui tourne bien ?).

### Always on top + une UI qui tient dans un coin

Deux compléments, pensés pour **laisser le Superviseur visible en permanence sans lui dédier un écran** :

- **« Always on top »** : une option pour garder la fenêtre au premier plan, au-dessus des autres (le patch à l'écran unique) : je code/joue/regarde Netflix, et le Superviseur reste lisible dans le coin.
- **une UI qui fonctionne en petit format** : s'assurer que tout (ou l'essentiel) se dégrade proprement dans une fenêtre réduite : la liste de la flotte compacte, une carte par ligne active, l'essentiel des signaux visibles. Si la fenêtre fait 300-400 px de large, je dois encore voir *ce qui tourne* et *ce qui m'attend*.

À creuser : est-ce un mode dédié (un « mode coin d'écran » avec densité maximale, défini dès la conception) ou juste une responsive correcte ? Quels parcours restent possibles en petit format (lire oui, mais débloquer / répondre ?) et à partir de quelle taille bascule-t-on sur l'interface complète.

### Date et heure de la dernière activité sur une conversation

Chaque conversation affiche **la date et l'heure de sa dernière activité**, doublée d'un temps relatif restimé en continu : « 4 nov 14h45 (3j) », « 9h34 (2h) ». L'absolu pour vérifier, le relatif pour sentir d'un coup d'œil si la session est vivante.

À creuser : quelle activité compte (dernier message ? dernier tool call ?) ; le format court en petit format (fenêtre en coin d'écran) : relatif seul, absolu en tooltip ; et le lien avec les états (une session « en cours » dont la dernière activité date de 3 h est un signal en soi).

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

> Approfondi et tranché le 2026-11-06 : le chat est retenu, mais comme **surface d'orchestration** à gauche, pas comme chat de tâche. Voir [mvp1/chat-superviseur.md](../mvp1/chat-superviseur.md).

### Markdown dans l'affichage (hors livraison)

Discussion du 6 nov : les agents écrivent du markdown par nature (gras, `code`, listes, liens, chemins), et le Superviseur ne le rend qu'à un seul endroit : la livraison. Partout ailleurs le texte sort brut, avec ses astérisques et ses backticks, ce qui rend les chemins et les commandes moins lisibles.

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
