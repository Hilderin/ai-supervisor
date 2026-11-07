# Panneau des tâches : positions stables et contenu borné

Statut : note de conception, 2026-11-06. Analyse seule : cette note n'a modifié aucun code de l'application.
Périmètre : le panneau de droite des tâches (`FleetBoard`, `SessionCard`, `QuestionBox`, `Composer`, `DeliveryBlock`) et l'ordre d'affichage de la flotte. Le chat de supervision, les données du daemon et le compagnon ne changent pas.

## 0. Décision en une phrase

Une tâche garde **une position et une hauteur fixes** du premier affichage jusqu'à sa fermeture. Son état ne change que l'icône, le liseré, le libellé de pied et le contenu interne d'une zone de taille réservée. L'attention (question, permission) est signalée par un badge et une barre fixe en haut du panneau, jamais par une remontée de carte. Tout ce qui est long (résultat, formulaire, composer étendu) s'ouvre dans un **inspecteur** en colonne à droite, redimensionnable, qui ne modifie pas l'ordre ni la hauteur des cartes. Les trois sections disparaissent comme conteneurs : le triage devient quatre états visuels, dont deux fins distinctes (point « fini, à valider » et coche « terminé confirmé »).

Cette note tranche l'option B (§4) et décrit son implémentation (§5), ses tests d'acceptation (§5.10) et les points à confirmer (§6).

## 1. Ce que le propriétaire constate

Deux gênes distinctes, qui se cumulent :

1. **Une carte change de place quand son état change** : elle saute dans la section « BESOIN DE TON ATTENTION », redescend dans « TERMINÉ », ou remonte en haut de « EN COURS » quand elle devient `busy`.
2. **Une carte se déplace de haut en bas quand ses voisines grossissent ou rapetissent** : une réponse qui se charge, un formulaire qui apparaît, un composer qui grandit, un « Voir plus » qui déplie le résultat. Tout ce qui est sous la carte concernée glisse du delta de hauteur.

Le besoin exprimé est une **mémoire spatiale** : « je sais que la tâche est là », comme une case fixe dans un tableau de bord. Le contenu et les boutons peuvent changer, la position non.

## 2. Diagnostic

### 2.1 Cause 1 : l'ordre et la section dépendent de l'état

Le problème n'est pas un hasard de rendu : il est construit en deux étages.

**Côté daemon**, dans `daemon/src/fleet.mts`, le bloc `rows.sort` de `buildFleet` trie les lignes à chaque poll :

1. nombre de formulaires et permissions en attente, décroissant ;
2. `busy` avant `idle` ;
3. `turnStartedAt` décroissant.

Ce tri est un tri d'état. Il change quand une question arrive, quand un tour démarre, quand une session passe `busy` puis `idle`, et quand une nouvelle session apparaît. Le commentaire du code protège la clé `turnStartedAt` des refresh de metadata, mais pas contre les deux premiers critères.

**Côté UI**, la boucle de `FleetBoard` (`ui/src/components/FleetBoard.tsx`) répartit les lignes dans trois sections :

- « BESOIN DE TON ATTENTION » si `isWaiting(row)` ;
- « TERMINÉ » si `isDone(row)` ;
- « EN COURS » sinon.

`updatePlacements` (`ui/src/lib/placement.ts`) ajoute une hystérésis de 8 s, mais uniquement pour le passage EN COURS ↔ TERMINÉ. Les branches d'attente, de job `busy` et de nouveau tour (`turnStartedAt`) sont **immédiates**. Autrement dit, le garde-fou actuel ralentit un seul des mouvements, pas les deux qui gênent le plus : la question qui arrive et le tour qui démarre.

Conséquences en chaîne :

- la carte est **démontée puis remontée** par React quand elle change de section, car elle change de parent dans le DOM. Le composer perd le focus ; le `useLayoutEffect` de `Composer.tsx` le restaure et appelle `scrollIntoView({ block: 'nearest', behavior: 'smooth' })`, ce qui peut ajouter un saut de scroll ;
- les en-têtes de section et leurs compteurs changent de place et de valeur ;
- à l'intérieur d'une même section, l'ordre reste celui du daemon. Une carte qui devient `busy` remonte au-dessus des `idle` ; une carte qui redevient `idle` redescend. L'hystérésis de section ne stabilise pas cet ordre ;
- l'arrivée d'une nouvelle session s'insère selon `turnStartedAt` (souvent en haut du groupe `idle`), donc elle pousse vers le bas les cartes situées sous elle ;
- la fermeture ou l'archivage d'une carte retire une ligne et fait remonter toutes les suivantes.

**Le point important** : même avec des cartes de hauteur parfaite, le simple tri par état suffit à violer la contrainte. Il faut donc retirer l'état de la clé d'ordre, pas seulement ralentir les transitions.

### 2.2 Cause 2 : la hauteur des cartes est variable

`ui/src/components/SessionCard.tsx` définit une carte sans hauteur imposée : padding, bordure, puis des rangées conditionnelles. Dans `ui/src/App.tsx`, le `main` de la flotte est en flux normal (`overflow-y-auto`) : chaque pixel ajouté dans une carte décale toutes les suivantes.

Les contributeurs de hauteur, tous dans `SessionCard` ou ses enfants :

| Élément | Code | Effet |
| --- | --- | --- |
| Brief du compagnon | `brief` dans `SessionCard` | texte libre, aucune limite de lignes : un résumé long passe de 1 à 3 lignes |
| Ligne « ✋ attends » | `attend` dans `SessionCard` | rangée ajoutée ou retirée selon le verdict |
| Barre de progression + confiance | `showBars` dans `SessionCard` | la rangée n'existe que si `row.sup` existe et qu'il y a une progression ou une confiance |
| Bloc de livraison | `DeliveryBlock` dans `SessionCard`, `deliveryView` et l'aperçu | apparaît en `loading`, puis `empty`, puis résultat ; aperçu 72 px (au repos) ou 280 px (TERMINÉ), dépliage sans limite, iframe 160 px ou 420 px |
| Question | `QuestionBox` dans `SessionCard` | un bloc par champ, options qui se replient, champ libre, deux boutons : 80 à 200 px selon le formulaire |
| Permission | bloc `perm` dans `SessionCard` | bloc ajouté avec bouton |
| Composer | `Composer` dans `SessionCard` | auto-grow de 1 à 120 px pendant la frappe |
| Pied TERMINÉ | branche `done` dans `SessionCard` | rangée de 38 px ajoutée seulement sur les cartes terminées |
| Erreur de fermeture | `closeError` dans `SessionCard` | ligne ajoutée après un échec |

Le popover de plan déjà en place (`PlanPopover`) montre le bon pattern : le compteur d'étapes reste dans la rangée fixe et la bulle vit dans un portail en `position: fixed`. La hauteur de la carte ne change pas. Le futur inspecteur doit suivre le même chemin.

Ces éléments ne sont pas seulement variables d'une carte à l'autre : ils **basculent avec l'état**. Une carte qui devient `busy` masque sa livraison et affiche la rangée de progression ; une carte qui reçoit une question masque sa livraison et affiche le formulaire ; une carte qui passe TERMINÉ ajoute son pied et déplie parfois son résultat. Un changement d'état est donc aussi un changement de hauteur, ce qui cumule les deux causes.

Le bloc de livraison ajoute une variante particulièrement visible : à l'ouverture d'une carte au repos, il affiche d'abord « Chargement du résultat… », puis le résultat, puis éventuellement « Voir plus ». Trois hauteurs successives, donc trois décalages des cartes du dessous.

**Mesure sur l'instance locale** (panneau d'environ 950 px de large, trois cartes visibles) : environ 175 px, 340 px et 350 px de haut. La troisième carte sort déjà du viewport de 900 px. La carte la plus longue fait environ le double de la plus courte, sans compter le dépliage.

### 2.3 Ce que l'hystérésis actuelle ne peut pas faire

`placement.ts` stabilise la **section**, pas la **position**. Même si une carte reste 8 s dans EN COURS avant de passer TERMINÉ, elle finit par changer de section, donc de place. Et l'hystérésis ne couvre ni l'attente, ni `busy`, ni un nouveau tour, ni l'ordre interne. Le mécanisme est utile pour éviter un clignotement de verdict, mais il ne peut pas servir de fondation à une disposition stable.

**Conséquence de conception** : on garde l'idée d'un verdict lissé pour la **décoration** (point, libellé), pas pour l'**ordre**.

### 2.4 Définition testable de « stable »

Pour une tâche donnée, tant qu'elle est affichée :

- `card.getBoundingClientRect().top` ne change pas quand son état change (`busy`, attente, terminé), quand son brief change, quand un résultat se charge, quand une question arrive ou est répondue, quand le composer grandit ;
- `card.getBoundingClientRect().height` est la même pour toutes les cartes, dans tous les états ;
- l'arrivée d'une nouvelle tâche ne change le `top` d'aucune carte existante ;
- seules la fermeture d'une carte et l'application d'un filtre peuvent retirer une carte et déplacer les suivantes. Un redimensionnement ne change ni l'ordre ni la hauteur.

C'est cette définition qui sert de test d'acceptation (§5.10), pas une impression visuelle.

### 2.5 Les deux fins que l'UI confond

Le propriétaire ajoute une distinction qui manque au code actuel :

- le **terminé confirmé** (section TERMINÉ actuelle) : `isDone` est vrai, c'est-à-dire que le compagnon a rendu un verdict `termine` frais, que la session n'est pas `busy` et que le verdict est postérieur au tour. C'est le seul état qui devrait porter la coche ;
- le **tour fini, à valider** (le EN COURS actuel avec le point vert) : la session n'est ni `busy` ni en attente, mais `isDone` est faux (pas de verdict, verdict périmé, ou verdict non concluant). Aujourd'hui, il n'a aucun bouton de clôture : le pied TERMINÉ n'est rendu que si `done` est vrai. C'est cet état qui doit recevoir le bouton `Terminé`.

Le code actuel utilise le même point vert pour les deux (plein pour EN COURS, pâle pour TERMINÉ) et n'affiche `Fermer` que sur TERMINÉ. La nouvelle disposition doit rendre la différence visible par la forme (point vs coche), pas seulement par l'opacité.

Point de sémantique : `POST /api/fleet/done` ne change pas le verdict du compagnon. Il pose `closed_at` et `closure: 'terminé'`, retire la carte de la flotte, et une activité ultérieure la rouvre (`daemon/src/server.mts`, `daemon/src/state.mts`). Le bouton `Terminé` est donc un geste humain de clôture, pas une confirmation technique de fin. C'est exactement la distinction à garder dans les libellés.

## 3. Contraintes produit à ne pas casser

La stabilité ne doit pas coûter les trois valeurs du projet.

1. **L'attention est la ressource rare** (README du design concept, doc 03). Aujourd'hui, la remontée en section est le signal principal. Si on fige les positions, il faut la remplacer, pas la supprimer : barre fixe en haut, badge, liseré, bouton « Suivante ». C'est un prérequis, pas un bonus.
2. **La livraison inline est une décision du 2026-11-06** (`design_concept/06-questions-ouvertes.md`, ligne « La livraison se rend INLINE dans la carte »). La recommandation garde un **aperçu inline borné** et déplace le **complet** dans l'inspecteur. C'est un compromis à assumer explicitement : on ne revient pas à « lire le résultat seulement dans OpenChamber », on ajoute un clic pour le détail long.
3. **Un geste minimum** (phare du projet). Le composer reste dans la carte sur une ligne, pour envoyer une consigne sans ouvrir l'inspecteur. Les questions et permissions, qui demandent une saisie ou une confirmation, passent par l'inspecteur : un clic de plus, mais une surface adaptée au formulaire.
   - **Mise à jour 2026-11-07** : ce geste minimum est retiré à la demande du propriétaire, le panneau de détail servant à l'écriture : plus de composer dans la carte, la consigne passe par un clic (ouverture du détail) puis son composer. La carte passe de 232 à 190 px, l'écran montre plus de cartes. Détails : [implementation-ui-react.md](implementation-ui-react.md), §13.

Le MVP1 est le contrat (`objectif-mvp1.md`). Cette note ne change ni les routes, ni le contrat `Fleet`, ni le compagnon : elle ne change que l'ordre d'affichage et la géométrie côté UI. Le tri du daemon peut rester en place, l'UI l'ignore ; on pourra le simplifier plus tard, sans que ce soit nécessaire au correctif.

## 4. Options de disposition stable

Trois dispositions complètes, comparées sur la stabilité, la lisibilité, la densité, l'attention et l'effort.

### Option A : liste compacte, une ligne par tâche, détail en panneau

Chaque tâche est une ligne de hauteur fixe (environ 64 à 72 px) : point d'état, titre, brief sur une ligne, badge d'attention, bouton d'ouverture. Le détail complet (résultat, question, composer, permissions) vit dans un panneau latéral.

- **Stabilité** : parfaite. Une ligne ne peut pas grandir, et l'ordre est indépendant de l'état.
- **Lisibilité** : excellente pour scanner beaucoup de tâches, mais on perd le coup d'œil sur la progression, la confiance et le début du résultat. Chaque lecture de contenu demande un clic.
- **Densité** : maximale, environ 10 à 12 tâches par écran de 900 px.
- **Attention** : badge et barre fixe, mais la question n'est pas lisible inline ; il faut ouvrir la ligne pour savoir ce qui est demandé.
- **Effort** : élevé. Ce n'est plus une carte, c'est un tableau maître-détail ; il faut réécrire la présentation et habituer l'œil.
- **Verdict** : trop pauvre pour le geste de supervision, et en conflit direct avec la livraison inline. Écartée.

### Option B : carte à hauteur constante, aperçu inline borné, détail en inspecteur (recommandée)

Une seule liste, ordre d'arrivée fixe. Chaque carte occupe exactement la même hauteur (environ 232 px, à ajuster ; **fixée à 190 px le 2026-11-07**, sans rang de composer), avec des zones réservées :

- en-tête : point d'état, titre, badge d'attention, menu, ouvrir ;
- corps : brief sur 2 lignes et une zone de contenu fixe (question, activité, ou aperçu de résultat) ;
- composer sur une ligne, hauteur fixe ;
- pied : libellé d'état, progression, confiance, bouton `Répondre` (attente), `Terminé` vert (fini à valider ET terminé confirmé) ou `Détail` (travaille).

Le détail long (résultat complet, markdown, iframe de rendu, formulaire de question, permission, composer étendu) s'ouvre dans un inspecteur qui est une colonne de droite du panneau (chat à gauche, liste au milieu, détail à droite), redimensionnable comme le chat, qui ne pousse aucune carte.

- **Stabilité** : parfaite, à condition que toutes les zones soient réservées dans tous les états et que l'ordre soit tenu par identité.
- **Lisibilité** : bonne. La grille est régulière, les titres et les briefs s'alignent, la question et le début du résultat restent visibles. Le détail est à un clic, ce qui correspond à la vision « les détails à un clic ».
- **Densité** : environ 3,5 à 4 cartes par écran de 900 px, contre 2 à 3 aujourd'hui. Moins dense que A, plus dense que l'existant.
- **Attention** : barre fixe « n en attente » avec « Suivante », liseré orange, point clignotant, libellé de pied, aperçu de la question. Le signal reste fort sans déplacer la carte.
- **Effort** : moyen. Il faut un store d'ordre, une carte à grille fixe, un inspecteur, et déplacer les blocs longs. Les composants `DeliveryBlock`, `QuestionBox` et `Composer` sont réutilisables dans l'inspecteur ; le contrat de données ne bouge pas.
- **Risque** : l'aperçu de résultat est plus petit qu'aujourd'hui ; le détail complet demande un clic. C'est le compromis à valider.

### Option C : sections conservées et figées, en-têtes collants, bandeau d'attention

On garde « BESOIN DE TON ATTENTION / EN COURS / TERMINÉ », avec des en-têtes collants et des cartes à hauteur fixe. Pour que les cartes ne bougent plus, il faut choisir :

- soit la carte change encore de section quand son état change : le problème initial reste, les en-têtes collants ne font que garder le titre visible ;
- soit la carte ne change plus de section : une carte terminée reste dans EN COURS, une carte en attente reste dans sa section, et les sections perdent leur sens. On est obligé de **dupliquer** la carte en attente dans un bandeau pour garder le triage.

- **Stabilité** : partielle dans le premier cas, artificielle dans le second.
- **Lisibilité** : le triage familier est conservé, mais la double représentation (carte + bandeau) crée deux sources de vérité et brouille la lecture.
- **Densité** : faible : trois en-têtes, des marges, et parfois une carte en double.
- **Attention** : forte dans l'idée, mais obtenue soit par le déplacement qu'on veut supprimer, soit par une duplication.
- **Effort** : moyen à élevé, pour un résultat qui contredit la contrainte.
- **Verdict** : écartée. Les en-têtes collants sont un confort de lecture, pas une solution de stabilité.

### Tableau comparatif

| Critère | A : liste compacte | B : carte fixe + inspecteur (recommandée) | C : sections figées |
| --- | --- | --- | --- |
| Stabilité de la position | parfaite | parfaite | partielle ou artificielle |
| Stabilité de la hauteur | parfaite (1 ligne) | parfaite (hauteur unique) | parfaite si hauteur unique, sinon non |
| Lisibilité | très bonne pour scanner, pauvre en contenu | bonne : brief, état et aperçu alignés | familière mais dupliquée |
| Densité (900 px) | 10 à 12 tâches | 3,5 à 4 cartes | 3 cartes environ |
| Attention | badge + barre, question non lisible | barre + liseré + aperçu de la question | section dédiée, mais déplacement ou doublon |
| Effort | élevé | moyen | moyen à élevé |
| Conflit avec la livraison inline | fort | partiel (aperçu borné) | faible, mais le problème reste |

## 5. Recommandation : option B, spécifiée

### 5.1 Ordre stable par identité

Un seul ordre, tenu par l'UI, jamais par l'état :

- à la première apparition d'une session, on lui attribue un rang monotone (`nextRank`) ;
- on persiste `{ id: rang }` dans `localStorage` (clé `superviseur.fleet.order.v1`) pour retrouver la même disposition après un rechargement ;
- au chargement, les lignes connues sont triées par rang ; les inconnues sont ajoutées à la fin, dans l'ordre où le daemon les envoie (au tout premier lancement, l'ordre actuel est donc gelé tel quel) ;
- un changement d'état, de titre, de brief, de progression, de verdict, de `busy`, de `turnStartedAt` ou de livraison **ne modifie jamais le rang** ;
- une nouvelle tâche est ajoutée **en bas**. Si la liste est défilée plus haut, un chip fixe « 1 nouvelle tâche » apparaît en bas du panneau ; il ne faut pas auto-défiler, sinon on déplace la vue sous le curseur ;
- une carte fermée explicitement est retirée et l'espace se referme. C'est le seul reflux lié à une carte, parce qu'il vient d'un geste humain. Un filtre activé est un choix humain distinct, qui peut aussi retirer des cartes de la vue. Une carte rouverte repart en bas. Si le propriétaire préfère ne rien voir bouger, on peut garder un emplacement vide « fermée » jusqu'au rechargement, mais ce n'est pas recommandé (des trous dans la liste) ;
- une disparition temporaire (frame SSE incomplète, filtre) conserve le rang en mémoire pendant 2 minutes. Si la ligne revient dans ce délai, elle retrouve sa place (ce retour peut décaler les suivantes une fois : c'est une récupération d'incident, pas un changement d'état) ; au-delà, elle repart en bas ;
- on garde les 500 rangs les plus récents ; les plus anciens absents sont purgés.

Le tri du daemon (`rows.sort` dans `buildFleet`) peut rester : l'UI ne l'utilise plus pour l'ordre. On documente ce point pour ne pas croire que le daemon pilote encore la disposition.

**Décoration d'état** : on garde l'hystérésis de 8 s de `placement.ts` pour le **libellé et le point** (TERMINÉ ne clignote pas), jamais pour le rang ni pour la hauteur. Une carte peut donc afficher « terminé » avec 8 s de retard, sans jamais bouger.

### 5.2 Géométrie : une hauteur, des zones réservées

La liste est un conteneur vertical avec un `gap` fixe. Chaque carte a **la même hauteur** dans tous les états, par exemple `--task-card-h: 232px` (valeur de départ, à ajuster de quelques pixels après essai visuel). La carte est une grille à rangées fixes :

```
┌ carte, hauteur 232 px ───────────────────────────────────────┐
│ ●  Titre de la tâche                       [!]  ⋯  ↗         │  en-tête 24 px
│ Le brief du compagnon, coupé à 2 lignes…                     │
│ ┌ zone de contenu fixe ────────────────────────────────────┐ │  corps 105 px
│ │ question (3 lignes) / activité + progression / aperçu     │ │
│ └──────────────────────────────────────────────────────────┘ │
│ [ Écrire à cette tâche…                         ]      [→]    │  composer 34 px
│ 3/6 étapes   ███████░░░ 72 %   ●●●        [Terminé]   [Détail]│  pied 24 px
└──────────────────────────────────────────────────────────────┘
```

Le bouton de pied est `Répondre`, `Terminé` (vert) ou `Détail` selon l'état (voir §5.3) ; sa largeur est réservée, donc le changement de libellé ne déplace rien.

Règles de rendu :

- **aucune rangée conditionnelle** : la barre de progression, la confiance, le pied et le composer existent toujours. Quand il n'y a pas de donnée, la zone est vide ou grisée, mais sa hauteur est réservée ;
- **brief** : coupé à 2 lignes (utilitaire `line-clamp-2`), avec une hauteur minimale de 2 lignes, pour qu'un brief court ne fasse pas remonter la suite ;
- **question** : 3 lignes maximum dans le corps, suivies du bouton « Répondre » dans le pied ; le texte intégral est dans l'inspecteur ;
- **résultat** : un aperçu borné dans le corps (2 lignes de markdown, ou le titre du rendu s'il y en a un), jamais un `DeliveryBlock` complet, jamais d'iframe dans la liste ;
- **progression** : piste de 5 px toujours présente, remplie à 0 % si inconnue ; le libellé `3/6` ou `72 %` a une largeur fixe ;
- **confiance** : trois pastilles toujours présentes, grises si `confiance` est `null` ; le tooltip reste dans un portail (leçon AGENTS.md) ;
- **titre** : une ligne, ellipse ; le chip de dossier disparaît de la carte et passe dans l'inspecteur ou le tooltip, pour ne pas disputer la largeur ;
- **boutons** : le menu « ⋯ » et « Ouvrir » restent toujours là, à largeur fixe. Le menu doit être dans un portail, car la carte passe en `overflow: hidden` ;
- **pas d'auto-grow** : le composer de la carte est une ligne fixe de 34 px, avec défilement interne. `Entrée` envoie, `Maj+Entrée` insère un saut de ligne (le texte défile). Le composer étendu vit dans l'inspecteur ;
- **bouton du composer** : l'emplacement de l'action (Envoyer) a une largeur fixe, pour que le remplacement d'un bouton par l'autre ne change pas la largeur du champ ;
- **pas de `scrollIntoView` automatique** : on ne déplace la vue que sur une action explicite (« Suivante », ouverture d'un inspecteur, chip « nouvelle tâche »).

Avec `height` fixe et `overflow: hidden`, la carte ne peut plus pousser ses voisines. C'est la garantie mécanique, pas une discipline de contenu.

### 5.3 États visuels et actions

Les sections disparaissent comme conteneurs, mais le triage reste lisible grâce à quatre états distincts. La forme porte le sens (pas seulement la couleur), et chaque état a une action principale.

| État | Condition | Icône | Libellé | Action principale | Sémantique |
| --- | --- | --- | --- | --- | --- |
| Travaille | `status === 'busy'` | anneau vert qui tourne | `travaille` | Envoyer (composer) | l'agent travaille ; on ne clôt pas |
| Fini, à valider | `status !== 'busy'`, pas d'attente, `isDone` faux ou verdict en attente de lissage | point vert plein, avec un anneau fin | `fini, à valider` | `Terminé` | le tour est fini ; rien ne prouve que tout est fait ; l'humain vérifie |
| Terminé confirmé | `isDone` vrai, après les 8 s de lissage | case cochée verte sur fond vert pâle, dans un carré arrondi | `terminé` | `Terminé` (bouton vert) | le compagnon confirme la fin ; la carte attend le nettoyage humain |
| Attend ta réponse | formulaire ou permission | point orange clignotant + liseré orange | `attend ta réponse` ou `permission` | `Répondre` ou `Autoriser` | la balle est dans le camp humain |

Pourquoi ces formes :

- l'anneau qui tourne (busy) est déjà utilisé et se distingue du point plein ;
- le point plein (fini, à valider) reprend le point vert actuel, mais il est accompagné du libellé et du bouton, donc on ne le confond plus avec la coche ;
- la case cochée sur fond vert pâle (terminé confirmé) est réservée au verdict frais du compagnon. Elle ne doit jamais servir au simple « tour fini », sinon la distinction disparaît. Le fond pâle évite de la confondre avec le point plein vert ;
- le point orange clignotant et le liseré (attente) restent le seul signal orange de la carte.

Le bouton `Terminé` (vert, sur `fini, à valider` comme sur `terminé confirmé`) est le geste humain de clôture. Il appelle la même route (`POST /api/fleet/done`) : la carte quitte la flotte, `closed_at` est posé, et une activité ultérieure la rouvre. Il ne modifie pas le verdict du compagnon : la coche n'apparaît que si `isDone` est vrai, après le lissage de 8 s qui évite l'oscillation du verdict. C'est la distinction demandée entre « le travail est fini » et « je considère la tâche terminée ».

Le bouton est dans un emplacement de largeur fixe, avec `Répondre` (attente), `Terminé` (vert, sur fini à valider ET sur terminé confirmé), et `Détail` (travaille). Le changement de libellé ne change pas la largeur du pied ni la hauteur de la carte. Sur une carte `busy`, il n'y a pas de `Terminé` : le composer porte Envoyer, et le menu garde la fermeture exceptionnelle (elle ne stoppe pas l'agent ; une activité ultérieure rouvre la carte). Sur une carte en attente, l'action principale est `Répondre` ; la clôture reste possible par le menu ou le bouton `Terminé` de l'inspecteur, avec l'avertissement actuel.

Le bouton `Terminé` est aussi disponible dans l'inspecteur, pour clôturer après avoir lu le résultat complet. Le verdict du compagnon reste un signal, jamais une décision (AGENTS.md). La coche indique qu'il est frais et confirmé ; la clôture reste le geste humain `Terminé`.

### 5.4 Attention sans déplacement

Le panneau garde une **barre fixe** en haut, hors de la zone de défilement, de hauteur constante :

- `2 en attente` avec un bouton `Suivante` qui fait défiler jusqu'à la prochaine carte en attente et la met en évidence 2 s (anneau), sans changer l'ordre ;
- si zéro : `Aucune tâche en attente` en gris, même hauteur. La barre ne doit jamais apparaître ou disparaître, sinon elle pousse la liste ;
- au survol ou au clic, la barre peut lister les titres en attente, pour choisir directement ;
- optionnel : des filtres dans la même barre (`Tout`, `À traiter`, `Travaille`, `Fini à valider`, `Terminé`), désactivés par défaut. Un filtre est un choix humain : quand on l'active, une carte qui change d'état peut sortir de la vue filtrée, c'est attendu. L'ordre de la vue « Tout » reste intact.

Sur la carte :

- liseré gauche orange de 3 px et point orange clignotant en attente ;
- badge compact dans l'en-tête (icône `?` ou `!` avec tooltip), pour ne pas changer la largeur du titre ;
- libellé de pied `attend ta réponse` ou `permission demandée` ;
- aperçu de la question dans le corps.

Le signal est donc **local et permanent**. Une carte en attente hors écran est couverte par le compteur et le bouton `Suivante` de la barre.

### 5.5 Contenus longs

- **Brief long** : coupé à 2 lignes, texte complet dans l'inspecteur.
- **Résultat long** : aperçu borné dans la carte, bouton `Détail` ou `Voir le résultat` ; l'inspecteur affiche le markdown complet et le rendu `openchamber_render` (iframe plafonnée à 420 px, défilement interne).
- **Tableau, code, image** : le rendu complet reste dans l'inspecteur ; la carte n'en montre au plus qu'un extrait texte. C'est ce qui permet à la carte de garder 232 px.
- **Question à plusieurs champs** : le formulaire complet est dans l'inspecteur, qui défile ; la carte n'affiche que les 3 premières lignes de la première question.
- **Permission** : bloc dans l'inspecteur, avec le bouton `Autoriser`. La carte affiche `permission demandée`.
- **Erreur de fermeture, erreur réseau** : toast ou ligne dans l'inspecteur, jamais une ligne ajoutée à la carte.
- **Confirmation de fermeture d'une question** : dialogue, pas une ligne dans la carte.

Le fetch de livraison reste déclenché pour remplir l'aperçu des cartes TERMINÉ (et, si on le souhaite, des cartes au repos). La différence est que le chargement, l'absence de résultat et le résultat occupent le **même emplacement fixe** : l'arrivée asynchrone ne déplace plus rien. L'inspecteur réutilise la donnée déjà chargée ; pour une carte au repos sans aperçu, il charge à l'ouverture.

### 5.6 Questions et permissions sans déplacer la carte

C'est le point le plus sensible, parce qu'une question est une interaction, pas seulement du texte.

1. La question arrive : le badge, le liseré et le compteur de la barre s'allument. La carte ne bouge pas et ne grandit pas.
2. Le corps affiche les 3 premières lignes de la question, le pied affiche `Répondre`.
3. Un clic sur `Répondre` ouvre l'inspecteur avec `QuestionBox`, le focus dans le premier champ, et le formulaire complet.
4. La réponse part par le même `POST /api/fleet/reply` et le même objet `{ qN: valeur }` qu'aujourd'hui. Aucun changement de contrat.
5. La carte se met à jour sur place : le badge et le liseré s'éteignent, le libellé de pied redevient `travaille` ou `terminé`. Sa position et sa hauteur ne changent pas.
6. Une permission suit le même chemin, avec `Autoriser` dans l'inspecteur.

Le formulaire n'est donc jamais dans le flux de la liste. Il peut être long, il peut avoir quatre champs, il ne pousse rien.

### 5.7 L'inspecteur (colonne de droite)

Une seule surface de détail, sous forme de **colonne de droite** plutôt qu'une surcouche : le chat à gauche, la liste au milieu, le détail à droite, comme une carte Jira.

- **Ouverture** : clic sur la carte (hors boutons et composer) ou `Entrée` quand la carte a le focus ; boutons `Répondre` et `Détail` du pied.
- **Forme** : colonne de largeur réglable (plafond 680 px, largeur persistée dans le stockage local, ajustable par une poignée entre la liste et le détail, comme le chat). La colonne existe seulement quand une tâche est sélectionnée : elle se ferme par sa croix, par `Échap` ou quand la sélection disparaît. Sous 1100 px, elle devient une feuille pleine largeur qui couvre la liste, comme une vue détail.
- **Contenu** : en-tête (état, titre, ouvrir, croix), puis une **ligne d'état** qui porte la barre de progression (plus longue), le compteur d'étapes (avec popup du plan) et la confiance ; puis le brief complet, l'attention, le **résultat complet déplié d'office** (markdown + rendu, pas de `Voir plus` à cliquer d'abord), la question ou la permission ; puis **le composer collé en bas du panneau, sans titre** ; puis le pied d'actions, tout en bas (`Terminé` vert dès que la tâche n'est pas `busy`, `Fermer le détail`).
- **Mise à jour 2026-11-07** : le compteur d'étapes de la ligne d'état est remplacé par une **section « Plan » toujours visible**, sous le résumé (désormais encadré et titré) et au-dessus du résultat ; la barre de progression du détail et son compteur sont retirés (redondants avec le badge du plan). Implémentation et décisions : [implementation-ui-react.md](implementation-ui-react.md), §12.
- **Cadre** : plus de marge de page : les colonnes collent aux bords de l'écran ; les marges internes (carte, corps du détail, composer) sont conservées pour garder une lecture possible.
- **Fermeture** : croix, `Échap`. Le focus revient à la carte, qui n'a pas bougé.
- **Sélection** : la carte sélectionnée garde un anneau intérieur (jamais rogné par les bords du panneau).
- **Défilement** : le corps du détail défile ; la liste conserve sa position et sa hauteur de cartes.

Le composer du détail est la soupape pour les messages longs, sans casser la grille de la carte ; collé en bas, il se comporte comme le chat.

### 5.8 Ce que l'humain voit changer

| Aujourd'hui | Après |
| --- | --- |
| Trois sections avec compteurs | Une liste unique ; l'état est un point, un liseré et un libellé de pied |
| Une question fait sauter la carte en haut | La carte reste ; liseré orange, badge, compteur fixe, bouton `Suivante` |
| Deux fins confondues (point vert plein ou pâle) | Quatre états : anneau qui tourne, point plein `fini, à valider`, coche `terminé confirmé`, orange `attend ta réponse` |
| Une carte terminée descend dans TERMINÉ | La carte reste ; la coche et le libellé `terminé` remplacent le point ; rien ne bouge |
| Pas de bouton `Terminé` sur une carte au tour fini | `Terminé` vert sur `fini, à valider` ET sur `terminé confirmé` |
| Une carte `busy` remonte au-dessus des autres | Aucun ordre ne change ; le point tourne |
| Les nouvelles tâches arrivent en haut | Elles arrivent en bas ; un chip signale celles hors écran |
| Le résultat s'ouvre et déplie la carte | Aperçu borné dans la carte ; déplié d'office dans l'inspecteur |
| La question s'ouvre dans la carte | Aperçu de 3 lignes ; formulaire dans l'inspecteur |
| Le composer grandit pendant la frappe | Une ligne fixe ; le composer étendu est dans l'inspecteur, collé en bas |
| Le détail sans progression, confiance ni plan | Ligne d'état dans le détail : barre plus longue, compteur d'étapes, confiance |
| Un bouton ambigu ferme le détail ET retire la tâche | `Fermer le détail` ne ferme que le panneau ; la clôture est le bouton `Terminé` vert |
| Une marge de page vide autour de tout | Les colonnes collent aux bords de l'écran ; les marges internes sont conservées |
| Le chip de dossier est dans l'en-tête de carte | Il passe dans l'inspecteur ou le tooltip ; le titre garde la largeur |
| Fermer une carte décale les suivantes | Seul reflux restant, parce que c'est un geste humain |
| Rechargement : l'ordre du daemon revient | L'ordre est restauré depuis le stockage local |

### 5.9 Plan d'implémentation (sans code)

1. **Store** (`ui/src/store/fleetStore.ts`) : ajouter `order` (rangs + `nextRank`) et sa persistance ; conserver `placements` pour la décoration, ou le remplacer par un `decoration` dérivé. Ne plus utiliser `placements` pour le rendu de la liste.
2. **Barre et liste** (`FleetBoard.tsx`) : remplacer les trois `Section` par une barre fixe (compteur, `Suivante`, filtres optionnels) et une liste triée par rang. Utiliser `fleet.concern` pour le texte de la barre s'il est disponible.
3. **Carte** (`SessionCard.tsx`) : grille à rangées fixes ; supprimer les rangées conditionnelles ; mapper l'état vers l'icône et l'action de pied (`Terminé` vert sur `fini, à valider` ET `terminé confirmé`, `Répondre` sur attente, `Détail` sur `busy`) dans un emplacement de largeur fixe ; déplacer `DeliveryBlock`, `QuestionBox`, permission, pied TERMINÉ et erreur de fermeture dans l'inspecteur ; garder un composer d'une ligne ; porter le menu et le tooltip en portail.
4. **Inspecteur** (nouveau `TaskInspector.tsx`) : portail dans le panneau, `Échap`, focus trap, retour du focus ; réutiliser `DeliveryBlock` (mode complet), `QuestionBox` et `Composer` (mode étendu).
5. **Composer** (`Composer.tsx`) : deux variantes, `compact` (34 px fixe, défilement interne) et `expanded` (auto-grow 120 px). Le comportement d'envoi ne change pas.
6. **Livraison** (`DeliveryBlock.tsx`) : garder le fetch pour l'aperçu des cartes TERMINÉ, mais rendre l'aperçu dans un emplacement fixe ; l'inspecteur réutilise le cache. Ne jamais monter l'iframe de rendu dans la liste. Le cache et les gardes du daemon restent tels quels.
7. **CSS** (`ui/src/index.css` ou classes) : `--task-card-h`, `line-clamp`, hauteurs de zones, `overflow: hidden`, `contain: layout paint` (en portant les menus en portail). Vérifier le `line-height: normal` déjà imposé par AGENTS.md.
8. **Tests** : ordre, hauteur, transitions, focus, inspecteur, clavier, responsive. Aucun test daemon à modifier.

### 5.10 Tests d'acceptation

À écrire en tests de composant et en test navigateur (Playwright) :

- **Invariant de position** : relever le `top` de chaque carte ; simuler `busy`, attente, question répondue, terminé, brief long, résultat chargé, composer rempli ; vérifier que chaque `top` est identique à 1 px près.
- **États et actions** : `busy` = anneau qui tourne et pas de `Terminé` ; `fini, à valider` = point plein et `Terminé` ; `terminé confirmé` = coche et `Terminé` ; attente = orange et `Répondre`. Cliquer `Terminé` appelle `POST /api/fleet/done` et retire la carte ; les autres cartes ne bougent pas.
- **Détail en colonne** : sélectionner une tâche affiche la colonne de droite ; la barre, les étapes et la confiance y sont visibles ; `Fermer le détail` la fait disparaître sans retirer la carte de la liste.
- **Deux fins distinctes** : une carte dont le tour est fini mais sans verdict frais n'affiche pas la coche ; une carte avec `isDone` l'affiche après le lissage de 8 s. Le passage de l'un à l'autre ne change ni le `top` ni la hauteur.
- **Invariant de hauteur** : la hauteur de chaque carte est égale à `--task-card-h` dans tous les états, y compris avec une question à 4 champs et un résultat long.
- **Nouvelle tâche** : ajouter une session ; les `top` des cartes existantes ne changent pas ; la nouvelle est en bas.
- **Fermeture** : fermer une carte ; les suivantes remontent (reflux explicitement autorisé) ; le compteur de la barre se met à jour sans décaler la liste.
- **Attente** : une question arrive ; le compteur passe à `1`, le liseré s'allume, aucune carte ne bouge. Répondre depuis l'inspecteur ; le compteur repasse à `0`, la carte ne bouge pas.
- **Ordre après rechargement** : recharger la page ; l'ordre est le même qu'avant.
- **Inspecteur** : ouvrir, défiler, fermer par `Échap`, focus rendu à la carte ; le scroll de la liste est conservé.
- **Clavier** : `Tab` jusqu'à la carte, `Entrée` ouvre, `Échap` ferme, le focus revient.
- **Responsive** : 1440, 1100, 800 et 400 px ; mêmes invariants ; l'inspecteur passe en feuille pleine largeur sous 1100 px.
- **CLS** : `PerformanceObserver` sur `layout-shift` dans le panneau pendant une séquence d'états ; zéro décalage hors fermeture explicite.

### 5.11 Risques et points à confirmer

- **Hauteur de carte** : 232 px est une valeur de départ. Elle doit être testée avec la police réelle et des titres longs. Si elle est trop haute, descendre à 208 px en réduisant le corps ; l'invariant tient quand même.
- **Composer dans la carte** : une ligne fixe est un compromis. Si l'usage montre que les messages longs sont fréquents, déplacer complètement le composer dans l'inspecteur (la carte descend à environ 198 px).
- **Livraison inline** : l'aperçu borné révise partiellement la décision du 2026-11-06. Il faut le dire au propriétaire : le résultat complet reste dans le Superviseur, à un clic, et le rendu graphique complet n'est plus dans la carte. Si le graphique inline est indispensable, il faut augmenter la hauteur réservée (par exemple 280 px) pour toutes les cartes, au prix de la densité.
- **Attention** : la barre fixe remplace la section. À valider à l'usage : si une question est ratée, ajouter un filtre `À traiter` proéminent ou une notification desktop (idée 7 de la boîte à idées), pas un retour au tri.
- **Terminé sur un tour fini** : le bouton fait la clôture humaine (`POST /api/fleet/done`), il ne transforme pas la carte en `terminé confirmé` : la carte disparaît. Si le propriétaire veut voir la coche apparaître après son clic, il faut un statut « validé par l'humain » distinct, ou garder la carte avec un `closed_at` local. Un toast « Annuler » serait utile si la fermeture devient fréquente, mais il demande une route de réouverture.
- **Deux fermetures, deux mots** : un bouton qui ferme un panneau ne doit jamais s'appeler `Fermer` à côté d'une action qui retire la tâche. La clôture dit toujours `Terminé` (vert, carte et détail) et le panneau dit `Fermer le détail` : c'est la correction du 2026-11-07, après qu'un `Fermer` ambigu du détail a retiré une conversation de la flotte à la place de fermer le panneau.
- **Cartes rouvertes** : elles repartent en bas. Si le propriétaire veut les retrouver à leur ancienne place, cela réintroduit un déplacement. Trancher.
- **Fermeture** : l'espace se referme. Si le propriétaire veut zéro mouvement même à la fermeture, garder un emplacement vide jusqu'au rechargement. Trancher.
- **Menu et tooltip** : avec `overflow: hidden`, ils doivent être portailisés. La leçon existe déjà pour le tooltip de confiance ; l'étendre au menu.
- **Filtres** : un filtre actif fait sortir une carte de la vue quand son état change. C'est un choix humain, mais il faut le documenter pour ne pas le confondre avec le tri automatique.
- **Épinglage** : l'idée « pinner une conversation » de la boîte à idées reste hors périmètre. Si elle est ajoutée plus tard, elle devra être un déplacement explicitement demandé, pas un tri automatique.

## 6. Décisions

Tranchées pour cette recommandation :

1. Une seule liste, ordre d'arrivée stable par identité, persisté localement.
2. Aucun tri ni déplacement par état ; l'état ne change que la décoration et le contenu.
3. Hauteur unique et zones réservées pour toutes les cartes.
4. Attention par barre fixe, liseré, badge et bouton `Suivante`, sans remontée.
5. Contenus longs, questions, permissions et composer étendu dans un inspecteur en colonne de droite, redimensionnable.
6. Aperçu de résultat borné dans la carte (la livraison inline reste, le complet est à un clic).
7. Aucun changement de contrat daemon ; le tri du daemon est ignoré par l'UI.
8. Quatre états visuels distincts : travaille, fini à valider, terminé confirmé, attend ta réponse. Le bouton de clôture est toujours `Terminé`, en vert, sur la carte et dans le détail.
9. `Fermer le détail` ne ferme que le panneau ; la clôture d'une tâche est toujours `Terminé`, jamais un « Fermer » du panneau.
10. Le détail est une colonne de droite (chat, liste, détail) redimensionnable, fermée par la croix ou quand aucune tâche n'est sélectionnée ; il affiche la progression, les étapes et la confiance, avec le composer collé en bas.
11. Le bouton `Terminé` clôture la tâche immédiatement et la retire : pas de statut « validé par l'humain » intermédiaire (choix du propriétaire, 2026-11-07).

À confirmer avec le propriétaire avant implémentation :

- hauteur exacte (232 px proposé) et présence du composer d'une ligne dans la carte ;
- comportement des cartes rouvertes et des fermetures (reflux autorisé ou emplacement vide) ;
- acceptation de l'aperçu de résultat borné au lieu du rendu complet inline.

## 7. Liens

- Idée d'origine et questions ouvertes : `docs/analyses/design_concept/10-boite-a-idees.md`, « Ordre des cartes figé : les nouvelles en bas, rien ne bouge sous le curseur ».
- États et niveaux de texte : `docs/analyses/design_concept/03-etats-taches-et-signaux.md` (règle 1-5-50, anti wall-of-text).
- Décision « livraison inline » : `docs/analyses/design_concept/06-questions-ouvertes.md`.
- Contrat UI actuel : `docs/analyses/mvp1/implementation-ui-react.md`.
- Périmètre MVP1 : `docs/analyses/mvp1/objectif-mvp1.md`.
- Pièges à conserver : `AGENTS.md` (tooltip en portail, focus sous SSE, `pollOnce` single-flight, `busy` prioritaire sur TERMINÉ, `line-height: normal`).
