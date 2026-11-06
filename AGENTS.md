# AGENTS.md

Directives pour tout agent travaillant dans ce repo.

## Questions à l'utilisateur

- Pour toute question ou clarification, utiliser le tool **`question`** (jamais de page HTML pour un choix).

## Projet

- Repo de conception puis d'implémentation du **Superviseur** : interface indépendante de supervision des conversations OpenChamber.
- La phase de conception vit dans `docs/analyses/design_concept/` ; le MVP1 dans `docs/analyses/mvp1/` : lire les README avant toute intervention, reporter les décisions prises (doc 06).
- Documents en français.
- **Rédaction (UI et docs) : ne jamais utiliser de tiret long (—)** ; préférer deux-points, parenthèses ou une phrase courte (introduit après un retour utilisateur sur le tooltip de confiance).

## Pièges et leçons (maintenance permanente)

> **Instruction permanente** : noter au fil de l'eau, directement dans la liste ci-dessous, chaque piège ou découverte importante rencontré pendant le développement (endpoint, DOM, ordre de données, regex de build, etc.). Une entrée = une règle courte et actionnable, ajoutée sous la bonne section. Les leçons générales de conception restent dans les docs, on ne copie que le piège.

### API OpenCode / OpenChamber (instance réelle)

- **`/api/session` est paginé à 50 par défaut**: au-delà de 50 sessions de l'instance (avec tous les enfants compagnon/sous-agents), les parents glissent dans et hors des 50 premières à chaque création → « fantômes » alternatifs dans la flotte et flicker des cartes. TOUJOURS paginer `/api/session?limit=200` (ou paginer explicitement).

- L'ordre des messages est **descendant** (plus récent d'abord) : `.slice(-n)` prend les plus anciens: toujours trier sur `time.created` avant usage.
- Le marqueur `completed` d'un message assistant arrive **en retard** : filtrer sur `completed` pour décider qu'une réponse est lisible = faux négatif. Vérifier que le texte tient debout (p.ex. parse JSON du compagnon).
- Un tour en cours = souvent des tool calls **sans texte** : pour savoir ce qui se passe, lire la part `reasoning` du dernier assistant.
- `POST /api/session/:id/prompt` **ignore le champ `agent`** sur la version installée. Pour changer d'agent : `POST /api/openchamber/sessions/:id/send` avec `{prompt, agent, directory}`: directory **requis** (dossier du parent).
- Session enfant avec `parentID` = masquée automatiquement de la flotte (filtre `parentID`) → utilisé pour les sessions compagnon.
- `/api/sessions/status` (OpenChamber) contient des **ids fantômes** (sessions supprimées) → joindre à l'annuaire `/api/session` et filtrer les absents ; les archivées (`time.archived`) sortent de la flotte.
- Le port local d'OpenChamber n'est **pas fixe** (auto-alloué) : discovery par `ss -tlnp` sur le process `openchamber`, ou `OPENCHAMBER_PORT`.
- OpenCode server direct = Basic auth détenue par OpenChamber : **toujours passer par OpenChamber**.
- Suppression de session via proxy : 404 (route introuvable): archiver plutôt (`POST /api/openchamber/sessions/archive` `{ids:[]}`), en archivant aussi les enfants compagnon.
- Les scheduled tasks n'ont **pas d'historique de runs** ; `/api/openchamber/message-search` existe (à tester) ; la mémoire agent = JSON lisible-corrigeable via HTTP.

### UI (patterns de la page flotte)

- `replaceChildren` **déplace même les nœuds identiques → blur** : ne mettre à jour le DOM que si l'ordre change (`setChildrenIfChanged`), et ne reconstruire une carte que si son « sig » change.
- Variables d'état dans les templates : ne pas composer un préfixe « : » à deux endroits (double `: :` réel). La variable porte déjà sa ponctuation, le template s'abstient.
- Le sig d'une carte doit inclure **tout ce qui doit rafRAÎCHIR à l'écran** (statut, id de formulaire, progress, confiance) sinon la carte semble figée (bug 95 % vs 100 %).
- Pendant une saisie (focus INPUT/TEXTAREA d'une carte), ne jamais reconstruire cette carte.
- Formulaire de questions : **multi-champs** (q0, q1 → un seul bouton Répondre) ; `type` variable (`string`, `multiselect` → valeur en TABLEAU) ; répondre par objet `{qN: ...}` complet.
- JSON des agents : clés **en anglais** (`summary/done/confidence/progress/pending_human/confidence_reason`) + clés toutes déclarées **requises** (les clés optionnelles ne sont pas nourries de façon fiable) ; parser tolérant aux variantes accentuées.
- Menu contextuel : `position:absolute` exige un ancêtre positionné: `.card { position:relative }` sinon le menu s'ancre à la page.

### UI React (depuis la migration du 2026-11-06)

- La référence visuelle est `ui/reference/flotte-vanilla.html` (l'ancien `ui/index.html`) ; le code vit dans `ui/src`, le build dans `ui/dist` et `ui/index.html` n'est plus que l'entrée Vite. Ne jamais remettre de TS inline dans un HTML servi tel quel.
- **Tailwind v4 met `line-height:1.5` sur `html`** : la maquette validée est en `normal`. Garder `body { line-height: normal }` dans `src/index.css`, sinon tout le contenu descend de ~5 px et le rendu n'est plus identique.
- **Le squelette vanilla cachait trois éléments par construction** : le chip « attends ta réponse », la boîte permission et la ligne ✋ orange existent dans `cardHTML` avec `display:none`, et `applyState` ne les crée que s'ils sont absents. La référence ne les affichait donc jamais. React les rend (exigence du brief) : ne pas « corriger » React vers ce bug.
- **Une carte qui change de section est démontée/remontée par React** : le brouillon du composer vit dans le store Zustand (`drafts`), sinon le texte est perdu en passant EN COURS → BESOIN. Le focus peut être perdu à ce moment-là (comme avec `replaceChildren` en vanilla).
- **SSE `/api/fleet/stream` pousse la flotte NON enrichie** (pas de `task`, pas de filtrage des fermées) : garder le filtrage local par `closed` + `lastUpdateAt > closed_at` (même règle de réouverture que le daemon), sinon une carte fermée revient au frame suivant.
- **Les frames SSE se répètent 2x/s à l'identique** : dédupliquer sur la chaîne brute (`ev.data`) avant `setFleet`, sinon re-render inutile deux fois par seconde.
- **Tailwind : deux utilitaires de la même propriété (`bg-green` + `bg-amber`, `font-medium` + `font-semibold`) ne se départagent pas par l'ordre de la classe** : toujours une classe conditionnelle exclusive.
- **`bun run build:ui` avant de lancer le daemon** : il sert `ui/dist` avec une table MIME (js/css/svg/woff) ; sans build, `/fleet` renvoie un 404 explicite.

### Compagnon (analyste)

- Session compagnon = enfant de la session supervisée ; agent global sans-tool, **canonical dans `daemon/agent/`** + symlink dans `~/.config/opencode/agent/`.
- Déclencheurs : idle + 5 min si nouveaux messages ; digest **incrémental** (dernier id vu) + goal (1er message humain) + dernier assistant taggé « état le plus récent » + reasoning si busy.
- Le verdict JSON est un **signal**, jamais une décision : la migration TERMINE reste un geste humain.
- Rattrapage (ré-analyse sans nouveaux messages) : passer `force` au digest, sinon les sessions au repos ne rafraîchissent jamais leurs verdicts (et une migration de schéma ne se propage jamais).
- `bun daemon/test/companion-loop.mts` peut échouer à froid sur l'étape 4 juste après un redémarrage du daemon (le premier verdict arrive avec un `at` antérieur au tour) : relancer une fois avant de conclure à une régression.

### Repo & docs

- **Lister le dossier avant d'attribuer un numéro de doc** (double 09 déjà arrivé).
- Le MVP1 est le contrat (`docs/analyses/mvp1/objectif-mvp1.md`) : création de session en dernier (design en évolution).
- Ne pas dupliquer : ce qui est analysé ailleurs (spike, architecture) se cite par lien.
- UI React : décisions et commandes dans `docs/analyses/mvp1/implementation-ui-react.md` et `ui/README.md`.
