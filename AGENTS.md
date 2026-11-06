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

### Compagnon (analyste)

- Session compagnon = enfant de la session supervisée ; agent global sans-tool, **canonical dans `daemon/agent/`** + symlink dans `~/.config/opencode/agent/`.
- Déclencheurs : idle + 5 min si nouveaux messages ; digest **incrémental** (dernier id vu) + goal (1er message humain) + dernier assistant taggé « état le plus récent » + reasoning si busy.
- Le verdict JSON est un **signal**, jamais une décision : la migration TERMINE reste un geste humain.
- Rattrapage (ré-analyse sans nouveaux messages) : passer `force` au digest, sinon les sessions au repos ne rafraîchissent jamais leurs verdicts (et une migration de schéma ne se propage jamais).

### Repo & docs

- **Lister le dossier avant d'attribuer un numéro de doc** (double 09 déjà arrivé).
- Le MVP1 est le contrat (`docs/analyses/mvp1/objectif-mvp1.md`) : création de session en dernier (design en évolution).
- Ne pas dupliquer : ce qui est analysé ailleurs (spike, architecture) se cite par lien.
