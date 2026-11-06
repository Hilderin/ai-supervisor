# 04 — Les 4 parcours épinglés

Chaque parcours correspond à un écran-cible que la première maquette devra satisfaire.

## Parcours A — « Que se passe-t-il ? » (la vue principale, 3 secondes)

```
┌ Flotte ────────────────────────────────────────────────────────┐
│ En attente de toi (2)                                          │
│  ▸ Migration auth  — attend un choix : « garder bcrypt ? »     │   [Oui] [Non]
│  ▸ Bug login       — demande d'édition de package.json         │   [Autoriser]
│                                                                │
│ En cours (3)                                                   │
│  ▸ Refonte dashboard — 4/7 étapes · vu il y a 12 s             │
│  ▸ Tests e2e         — 2/9 étapes · vu il y a 3 min            │
│  ▸ Nettoyage CSS     — sans message depuis 6 min               │
│                                                                │
│ Terminé (1)                                                    │
│  ▸ Docs API — il y a 2 h · livraison : 3 endpoints documentés  │   [Valider] [Rouvrir]
└────────────────────────────────────────────────────────────────┘
```

- Les sections d'alerte en haut, l'activité au milieu, le terminé en bas.
- Chaque carte est cliquable pour l'expand 5 lignes (doc 03). Un bouton déporte vers OpenChamber.
- Les boutons rapides ne sont **pas** un mini-chat : ce sont 2 actions pré-construites pour les 2 cas les plus fréquents (question binaire, permission). Tout le reste passe par « Ouvrir dans OpenChamber ».

## Parcours B — Lancer une tâche (le goal dès le départ)

1. **Nouvelle tâche** : titre + goal en 1-3 bullets (le champ impose un format court).
2. Choix du projet (dossier OpenCode), de l'agent et du modèle ; valeurs par défaut issues de la dernière tâche du même projet.
3. **Templates** réutilisables, stockés dans ce repo (« bugfix », « feature », « refactoring ») : prompt d'ouverture, checklist d'attentes (tests ? PR ? docs ?), seuils de signaux.
4. Au clic **Démarrer** : la session OpenCode est créée via l'API, le message d'ouverture est injecté (goal + conventions + consigne « résume ton avancement dans le journal »), et la carte apparaît immédiatement en `running`.

C'est ici que se joue la traçabilité du goal : sans un lancement propre, la détection de dérive n'a rien avec quoi comparer.

## Parcours C — Débloquer (le plus gros gain de temps)

Cause racine de P2 : l'agent pose une question et on ne la voit pas. Traitement :

1. Une question ou une permission génère un signal de niveau `action`, qui place la carte en tête de file.
2. La carte propose alors le chemin le plus court :
   - question à oui/non → deux boutons inline (réponse envoyée via l'API) ;
   - permission → bouton « Autoriser » ;
   - cas complexe → « Ouvrir dans OpenChamber ».
3. Le signal est daté et **persistant** : tant qu'il n'est pas traité, il reste en tête, avec un compteur « depuis 47 min » qui prend l'accent au-delà de 30 min.

## Parcours D — Clôturer (fermer la boucle du goal)

Quand la session devient idle avec les todos finies :

1. La carte passe en `done` avec une ligne « livré : … » (résumé du dernier message).
2. **Checklist de clôture** dérivée du goal initial : chaque bullet reçoit ✅ / ⚠️ / ❌. Cette checklist est posée par l'agent en fin de tâche (consigne donnée au lancement), jamais devinée par le client.
3. Vous validez, ou vous relancez (bullet non fait → **nouvelle session liée à la même tâche**).
4. La tâche archivée conserve goal initial, journal, durées, sessions liées : la mémoire de ce qui a été fait, et pourquoi.
