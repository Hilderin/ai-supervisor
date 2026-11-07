# UI React du Superviseur (migration du 2026-11-06)

## 1. Décision

L'UI `ui/` passe du HTML/JS vanilla à **Vite + React 19 + TypeScript + Tailwind v4 + Zustand**, la même pile que `packages/ui` d'OpenChamber. Le rendu visuel validé reste la maquette `ui/reference/flotte-vanilla.html` (l'ancien `ui/index.html`, conservé tel quel).

Le daemon ne change pas de contrat : seules les routes `/api/fleet*` existent, et le serveur statique sert désormais `ui/dist` avec une table MIME (`.html`, `.js`, `.css`, `.svg`, polices). Aucune dépendance UI n'est chargée par le daemon au runtime : React et Vite sont des dépendances de build.

## 2. Arborescence

```
ui/
  index.html              entrée Vite (div#root)
  vite.config.ts          plugins React + Tailwind, proxy /api → 127.0.0.1:5180
  package.json            build = tsc --noEmit && vite build ; test = bun test
  src/
    main.tsx              montage React
    App.tsx               en-tête, indicateur Live, barre désactivée, erreur
    index.css             @import "tailwindcss" + jetons @theme + base
    types.ts              contrat Fleet / FleetRow / PendingForm / Delivery
    lib/
      fleet.ts            isDone, isStaleTurn, briefRow, fmtAge, confiance
      answer.ts           construction de { qN: valeur } (multiselect = tableau)
      delivery.ts         états d'affichage du bloc Résultat (pur, testé)
      renderDoc.ts        CSP + rapport de hauteur de l'iframe de rendu
      api.ts              fetch / POST des routes du daemon
      cx.ts, ui.ts        classes partagées
    store/fleetStore.ts   Zustand : flotte, erreur, fermetures, brouillons
    hooks/
      useFleetStream.ts   SSE + poll 3 s
      useNow.ts           horloge 1 s (âges et indicateur Live)
    components/
      FleetBoard.tsx      3 sections
      SessionCard.tsx     carte complète
      DeliveryBlock.tsx   bloc Résultat (à la demande, états, repli)
      DeliveryMarkdown.tsx markdown GFM sans HTML brut
      SandboxedRender.tsx iframe sandboxée du rendu openchamber_render
      QuestionBox.tsx     formulaire multi-champs
      Composer.tsx        auto-grow, Enter / Shift+Enter
      ConfidenceDots.tsx  pastilles + tooltip HTML
      Icons.tsx           SVG de la maquette
  reference/
    flotte-vanilla.html   référence visuelle (non buildée, non servie)
  dist/                   build servi par le daemon (gitignore)
```

## 3. Flux de données

`useFleetStream` ouvre `EventSource('/api/fleet/stream')` et lance en parallèle un poll `GET /api/fleet` toutes les 3 s. Les deux routes poussent désormais **la même flotte enrichie** (`enrichedFleet()` côté daemon) : les cartes fermées côté daemon ne réapparaissent plus à chaque frame SSE pour disparaître au poll suivant. Le store ignore en plus un `fleet.at` plus ancien que celui déjà affiché, et le daemon coalesce les polls concurrents (single-flight). Les frames SSE identiques sont ignorées (le daemon renvoie la même flotte deux fois par seconde). Le store Zustand garde :

- `fleet` : la dernière flotte reçue ;
- `error` : le message « daemon injoignable » du dernier poll en échec ;
- `closed` : les fermetures locales (`id → horodatage`), avec réouverture si `lastUpdateAt` ou `busy` dépasse la fermeture, comme le daemon ;
- `drafts` : le texte en cours de chaque composer, pour survivre à un changement de section (React démonte la carte quand elle passe d'une section à l'autre).

`FleetBoard` répartit les lignes dans l'ordre du daemon :

1. **BESOIN DE TON ATTENTION** : `pendingForms` ou `pendingPermissions` non vide ;
2. **TERMINÉ** : `isDone(row)` ;
3. **EN COURS** : le reste.

`isDone` n'est vrai que si `sup.termine`, que la session n'est pas `busy` et que le verdict n'est pas antérieur au tour en cours. Un job relancé (verdict « done » du tour précédent, même reconfirmé pendant le nouveau tour) reste donc EN COURS, avec « Réflexion en cours... » si le verdict est périmé.

Le placement est en plus **stabilisé par une hystérésis de 8 s** (`lib/placement.ts`) : un verdict `termine` qui oscille d'une analyse à l'autre ne fait plus sauter la carte entre EN COURS et TERMINÉ, ni décaler les titres au-dessus. Un job `busy`, un nouveau tour (`turnStartedAt`) et une attente (question/permission) s'appliquent immédiatement.

Le flicker d'ordre observé avant la migration avait deux causes cumulées, toutes deux corrigées côté daemon :

- le SSE poussait `currentFleet()` brut alors que le GET filtrait les tâches fermées : les mêmes ids réapparaissaient et disparaissaient en boucle, ce qui décalait les titres ;
- plusieurs polls pouvaient se croiser (GET, intervalle 3 s, événements SSE) et publier des snapshots dans le désordre pour une même session.

`enrichedFleet()` est maintenant partagé par les deux routes et `pollOnce` est single-flight.

## 4. Contrat API respecté

| Route | Usage UI |
| --- | --- |
| `GET /api/fleet` | poll 3 s + état initial (flotte enrichie, fermées filtrées) |
| `GET /api/fleet/stream` | SSE de la flotte enrichie, identique au GET |
| `POST /api/fleet/reply` | `{sessionId, formId, answer}` ou `{sessionId, requestID, decision}` |
| `POST /api/fleet/send` | `{sessionId, text}` (le daemon applique `delivery: steer`) |
| `POST /api/fleet/done` | `{sessionId}` |

Le formulaire envoie **un objet complet** `{ qN: valeur }` en un seul appel. Un champ `multiselect` est toujours un tableau, y compris quand le texte libre est la seule valeur (`[texte]`). Le champ libre reste disponible à côté des options.

## 5. Livraison inline (capacité 4)

Objectif : lire le dernier résultat de l'agent dans la carte, sans ouvrir OpenChamber.

### 5.1 Contrat observé sur l'instance réelle

Vérifié le 2026-11-06 contre l'instance OpenChamber locale (port auto-détecté, 57123 pendant le test) :

- `GET /api/session/:id/message?limit=40` renvoie les messages du plus récent au plus ancien (`order=asc` pour les plus anciens). La fenêtre `limit` est une fenêtre de fin, pas une pagination complète.
- Le prompt humain est à la racine (`text`) ; la réponse assistant est dans `content[]` avec des parts `text`, `reasoning` et `tool`.
- Un tool part porte `name` (ou `tool`), `state.status`, `state.input`, `state.metadata` et, une fois fini, `state.content[]` (le champ `output` n'est pas utilisé sur cette version).
- `openchamber_render` garde la page dans `state.input.parameters.html` (ou `state.input.html`), le titre dans `parameters.title` (ou `title`), et confirme le rendu avec `state.metadata.openchamber.ok === true`. Un appel réel de contrôle (session enfant jetable, puis archivée) a produit : `action: "render.page"`, `parameters.html`, `metadata.openchamber.ok: true`, et l'endpoint de livraison a bien renvoyé le HTML et le titre.
- Les pages en langage `ui` (`state.input.parameters.ui`) ne sont pas dessinées : le texte final reste la livraison. Limite assumée pour MVP1.
- Un tour finit souvent par des tool calls **sans texte** : le « dernier message assistant » n'est donc pas la réponse. Le daemon retient le dernier texte assistant depuis le dernier message humain, et le dernier rendu du même tour.
- Cas d'absence : session inconnue ou supprimée → `state: 'unavailable'` ; aucun texte ni rendu dans le tour → `state: 'empty'` ; fenêtre sans message humain (tour de plus de 40 messages) → le dernier texte assistant de la fenêtre est conservé.

### 5.2 Chemin de données

Pas de messages dans `GET /api/fleet` ni dans le SSE (2 frames/s). Nouvelle route dédiée :

| Route | Usage UI |
| --- | --- |
| `GET /api/fleet/delivery?sessionId=…` | dernier texte + rendu d'une session, à la demande |
| `GET /api/fleet/asset?sessionId=…&path=…` | image locale citée par une réponse, servie depuis le dossier de la session |

Côté daemon (`daemon/src/delivery.mts`) :

- cache mémoire par session, 30 s pour une réponse valide, 5 s pour une réponse vide ou une erreur ;
- single-flight : deux cartes ou deux rendus simultanés ne font qu'une requête ;
- invalidation par événements dans `kicks.mts` : `message.*`, `session.execution.*`, `session.inbox.*`, `session.text.*`, `session.step.ended`, `session.idle` ; un événement sans `sessionID` exploitable vide tout le cache ;
- `state: 'ok' | 'empty' | 'unavailable'`, `markdown` (40 000 caractères max, `truncated`), `render { html, title }` (200 000 caractères max), `createdAt`, `turnStartedAt`.

L'UI ne demande la livraison que pour une carte **TERMINÉ** ou **au repos non en attente**. Une carte `busy` ou avec question/permission ne déclenche aucune lecture de messages. Le fetch est refait quand `lastUpdateAt` ou `turnStartedAt` change, jamais à chaque frame.

### 5.3 Rendu et sécurité

- Markdown : `react-markdown` + `remark-gfm`, `skipHtml` et **pas** de `rehype-raw`. Le HTML brut du message n'est jamais interprété ; les liens sortent avec `target="_blank" rel="noreferrer noopener"`. Titres, listes, code, tableaux et citations sont stylés par `.delivery-md` (jetons de la maquette).
- Rendu `openchamber_render` : iframe `sandbox="allow-scripts"` **sans** `allow-same-origin` (origine opaque, aucun accès au DOM, au stockage ou aux credentials du Superviseur) et CSP injectée : `default-src 'none'`, `connect-src 'none'`, `form-action 'none'`, `frame-src 'none'`, images `data:`/`blob:`/`https:`, styles et scripts inline. Les scripts inline restent autorisés pour les graphiques ; ils sont confinés à l'origine opaque.
- Images locales : `DeliveryMarkdown` réécrit une source non HTTP/data vers `/api/fleet/asset?sessionId=…&path=…`. Le daemon résout le chemin dans le dossier de la session (symlinks compris), ne sert que PNG/JPEG/GIF/WebP, borne à 10 Mo, et refuse tout ce qui sort du dossier. Une image refusée affiche « Image indisponible » au lieu d'une icône cassée.
- Hauteur : la page rapporte sa hauteur par `postMessage`; plafond 420 px (160 px en aperçu), l'iframe défile au-delà.
- Aperçu : carte TERMINÉ 280 px, carte au repos 72 px (3 lignes) ; bouton « Voir plus » / « Voir moins ». Réponse vide sur TERMINÉ : « Aucune réponse textuelle pour ce tour. » ; erreur : « Résultat indisponible. » + « Réessayer ».

Le bloc est mémoïsé : les re-rendus 1 s / 2 s de la carte ne relancent ni la requête, ni le parsing du markdown, ni l'iframe. Le focus du composer n'est pas touché (aucun remontage de la carte).

## 6. Comportements de la carte

- **Dot** : orange clignotant si attente, anneau vert tournant si `busy`, vert plein si idle, vert pâle si terminé.
- **Chip** : « attends ta réponse » sur les cartes en attente.
- **Résumé** : `sup.resume`, sinon la phrase d'activité (`Réflexion en cours...`, `tour terminé · il y a …`, `une question t’attend`).
- **Attend** : la ligne `sup.attend` en orange sous le résumé.
- **Progression** : barre verte, ambre entre 1 et 65 %. Le compteur à droite (`x/y`) est un bouton qui ouvre un popup listant les étapes du plan (`todowrite`) avec leur statut. Tant qu'aucune étape n'a commencé, il affiche `N étapes` au lieu de `0/N` ; une tâche terminée affiche `100 %`.
- **Confiance** : trois pastilles (rouge < 35 %, ambre < 70 %, vert ensuite) et bulle HTML avec `Confiance N %` puis `sup.note` (le `confidence_reason` du compagnon). La bulle est un portail en `position:fixed` (`width:max-content`, 300 px max), ouverte au survol et au focus clavier.
- **Question** : un bloc par champ, options (mono ou multiselect) et champ libre, un seul bouton « Répondre ».
- **Permission** : « Permission demandée » + bouton « Autoriser » (`decision: once`).
- **Résultat** : bloc de livraison sur les cartes TERMINÉ et au repos (texte markdown + rendu `openchamber_render`), aperçu replié, jamais sur une carte busy ou en attente.
- **Composer** : retiré des cartes le 2026-11-07 (demande du propriétaire, voir §13) : l'écriture à une tâche passe par le détail. Le composer du détail garde hauteur auto jusqu'à 120 px, Entrée envoie, Maj+Entrée saute une ligne, flèche verte dès qu'il y a du texte. Dans le chat de supervision, la hauteur est aussi réglable à la souris (poignée au-dessus du champ, 34 à 360 px, mémorisée) ; le composer reste actif pendant un tour, le texte part alors dans la file d'attente OpenChamber.
- **Fermer** : la donebox et le menu kebab appellent `POST /api/fleet/done` puis masquent la carte. Une activité ultérieure dans OpenChamber la rouvre (règle du daemon).
- **Ouvrir** : les liens de carte et du détail ouvrent le mini chat web ciblé dans un panneau à droite du détail. L'endpoint daemon `GET /api/openchamber/mini-chat?sessionId=…` construit le lien avec le port OpenChamber découvert ; l'URL OpenChamber est `/mini-chat.html?mode=session&sessionId=…`. Le chat du Superviseur reste visible si la place suffit ; sinon il est replié automatiquement puis restauré quand le mini chat se ferme. L'iframe requiert l'origine du Superviseur dans `OPENCHAMBER_FRAME_ANCESTORS` (voir le [README racine](../../../README.md)).

## 7. Écarts assumés avec la référence vanilla

La maquette conservait trois éléments dans un squelette `display:none` et ne les recréait jamais : le chip « attends ta réponse », la boîte permission et la ligne ✋ orange. La référence ne les affichait donc jamais. React les rend, conformément au brief. Le reste du rendu (en-tête, barre, sections, cartes, questionnaire, composer) est identique au pixel après la correction du `line-height` global de Tailwind (voir AGENTS.md).

Deux écarts de comportement volontaires :

- **Fermer persiste** via `/api/fleet/done` (la vanilla ne faisait que masquer localement), ce qui permet à la fermeture de survivre à un rechargement sans archiver la session.
- **Le panneau de debug `?debug=1`** de la vanilla (MutationObserver sur les reconstructions DOM) a été supprimé : React rend le diagnostic inutile.

## 8. Vérification

- `bun run typecheck` : TypeScript strict, aucune erreur.
- `bun test` : 72 tests UI (construction des réponses, placement TERMINÉ / périmé / busy, hystérésis de section, fermeture / réouverture, âges, garde d'horodatage, états de livraison, markdown, images locales, CSP du rendu, libellés de plan, envoi direct / file, boutons Envoyer et Stop, sens de « Nettoyer », actions de message, bloc `send_task`).
- `bun test daemon/test` : 27 tests (dont 16 livraison et 7 assets : dernier texte, tour courant, rendu, refus, troncature, cache, single-flight, invalidation, course événement/lecture, chemins d'image).
- `bun run build` : build Vite dans `ui/dist`.
- Vérification visuelle : captures Playwright de la référence et du build sur une flotte factice, diff au pixel. Les zones communes sont identiques ; les seules différences sont le chip, la permission et la couleur de la ligne ✋ (écarts assumés ci-dessus).
- Vérification fonctionnelle Playwright sur la flotte factice : 15/15 (options mono et multiselect, texte libre, permission, auto-grow, Enter / Shift+Enter, focus et brouillon sous SSE, menu kebab, tooltip, fermeture).
- Livraison : flotte factice (TERMINÉ avec rendu SVG, TERMINÉ avec tableau et code, TERMINÉ sans réponse, carte au repos longue, carte busy sans requête) et session réelle (texte + `openchamber_render` de contrôle, puis session enfant archivée).
- Garde-fou daemon : `bun daemon/test/companion-loop.mts` 5/5.

## 9. Lancement

```bash
# build de l'UI puis daemon (le daemon sert ui/dist)
cd ui && bun install && bun run build && cd ..
bun daemon/src/index.mts          # http://127.0.0.1:5180/fleet

# ou depuis la racine
bun run build:ui
bun start

# développement avec HMR (proxy /api vers le daemon sur 5180)
bun run dev:ui
```

## 10. Reste à faire

- La barre de création de session reste désactivée dans l'état actuel ; le design est tranché dans [chat-superviseur.md](chat-superviseur.md) (chat de supervision à gauche, `start_task`), l'implémentation remplacera la barre.
- Le chemin permission n'a pas encore été exercé sur une vraie demande OpenChamber (aucune demande réelle disponible pendant la migration) ; le contrat et le rendu sont testés sur flotte factice. L'instance tourne en YOLO et le parcours est reporté : [permissions-yolo.md](permissions-yolo.md).
- Le déplacement d'une carte entre sections peut perdre le focus du composer (le texte est conservé par le store). Un rendu en liste plate avec portails pourrait le préserver si l'usage le réclame.
- Livraison : les pages `openchamber_render` en langage `ui` ne sont pas dessinées (texte final seulement) ; les pages qui attendent une réponse (`awaitAnswer`) ne sont pas affichées (leur réponse reste un geste OpenChamber) ; les images locales d'une page HTML ne sont pas résolues ; un tour de plus de 40 messages peut sortir le dernier prompt de la fenêtre (le dernier texte assistant reste retenu).

## 11. Chat de supervision (implémenté le 2026-11-06)

Le chat de gauche remplace la barre de saisie du haut. Il vit dans `~/.superviseur` et tout le dossier est exclu de la flotte et du compagnon.

### Composants

- `SupervisorChat.tsx` : panneau vertical, messages, tool chips, composer, erreurs, icône balai « Nettoyer le chat », repli et flèche mini chat à droite de « Replier ». Les sélecteurs mode/projet ne sont pas affichés. Chaque message expose deux icônes (copier, revenir à partir d'ici) sur la ligne de l'heure (à droite côté utilisateur, à gauche côté agent), avec infobulle et libellé accessible ; un `send_task` réussi ajoute un bloc « Envoyé à « titre » » avec le texte complet, le titre étant résolu dans la flotte à l'affichage. Le composer se redimensionne à la souris, reste actif pendant un tour et reprend le focus après « Nettoyer ».
- `App.tsx` : orchestre le mini chat en panneau adjacent au détail, le repli automatique du chat superviseur selon l'espace et sa restauration à la fermeture.
- `OpenChamberPanel.tsx` : iframe du mini chat, URL de session fournie par le daemon, panneau sans arrondi et fermeture par X.
- `ChatMarkdown.tsx` : markdown GFM, `skipHtml`, pas d'images locales dans le chat.
- `supervisorStore.ts` : état du chat ; `sendError` séparé de `refreshError` pour qu'un poll ne masque pas un échec d'envoi ; `draft` restauré après échec ; envoi direct au repos, mise en file pendant un tour.
- `useSupervisor.ts` : poll 1,2 s quand le superviseur travaille, 4 s au repos.
- `App.tsx` : chat 380 px redimensionnable (320 à 480, largeur mémorisée), onglets Chat/Tâches sous 1100 px, flotte à droite. L'icône Envoyer est `SendIcon`, comme les composers de carte ; pendant un tour, le carré Stop occupe le bord droit et Envoyer apparaît à sa gauche dès qu'un texte est saisi.

### Routes

| Route | Usage |
| --- | --- |
| `GET /api/supervisor` | session, statut, messages transformés (texte + tool chips), file d'attente |
| `GET /api/openchamber/mini-chat?sessionId=…` | URL web du mini chat ciblé, construite à partir du port OpenChamber découvert |
| `POST /api/supervisor/send` | envoyer un texte au chat (session au repos) |
| `POST /api/supervisor/queue` | mettre un texte en file pendant un tour (`POST /api/message-queue/sessions/:id/items`) |
| `POST /api/supervisor/queue/cancel` | retirer un message de la file (`DELETE /api/message-queue/sessions/:id/items/:itemId`) |
| `POST /api/supervisor/revert` | « Revenir à partir d'ici » (`POST /api/session/:id/revert/stage` puis `/revert/commit`) |
| `POST /api/supervisor/new` | nouvelle conversation |
| `POST /api/supervisor/abort` | arrêter le tour |
| `POST /api/tools/:name` | outils du plugin (`list_projects`, `list_tasks`, `get_task`, `start_task`, `send_task`, `close_task`) |

La file est celle d'OpenChamber : elle exige le modèle de la session (`providerID`, `modelID`) et survit à la fermeture de l'onglet. Le daemon reprend ces valeurs de `/api/session/:id`. Le retour en arrière est un `stage` puis un `commit` immédiat, après un `abort` si un tour est en cours.

Le détail du contrat, du plugin, du trust du dossier et des tests est dans [chat-superviseur.md](chat-superviseur.md) et [chat-superviseur-tests.md](chat-superviseur-tests.md). `bun test daemon/test ui/src` couvre 110 tests ; les campagnes Playwright ont validé C1 à C17.

## 12. Section Plan dans le détail (implémentée le 2026-11-07)

Le compteur d'étapes cliquable (bulle `PlanPopover`) a été remplacé, dans le panneau de détail, par une section « Plan » toujours visible : le plan se lit sans clic sur un compteur.

- Ordre dans le corps défilant : **résumé** (encadré titré « Résumé », note « ✋ ») → **Plan** → livraison → question / permission. La barre de progression et le compteur sous le plan ont été retirés le 2026-11-07 (information redondante avec le badge du plan) : la ligne d'état du haut ne porte plus que l'état, le dossier et la confiance, et le repli sans plan est une ligne discrète (`N %` du compagnon, sinon « pas de plan »).
- En-tête de section : titre « Plan », nombre d'étapes, badge d'état et chevron ; le clic bascule le dépliage. Le badge affiche `réalisé/total` dès qu'une étape a démarré, `à faire` tant que rien n'a commencé (jamais `0/N`, règle partagée avec `planLabel`), en vert quand le plan est complet.
- Défaut d'ouverture (`planDefaultOpen`) : déplié quand la tâche est `busy` ou `waiting`, replié quand elle est `done` ou `idle` (travail fini). Sans préférence manuelle, le défaut suit l'état en continu : une tâche qui se termine se replie d'elle-même.
- Préférence manuelle par carte : un clic mémorise le choix dans une carte module (`Map<sessionId, boolean>`) qui prime sur le défaut tant que la page vit ; elle disparaît au rechargement et quand le panneau pointe un autre id de session.
- Étapes : liste numérotée partagée `PlanSteps` (rendu extrait de `PlanPopover`), donc identique dans la bulle des cartes : état visuel (✓ finie, ● en cours, ○ à faire), numéro, texte. Hauteur plafonnée à 240 px avec défilement, comme dans la bulle.
- `SessionCard` ne change pas : la carte garde sa hauteur constante et son compteur cliquable en portail.

Tests : `ui/src/components/PlanSection.test.tsx` (défauts par état, badge « à faire », étapes numérotées) et `ui/src/components/TaskInspector.test.tsx` (encadré « Résumé », absence de barre et de compteur, repli sans plan). `bun run build:ui` avant de relancer le daemon (le 404 explicite de `/fleet` sans build reste d'actualité).

Conséquence sur la note de conception : la ligne d'état décrite dans [panneau-taches-stable.md](panneau-taches-stable.md) §5.7 (compteur d'étapes porté par la ligne d'état du haut, puis barre de progression plus bas) est remplacée par cette section ; la progression vit désormais uniquement dans le badge du plan.

## 13. Composer des cartes retiré (2026-11-07)

À la demande du propriétaire : le champ « Écrire à cette tâche » et son bouton d'envoi quittent les cartes du milieu, parce que le panneau de détail sert exactement à ça.

- La carte perd son rang de composer : la grille passe de quatre rangées (en-tête, corps, composer, pied) à trois (en-tête, corps, pied), et la hauteur fixe de 232 px à **190 px** (le corps du résumé garde sa taille, le gain vient du rang composer et d'un écart de grille). La même page affiche donc plus de cartes.
- `Composer.tsx` est simplifié : la variante carte (une ligne fixe, sans auto-grow) est supprimée, il ne reste que la variante du détail (auto-grow plafonné à 120 px). Le brouillon (`drafts` du store) continue de suivre la session, donc un texte commencé dans le détail y survit.
- La carte reste cliquable sur sa totalité (hors boutons) : ouvrir le détail est devenu le seul moyen d'envoyer une instruction. Le geste « écrire sans ouvrir le détail » (note de conception §2.4, « geste minimum ») est remplacé par un clic de plus, assumé.
- Les boutons du pied ne changent pas : `Répondre` (attente), `Détail` (busy), `Terminé` (fini). Le clic d'ouverture du détail reste un clic sur le corps de la carte : voir le piège noté dans AGENTS.md sur le second bouton du pied, qui clôture sur une carte « fini, à valider ».

Tests : `ui/src/components/SessionCard.test.tsx` (plus de `textarea` sur la carte, hauteur et grille à trois rangées). Vérifié en direct sur la flotte : aucune zone de saisie dans les cartes, en-tête à en-tête d'environ 199 px.

## 14. Finition du mini chat OpenChamber (2026-11-07)

- Le panneau iframe n'a pas d'arrondi. Son en-tête ferme avec un bouton X, qui démonte l'iframe et restaure le chat superviseur s'il avait été replié automatiquement.
- L'en-tête de `SupervisorChat` place la flèche Mini chat immédiatement à droite du bouton « Replier ». Le bouton distinct au-dessus du chat est retiré. Les sélecteurs mode et projet ne sont pas affichés. Le panneau affiche maintenant la session `OpenChamber - [titre]` avec troncature visuelle ; le X reste à droite.
- Vérification : `bun run typecheck`, `bun test` UI et `bun run build:ui`. Le navigateur confirme la fermeture X et le retour au chat.
