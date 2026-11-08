# Réglages de conversation : vérification du 2026-11-08

Objet : bouton config du chat (idées 19 et 20 de la boîte à idées), modèle et agent à chaud, modèles séparés du chat, des tâches et du compagnon, persistance et repli.

## Tests automatisés

Boucle daemon, fichier par fichier (les tests ouvrent la même base SQLite) :

```bash
for f in daemon/test/*.test.mts; do bun test "$f"; done
```

Résultat : 29 fichiers, tous à 0 échec. Dont :

- `prefs.test.mts` : 14 pass (catalogue, préférences indépendantes, repli sur valeur inconnue, modèle retiré du catalogue, application à chaud, propagation au compagnon) ;
- `resume.test.mts` : 17 pass (reprise automatique, modèle des tâches) ;
- `supervisorSessionFlow.test.mts` : 5 pass (bascule d'agent sans recréation) ;
- `companion-recovery.test.mts` : 1 pass (création du compagnon avec `model`).

UI :

```bash
bun test ui/src          # 276 pass, 0 fail, 31 fichiers
bun run typecheck:ui     # tsc --noEmit, aucune erreur
bun run build:ui         # build Vite terminé
```

## Vérification au navigateur

Page `http://127.0.0.1:5180/fleet`, chat Superviseur à gauche.

1. **Bouton et panneau** : clic sur `button[data-testid="config-button"]` (engrenage entre le titre et Nettoyer). Le dialogue « Configuration du chat » s'ouvre avec les sélecteurs `config-agent`, `config-chat-model`, `config-task-model`, `config-companion-model`. Capture : `.openchamber/screenshots/config-popover-2026-11-08T18-29-22-878.jpg`.
2. **Changement à chaud** : modèle du chat passé à `opencode/beam-free`, Enregistrer. Le sous-titre de l'en-tête passe de `orchestrateur · skytech/DeepSeek-V4.1-Flash-1017` à `orchestrateur · Beam Free` sans rechargement, et `GET /api/supervisor` conserve le même `sessionId` (`ses_e439c4931ffe2rR8ioWRKtzx08`). Capture : `.openchamber/screenshots/config-saved-2026-11-08T18-29-47-219.jpg`.
3. **Persistance** : modèles des tâches `opencode/big-pickle` et du compagnon `opencode/claude-haiku-4-5` enregistrés, page rechargée. Le panneau rouvert montre les deux sélections. Après redémarrage du daemon, `GET /api/supervisor/config` renvoie toujours les mêmes préférences. Capture : `.openchamber/screenshots/config-persisted-2026-11-08T18-32-07-411.jpg`.
4. **Valeur périmée** : `task_model` posé à `openai/modele-disparu` directement en base, puis panneau rouvert. Le sélecteur affiche « Défaut de la session » et le bandeau orange dit « Modèle des tâches « openai/modele-disparu » introuvable : le défaut s'applique. » Capture : `.openchamber/screenshots/config-warning-2026-11-08T18-31-52-843.jpg`.
5. **Retour au défaut** : `POST /api/supervisor/config` avec les quatre champs vides remet l'orchestrateur versionné et le modèle par défaut ; le sous-titre reprend `skytech/DeepSeek-V4.1-Flash-1017`. Toutes les préférences ont été remises à `NULL` en fin de recette pour ne pas laisser un réglage d'essai.

## Décisions de mise en œuvre

- Préférences dans `supervisor_pref` (une ligne, colonnes NULL = défaut), aucune clé ni secret.
- Catalogue lu à `/api/model`, `/api/provider` et `/api/agent`, filtré sur les modèles `chat` activés et les agents primaires non internes, cache de 30 s.
- Changement à chaud par `POST /api/session/:id/agent` et `/model` ; aucune session recréée.
- Compagnon : `model` à la création (session enfant) et propagation par `POST /api/session/:id/model` aux conversations déjà connues de `companion_map`.
- Tâches : préférence appliquée par `resolveTaskModel` à la création et par `resumeTick` à la reprise automatique ; le modèle demandé par `start_task` garde la priorité s'il est valide.
- Un modèle ou agent invalide n'est jamais stocké ; l'avertissement est renvoyé par l'API et affiché dans le panneau. Une préférence devenue périmée est également signalée à l'ouverture.
- Reste ouvert : choix de la variante (`thinking`, rapide) et favori de modèle par projet pour les tâches.

## Modèle par tâche (complément du 2026-11-08)

Le réglage global « Modèle des tâches » ne sert plus qu'aux nouvelles tâches. Chaque tâche porte son modèle dans `task_brief.model` et `task_resume.model`, visible et changeable dans son détail.

### Vérifications

- `bun test daemon/test/task-model.test.mts` : 7 pass. Lecture de la préférence + modèle effectif + catalogue ; changement à chaud avec `POST /api/session/ses_task/model` ; persistance dans le brief et le registre ; valeur vide qui revient au défaut ; modèle inconnu refusé sans POST ni écriture ; refus de la session laissant la tâche intacte ; tâche sans brief appliquée mais non conservée.
- `bun test daemon/test/resume.test.mts` : 19 pass, dont « la reprise utilise le modèle propre à la tâche, pas le réglage global » et « sans modèle de tâche, la reprise suit le défaut, jamais le réglage global ».
- Navigateur : détail de la tâche « Réglages de conversation... » ouvert par un clic sur sa carte. La ligne d'en-tête affiche `modèle · skytech/DeepSeek-V4.1-Flash-1017` ; l'engrenage est à gauche de la flèche OpenChamber. Le popover montre « Défaut de la session » et « Effectif : ... (défaut de la session) ». Capture : `.openchamber/screenshots/task-model-popover-2026-11-08T21-09-36-061.jpg`.
- Changement dans le détail : modèle `Beam Free` enregistré. Le libellé passe à `modèle · Beam Free` sans rechargement, `GET /api/fleet/model` renvoie `model=opencode/beam-free`, `effective=opencode/beam-free`, et aucune session n'est recréée. Capture : `.openchamber/screenshots/task-model-changed-2026-11-08T21-10-04-200.jpg`.
- Persistance : le modèle `Beam Free` est toujours là après redémarrage du daemon (`GET /api/fleet/model`), puis la tâche est revenue au défaut en fin de recette (`model=null`, `effective=skytech/DeepSeek-V4.1-Flash-1017`).
- Le réglage global des tâches n'a pas été touché pendant ces essais ; le chat du superviseur est resté sur son modèle.

### Décisions

- `task_brief.model` et `task_resume.model` sont la source du modèle d'une tâche. `supervisor_pref.task_model` n'est lu que par `start_task`.
- `resumeTick` lit le modèle de la tâche puis `defaultModelRef()` ; il ne consulte jamais le réglage global.
- `updateTaskModel` écrit le brief et le registre ; `armTaskResume` ne met pas à jour `model` en conflit, donc un changement doit passer par cette fonction.
- Le libellé du détail montre le modèle effectif ; le select du popover montre la préférence. Une valeur vide remet le défaut et efface la préférence.
- Un modèle inconnu est refusé avant tout appel ; un refus de la session (`apply_failed`) laisse la tâche intacte.

## Correctif du 2026-11-08 : modèles de la source Skytech absents

### Constat

`GET /api/model` renvoie 171 entrées sur l'instance : 158 avec `type: 'chat'` et 13 appartenant au provider `skytech` **sans champ `type`**. Le filtre du catalogue exigeait `type === 'chat'` : les 13 modèles Skytech, dont `skytech/DeepSeek-V4.1-Flash-1017` qui est le modèle par défaut de l'instance, étaient écartés du sélecteur. Le chat affichait donc un modèle par défaut impossible à choisir dans la liste.

OpenChamber traite un type absent comme un modèle de chat (son store ne sépare que `type === 'image'`) : le Superviseur suit maintenant la même règle.

### Correctif

- `daemon/src/models.mts` : `(m.type ?? 'chat') === 'chat'` ; les types explicitement non chat (`image`, `embedding`, `decision`) restent exclus, comme les modèles désactivés.
- `daemon/test/prefs.test.mts` : le catalogue de test contient un modèle Skytech sans `type`, un modèle `decision` et un modèle `embedding` ; un test dédié vérifie que le premier est proposé sous « Skytech » et que les autres sont écartés.

### Vérifications

- `bun test daemon/test/prefs.test.mts` : 15 pass, 0 fail.
- `GET /api/supervisor/config` après redémarrage du daemon : 171 modèles, 13 sous `providerName: "Skytech"` (dont `skytech/DeepSeek-V4.1-Flash-1017`), et `defaults.chatModel = skytech/DeepSeek-V4.1-Flash-1017`.
- Navigateur : le select de la configuration du chat propose les 13 modèles Skytech ; `skytech/glm-5.3` sélectionné puis enregistré, le sous-titre passe à `orchestrateur · glm-5.3` (capture `.openchamber/screenshots/skytech-model-applied-2026-11-08T21-19-59-472.jpg`), puis retour au défaut. Le select du modèle d'une tâche propose aussi les mêmes entrées Skytech.

