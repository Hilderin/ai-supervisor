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
    types.ts              contrat Fleet / FleetRow / PendingForm
    lib/
      fleet.ts            isDone, isStaleTurn, briefRow, fmtAge, confiance
      answer.ts           construction de { qN: valeur } (multiselect = tableau)
      api.ts              fetch / POST des routes du daemon
      cx.ts, ui.ts        classes partagées
    store/fleetStore.ts   Zustand : flotte, erreur, fermetures, brouillons
    hooks/
      useFleetStream.ts   SSE + poll 3 s
      useNow.ts           horloge 1 s (âges et indicateur Live)
    components/
      FleetBoard.tsx      3 sections
      SessionCard.tsx     carte complète
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

## 5. Comportements de la carte

- **Dot** : orange clignotant si attente, anneau vert tournant si `busy`, vert plein si idle, vert pâle si terminé.
- **Chip** : « attends ta réponse » sur les cartes en attente.
- **Résumé** : `sup.resume`, sinon la phrase d'activité (`travaille`, `tour terminé · il y a …`, `une question t’attend`).
- **Attend** : la ligne `sup.attend` en orange sous le résumé.
- **Progression** : barre verte, ambre entre 1 et 65 %, pourcentage à droite.
- **Confiance** : trois pastilles (rouge < 35 %, ambre < 70 %, vert ensuite) et tooltip HTML avec `Confiance N %` puis `sup.note` (le `confidence_reason` du compagnon).
- **Question** : un bloc par champ, options (mono ou multiselect) et champ libre, un seul bouton « Répondre ».
- **Permission** : « Permission demandée » + bouton « Autoriser » (`decision: once`).
- **Composer** : hauteur auto jusqu'à 120 px, Enter envoie, Shift+Enter saute une ligne, flèche verte dès qu'il y a du texte.
- **Fermer** : la donebox et le menu kebab appellent `POST /api/fleet/done` puis masquent la carte. Une activité ultérieure dans OpenChamber la rouvre (règle du daemon).
- **Ouvrir** : `openchamber-ui://session/{id}` dans un nouvel onglet, comme la maquette.

## 6. Écarts assumés avec la référence vanilla

La maquette conservait trois éléments dans un squelette `display:none` et ne les recréait jamais : le chip « attends ta réponse », la boîte permission et la ligne ✋ orange. La référence ne les affichait donc jamais. React les rend, conformément au brief. Le reste du rendu (en-tête, barre, sections, cartes, questionnaire, composer) est identique au pixel après la correction du `line-height` global de Tailwind (voir AGENTS.md).

Deux écarts de comportement volontaires :

- **Fermer persiste** via `/api/fleet/done` (la vanilla ne faisait que masquer localement), ce qui permet à la fermeture de survivre à un rechargement sans archiver la session.
- **Le panneau de debug `?debug=1`** de la vanilla (MutationObserver sur les reconstructions DOM) a été supprimé : React rend le diagnostic inutile.

## 7. Vérification

- `bun run typecheck` : TypeScript strict, aucune erreur.
- `bun test` : 31 tests (construction des réponses, placement TERMINÉ / périmé / busy, hystérésis de section, fermeture / réouverture, âges, garde d'horodatage).
- `bun run build` : build Vite dans `ui/dist`.
- Vérification visuelle : captures Playwright de la référence et du build sur une flotte factice, diff au pixel. Les zones communes sont identiques ; les seules différences sont le chip, la permission et la couleur de la ligne ✋ (écarts assumés ci-dessus).
- Vérification fonctionnelle Playwright sur la flotte factice : 15/15 (options mono et multiselect, texte libre, permission, auto-grow, Enter / Shift+Enter, focus et brouillon sous SSE, menu kebab, tooltip, fermeture).
- Garde-fou daemon : `bun daemon/test/companion-loop.mts` 5/5.

## 8. Lancement

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

## 9. Reste à faire

- La barre de création de session reste désactivée (position MVP1, design en évolution).
- Le chemin permission n'a pas encore été exercé sur une vraie demande OpenChamber (aucune demande réelle disponible pendant la migration) ; le contrat et le rendu sont testés sur flotte factice.
- Le déplacement d'une carte entre sections peut perdre le focus du composer (le texte est conservé par le store). Un rendu en liste plate avec portails pourrait le préserver si l'usage le réclame.
