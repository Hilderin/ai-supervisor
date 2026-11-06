# Boîte à idées

Idées et suggestions en vrac, à creuser (ou non) plus tard. Rien d'engagé ici : une idée peut être ajoutée en deux lignes, puis promue vers un doc de conception si elle tient.

## Idées

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

### Un petit bouton config dans la conversation

Dans l'en-tête d'une conversation (sans doute à côté du modèle/agent affiché), un petit bouton de config permettant d'ajuster à chaud :

- **le modèle** de la session (ex. besoin de passer sur un modèle plus fort ou plus rapide en cours de route) ;
- **l'agent** (ex. changer `build` pour un `plan`, ou brancher un agent spécialisé).

À creuser : le changement s'applique-t-il immédiatement (au prochain tour de la session) ou seulement nouvel envoi ? Faut-il une confirmation avant de basculer ? Comment signaler dans l'historique qu'un changement de modèle/agent a eu lieu (traçabilité des échanges) ?

### Notifications desktop + badge d'attention sur l'icône

Comme le fait OpenChamber :

- des **notifications desktop** quand quelque chose mérite l'attention (tâche bloquée sur une question, tâche terminée, échec...) : le Superviseur étant une fenêtre qu'on ne regarde pas en continu, c'est lui qui doit venir vers l'utilisateur ;
- un **badge de compte sur l'icône** de l'app : le nombre de tâches ayant besoin de mon attention, visible sans ouvrir la fenêtre.

À creuser : le seuil de notification (tout ou filtré par priorité ? risque de spam inversé : l'habituer, c'est le tuer), la déduplication (une notification qui reste valable ne doit pas se répéter), et l'alignement avec le badge (qu'est-ce qui « consomme » une notification : la lecture de la carte ? la réponse à la session ?).

### Pinner des conversations / indiquer une priorité

Pouvoir **pinner** des conversations, ou leur **indiquer une priorité**, pour qu'elles remontent en haut de la liste, au-dessus des autres. Complète le triage : ce qui est urgent à mes yeux reste visible même quand la flotte bouge beaucoup.

À creuser : pin simple vs échelle de priorité (combien de niveaux ?), position et signal visuel des cartes épinglées (section dédiée en haut ? badge sur la carte ?), et lien avec les signaux déjà existants (une tâche bloquée mais non épinglée doit-elle passer devant une épinglée qui tourne bien ?).

### Always on top + une UI qui tient dans un coin

Deux compléments, pensés pour **laisser le Superviseur visible en permanence sans lui dédier un écran** :

- **« Always on top »** : une option pour garder la fenêtre au premier plan, au-dessus des autres (le patch à l'écran unique) : je code/joue/regarde Netflix, et le Superviseur reste lisible dans le coin.
- **une UI qui fonctionne en petit format** : s'assurer que tout (ou l'essentiel) se dégrade proprement dans une fenêtre réduite : la liste de la flotte compacte, une carte par ligne active, l'essentiel des signaux visibles. Si la fenêtre fait 300-400 px de large, je dois encore voir *ce qui tourne* et *ce qui m'attend*.

À creuser : est-ce un mode dédié (un « mode coin d'écran » avec densité maximale, défini dès la conception) ou juste une responsive correcte ? Quels parcours restent possibles en petit format (lire oui, mais débloquer / répondre ?) et à partir de quelle taille bascule-t-on sur l'interface complète.

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

### Date et heure de la dernière activité sur une conversation

Chaque conversation affiche **la date et l'heure de sa dernière activité**, doublée d'un temps relatif restimé en continu : « 4 nov 14h45 (3j) », « 9h34 (2h) ». L'absolu pour vérifier, le relatif pour sentir d'un coup d'œil si la session est vivante.

À creuser : quelle activité compte (dernier message ? dernier tool call ?) ; le format court en petit format (fenêtre en coin d'écran) : relatif seul, absolu en tooltip ; et le lien avec les états (une session « en cours » dont la dernière activité date de 3 h est un signal en soi).

### Objectif courant affiché sur la carte, en plus du résumé

Discussion du 6 nov : ajouter une ligne « objectif courant » sur chaque carte, en plus du `resume` du compagnon. Le résumé dit ce qui se passe, pas où ça va ; sur une flotte, c'est l'info qui manque au retour (« c'est quoi le but de cette carte ? ») et l'entité Goal du doc 02 n'est jamais rendue à l'écran.

En l'état, le verdict du compagnon (`Verdict` dans `ui/src/types.ts`) n'a pas de champ goal : le digest passe le premier message humain comme contexte, et le prompt de l'analyste ne le réutilise qu'au détour d'un tour vide (« je travaille sur ta demande : <objectif court> »).

Avis et réserves (à trancher avant d'implémenter) :

- pas une deuxième phrase de texte : une ligne courte, de type « Objectif : migrer le schéma v2 », sinon la carte devient un mur (anti wall-of-text, doc 03) ;
- éviter la redondance : pour une petite tâche, objectif = résumé ; l'analyste ne remplit le champ que s'il apporte quelque chose de distinct ;
- champ de plus à produire à chaque tour : risque de plateau, donc le mettre dans le sig de la carte et ne l'afficher que s'il change (leçon anti flicker) ;
- coût d'implémentation faible si validé : clé en anglais `goal` déclarée requise dans le JSON de l'analyste (leçon clés en anglais), puis une ligne dans `SessionCard`.

### Le superviseur fixe l'objectif, et peut stopper ou rediriger un agent qui dérape

Idée du 6 nov, née d'un vrai cas : la demande portait sur l'ajout d'une idée dans la boîte (la confiance non définie) ; l'agent l'a comprise comme « implémente-la » et est parti en implémentation. En réunion, avec la flotte qui roule en parallèle, ce genre de glissement passe inaperçu : une demande de conception est devenue un chantier de code sans garde-fou, et on ne s'en aperçoit qu'après coup. (L'implémentation en question est conservée : elle était presque terminée et utile ; mais le cas montre bien le manque.)

Ce que le superviseur devrait savoir faire :

- **fixer l'objectif de chaque conversation** : l'objectif explicite, fixé (ou confirmé) par l'utilisateur au lancement, devient la référence de jugement, pas juste une info affichée (c'est la suite logique de l'idée « objectif courant » ci-dessus) ;
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
