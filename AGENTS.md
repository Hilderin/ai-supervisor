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
- **Le prompt humain est à la RACINE du message** (`m.text`) sur l'API installée, pas dans `payload.text` (ancienne forme) : lire `m.text ?? m.payload.text` (helper `daemon/src/messages.mts`), sinon le compagnon ne voit aucun message utilisateur, son « objectif » reste `inconnu de l'extrait` et ses résumés ne parlent que de la sortie de l'agent.
- `/api/session/:id/message?limit=N&order=asc` renvoie les **plus anciens** messages (défaut : desc). Utile pour retrouver le premier prompt sans paginer, et sans dépendre de la fenêtre des 30 derniers (un long tour fait sortir le prompt de la fenêtre).
- Le marqueur `completed` d'un message assistant arrive **en retard** : filtrer sur `completed` pour décider qu'une réponse est lisible = faux négatif. Vérifier que le texte tient debout (p.ex. parse JSON du compagnon).
- Un tour en cours = souvent des tool calls **sans texte** : pour savoir ce qui se passe, lire la part `reasoning` du dernier assistant.
- `POST /api/session/:id/prompt` **ignore le champ `agent`** sur la version installée. Pour changer d'agent : `POST /api/openchamber/sessions/:id/send` avec `{prompt, agent, directory}`: directory **requis** (dossier du parent).
- Session enfant avec `parentID` = masquée automatiquement de la flotte (filtre `parentID`) → utilisé pour les sessions compagnon.
- `/api/sessions/status` (OpenChamber) contient des **ids fantômes** (sessions supprimées) → joindre à l'annuaire `/api/session` et filtrer les absents ; les archivées (`time.archived`) sortent de la flotte.
- Le port local d'OpenChamber n'est **pas fixe** (auto-alloué) : discovery par `ss -tlnp` sur le process `openchamber`, ou `OPENCHAMBER_PORT`.
- OpenCode server direct = Basic auth détenue par OpenChamber : **toujours passer par OpenChamber**.
- Suppression de session via proxy : 404 (route introuvable): archiver plutôt (`POST /api/openchamber/sessions/archive` `{ids:[]}`), en archivant aussi les enfants compagnon.
- Les scheduled tasks n'ont **pas d'historique de runs** ; `/api/openchamber/message-search` existe (à tester) ; la mémoire agent = JSON lisible-corrigeable via HTTP.
- **Livraison inline : le dernier message assistant n'est pas la réponse** : un tour finit souvent par des tool calls sans texte. Depuis le dernier message `user`, prendre le dernier texte assistant et le dernier `openchamber_render` du même tour.
- **`openchamber_render`** : la page est dans `state.input.parameters.html` (ou `state.input.html`), le titre dans `parameters.title` (ou `title`), et le rendu est confirmé par `state.metadata.openchamber.ok`. Les pages en langage `ui` (`parameters.ui`) ne sont pas du HTML : ne pas les dessiner comme telles.
- **Todo list de tâche** : le plugin OpenCodeTodoList est actif et écrit son JSON dans `opencode.db`, table `kv`, clé `plugin:…:session/<sessionID>`. La lecture stable pour le daemon est le tool part `todowrite` (`state.metadata.todos`), pas la base ; la table `todo` native n'est pas ce store.

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
- **SSE et GET doivent pousser la MÊME flotte enrichie** : le SSE envoyait `currentFleet()` brut (sans `task` ni filtrage des fermées), le GET filtrait. Les cartes fermées côté daemon réapparaissaient à chaque frame SSE puis disparaissaient au poll suivant : flicker, ordre qui change, titres qui semblent se battre pour le même id. `enrichedFleet()` est maintenant partagé par `/api/fleet` et `/api/fleet/stream`.
- **`pollOnce` est single-flight** : GET /api/fleet, l'intervalle 3 s et les événements SSE déclenchaient des polls concurrents qui publiaient des snapshots dans le désordre (même session avec deux états). Les demandes concurrentes sont coalescées ; ne pas retirer ce garde-fou.
- **L'UI ignore un `fleet.at` plus ancien** que celui déjà affiché : un GET en retard ne doit pas écraser un frame SSE plus récent (garde dans `setFleet`).
- **Les frames SSE se répètent 2x/s à l'identique** : dédupliquer sur la chaîne brute (`ev.data`) avant `setFleet`, sinon re-render inutile deux fois par seconde.
- **Tailwind : deux utilitaires de la même propriété (`bg-green` + `bg-amber`, `font-medium` + `font-semibold`) ne se départagent pas par l'ordre de la classe** : toujours une classe conditionnelle exclusive.
- **`bun run build:ui` avant de lancer le daemon** : il sert `ui/dist` avec une table MIME (js/css/svg/woff) ; sans build, `/fleet` renvoie un 404 explicite.
- **Un job `busy` n'est jamais TERMINÉ**, même avec un verdict `done` frais : un job relancé garde le « done » du tour précédent et le compagnon peut le reconfirmer pendant le nouveau tour (verdict frais, travail visible). `busy` prime toujours sur l'étiquette `termine`.
- **Le verdict `termine` oscille d'une analyse à l'autre** : sans garde-fou, la carte saute EN COURS ↔ TERMINÉ et décale les titres (flicker connu, antérieur à React). `ui/src/lib/placement.ts` exige 8 s de stabilité pour un changement done/running ; busy, nouveau tour et attente restent immédiats.
- **Livraison inline : jamais les messages dans la flotte** : `GET /api/fleet` et le SSE ne portent que l'état. L'UI appelle `GET /api/fleet/delivery?sessionId=…` pour une carte TERMINÉ ou au repos (pas busy, pas en attente), et seulement quand `lastUpdateAt`/`turnStartedAt` change. Cache daemon 30 s, invalidé par `message.*`, `session.execution.*`, `session.inbox.*`, `session.text.*`, `session.step.ended`, `session.idle`.
- **Rendu openchamber_render** : iframe `sandbox="allow-scripts"` sans `allow-same-origin` et CSP (`connect-src 'none'`, `form-action 'none'`). Jamais de HTML brut dans le DOM. Le markdown passe par `react-markdown` avec `skipHtml`, sans `rehype-raw`.
- **Images locales de la livraison** : le navigateur ne peut pas lire un chemin disque et l'UI n'est pas servie par OpenChamber. `DeliveryMarkdown` réécrit les sources locales vers `/api/fleet/asset` (chemin validé dans le dossier de session, raster only, 10 Mo). Une image refusée affiche un placeholder, jamais une icône cassée.
- **Tooltip : jamais en `position:absolute` dans la carte** : la bulle de confiance était ancrée sur les trois pastilles (~35 px de large), donc son `width:auto` (shrink-to-fit) calculait une largeur disponible de ~39 px et le texte se repliait sur 3-4 lettres par ligne. Une bulle vit dans un portail `createPortal(document.body)` en `position:fixed`, `width:max-content` + `max-width` (300 px), position recalculée au scroll/resize et bornée à la fenêtre. Ouverte au survol ET au focus clavier (`tabIndex`), `Échap` la ferme.

### Compagnon (analyste)

- Session compagnon = enfant de la session supervisée ; agent global sans-tool, **canonical dans `daemon/agent/`** + symlink dans `~/.config/opencode/agent/`.
- `confidence: null` = état légitime « non disponible » (rien à juger dans l'extrait) : stocké NULL en DB, mappé `undefined` côté UI, **pastilles grises + tooltip « Confiance non disponible »**. Ne pas redistribuer vers 0 (ancien bug : `Number(undefined) || 0` dégradait le « je ne sais pas » en « confiance 0 % », faux signal rouge).
- `companion_map.version` doit être écrite à chaque `putCompanion` : une deuxième définition non versionnée écrasait la première et laissait `version` à `NULL`, d'où un compagnon ARCHIVÉ et recréé à chaque analyse (historique fragmenté, `comp. supervision` qui semble ne jamais contenir l'échange en cours).
- Déclencheurs : idle + 5 min si nouveaux messages ; digest **incrémental** (dernier id vu) + goal (1er message humain) + dernier assistant taggé « état le plus récent » + reasoning si busy.
- Le verdict JSON est un **signal**, jamais une décision : la migration TERMINE reste un geste humain.
- Rattrapage (ré-analyse sans nouveaux messages) : passer `force` au digest, sinon les sessions au repos ne rafraîchissent jamais leurs verdicts (et une migration de schéma ne se propage jamais).
- `bun daemon/test/companion-loop.mts` peut échouer à froid sur l'étape 4 juste après un redémarrage du daemon (le premier verdict arrive avec un `at` antérieur au tour) : relancer une fois avant de conclure à une régression.
- **Le prompt d'un agent est mis en cache par NOM, pas par contenu** : changer le fichier ne suffit pas, une session créée avec le même nom peut garder l'ancien prompt. Le daemon crée `superviseur-analyste-<hash>` (symlink vers le fichier canonique), le fixe **dès la création** de la session enfant (le `send` ne l'impose pas toujours), et recrée le compagnon si `companion_map.agent` ne correspond pas.
- **`getAgentVersion` lit et hashe le contenu à chaque appel** : un cache par `mtime` a mémorisé un fichier lu pendant une écriture et est resté figé sur une version périmée. 8 Ko toutes les 3 s sont négligeables.
- **L'attente humaine ne se décide pas par le LLM** : `attend` vient des formulaires (`question_tool`), des permissions, ou d'une question explicite du dernier message de l'agent. Le compagnon ne fait que reformuler ; sans signal, le daemon vide `attend`. Le digest nomme le lecteur `[TOI]`, jamais `[HUMAIN]`.
- **La progression vient du plan `todowrite` de la session de travail** (3 à 6 étapes), pas du compagnon ni d'un pourcentage inventé : le daemon lit le tool part `todowrite`, calcule `étapes faites / étapes`, `done` implique 100, `busy` interdit `done`, pas de plan ⇒ pas de barre, baisse refusée à plan identique.
- **Un nouvel objectif est versionné** : une consigne longue avec un verbe d'action incrémente `task_state.objective_version` et remet le plan à zéro ; une réponse courte ne change pas l'objectif. La carte lit le dernier objectif, pas seulement le premier prompt.
- **Résumé de carte** : français, troisième personne pour l'agent, « tu » réservé au lecteur ; interdits = identifiants, commits, branches, numéros de document, fichiers, outils, tests, pourcentages, `idle/busy/extrait`, « le compagnon » pour l'agent, et toute allusion au plan/contrat/JSON. Linter + une reprise unique + ancien résumé en repli.
- **Déclencheurs et coût** : digest inchangé ⇒ aucun appel ; 20 s minimum par session ; 3 analyses simultanées ; les compagnons à migrer passent en priorité sinon deux sessions busy prennent tous les créneaux.
- **Ménage** : `bun daemon/scripts/cleanup-companions.mts` (simulation) puis `--apply`. Garde le compagnon de `companion_map`, archive les autres, supprime les mappings des parents disparus ou archivés. Idempotent.
- Détails et décisions : `docs/analyses/mvp1/compagnon-verdict.md`.

### Chat de supervision (2026-11-06)

- Le chat vit dans `~/.superviseur` (session OpenChamber normale, agent `superviseur-orchestrateur-<hash>`). **Tout le dossier** est exclu de la flotte et du compagnon : les anciennes conversations restent dans OpenChamber mais ne deviennent jamais des cartes.
- **Plugin projet-local** : `~/.superviseur/.opencode/plugins/superviseur` est bien chargé ; un agent projet-local dans `~/.superviseur/.opencode/agent` n'est **pas** chargé par cette version d'OpenChamber. L'agent orchestrateur est donc global et versionné, comme l'analyste.
- **Trust du dossier** : OpenChamber met le dossier en pause (`opencode_trust_required`) tant que son empreinte de plugins/commandes n'est pas approuvée. Le daemon appelle `GET/POST /api/opencode/trust` avec le `fingerprint` avant de créer la session.
- **Ajouter un plugin exige un redémarrage d'OpenCode** : `/api/location/reload` ne recharge pas la liste des plugins, et `/api/config/reload` peut interrompre une réponse en cours. Le dossier doit être approuvé puis OpenCode redémarré une fois.
- **Outils du plugin** : `codemode: false` pour des outils directs. L'agent désactive `openchamber*` et `execute` ; le daemon vérifie que l'appelant est la session de supervision (`not_supervisor` sinon).
- **`start_task` et doublons** : la flotte peut ne pas avoir encore vu la nouvelle session. Vérifier `task_brief` (écrit immédiatement) et garder un set `creating` par `projet|titre` ; sinon deux appels rapprochés créent deux sessions.
- **Fin de tour** : un kick `end` (`session.execution.*` ou `session.idle`) n'est pas bloqué par l'intervalle de 20 s. Si le verdict précède la dernière activité, masquer résumé/confiance et garder la progression des todos en attendant le bilan.
- **Chat UI** : l'erreur d'envoi (`sendError`) est séparée de l'erreur de poll (`refreshError`) ; sinon le poll suivant efface le bandeau et fait disparaître le message. Composer désactivé pendant un tour busy, icône Envoyer identique aux cartes, auto-grow 120 px.
- **« Nouvelle » n'est pas un tour LLM** : créer la session sans prompt et séparer `creating` de `sending` ; l'écran se vide immédiatement, sans indicateur « le superviseur travaille ». Les suggestions de l'écran vide ont été retirées (demande utilisateur).
- **En-tête du chat** : la barre de page (logo, titre, « Masquer », Live) a été retirée ; le chat porte le titre. `+` pour Nouvelle, icône de panneau pour replier, flèche pour OpenChamber. Replié, un rail de 34 px avec l'icône de panneau rouvre le chat.
- **`send_task`** : seul outil d'écriture dans une tâche. Une question en attente est **annulée** via `DELETE /api/session/:id/form/:formID?message=…` puis le texte est envoyé (même geste qu'OpenChamber) ; une permission reste bloquante. `cancel_question` et le bouton « Annuler la question » font le même DELETE. `close_task` refuse une attente sauf `force` explicite, et annule alors la question en journalisant l'abandon. Pas de `reply_task`, pas de `merge_pr`.
- **Information inaccessible = intention de tâche probable** : si le chat n'a pas l'accès (web, fichier, exécution), il ne répond pas seulement « je ne peux pas » ; il propose une tâche de recherche ou d'exécution, demande la précision minimale, et lance `start_task` sur accord. Une demande explicite (« cherche la météo à Montréal ») part directement dans le projet `chats` ; une question vague propose d'abord. Une question à laquelle il peut répondre reste une réponse.
- **Permissions : YOLO, hors scope** : l'instance ne demande pas de permission ; le chemin carte/proxy reste en place mais n'est pas développé. Voir `docs/analyses/mvp1/permissions-yolo.md`. Ne pas annuler une permission avec le DELETE des questions.
- Détails, tests et questions : `docs/analyses/mvp1/chat-superviseur.md` et `chat-superviseur-tests.md`.

### Repo & docs

- **Lister le dossier avant d'attribuer un numéro de doc** (double 09 déjà arrivé).
- **Une demande de boîte à idées n'est pas un chantier d'implémentation** (déjà arrivé : « ajoute l'idée confiance non définie » lu comme « implémente-la »). Quand un message peut se lire comme une note de conception OU une tâche de code, trancher explicitement avant d'agir (question courte : « note dans la boîte, ou j'implémente ? »).
- **Image locale dans une réponse** : OpenChamber ne donne un grant que pour un chemin cité par le message assistant lui-même. Une copie du message dans un résumé compagnon (ou un autre fil) affiche une image brisée. Pour une image destinée à être partagée, servir une URL HTTP (build/daemon) ou une data URL, pas un chemin local.
- Le MVP1 est le contrat (`docs/analyses/mvp1/objectif-mvp1.md`) ; la création de session est implémentée via le chat de supervision (`docs/analyses/mvp1/chat-superviseur.md`).
- Ne pas dupliquer : ce qui est analysé ailleurs (spike, architecture) se cite par lien.
- UI React : décisions et commandes dans `docs/analyses/mvp1/implementation-ui-react.md` et `ui/README.md`.
