# Flotte persistante : les cartes survivent aux redémarrages

Date : 2026-11-12. Problème rapporté par le propriétaire : fermer et rouvrir le
Superviseur vide le tableau, alors que les conversations existent toujours dans
OpenChamber.

## Cause : le statut vivant d'OpenChamber est une carte en mémoire

- La flotte est construite sur `GET /api/sessions/status` (`fleet.mts`,
  `buildFleet`).
- Côté OpenChamber (`packages/web/server/lib/opencode/session-runtime.js`), ce
  statut vit dans la Map en mémoire `sessionStates`, alimentée uniquement par
  les événements `session.status` du flux SSE d'OpenCode.
- Deux pertes :
  - au redémarrage d'OpenChamber ou d'OpenCode, la Map repart vide ; une session
    au repos ne réémet jamais `session.status`, elle ne rentre jamais toute
    seule dans le statut ;
  - les entrées expirent après 24 h (`SESSION_STATE_MAX_AGE_MS`,
    `session-runtime.js`, ligne 2) : une tâche au repos plus d'un jour sort du
    tableau même sans redémarrage.
- OpenChamber ne re-seede pas la Map depuis l'annuaire au démarrage : il ne
  gère que la reprise des sessions BUSY interrompues
  (`restart-session-recovery.test.js`).
- L'annuaire `GET /api/session`, lui, est durable (stockage OpenCode) : toutes
  les conversations y restent, avec titre, dossier, `time`
  (created/updated/busy/idle/viewed) et `metadata.openchamber.work`.

## Correctif : registre persistant `fleet_seen` + restauration continue

Nouvelle table `fleet_seen` (`state.mts`) : une ligne par conversation montrée
dans le tableau (`session_id`, `title`, `dir`, `first_seen_at`,
`last_seen_at`, `last_update_at`).

Dans `fleet.mts` :

- `persistFleetSeen` : chaque carte du statut vivant est notée dans le registre
  (upsert à chaque poll).
- `restoreFleetRows` : les conversations du registre absentes du statut vivant
  sont remises au tableau. Appelé à CHAQUE poll, pas seulement au démarrage :
  un redémarrage d'OpenChamber en cours de route se répare tout seul.
  - La session est revérifiée sur son état COURANT : annuaire d'abord, sinon
    lecture directe `GET /api/session/:id` (cache 5 min : l'annuaire est paginé
    à 200, une session peut en manquer).
  - Filtres identiques à `buildFleet`, sur les métadonnées fraîches : pas le
    chat de supervision, pas le dossier `.superviseur`, pas de `parentID`, pas
    d'archivée.
  - Une conversation marquée terminée (`work=done` : bouton « Done »
    d'OpenChamber ou « Terminé » du Superviseur) ne revient pas.
  - Une session absente de l'annuaire et en 404 en lecture directe quitte le
    registre (suppression confirmée). Instance injoignable : rien n'est décidé,
    la ligne du registre reste (même règle que `resume.mts`).
  - Une session déjà dans le statut vivant mais sans annuaire (fantôme, page
    en retard) n'est pas restaurée en faux « idle » : `buildFleet` en décide.
- La carte restaurée porte `status: 'idle'`, le titre et les `time` de
  l'annuaire (`turnStartedAt` = `time.busy`, `lastUpdateAt` = `time.updated`) :
  le tri et la livraison du détail suivent la vraie fraîcheur. La restauration
  passe AVANT l'enrichissement plan et critères : la carte arrive complète sur
  la même frame (règle anti-flicker du 2026-11-07).

Le cycle de vie reste porté par les mécanismes existants :

- fermée dans le Superviseur (`closed_at`) : `enrichedFleet` la filtre, et une
  activité postérieure la rouvre (inchangé) ;
- le « Terminé » écrit aussi `work=done` côté OpenChamber : la carte ne
  reviendra pas non plus après une perte du statut vivant ;
- une tâche dont la session est détruite : la reprise automatique
  (`resume.mts`) recrée une session, qui redevient vivante et re-rentre au
  registre par le statut.

## Conséquence produit

Le tableau ne suit plus la fenêtre des 24 h : il montre toute conversation
encore existante, non terminée, non archivée, tant que le Superviseur l'a vue
au moins une fois. Les anciennes cartes s'entassent en bas (tri par récence)
jusqu'à ce que le propriétaire les marque « Terminé ».

## Tests et vérification

- `daemon/test/fleet-seen.test.mts` (14 tests, harnais OpenChamber simulé :
  annuaire paginé + lectures directes) : persistance et mise à jour du
  registre, restauration, `work=done`, archivée, 404 confirmé, instance
  injoignable (rien décidé), sous-session, chat de supervision, session hors
  page d'annuaire (lecture directe), fantôme du statut sans annuaire, pas de
  doublon avec une carte vivante, tri partagé, question en attente portée par
  la carte restaurée.
- Vérification réelle (OpenChamber local, daemon du repo sur le port 5199,
  base SQLite temporaire) :
  1. premier démarrage : les 5 cartes vivantes entrent au registre
     (`fleet_seen` relu en SQL) ;
  2. arrêt du daemon, injection de deux témoins dans `fleet_seen`
     (ses_e33a5fdd « Analyse de la feature ARC-2478 », `work=open`, absente du
     statut vivant ; ses_e3030ea5 « Simplification du superviseur »,
     `work=done`) : simulation de la perte de la Map d'OpenChamber ;
  3. redémarrage du daemon : la carte `work=open` revient (`status: idle`,
     titre et `time` frais de l'annuaire), la carte `work=done` reste absente,
     aucune carte vivante doublée ;
  4. `GET /api/fleet/delivery` sur la carte restaurée : la livraison du détail
     répond (dernier bilan de la session).
- La conversation « Superviseur » créée par le daemon de vérification a été
  supprimée (`DELETE /api/session/:id`, 204) : aucun résidu dans OpenChamber.
