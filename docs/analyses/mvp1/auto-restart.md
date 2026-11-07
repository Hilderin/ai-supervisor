# Auto-restart : la tâche repart quand sa session est détruite

> Implémenté le 2026-11-07. Code : `daemon/src/resume.mts` (mécanisme),
> `daemon/src/state.mts` (registre `task_resume`), branché dans
> `daemon/src/fleet.mts` (balayage) et `daemon/src/tools.mts` (armement).
> Tests : `daemon/test/resume.test.mts` (17 tests), à lancer SEUL :
> `bun test daemon/test/resume.test.mts` (en batch, `state.mts` peut pointer
> la base de production et le fichier de test refuse alors toute écriture).

## 1. Le problème

La carte d'une tâche vit sur une session OpenChamber ; si cette session est
supprimée (erreur, nettoyage manuel dans OpenChamber, crash), la carte
disparaît du Superviseur alors que l'objectif n'est pas terminé : le brief
(`task_brief`) reste en base, sans session qui le porte.

## 2. Le mécanisme

Un registre par tâche, `task_resume` :

| Colonne | Rôle |
| --- | --- |
| `task_id` | identité stable de la tâche : l'id de la session d'origine, conservé à travers les recréations |
| `session_id` | session vivante actuelle |
| `attempts`, `last_attempt_at` | garde-fous : essais consécutifs + backoff croissant |
| `session_since`, `last_seen_at` | première vue vivante de la session courante, dernier contact |
| `disabled_at`, `disabled_reason` | reprise désactivée (budget épuisé, tâche fermée, session archivée, orpheline ancienne) |

Chaque poll de flotte (3 s) balaye le registre (`resumeTick`) :

1. La session est dans l'annuaire vivant (hors `time.archived`) : on note le
   contact ; si la session tourne depuis 10 min, le budget de tentatives
   revient à zéro.
2. La session est absente : on confirme par une **lecture directe**
   `GET /api/session/:id` (la pagination du répertoire peut cacher une session :
   jamais de décision sur la seule absence du listing). Une session absente de
   deux balayages et en 404 est réellement détruite ; une session archivée
   (toujours listée, marquée `time.archived`) fait désactiver la reprise.
3. Détruite confirmée : nouvelle session créée sur `POST /api/openchamber/sessions`
   avec le **modèle default courant**, puis toutes les données locales suivent
   (`migrateTaskSession`) : brief, état de carte, journal.
   Une seule carte : la nouvelle session hérite de l'identité de la tâche,
   l'historique n'est pas dupliqué (pas de fork du transcript, pas de copie des
   messages). Le verdict du compagnon est supprimé : un bilan ancien figerait
   la carte en « terminé » alors qu'elle reprend.
4. Le prompt de reprise porte le brief (objectif, critères, contraintes), le
   plan connu (`task_state.plan`, lecture du dernier `todowrite`) et le dernier
   bilan : l'agent continue là où il en était, il ne recommence pas.

## 3. Garde-fous (pas de boucle de recréation)

| Garde | Effet |
| --- | --- |
| Confirmation (2 balayages + lecture directe) | une blip du listing ou une instance lente ne déclenche rien |
| Instance vivante exigée (`liveIds` non vide) | une instance vide (redémarrage de la base) n'arrose pas tout le registre |
| Budget : 3 essais consécutifs, réarmé après 10 min de session stable | un crash en boucle sature vite ; la tâche passe en « désactivée » |
| Backoff croissant 30 s, 60 s, 120 s (plafond 10 min) | pas de recréations en rafale |
| Modèle default introuvable | pas de départ en aveugle : l'essai est perdu et le backoff s'applique |
| Tâche fermée (`closed_at`) | désactivée : la clôture humaine ne se relance pas |
| Session **archivée** dans OpenChamber | désactivée : un archivage est un geste humain, pas une destruction |
| Écriture humaine sur une tâche (`send_task`) | la reprise désactivée redémarre (le propriétaire reprend la main) |
| Interrupteur général | `SUPERVISEUR_AUTO_RESTART=0` désactive tout le mécanisme |

Les créations refusées par l'instance comptent aussi comme un essai (backoff) :
même une boucle d'échec de création ne recrée pas en rafale.

## 4. Configuration (variables d'environnement)

| Variable | Défaut | Sens |
| --- | --- | --- |
| `SUPERVISEUR_AUTO_RESTART` | `1` | `0`, `false`, `off`, `non` : tout désactive |
| `SUPERVISEUR_AUTO_RESTART_MAX` | `3` | essais consécutifs avant désactivation |
| `SUPERVISEUR_AUTO_RESTART_BACKOFF_MS` | `30000` | backoff de base (doublé à chaque essai) |
| `SUPERVISEUR_AUTO_RESTART_RESET_MS` | `600000` | session stable depuis ce délai : budget remis à zéro |
| `SUPERVISEUR_AUTO_RESTART_CONFIRM_MS` | `10000` | absence confirmée après ce délai (et 404) |
| `SUPERVISEUR_AUTO_RESTART_LEGACY_MS` | `172800000` (48 h) | au premier balayage : une tâche déjà orpheline n'est rattrapée que si son activité date de moins de ça |

## 5. Le cas du démarrage (backfill)

Au premier balayage sur une instance vivante, chaque brief ouvert sans ligne de
registre est armé. Les orphelines déjà anciennes (aucune activité dans la
fenêtre `LEGACY_MS`) sont armées mais désactivées : on ne ressuscite pas un
nettoyage voulu passé ; les récentes restent candidates (l'accident de la
session d'hier soir se répare au démarrage du daemon).

## 6. Le modèle default courant

`GET /api/config/settings` renvoie `defaultModel` (ex :
`opencode-go/deepseek-v4.1-flash`), celui du sélecteur de l'UI, pas celui de la
session morte. Repli : `GET /api/model/default` (défaut d'OpenCode). Ni l'un ni
l'autre : pas de départ.

## 7. Ce que le mécanisme ne fait pas

- Il ne recopie pas l'historique de la session morte (pas de fork) : la
  continuité vient du brief et du plan, pas du transcript.
- Il ne redémarre ni la session de supervision du chat, ni les sessions enfant
  dans le cadre de la reprise de tâche. Un compagnon supprimé est toutefois
  détecté et recréé par son propre cycle (`companionTick`) tant que sa session
  parente existe. Si le parent lui-même est détruit puis repris, sa nouvelle
  session reçoit un nouveau compagnon et la mapping de l'ancien parent est
  supprimée.
- Il ne touche pas aux tâches fermées, ni aux sessions archivées.
