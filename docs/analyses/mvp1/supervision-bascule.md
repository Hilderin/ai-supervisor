# Supervision opt-in des conversations OpenChamber (2026-11-09)

> Décision : une conversation démarrée directement dans OpenChamber reste
> visible dans la flotte du Superviseur mais n'installe PLUS ses sous-agents
> (compagnon analyste, vérificateur) par défaut. Seules les conversations
> démarrées via le Superviseur (chat, `start_task`) sont supervisées par défaut.

## 1. Le problème

Le compagnon et le vérificateur s'attachaient à TOUTE session visible de la
flotte : une conversation ouverte à la main dans OpenChamber se voyait
installer un enfant « comp. supervision » et un enfant « verif. critères »,
consommer des analyses de modèle, et recevoir des rappels critères, sans que
le propriétaire ait rien demandé. La flotte est une vue : elle ne doit pas
s'immiscer par défaut dans les conversations qui n'ont pas été créées pour
elle.

## 2. Modèle de données (state.mts)

Nouvelle table `supervision` : une ligne explicite par session, avec
horodatage. Aucune écriture automatique au démarrage : la ligne n'existe que
quand le propriétaire (ou le code) tranche explicitement.

```sql
CREATE TABLE IF NOT EXISTS supervision (
  session_id TEXT PRIMARY KEY,
  supervised INTEGER NOT NULL,   -- 1 = supervisée, 0 = non supervisée
  updated_at INTEGER NOT NULL
);
```

La règle de défaut est lue, jamais migrée : `isSupervised(sessionId)` vaut

1. la ligne explicite si elle existe (le choix du propriétaire fait foi) ;
2. sinon `true` si un `task_brief` existe pour la session (démarrée via le
   Superviseur : comportement inchangé, contrainte de la demande) ;
3. sinon `false` (conversation OpenChamber : non supervisée par défaut).

Pas de règle de rattrapage sur `companion_map`/`verifier_map` existants : les
conversations OpenChamber déjà supervisées avant le changement passent en non
supervisées au prochain démarrage du daemon, et restent activables d'un clic.
C'est le sens même de la demande (« par défaut »).

## 3. Garde d'attache des sous-agents

Deux couches, défense en profondeur :

- **fleet.mts** : `runPoll` filtre `tickSessions` (compagnon ET vérificateur)
  sur `isSupervised(id)` : une conversation non supervisée n'est jamais
  proposée aux ticks.
- **companion.mts / verifier.mts** : les ticks refiltrent eux-mêmes leurs
  candidats sur `isSupervised` (les tests appellent les ticks directement,
  sans passer par la flotte). Un kick consommé pour une session non supervisée
  est jeté : pas d'analyse différée si la supervision est activée plus tard
  par un kick périmé (l'activation pousse son propre kick).

La flotte transporte désormais `supervised: boolean` sur chaque carte, relu de
la BD à chaque frame (le changement est effectif sans redémarrage).

## 4. Bascule (server.mts)

`POST /api/fleet/supervision` `{sessionId, supervised}` :

- persiste la ligne explicite en BD (avec horodatage) ;
- **désactivation** : détache les sous-agents existants : archivage des
  sessions compagnon et vérificateur (geste doux, historique conservé dans
  OpenChamber), suppression des mappings `companion_map`/`verifier_map` et de
  l'état mémoire des ticks ; la conversation elle-même et son historique ne
  sont pas touchés ;
- **activation** : pousse un kick « start » : le compagnon cadre la
  conversation au prochain tick (effet immédiat, sans redémarrage) ;
- refuse la session de supervision elle-même et les sessions hors flotte
  (même garde `not_task` / 404 que `/api/fleet/model`).

La bascule est symétrique et répétable ; chaque changement est journalisé
(`task_log`).

## 5. UI

- Un badge discret « Non supervisée » sur la carte quand `supervised === false`
  (une conversation supervisée ne porte aucun badge : le bruit resterait).
- Une entrée dans le menu « options » (⋯) de la carte : « Activer la
  supervision » ou « Désactiver la supervision ». L'appel POST est suivi d'un
  poll daemon immédiat : le frame SSE suivant (500 ms) porte le nouvel état,
  sans rechargement de page.

## 6. Ce qui ne change pas

- Les conversations du Superviseur (brief + registre de reprise) : supervisées
  par défaut, auto-restart inchangé (le registre n'est armé que par
  `start_task`, donc jamais armé pour une conversation OpenChamber).
- Les outils criteria restent appelables par toute conversation ; seule la
  PHASE de vérification (enfant vérificateur) est gardée par la supervision.
- La lecture des messages, l'index local, la livraison et le journal : inchangés.
