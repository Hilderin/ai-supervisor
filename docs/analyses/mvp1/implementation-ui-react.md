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

`isDone` n'est vrai que si `sup.termine`, que la session n'est pas `busy` et que le verdict n'est pas antérieur au tour en cours. Un job relancé (verdict « done » du tour précédent, même reconfirmé pendant le nouveau tour) reste donc EN COURS, avec « Réflexion en cours… » si le verdict est périmé.

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

Côté daemon (`daemon/src/delivery.mts`) :

- cache mémoire par session, 30 s pour une réponse valide, 5 s pour une réponse vide ou une erreur ;
- single-flight : deux cartes ou deux rendus simultanés ne font qu'une requête ;
- invalidation par événements dans `kicks.mts` : `message.*`, `session.execution.*`, `session.inbox.*`, `session.text.*`, `session.step.ended`, `session.idle` ; un événement sans `sessionID` exploitable vide tout le cache ;
- `state: 'ok' | 'empty' | 'unavailable'`, `markdown` (40 000 caractères max, `truncated`), `render { html, title }` (200 000 caractères max), `createdAt`, `turnStartedAt`.

L'UI ne demande la livraison que pour une carte **TERMINÉ** ou **au repos non en attente**. Une carte `busy` ou avec question/permission ne déclenche aucune lecture de messages. Le fetch est refait quand `lastUpdateAt` ou `turnStartedAt` change, jamais à chaque frame.

### 5.3 Rendu et sécurité

- Markdown : `react-markdown` + `remark-gfm`, `skipHtml` et **pas** de `rehype-raw`. Le HTML brut du message n'est jamais interprété ; les liens sortent avec `target="_blank" rel="noreferrer noopener"`. Titres, listes, code, tableaux et citations sont stylés par `.delivery-md` (jetons de la maquette).
- Rendu `openchamber_render` : iframe `sandbox="allow-scripts"` **sans** `allow-same-origin` (origine opaque, aucun accès au DOM, au stockage ou aux credentials du Superviseur) et CSP injectée : `default-src 'none'`, `connect-src 'none'`, `form-action 'none'`, `frame-src 'none'`, images `data:`/`blob:`/`https:`, styles et scripts inline. Les scripts inline restent autorisés pour les graphiques ; ils sont confinés à l'origine opaque.
- Hauteur : la page rapporte sa hauteur par `postMessage`; plafond 420 px (160 px en aperçu), l'iframe défile au-delà.
- Aperçu : carte TERMINÉ 280 px, carte au repos 72 px (3 lignes) ; bouton « Voir plus » / « Voir moins ». Réponse vide sur TERMINÉ : « Aucune réponse textuelle pour ce tour. » ; erreur : « Résultat indisponible. » + « Réessayer ».

Le bloc est mémoïsé : les re-rendus 1 s / 2 s de la carte ne relancent ni la requête, ni le parsing du markdown, ni l'iframe. Le focus du composer n'est pas touché (aucun remontage de la carte).

## 6. Comportements de la carte

- **Dot** : orange clignotant si attente, anneau vert tournant si `busy`, vert plein si idle, vert pâle si terminé.
- **Chip** : « attends ta réponse » sur les cartes en attente.
- **Résumé** : `sup.resume`, sinon la phrase d'activité (`travaille`, `tour terminé · il y a …`, `une question t’attend`).
- **Attend** : la ligne `sup.attend` en orange sous le résumé.
- **Progression** : barre verte, ambre entre 1 et 65 %, pourcentage à droite.
- **Confiance** : trois pastilles (rouge < 35 %, ambre < 70 %, vert ensuite) et tooltip HTML avec `Confiance N %` puis `sup.note` (le `confidence_reason` du compagnon).
- **Question** : un bloc par champ, options (mono ou multiselect) et champ libre, un seul bouton « Répondre ».
- **Permission** : « Permission demandée » + bouton « Autoriser » (`decision: once`).
- **Résultat** : bloc de livraison sur les cartes TERMINÉ et au repos (texte markdown + rendu `openchamber_render`), aperçu replié, jamais sur une carte busy ou en attente.
- **Composer** : hauteur auto jusqu'à 120 px, Enter envoie, Shift+Enter saute une ligne, flèche verte dès qu'il y a du texte.
- **Fermer** : la donebox et le menu kebab appellent `POST /api/fleet/done` puis masquent la carte. Une activité ultérieure dans OpenChamber la rouvre (règle du daemon).
- **Ouvrir** : `openchamber-ui://session/{id}` dans un nouvel onglet, comme la maquette.

## 7. Écarts assumés avec la référence vanilla

La maquette conservait trois éléments dans un squelette `display:none` et ne les recréait jamais : le chip « attends ta réponse », la boîte permission et la ligne ✋ orange. La référence ne les affichait donc jamais. React les rend, conformément au brief. Le reste du rendu (en-tête, barre, sections, cartes, questionnaire, composer) est identique au pixel après la correction du `line-height` global de Tailwind (voir AGENTS.md).

Deux écarts de comportement volontaires :

- **Fermer persiste** via `/api/fleet/done` (la vanilla ne faisait que masquer localement), ce qui permet à la fermeture de survivre à un rechargement sans archiver la session.
- **Le panneau de debug `?debug=1`** de la vanilla (MutationObserver sur les reconstructions DOM) a été supprimé : React rend le diagnostic inutile.

## 8. Vérification

- `bun run typecheck` : TypeScript strict, aucune erreur.
- `bun test` : 46 tests UI (construction des réponses, placement TERMINÉ / périmé / busy, hystérésis de section, fermeture / réouverture, âges, garde d'horodatage, états de livraison, markdown, CSP du rendu).
- `bun test daemon/test` : 20 tests (dont 16 livraison : dernier texte, tour courant, rendu, refus, troncature, cache, single-flight, invalidation, course événement/lecture).
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

- La barre de création de session reste désactivée (position MVP1, design en évolution).
- Le chemin permission n'a pas encore été exercé sur une vraie demande OpenChamber (aucune demande réelle disponible pendant la migration) ; le contrat et le rendu sont testés sur flotte factice.
- Le déplacement d'une carte entre sections peut perdre le focus du composer (le texte est conservé par le store). Un rendu en liste plate avec portails pourrait le préserver si l'usage le réclame.
- Livraison : les pages `openchamber_render` en langage `ui` ne sont pas dessinées (texte final seulement) ; les pages qui attendent une réponse (`awaitAnswer`) ne sont pas affichées (leur réponse reste un geste OpenChamber) ; les images locales d'une page HTML ne sont pas résolues ; un tour de plus de 40 messages peut sortir le dernier prompt de la fenêtre (le dernier texte assistant reste retenu).
