# Architecture MVP1 — hôtellerie du daemon, stockage, squelette

Décisions tranchées (2026-11-06, avec Guillaume) — révisées le jour même vers Bun après vérification de la stack OpenChamber :

| Décision | Choix | Note |
| --- | --- | --- |
| Runtime / langage | **Bun + TypeScript** *(révision)* | alignement délibéré sur la stack d'OpenChamber (même runtime que l'instance supervisée — leur dépôt embarque des patches bun et des modules natifs bun-pty). Bun 1.4.2 déjà présent sur la machine (`~/.bun`). TS exécuté nativement, sans étape de build |
| Forme de l'UI | **Web locale d'abord, Electron ensuite** | modéliser le serveur comme `packages/web` d'OpenChamber (HTTP + code UI partagé) pour greffer le shell desktop plus tard, exactement leur pattern |
| Pile UI | **Vite + React 19 + TypeScript + Tailwind v4 + Zustand** | même pile que `packages/ui` d'OpenChamber ; build statique dans `ui/dist`, servi par le daemon (migration du 2026-11-06, voir `implementation-ui-react.md`) |
| Stockage | **SQLite** | via `bun:sqlite` (Database API native Bun, zéro dépendance à compiler) |
| Historique | Node 24 d'abord envisagé, installé puis remplacé par Bun à la découverte de la stack OpenChamber | `~/.local/opt/node-v24` reste installé si besoin |

## 1. Composants du dépôt

```
superviseur/
  daemon/
    src/
      discover.mts      — trouver le port d'OpenChamber (ss -tlnp → process "openchamber", ou OPENCHAMBER_PORT)
      fleet.mts         — lecture : poll /api/sessions/status (3 s) + /api/session ; abonnement SSE /api/event
      delivery.mts      : livraison inline (dernier texte + rendu openchamber_render, cache invalidé par événements)
      assets.mts        : images locales d'une réponse (validation dans le dossier de session, raster only)
      state.mts         — SQLite (bun:sqlite) : journaux, clôtures, seuils
      server.mts        — HTTP : sert /api/fleet (JSON fusionné), les actions, et le build UI statique
      index.mts         — file-tout, lance le tout
  ui/                   — UI React (Vite + TypeScript + Tailwind + Zustand)
    src/                — composants, hooks, store, styles
    reference/          — flotte-vanilla.html, la maquette validée (référence pixel)
    dist/               — build servi par le daemon (gitignore)
  data/                 — superviseur.db (gitignore, local seulement)
```

Un seul process **Bun** fait tout (daemon + serveur HTTP + UI statique) : `bun daemon/src/index.mts` ; l'UI parle au daemon via `http://127.0.0.1:5180/api/fleet`.

## 2. Endpoints du daemon (MVP1)

| Route | Rôle |
| --- | --- |
| `GET /api/fleet` | l'état fusionné pour l'UI : sessions (de `/api/session`), statut et pending (de `/api/sessions/status`), l'état local (journaux, clôtures) |
| `GET /api/fleet/delivery` | livraison inline d'une session (`?sessionId=…`) : dernier texte + rendu `openchamber_render`, à la demande (jamais dans les frames de flotte), cache invalidé par événements |
| `GET /api/fleet/asset` | image locale citée par une réponse (`?sessionId=…&path=…`), servie depuis le dossier de la session, formats raster uniquement |
| `POST /api/fleet/reply` | répondre une question / permission / envoyer du libre (proxy vers form/permission reply) |
| `POST /api/fleet/create` | créé la session (proxé `/api/openchamber/sessions` — à confirmer) |
| `POST /api/fleet/done` | clôturer / repartir (nouvelle session liée) |
| `GET /api/fleet/stream` | SSE : pousse la flotte enrichie, identique à `GET /api/fleet` (2x/s) ; l'UI garde un poll 3 s en filet |
| `GET /fleet` | le build UI (`ui/dist/index.html`) |

## 3. Principes

1. **OpenChamber seul** : le daemon ne parle jamais à OpenCode directement (le port 43735 exige la basic auth qu'OpenChamber détient ; son `openapi.json` est d'ailleurs indisponible). Proxy HTTP pur, aucun SDK.
2. **Détails tolérés** : IDs fantômes filtrés (lastUpdateAt > 5 min), reconnexion SSE automatique, port auto-détecté à chaque démarrage avec fallback env. Le poll est single-flight (GET, intervalle et SSE coalescés) et le SSE pousse exactement la même flotte enrichie que le GET.
3. **Zéro dépendance runtime** dans le daemon : Bun implémente déjà tout ce qu'on utilise (fetch natif, serveur HTTP via node:http compatible, bun:sqlite, WebSocket natif). Les dépendances de l'UI (React, Vite, Tailwind, Zustand) sont des dépendances de build : le daemon ne sert que `ui/dist`. Aucun express, aucun framework côté serveur.
4. L'état dans SQLite reste minime : ce qui nous appartient (journal, clôtures, seuils). Rien de déjà servi par les endpoints.

## 4. Critères du squelette (fait quand)

- [x] le daemon détecte le port d'OpenChamber de cette machine et s'abonne au SSE ;
- [x] `GET /api/fleet` produit, pour chaque vraie session, ce que la maquette affiche (titre, statut, dernier tour, progression via todos quand disponible) ;
- [x] l'UI `/fleet` affiche la flotte réelle dans le style v4 (build React servi depuis `ui/dist`) ;
- [x] répondre à une question depuis l'UI débloque la vraie session ;
- [x] la livraison inline (dernier texte + rendu `openchamber_render`) s'affiche dans la carte ;
- [ ] ensuite seulement : créations, clôtures.
