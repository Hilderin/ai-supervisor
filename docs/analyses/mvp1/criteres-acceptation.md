# Critères d'acceptation et renommage plan : spécification

> Spécification rédigée avant implémentation, à valider par le propriétaire.
> Liens : [objectif-mvp1.md](objectif-mvp1.md), [chat-superviseur.md](chat-superviseur.md),
> [compagnon-verdict.md](compagnon-verdict.md), [architecture.md](architecture.md).

## 0. Le concept en une phrase

Chaque tâche porte une liste de critères d'acceptation (AC-01, AC-02, ...) que
l'agent principal fait progresser avec des tools dédiés, que le vérificateur
(un sous-agent enfant) juge via des preuves, et dont le daemon applique les
transitions : le statut d'un critère n'est JAMAIS modifiable directement,
uniquement via les transitions de la machine à états.

## 1. Le critère

Un critère est une ligne de la table `criteria`, identifiée par :

| Champ | Rôle |
| --- | --- |
| `ref` | `AC-01`, `AC-02`, ... : identifiant stable, jamais réattribué après retrait |
| `title` | titre court (« Tests unitaires passent ») |
| `detail` | ce qui prouve exactement le critère (commande, parcours, ce qu'on doit voir) |
| `methods` | au moins une méthode de validation (JSON, liste non vide) |
| `status` | `todo`, `to_validate`, `to_fix`, `validated` |
| `evidence` | la preuve soumise (JSON, liste d'items) |
| `review` | dernier commentaire du vérificateur (approbation ou raison de rejet) |

### 1.1 Méthodes de validation

`unit_test`, `e2e`, `browser_nav`, `screenshot`, `human`, `text`,
`code_excerpt`, `artifact`, `command`, `diff`, `doc`.
Chaque critère exige au moins une méthode : c'est le contrat de preuve.
`criteria_add` et `criteria_update` refusent une liste vide ou inconnue.

Sens des types ajoutés (retenu avec le propriétaire) :

- `code_excerpt` : un fichier de code avec numéros de lignes
  (`path` + `start_line` + `line_count`), `text` dit quoi y voir ;
- `artifact` : un fichier livré sur le disque, relatif au projet, avec ce
  qu'il faut y vérifier ;
- `command` : une commande et sa sortie (dans `text`), au-delà du seul test
  unitaire ;
- `diff` : un commit ou un patch, le code modifié et son contexte ;
- `doc` : une section d'un document du repo qui documente le changement.

### 1.2 Preuve soumise (`evidence`)

Une liste d'items `{kind, text, path, start_line, line_count, at}` où `kind`
appartient au même ensemble que les méthodes, `text` décrit ce qui prouve
(sortie de test, parcours suivi, observation, commande et sa sortie) et :

- `path` est optionnel : capture d'écran ou fichier relatif au projet ;
- `start_line` et `line_count` sont requis pour `code_excerpt`.

Durcissement transverse : quand une preuve porte un `path`, le daemon vérifie
à la soumission (`criteria_to_validate`) que le fichier existe dans le dossier
du projet (chemin relatif, validé comme les lectures d'investigation) ; une
preuve à `path` inexistant est refusée au tool, pas plus tard. Les images
restent servables dans le détail via `/api/fleet/asset` ; extraits de code et
artifacts s'affichent en texte dans la section Critères.

## 2. Machine à états

États : `todo` (À faire), `to_validate` (À valider, preuve soumise),
`to_fix` (À corriger, rejet avec justification), `validated` (Validé, preuve
acceptée pour la version examinée).

| Transition | De | Vers | Qui | Via |
| --- | --- | --- | --- | --- |
| création | (rien) | `todo` | agent principal | `criteria_add` |
| soumission de preuve | `todo` ou `to_fix` | `to_validate` | agent principal | `criteria_to_validate` |
| approbation | `to_validate` | `validated` | daemon (retour JSON vérificateur) | `criteria-approve` (interne) |
| rejet | `to_validate` | `to_fix` | daemon (retour JSON vérificateur) | `criteria-reject` (interne) |
| invalidation de contenu | `to_validate`, `to_fix`, `validated` | `todo` | agent principal | `criteria_update` |
| retrait | n'importe quel état | (ligne supprimée) | agent principal | `criteria_remove` |

Règles dures :

1. **Aucun tool d'écriture directe du statut** : le plugin n'expose ni
   `criteria_approve` ni `criteria_reject` à l'agent principal ; ces deux
   transitions existent uniquement dans le daemon, déclenchées par le retour
   JSON du vérificateur.
2. **Un critère `validated` reste validé** tant que son contenu ne change pas
   (`criteria_update` le repasse `todo`) et qu'il n'est pas retiré. Un nouvel
   objectif de tâche ne réinitialise pas les critères. Un critère validé peut
   être OBSOLÈTE sans changer : chaque critère porte `validated_at` et une
   **version de contenu** (incrémentée à chaque preuve soumise ou contenu
   modifié) ; quand le travail a bougé depuis l'approbation, l'injection du
   vérificateur marque « VALIDÉ AVANT LES DERNIÈRES MODIFICATIONS » pour qu'il
   recoupe ou suggère une revalidation (retour du propriétaire, 2026-11-08 :
   pas de système de dépendances fichiers/critères, un signal suffit).
3. **Nouvelle phase de validation** : `criteria_add`, `criteria_remove` et
   `criteria_update` (et l'application daemon d'une suggestion du vérificateur)
   réveillent le vérificateur pour une revalidation de la liste.
4. **Refs jamais réattribuées** : un compteur par tâche (`task_state.criteria_seq`)
   donne le prochain numéro ; un retrait ne libère pas son numéro.
5. **Approche et rejet sont versionnés et atomiques** : l'approbation vise la
   `submission_version` du critère telle que le vérificateur l'a vue ;
   `UPDATE ... WHERE status='to_validate' AND version = ?` ; un jugement sur
   une version périmée (l'agent a soumis une preuve ou modifié le critère
   pendant la phase) est ignoré (`stale_judgment`), jamais appliqué.
6. **Retrait** : `criteria_remove` (agent) est une SUPPRESSION DOUCE
   (`removed_at`, la ligne reste consultable : un critère retiré sert à
   comprendre une régression passée) ; le vérificateur ne supprime jamais
   physiquement : son op `remove` enregistre une **proposition persistée**
   (raison obligatoire) que l'agent confirme (`criteria_remove`) ou refuse
   (`criteria_update`, qui efface la proposition).
7. Chaque transition est journalisée (`task_log`, kind `criteria`) et visible
   dans le journal de la carte.

## 3. Tools criteria (agent principal)

Plugin OpenCode `superviseur-criteria` (dossier `daemon/plugin/superviseur-criteria`),
même modèle que `superviseur-task` : outils directs (`codemode: false`) qui
postent vers le daemon (`POST /api/criteria/:name`) avec le `sessionID`
appelant ; le daemon valide que l'appelant est une tâche connue
(`isTaskSession`, compagnon et chat refusés), applique la transition de la
machine à états et répond. Noms en underscores, convention du repo
(`read_project`, `list_tasks`) : les verbes `approve` et `reject` n'existent
pas côté agent.

| Tool | Entrée | Effet |
| --- | --- | --- |
| `criteria_add` | `{title, detail?, methods[]}` | crée le critère au prochain ref libre, statut `todo`, version 0 ; réveille le vérificateur |
| `criteria_remove` | `{ref}` | suppression DOUCE (historique conservé, `include_removed` pour le relire) ; réveille le vérificateur ; ref jamais réattribuée |
| `criteria_update` | `{ref, title?, detail?, methods?}` | modifie le contenu (version + 1) ; un critère non `todo` repasse `todo` (preuve invalidée) ; efface une proposition de retrait ; réveille le vérificateur |
| `criteria_to_validate` | `{ref, evidence[]}` | exige au moins un item de preuve valide ; `todo`/`to_fix` → `to_validate` (version + 1) ; remplace l'ancienne preuve |
| `criteria_list` | `{include_removed?}` (lecture) | renvoie la liste complète avec états, versions, preuves, propositions et commentaires ; ne déclenche rien |

Gardes communs : `title` non vide (200 car.), `detail` (2000 car.), `ref`
inconnu → erreur `unknown_ref` ; plus de 12 critères par tâche → `limit` ;
méthodes inconnues → `invalid_method`. Chaque tool répond `{ok, criteria}` (la
liste après application) pour que l'agent reste aligné sans relecture.

## 4. Le vérificateur

### 4.1 Session et agent

- Agent global, canonical dans `daemon/agent/superviseur-verificateur.md`,
  nom **sans hash** : `superviseur-verificateur`, symlink dans
  `~/.config/opencode/agent`. Choix du propriétaire : pas de versionnage par
  hash, la session vit longtemps et doit garder son fil.
- **Une seule session vérificateur par tâche, réutilisée pour toutes les
  vérifications** : sous-conversation enfant de la tâche (`POST /api/session`
  `{parentID: taskId, agent}`), créée à la première phase de validation,
  réparée si supprimée ou archivée. Réutiliser la même session lui garde le
  fil de la liste, des preuves déjà jugées et des retraits : il valide
  beaucoup mieux les ajouts et retraits successifs. Toute la quincallerie du
  compagnon est réutilisée (`ensureVerifier` calqué sur `ensureCompanion`,
  table `verifier_map`, réparation à la disparition).
- Conséquence assumée de la leçon « prompt mis en cache par NOM » : modifier
  le prompt du vérificateur exige un redémarrage d'OpenCode (ou un renommage
  manuel) pour que la session existante ou suivante le charge ; le prompt
  étant stable, le risque est faible et le comportement documenté ici.

### 4.2 Lectures bornées de la conversation de l'agent principal

Plugin `superviseur-verifier` : cinq outils de lecture qui postent vers le
daemon (`POST /api/verifier/:name`), lequel vérifie que l'appelant est bien le
vérificateur de la tâche (`verifier_map`) et interroge OpenChamber pour la
seule session parent. Rien d'autre : le vérificateur n'a AUCUN tool de
gestion des critères et aucun tool natif (bash, read, edit, ... désactivés
dans le frontmatter de l'agent).

| Tool | Bornes |
| --- | --- |
| `verifier_messages` | liste des messages du parent (`limit` 60 max), textes tronqués ; lecture du texte racine (`m.text`, leçon du prompt humain) |
| `verifier_tools` | liste des tool calls récents (`limit` 40 max) : nom, statut, entrée résumée |
| `verifier_tool_result` | UN tool call précis avec entrée et sortie COMPLÈTES (bornées) : `{index}` ou `{tool, query?}` ; c'est ce qui permet de juger la preuve elle-même, pas sa description |
| `verifier_artifact` | lit un artefact de preuve dans le dossier du projet du parent (extrait de code avec lignes, texte, document) ; une image n'en donne pas le rendu visuel : le tool le dit et une preuve textuelle complémentaire est exigée |
| `verifier_search` | recherche (30 matches max) dans les messages ET les entrées de tool calls, sur l'historique couvert (union des deux extrémités du listing : l'API ignore offset/curseurs, vérifié sur l'instance ; la recherche serveur d'OpenChamber est désactivée) |

Chaque lecture porte un horodatage de fenêtre optionnel (`since`) pour ne pas
relire toute la conversation à chaque phase.

### 4.3 Déclencheurs

- tool `criteria_add` / `criteria_remove` / `criteria_update` (nouvelle phase
  de validation, exigence du design) ;
- tool `criteria_to_validate` (une preuve attend un jugement) ;
- fin de tour de la tâche (kick `end` du flux `session.execution.*`) si la
  tâche a au moins un critère ;
- création PROACTIVE : la sous-conversation existe pour toute tâche dès le
  premier tick (même sans critère, comme le compagnon) ; aucune phase ne part
  tant qu'il n'y a rien à juger.

Garde-fous (leçons compagnon) : intervalle minimal entre deux phases
(`SUPERVISEUR_VERIFIER_MIN_INTERVAL_MS`, défaut 20 s ; 60 s après une phase qui
a modifié la liste, pour casser les boucles) ; dédoublonnage par signature de
l'état critères PERSISTÉE en DB (`verifier_map.signature`, mise à jour après
chaque phase appliquée) : la signature ne repart pas à vide au redémarrage du
daemon, donc aucun redémarrage ne relance de phase sans changement (retour du
propriétaire, 2026-11-08) ; une seule phase à la fois par tâche ; concurrence
globale limitée à 2 ; l'attente de réponse scanne les messages du plus récent
au plus ancien (`newestVerifierReply`, le listing est descendant : un assistant
sans texte ne doit pas masquer le JSON, constat réel : 151 s d'attente ramenées
à environ 13 s).

### 4.4 Injection et contrat JSON

Le daemon injecte : objectif courant, liste des critères avec états, VERSION de
contenu de chacun, preuves soumises (texte), derniers commentaires, propositions
de retrait en cours, marqueur « VALIDÉ AVANT LES DERNIÈRES MODIFICATIONS »
(`validated_at` antérieur à la dernière activité de la tâche), extrait de
conversation récent, et le rappel du contrat. Le vérificateur répond par UN
SEUL bloc JSON, clés en anglais :

```json
{
  "review": "ok",
  "notes": "Une phrase pour la carte ou le journal, en français.",
  "actions": [
    { "op": "approve", "ref": "AC-02", "submission_version": 2, "comment": "Les tests sont visibles et passent." },
    { "op": "reject", "ref": "AC-03", "submission_version": 1, "reason": "La capture ne montre pas l'état final." },
    { "op": "add", "title": "Aucune régression du build UI", "detail": "...", "methods": ["unit_test"], "reason": "Le plan touche l'UI sans critère associé." },
    { "op": "remove", "ref": "AC-05", "reason": "Doublon de AC-04." },
    { "op": "update", "ref": "AC-01", "title": "...", "detail": "...", "methods": ["unit_test"], "reason": "Le détail ne précise pas la commande." }
  ]
}
```

Règles du contrat :

- `approve` et `reject` ne visent que des critères `to_validate` et portent la
  `submission_version` vue par le vérificateur : un jugement périmé (le critère
  a changé pendant la phase) est ignoré et journalisé, jamais appliqué ; un ref
  invalide est ignoré et journalisé (le daemon garde la main) ;
- `reject` exige `reason` (l'explication devient `review` du critère et part
  dans la notification) ; `approve` peut porter un `comment` court ;
- `add` exige `title` et au moins une méthode ; `update` exige au moins un
  champ de contenu ; chaque suggestion peut porter une `reason` ;
- `remove` n'est PAS une suppression : une proposition persistée (raison
  obligatoire), le critère reste en place jusqu'à confirmation ou refus de
  l'agent ; idempotente à raison identique ;
- au plus 12 actions par réponse, inconnues ignorées avec journal ;
- cohérence des états : le vérificateur signale en `notes` toute incohérence
  qu'il constate (p. ex. un `validated` dont la preuve ne tient plus, ou validé
  avant les dernières modifications), le daemon ne dégrade JAMAIS un `validated`
  sur seul avis du texte `notes` : une dégradation passe par `update`
  (suggestion) qui repasse le critère `todo`.

## 5. Application par le daemon et notifications

- Le retour JSON est parsé toléramment (comme le verdict compagnon) ;
  réponse illisible : une reprise de réparation (un seul essai), puis abandon
  sans transition ; la signature n'est pas consommée (la phase repartira).
- Les actions sont appliquées dans l'ordre, via exactement les mêmes fonctions
  de transition que les tools (une seule source de vérité de la machine à
  états, dans `criteria.mts`).
- **Notification à l'agent principal** : après chaque phase de vérificateur qui
  a produit au moins une transition, le daemon envoie UN message à la session
  de la tâche (`POST /api/session/:id/prompt`, `delivery: 'steer'`) qui liste
  chaque transition appliquée, structurée : la justification d'une approbation
  (`comment`) est transmise, les ajouts portent titre, détail et méthodes, les
  propositions de retrait expliquent comment confirmer ou refuser :

  > [superviseur] Critères : AC-02 validé : la sortie de test passe. AC-03 à
  > corriger : la capture ne montre pas l'état final. AC-05 ajouté par le
  > vérificateur : « aucune régression du build UI » : le plan touche l'UI
  > sans critère associé. Ne réponds pas à ce message : applique les
  > corrections nécessaires.

  Un message par phase (jamais un prompt par transition) ; l'agent initie
  ensuite lui-même ses `criteria_*`. Livraison fiable : 3 essais de steer, puis
  repli sur la file d'attente OpenChamber (`sendConfig` repris de la session) ;
  si les deux échouent, journal et reprise au prochain kick.
- Les transitions initiées par l'agent lui-même (`criteria_to_validate`,
  add/remove/update via tools) ne génèrent pas de notification à lui-même.
- **Rappel critères (analyste)** : un verdict `done` avec un trou de critères
  (aucun critère défini, ou critères restants non validés) fait pousser par le
  daemon UN message à l'agent : la `criteria_note` de l'analyste (adressée à
  l'agent, à l'impératif) sinon le message déterministe `criteriaPushMessage`
  (aucun critère : `criteria_add` ; restants : refs et états,
  `criteria_to_validate`). Dédoublonné : un message identique n'est pas
  repoussé ; le rappel se réarme dès que le verdict repasse hors done. Le
  `wrapOwnerPrompt` (nouvelle consigne du propriétaire) rappelle aussi les
  critères.
- `task_log` reçoit une ligne par transition (kind `criteria`, meta avec ref,
  ancien état, nouvel état, source `agent|verifier`).

## 6. Schéma DB et intégration

```sql
CREATE TABLE IF NOT EXISTS criteria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,             -- suit la tâche migrée (migrateTaskSession)
  ref TEXT NOT NULL,                 -- 'AC-01', stable, jamais réattribué
  title TEXT NOT NULL,
  detail TEXT,
  methods TEXT NOT NULL,             -- JSON array
  status TEXT NOT NULL DEFAULT 'todo',
  evidence TEXT,                     -- JSON array {kind, text, path, at}
  review TEXT,                       -- dernier commentaire du vérificateur
  review_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(task_id, ref)
);
CREATE INDEX IF NOT EXISTS idx_criteria_task ON criteria(task_id);
ALTER TABLE task_state ADD COLUMN criteria_seq INTEGER;
CREATE TABLE IF NOT EXISTS verifier_map (
  parent_session_id TEXT PRIMARY KEY,
  verifier_session_id TEXT NOT NULL,
  agent TEXT,
  created_at INTEGER NOT NULL
);
```

- `migrateTaskSession` (auto-restart) : `criteria` suit la tâche
  (`UPDATE criteria SET task_id`), `verifier_map` est supprimé avec
  `companion_map` (l'enfant est détruit avec son parent).
- `criteria_seq` : compteur du prochain numéro de ref (jamais décrémenté).

## 7. Flotte et UI

### 7.1 Données de flotte

- La flotte enrichie porte par carte `criteria: {total, todo, toValidate,
  toFix, validated}` (calculé en SQL, enrichi avec le plan, jamais dans une
  frame intermédiaire : même garde anti-flicker que `enrichTodoProgress`).
- La liste détaillée (réfs, titres, états, preuves, commentaires) ne voyage
  pas dans la flotte (frames SSE 2x/s) : le panneau de détail la charge à la
  demande via `GET /api/fleet/criteria?sessionId=...`, rechargée quand
  `lastUpdateAt` change (les tool criteria produisent des messages, donc
  rafraîchissent `lastUpdateAt`), avec le même pattern de cache que la
  livraison.

### 7.2 Panneau de détail : section Critères

- Une section « Critères » dans le panneau de détail, **sous le plan**
  (PlanSection), avant les réponses au propriétaire : une ligne par critère
  avec ref (`AC-01`), titre, badge d'état (À faire, À valider, À corriger,
  Validé), la preuve soumise (texte, chemin et lignes pour `code_excerpt`,
  image servable via `/api/fleet/asset`) et le jugement du vérificateur,
  libellé selon l'état : « Vérificateur : preuve refusée : (raison) » en orange
  pour « À corriger », « Vérificateur : preuve acceptée : (commentaire) » en
  vert pour « Validé », rien sinon (retour du propriétaire : la ligne orange
  nue n'expliquait pas son rôle).
- Comportement d'ouverture identique au plan : **dépliée par défaut tant que
  la tâche est en cours, repliée sinon** (`criteriaDefaultOpen` calqué sur
  `planDefaultOpen`, préférence manuelle de repli/dépli mémorisée par session
  comme le plan).
- Une tâche sans critère n'affiche pas la section (pas de placeholder vide).

### 7.3 Carte : deuxième barre de progression

- À droite de la barre de progression du plan, dans le pied de carte, une
  **deuxième barre au même gabarit exact** (piste `flex-1` plafonnée à 160 px
  comme celle du plan, donc même longueur : retour du propriétaire sur des
  largeurs divergentes, largeur animée, libellé `x/y` tabulaire) : nombre de
  critères validés sur le nombre total de critères.
- La barre n'apparaît que si la tâche a au moins un critère (même règle que la
  barre du plan sans plan).
- Le libellé `x/y` est **cliquable comme celui du plan** : même bulle en
  portail `position:fixed` (`CriteriaPopover`, calqué sur `PlanPopover`),
  liste des critères avec pastille d'état par critère, chargée à l'ouverture
  (la flotte ne transporte que les comptes).

### 7.4 Retrait du concept de confiance

Le concept de confiance (pastilles de couleur, bulle, valeur numérique) est
**retiré partout dans le Superviseur** ; la liste des critères et leurs états
deviennent le signal de fiabilité.

Daemon :

- `verdict.mts` : les clés `confidence` / `confidence_reason` quittent le
  contrat du compagnon et la normalisation ; `note` (qui n'était que le
  `confidence_reason`) disparaît avec elles ; le linter reste inchangé.
- `companion.mts` / `state.mts` : `upsertVerdict` n'écrit plus `confiance` ni
  `note` ; les colonnes restent dans `task_verdict` (aucune migration
  destructive, elles restent à NULL) ; le verdict précédent injecté à
  l'analyste ne cite plus la confiance.
- `fleet.mts` : `Verdict` perd `confiance` et `note` ; `tools.mts` (`get_task`)
  perd `confidence` et `confidenceReason`.

Agent analyste :

- `superviseur-analyste.md` : contrat réduit à `state`, `summary`, `next`,
  `human_request` ; plus de `confidence` ni `confidence_reason` ; les règles
  et exemples qui citaient la confiance sont réécrits (ce qui manque au
  lecteur se dit dans `summary`/`next`).

UI :

- `ConfidenceDots.tsx` supprimé ; plus aucune pastille ni bulle de confiance
  sur la carte ni dans le détail (les emplacements libérés accueillent la
  barre critères sur la carte, rien dans le détail) ;
- `types.ts` : `SupVerdict` perd `confiance` et `note` ;
- les tests et fixtures (`SessionCard`, `TaskInspector`,
  `debug/reproFlicker.tsx`) suivent ;
- AGENTS.md : les leçons qui décrivent le comportement courant passent aux
  nouveaux usages ; les entrées devenue historiques (tooltip de confiance,
  pastilles grises) sont marquées « concept retiré le 2026-11-07, ne pas
  réintroduire » pour éviter une résurrection.

## 8. Renommage todo* en plan-* (sans régression)

Motif : distinguer le plan (liste d'étapes de la session de travail) des
objectifs (goal, objective). Le mot « todo » désigne mal la chose.

| Avant | Après |
| --- | --- |
| plugin `superviseur-todolist` (dossier, id) | `superviseur-plan` |
| tools `todowrite`, `todoupdate`, `todoread` | `planwrite`, `planupdate`, `planread` |
| permissions d'outils `todowrite`/`todoupdate`/`todoread` | `planwrite`/`planupdate`/`planread` |
| balise d'injection `<todo_list>` | `<plan_list>` |
| `daemon/src/todos.mts` | `daemon/src/plan.mts` |
| `getTodoSnapshot`, `normalizeTodos`, `extractTodos`, `invalidateTodos`, `resetTodoCache`, `todoPlan` | `getPlanSnapshot`, `normalizePlanItems`, `extractPlanItems`, `invalidatePlan`, `resetPlanCache`, `planStepsOf` |
| champ de flotte `row.todo` | `row.plan` |
| test `daemon/test/todos.test.mts` | `daemon/test/plan.test.mts` |

Règles de compatibilité et points de vigilance :

1. **Le lecteur accepte les deux générations de noms** : `isPlanTool` matche
   `planwrite`/`planupdate` ET `todowrite`/`todoupdate` (les sessions créées
   avant la bascule portent des tool parts anciens) ; les `PlanStep` de
   `verdict.mts` ne bougent pas.
2. **Le stockage du plugin est namespacé par id** : après bascule, les sessions
   en vol repartent de liste vide (recréée au premier appel) ; leçon connue,
   notée dans le README du plugin.
3. **La config globale OpenCode référence le chemin du plugin**
   (`~/.config/opencode/opencode.jsonc`) : mise à jour requise au déploiement,
   et un redémarrage d'OpenCode (leçon : ajouter/changer un plugin exige un
   redémarrage). Les symlinks d'agents `superviseur-analyste-*` citent
   `todowrite: false` dans le frontmatter : mettre à jour les fichiers
   canonical (`superviseur-analyste.md`, `superviseur-orchestrateur.md`) ;
   les hash de version changent, les compagnons sont déclassés et recréés
   naturellement au tick suivant.
4. **Le prompt de création de tâche** (`composePrompt`) et les prompts des
   agents citent les nouveaux noms. Les sessions déjà créées gardent l'ancien
   texte mais l'injection `<plan_list>` (fraîche à chaque requête) porte les
   nouveaux noms, qui l'emportent.
5. **UI** : `types.ts` (`FleetRow.plan`, `PlanStep`), `lib/fleet.ts`,
   `SessionCard`, `PlanSection`, `PlanPopover`, `TaskInspector` et leurs tests ;
   les commentaires de docs et d'AGENTS.md qui décrivent le comportement
   courant passent aux nouveaux noms (les entrées historiques des leçons
   peuvent citer l'ancien nom quand le piège date d'avant la bascule).
6. La colonne `task_state.plan` et la table `task_verdict` ne changent pas de
   nom (elles s'appellent déjà « plan », aucune migration).

## 9. Tests

- `criteria.test.mts` : machine à états pure (transitions, refus, refs jamais
  réattribuées, invalidation par `criteria_update`, preuves et méthodes
  validées), sur une base SQLite temporaire (garde du lesson : jamais la base
  de production) ;
- `criteria-flow.test.mts` : application du retour JSON du vérificateur
  (approve/reject/add/remove/update, actions invalides ignorées, notification
  construite) ; les appels réseau sont mockés ;
- `plan.test.mts` (ex-todos.test.mts) adapté aux nouveaux noms + test de
  compatibilité (tool parts `todowrite` anciens encore lus) ;
- build UI (`bun run build:ui`) et suite daemon fichier par fichier
  (leçon : jamais en batch, verrous SQLite).

## 10. Variables d'environnement

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `SUPERVISEUR_CRITERIA` | on | interrupteur global du flux critères |
| `SUPERVISEUR_VERIFIER` | on | interrupteur du vérificateur |
| `SUPERVISEUR_VERIFIER_MIN_INTERVAL_MS` | 20000 | intervalle minimal entre phases |
| `SUPERVISEUR_VERIFIER_CONCURRENCY` | 2 | phases simultanées toutes tâches |

## 11. Décisions tranchées (validées par le propriétaire le 2026-11-07)

1. `criteria_update` d'un critère non `todo` le repasse `todo` (preuve
   invalidée) : la cohérence prime sur la commodité.
2. Les suggestions du vérificateur (`add`, `remove`, `update`) sont appliquées
   automatiquement par le daemon (notification à l'agent).
3. Noms d'outils en underscores (`criteria_add`) : convention du repo.
4. Types de preuve : les cinq nouveaux (`code_excerpt`, `artifact`,
   `command`, `diff`, `doc`) sont retenus en plus des six de base.
5. Vérificateur : sous-conversation enfant comme « comp. supervision »,
   quincallerie compagnon réutilisée, nom sans hash
   (`superviseur-verificateur`), une seule session réutilisée pour toutes les
   vérifications de la tâche (garde le fil des ajouts et retraits).
6. UI (validée par le propriétaire le 2026-11-07) :
   - section Critères dans le panneau de détail, sous le plan, dépliée par
     défaut tant que la tâche est en cours, repliée sinon ;
   - deuxième barre de progression sur la carte, à droite de celle du plan,
     même format, critères validés / critères total, masquée sans critère ;
   - retrait complet du concept de confiance (pastilles, bulle, valeur
     numérique, clés du contrat analyste, colonnes non écrites) : la liste
     des critères devient le signal de fiabilité.
7. Aucune édition des critères côté UI pour cette passe (lecture seule), pas
   de popup dédiée sur la carte.

## 12. Implémentation (réalisée le 2026-11-07)

Fichiers :

- machine à états et accès DB : `daemon/src/criteria.mts` (seule source des transitions) ;
- dispatch des tools de l'agent : `daemon/src/criteria-tools.mts` + routes `POST /api/criteria/:name` ; plugin `daemon/plugin/superviseur-criteria` ;
- lectures bornées : `daemon/src/verifier-tools.mts` + routes `POST /api/verifier/:name` ; plugin `daemon/plugin/superviseur-verifier` ;
- orchestrateur du vérificateur : `daemon/src/verifier.mts` (quincallerie compagnon : `ensureVerifier`, `verifier_map`, kicks `verifier-kicks.mts`, phase, application du JSON, notification) ; agent `daemon/agent/superviseur-verificateur.md` (nom fixe) ;
- flotte : `row.criteria` (comptes) ; route `GET /api/fleet/criteria?sessionId=...` pour la liste détaillée ;
- UI : `ui/src/components/CriteriaSection.tsx` (détail, sous le plan), deuxième barre dans `SessionCard.tsx` ;
- retrait de la confiance : contrat analyste réduit, `upsertVerdict` sans `confiance`/`note` (colonnes conservées, non écrites), `ConfidenceDots` supprimé ;
- renommage plan-* : plugin `superviseur-plan`, tools `planwrite`/`planupdate`/`planread`, module `daemon/src/plan.mts`, champ `row.plan`, lecteur compatible tool parts `todowrite`/`todoupdate` anciens ;
- tests : `daemon/test/criteria.test.mts`, `daemon/test/criteria-flow.test.mts`, `daemon/test/plan.test.mts`, `ui/src/components/CriteriaSection.test.tsx` ;

Déploiement noté : la config globale OpenCode (`~/.config/opencode/opencode.jsonc`) référence les plugins `superviseur-plan`, `superviseur-criteria` et `superviseur-verifier` ; un redémarrage d'OpenCode et du daemon est nécessaire au passage en production.
