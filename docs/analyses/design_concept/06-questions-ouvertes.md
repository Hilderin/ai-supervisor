# 06 — Questions ouvertes (à trancher ensemble)

Le brainstorm vit ici. Une question = une décision de design ; on la tranche, on la reporte dans les docs concernés.

## A. Périmètre et forme

1. **Web app légère vs. panneau intégré à OpenChamber ?** La web app indépendante offre la liberté totale mais impose build et déploiement. Un panneau côté OpenChamber serait intégré mais dépend de ce qu'OpenChamber accepte d'héberger.
2. **Un écran de flotte par projet, ou multi-projets ?** Vous avez plusieurs projets : AI Supervisor agrège-t-il tout, ou filtre-t-il par projet ?
3. **MVP vertical** : quelle première tranche ? [file des tâches + parcours C] seul, ou [lancement (B) + file (A)] d'abord ?

## B. Modèle de données

4. **Tâche = 1 session en V1, ou déjà multi-sessions ?** Coût marginal faible, mais UI plus complexe.
5. **Où vit le goal ?** *(éclairci par l'exploration d'OpenChamber)* — Session Goals existe nativement (`session.metadata.openchamber.goal` + runtime d'audit/continuation). Réponse proposée : le Superviseur **réutilise** le goal OpenChamber et n'ajoute que la couche tâche (titre, template, journal).
6. **Tâche sans session** (notée mais pas encore lancée) : backlog voulu, ou hors périmètre ?

## C. Détection

7. **Seuils par défaut** : silence 5 min ? à régler après quelques jours d'usage réel.
8. **Position du signal `drifting`** : discret sur la carte, ou toast immédiate ?
9. **Agent « watchdog »** : une session OpenCode dédiée qui regarde les autres et écrit un journal, plutôt que de la logique locale ? Plus cher en tokens, plus fin en jugement.

## D. Notifications

10. **Le degré voulu** : badge dans l'UI seulement, toasts, notifications système / push mobile (canal potentiellement déjà couvert par OpenChamber) ?
11. **Ne pas déranger** : besoin d'un mode silencieux par tâche ?

## E. Technique

12. **Stack** : le repo est vide, tout reste à décider. Piste naturelle : TypeScript + `@opencode/client`/contrat `openapi.json`, petite web app, streams WS d'OpenChamber.
13. **Accès** : *(éclairci)* OpenChamber expose déjà `sessions/status`, WS d'événements et le proxy OpenCode — accessible en HTTP local, Auth = password UI OpenChamber. Le superviseur évolue comme un client OpenChamber.
14. **Hébergement** : un port local séparé, ou servie par OpenChamber lui-même (panels/extensions existent) ?

## F. Contraintes découvertes pendant les explorations (nouveau)

15. **Écart de versions** : le checkout OpenCode local est en avance sur la version installée (contrat refactorisé). Vérifier `GET /openapi.json` du serveur réel avant tout code — quel mode OpenChamber/OpenCode utilises-tu (géré vs attaché) ?
16. **Questions (forms) fugaces** : en mémoire, TTL 10 min après réponse, disparues au redémarrage serveur → le superviseur doit indexer les événements en continu, pas re-lire. Ça impose un processus **toujours en marche** (daemon local), pas une pure web page éphémère.
17. **Historique des scheduled tasks** : inexistant côté OpenChamber → doit-on le tenir dans le store du superviseur (indexation du flux) dès la V1 ?
18. **Coût par session** : tokens/coût natifs dans OpenCode, tokenBudget déjà présent dans les session goals — la vue flotte doit-elle afficher le coût/budget de chaque tâche ?

## G. Paysage concurrentiel (nov. 2026 — doc 09)

19. **Le paysage est saturé en orchestration, vide en supervision de l'attention** (doc 09). Trois axes restent non couverts par quiconque : débloquer multi-projets priorisé, mémoire déclarée, vérification de clôture. Décision à trancher : **le MVP porte-t-il ces trois axes « vides » de plein front, ou d'abord la flotte « Voir » bien couverte par l'écosystème ?** (liée à la question 3, section A)
20. **P1/P5/P10 partiellement couvertes par OpenChamber lui-même** (approvals, scheduled tasks, statuts, doc 05). Pour chaque douleur, position explicitée à tenir : réutiliser l'API OpenChamber et se différencier sur le calibrage (priorisation, digest, snooze) — à valider à l'usage réel avant de coder.

## Décisions tranchées

| Décision | Date | Impact |
| --- | --- | --- |
| Le Superviseur reçoit des hooks externes (courriel, chat, PR) et les transforme en tâches candidates ; la réponse se tape sur la carte, pas dictée à part | 2026-11-06 | doc 08 §6 |
| La phrase phare « ton attention est la ressource rare… » est le critère de design nᵒ1 du projet | 2026-11-06 | README |
| La flotte devient un bureau d'actions : 3 familles de cartes — relais humain (entrant), acte sortant (cas « message à Max »), travail d'agent — même forme, canal de retour différent | 2026-11-06 | doc 08 §6 |
| Maquette v2 : plus de suggestions sous la barre ; saisie = session en cours ; sections « Besoin de ton attention / En cours / Fini » ; réponses rapides (Oui/Non/Envoyer) avec **toujours** un champ texte libre ; pas de compteur d'âge d'attente ; Fini = « Repartir » (texte) ou « Terminer » ; lien ↗ OpenChamber sur chaque carte | 2026-11-06 | mockups/02-flotte-v2.html |
| Cartes « En cours » : une phrase d'activité + barre de progression + niveau de confiance en un coup d'œil | 2026-11-06 | mockups/02-flotte-v2.html (à prouver avec des données réelles : todos, budget, retries) |
| Direction visuelle : light theme épuré (réf. claude-agents-dashboard « Daylight ») — suppression des stats d'usage de l'en-tête | 2026-11-06 | mockups/03-flotte-light.html |
| Lien OpenChamber = petite icône coin haut-droit de la carte, pas un bouton pleine largeur | 2026-11-06 | mockups/03-flotte-light.html (v3.2) |
| Titre à gauche complète ; « attends ta réponse » = chip à droite du titre ; bruit supprimé (pills tags/canal/texte-confiance) ; la confiance devient un point coloré muet sur la barre de progression | 2026-11-06 | mockups/04-flotte-rendus.html |
| **La livraison se rend INLINE dans la carte** (graphique + explication sommaire, table, doc) : objectif = éviter OpenChamber pour consulter les résultats, n'y aller que pour le contexte long | 2026-11-06 | mockups/04-flotte-rendus.html — à brancher sur le tool `openchamber_render` des sessions + livraison via événements |
| **MVP1 = la flotte maquettée (v4)** : saisie → session, cartes d'état, réponses inline, livraison inline, clôture Repartir/Terminer, ↗ OpenChamber. Tout le reste (hooks, digest, mémoire, search, scheduled tasks) est post-MVP1 | 2026-11-06 | doc 09 |
| MVP1 : confiance = voie mécanique (A) uniquement ; chip d'attention dans la liste En cours (fatigué en haut), une section dédiée est un détail d'affichage si l'usage le réclame | 2026-11-06 | docs 03 (§0), 09 (§2) |
| La flotte suit l'attention, pas un cycle de vie dev : Planning/Isolating de PILOT est optionnel par tâche, jamais une étape obligatoire (cadence protégée) | 2026-11-06 | doc 08 §2 |
| Les micro-tâches (type « réponds à Gab ») sont des cartes légères dans la même flotte ; leur réponse est l'action principale de la carte | 2026-11-06 | doc 08 §6 |
| Lancement par barre unique en langage naturel, réglages fins ajustables après coup | 2026-11-06 | doc 08 §3 (à préciser) |
| Les questions à l'utilisateur passent par le tool `question` (jamais de HTML) | 2026-11-06 | AGENTS.md |
