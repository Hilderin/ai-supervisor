# Architecture MVP1 — hôtellerie du daemon, stockage, squelette

Décisions tranchées (2026-11-06, avec Guillaume) — révisées le jour même vers Bun après vérification de la stack OpenChamber :

| Décision | Choix | Note |
| --- | --- | --- |
| Runtime / langage | **Bun + TypeScript** *(révision)* | alignement délibéré sur la stack d'OpenChamber (même runtime que l'instance supervisée — leur dépôt embarque des patches bun et des modules natifs bun-pty). Bun 1.4.2 déjà présent sur la machine (`~/.bun`). TS exécuté nativement, sans étape de build |
| Forme de l'UI | **Web locale d'abord, Electron ensuite** | modéliser le serveur comme `packages/web` d'OpenChamber (HTTP + code UI partagé) pour greffer le shell desktop plus tard, exactement leur pattern |
| Stockage | **SQLite** | via `bun:sqlite` (Database API native Bun, zéro dépendance à compiler) |
| Historique | Node 24 d'abord envisagé, installé puis remplacé par Bun à la découverte de la stack OpenChamber | `~/.local/opt/node-v24` reste installé si besoin |

## 1. Composants du dépôt

```
superviseur/
  daemon/
    src/
      discover.mts      — trouver le port d'OpenChamber (ss -tlnp → process "openchamber", ou OPENCHAMBER_PORT)
      fleet.mts         — lecture : poll /api/sessions/status (3 s) + /api/session ; abonnement SSE /api/event
      state.mts         — SQLite (bun:sqlite) : journaux, clôtures, seuils
      server.mts        — HTTP : sert /api/fleet (JSON fusionné), les actions, et l'UI statique
      index.mts         — file-tout, lance le tout
  ui/                   — la maquette v4 branchée (HTML/JS vanilla dans MVP1)
  data/                 — superviseur.db (gitignore, local seulement)
```

Un seul process **Bun** fait tout (daemon + serveur HTTP + UI statique) : `bun daemon/src/index.mts` ; l'UI parle au daemon via `http://127.0.0.1:5180/api/fleet`.

## 2. Endpoints du daemon (MVP1)

| Route | Rôle |
| --- | --- |
| `GET /api/fleet` | l'état fusionné pour l'UI : sessions (de `/api/session`), statut et pending (de `/api/sessions/status`), l'état local (journaux, clôtures) |
| `POST /api/fleet/reply` | répondre une question / permission / envoyer du libre (proxy vers form/permission reply) |
| `POST /api/fleet/create` | créé la session (proxé `/api/openchamber/sessions` — à confirmer) |
| `POST /api/fleet/done` | clôturer / repartir (nouvelle session liée) |
| `GET /fleet` | l'UI |

## 3. Principes

1. **OpenChamber seul** : le daemon ne parle jamais à OpenCode directement (le port 43735 exige la basic auth qu'OpenChamber détient ; son `openapi.json` est d'ailleurs indisponible). Proxy HTTP pur, aucun SDK.
2. **Détails tolérés** : IDs fantômes filtrés (lastUpdateAt > 5 min), reconnexion SSE automatique, port auto-détecté à chaque démarrage avec fallback env.
3. **Zéro dépendance runtime** dans MVP1 : Bun implémente de déjà tout ce qu'on utilise (fetch natif, serveur HTTP via node:http compatible, bun:sqlite, WebSocket natif). Pas d'express, pas de framework UI — la maquette v4 vanilla branchée à un petit client d'état.
4. L'état dans SQLite reste minime : ce qui nous appartient (journal, clôtures, seuils). Rien de déjà servi par les endpoints.

## 4. Critères du squelette (fait quand)

- [ ] le daemon détecte le port d'OpenChamber de cette machine et s'abonne au SSE ;
- [ ] `GET /api/fleet` produit, pour chaque vraie session, ce que la maquette affiche (titre, statut, dernier tour, progression via todos quand disponible) ;
- [ ] l'UI `/fleet` affiche la flotte réelle dans le style v4 ;
- [ ] répondre à une question depuis l'UI débloque la vraie session ;
- [ ] ensuite seulement : créations, clôtures, rendus inline.
