# Design concept — AI Supervisor

Réflexion de conception pour une interface indépendante de **supervision des conversations OpenChamber**.

## Le phare du projet

> **Ton attention est la ressource rare. Le Superviseur est le seul endroit où elle se réapprovisionne — ce qui tourne, ce qui t'attend, ce qui arrive — et chaque élément se règle d'un geste minimum.**

Toute décision de conception se teste contre cette phrase : si un écran demande plus qu'un geste minimum, ou si l'utilisateur doit aller chercher ce que la flotte aurait dû lui apporter, l'écran est en faute.

## Le problème

Avec 3 à 6 conversations actives en parallèle dans OpenChamber :

- on perd le fil de ce qui est en cours, où, pourquoi ;
- une session peut rester bloquée sur une question sans qu'on s'en rende compte ;
- le « goal » d'une session vit au fond de la conversation, difficile à relire ;
- les agents produisent des murs de texte ; l'essentiel se noie dans le détail ;
- difficulté à savoir si ce qui a été demandé a été fait **jusqu'au bout**.

## La vision en une phrase

> Un poste de commandement de la flotte : tout ce que je dois décider en un coup d'œil, les détails à un clic, jamais l'inverse.
> (Horizon ouvert, doc 08 §6 : les demandes extérieures deviennent elles-mêmes des cartes candidates — tu cliques, tu tapes, ça part.)

Les 12 douleurs visées (P1-P12) sont listées dans [01](01-probleme-et-vision.md). La recherche UX 2025-2026 qui les valide et façonne le design est dans [07](07-etat-de-l-art-recherche.md).

## Documents

| Fichier | Contenu |
| --- | --- |
| [01-probleme-et-vision.md](01-probleme-et-vision.md) | Analyse du problème, personas réel (moi), scénarios d'usage |
| [02-modele-de-domaine.md](02-modele-de-domaine.md) | Entités : Session, Tâche, Goal, Signal, Note du superviseur |
| [03-etats-taches-et-signaux.md](03-etats-taches-et-signaux.md) | Machine à états d'une tâche + niveaux de signal (anti wall-of-text) |
| [04-parcours-epingles.md](04-parcours-epingles.md) | Les 4 parcours clés : lancer, superviser, débloquer, clôturer |
| [05-integration-donnees.md](05-integration-donnees.md) | Ce que la stack expose réellement (API OpenCode server, OpenChamber) |
| [06-questions-ouvertes.md](06-questions-ouvertes.md) | Questions de brainstorm à trancher ensemble |
| [07-etat-de-l-art-recherche.md](07-etat-de-l-art-recherche.md) | Recherche UX/académique 2025-2026 et implications pour le concept |
| [08-que-doit-faire-le-superviseur.md](08-que-doit-faire-le-superviseur.md) | Périmètre clarifié : cadre PILOT adapté, composants, extras MVP, hors périmètre |
| [09-paysage-concurrentiel.md](09-paysage-concurrentiel.md) | Produits et repos GitHub similaires : orchestrateurs, dashboards ; axes couverts / vides |
| [10-mvp1-objectif.md](10-mvp1-objectif.md) | MVP1 figé : capacités, exclusions, critères de succès, prochain pas (spike) |

## Méthode de cette phase

1. On écrit les hypothèses **avant** le code (ce dossier).
2. Chaque section sépare ce qui est **constaté** (vérifiable contre la stack) de ce qui est **inventé** (à valider).
3. Les décisions d'orientation sont tranchées dans 06, une par une.
4. On n'attaque aucun code tant que le concept tient debout sur un cycle réel d'utilisation (kick les pneus avec vraies sessions OpenChamber).
