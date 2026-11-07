# Flicker de la flotte : barres qui se relancent, section Plan qui disparaît

Statut : note de diagnostic, 2026-11-07. Problème corrigé le même jour ; la page de repro reste en `ui/repro-flicker.html` (mode debug, hors bundle).

## 1. Symptômes observés

1. Sur une carte, la barre de progression s'anime à chaque cycle : elle passe de 38 % à 0 puis revient à 38 % (transition CSS `[width] duration-500`).
2. Dans le panneau de détail (`TaskInspector`), la section `PlanSection` est démontée puis remonter : elle disparaît ((et son emplacement affiche « pas de plan » ou un pourcentage) puis revient.

## 2. Cause racine (daemon : publication avant enrichissement)

`daemon/src/fleet.mts`, `runPoll` :

```ts
cachedFleet = buildFleet(status);        // publié immédiatement
await enrichTodoProgress(cachedFleet);   // enrichissement TOUJOURS après
```

`buildFleet` fabrique les lignes **sans** `todo` : le champ vient de `enrichTodoProgress`, qui fait un fetch `/api/session/:id/message?limit=80` par session. Chaque fetch met quelques dizaines à centaines de ms ; pendant toute cette fenêtre, `cachedFleet` publié au SSE (`/api/fleet/stream`, 2 images/s) et au poll 3 s (`GET /api/fleet`) est un snapshot **non enrichi** :

- `todo` absent : `PlanSection` (déroulant : `todoSteps.length ?`) et `PlanPopover` se démontent, la barre (`hasProgress`) peut carrément disparaître ;
- `sup.progress` = la valeur du **verdict du compagnon** (0, 99...) au lieu de celle du **plan** : la barre, toujours montée, s'anime entre les deux valeurs puis revient.

La fenêtre est déclenchée à chaque cache-miss du snapshot todos (`todos.mts`) : session busy (dernier `lastUpdateAt` changé) ou entrée de cache de plus de 30 s. En production, une capture SSE de 3 minutes le confirme sur les 3 sessions de la flotte, fenêtres d'environ 500 ms, à t+84 s, t+155 s et t+175 s :

| session | frame enrichie | frame de fenêtre (500 ms) |
| --- | --- | --- |
| Diagnostique flicker (busy) | `todo 3/8, progress 38` | `todo null, progress 0` |
| Auto-restart (busy) | `todo 5/5, progress 99` | `todo null, progress 99` |
| Boîte à idées (idle) | `todo 3/3, progress 99` | `todo null, progress absent` (strippé) |

Le cas « Auto-restart » montre que le flicker de la section Plan n'a pas besoin d'un écart de pourcentage : la simple absence de `todo` suffit à démonter la section.

## 3. Hypothèses écartées

- **Clés React** : les cartes sont keyées par `row.id` (jamais de remontée de clé), l'inspecteur n'est pas remonté par App. Le démontage observé vient du payload, pas des clés.
- **Divergence SSE vs GET** : les deux servent `enrichedFleet()` depuis le même `cachedFleet` (fix du 2026-10). La divergence est **temporelle**, dans un même canal : deux snapshots de qualité différente se succèdent dans le cycle d'un poll.
- **Re-render complet au passage de données** : les frames identiques du SSE sont dédupliquées (`useFleetStream`) ; le store recalcule `placements`/`order` à chaque frame mais ces valeurs ne déplacent pas les cartes (ordres stables, hystérésis).

## 4. Fix

`daemon/src/fleet.mts` : la flotte est construite dans une variable locale, enrichie, **puis** publiée en `cachedFleet`. Le SSE et le poll ne voient donc plus jamais un snapshot sans plan. La conséquence : pendant l'enrichissement (au plus ~1 s sur cette instance), l'UI reste sur le dernier snapshot enrichi (valeur figée), ce qui est le comportement voulu.

Le repli « toujours l'ancien plan connu plutôt que clignotant à zéro » existait déjà dans `todos.mts` (cache précédent en cas de fetch échoué ou plan sorti de la fenêtre de 80 messages) ; le fix de publication le fait enfin respecter à l'échelle de flotte.

## 5. Repro et validation

- **En production (avant fix)** : capture SSE 3 min, logs dans `/tmp/opencode/sse-capture.log` : fenêtres `todo:null` pour les 3 sessions.
- **Repro déterministe (UI)** : `bun run dev` puis `http://localhost:5173/repro-flicker.html?fen=500&cycle=3000`. La page rejoue les frames enrichie puis fenêtre avec un compteur de démontages (`data-flicker-plan`, `data-flicker-bar` sur `<body>`). Non importée par `index.html`, donc jamais dans le bundle.
- **Après fix (validation navigateur)** : de longues observations ciblées (headless via CDP) sur `/fleet` en production ne montrent plus aucune frame sans `todo` ni démontage de la section Plan, avec des données qui changent (sessions busy).
