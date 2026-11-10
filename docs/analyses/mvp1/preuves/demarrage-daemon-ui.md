# Preuves : démarrage du daemon et de l'UI (2026-11-09)

Tâche : démarrer le daemon et l'UI du Superviseur sur la machine Windows de guillaume.

## AC-01 : dépendances UI installées et build UI réussi

- `bun install --cwd ui` : 189 packages installés en 3.35 s (extrait du log) :

  ```
  + typescript@5.9.3
  + vite@7.3.7
  + @openuidev/lang-core@1.0.2
  189 packages installed [3.35s]
  ```

- `bun run build:ui` : code de sortie 0, `tsc --noEmit` sans erreur, build Vite terminé (extrait du log) :

  ```
  dist/index.html                 0.42 kB │ gzip:   0.29 kB
  dist/assets/index-CtyP2Ctm.css 33.82 kB │ gzip:   7.46 kB
  dist/assets/index-BmA8yVIr.js   5.64 kB │ gzip:   2.17 kB
  dist/assets/index-D-36kLjk.js 703.12 kB │ gzip: 213.66 kB
  ✓ built in 1.90s
  ```

- Vérification après coup des fichiers produits (2026-11-09 07:57) :

  ```
  index.html            421 bytes
  index-BmA8yVIr.js    5644 bytes
  index-D-36kLjk.js  703123 bytes
  ```

## AC-02 : daemon démarré, flotte servie sur le port 5180

- Le premier démarrage sans `OPENCHAMBER_PORT` échoue comme attendu sur Windows
  (`Executable not found in $PATH: "ss"`) ; relance avec `OPENCHAMBER_PORT=57123`.
- Log du daemon au démarrage :

  ```
  [superviseur] OpenChamber découvert sur 127.0.0.1:57123
  [superviseur] chat de supervision prêt (ses_e3f9d0f29ffewSzP4fteNW1Kwg)
  [superviseur] flotte initialisée : OK - db SQLite ouverte
  [superviseur] UI + daemon sur http://127.0.0.1:5180/fleet
  ```

- `Get-NetTCPConnection -LocalPort 5180 -State Listen` : connexion en écoute sur
  `127.0.0.1:5180` (process bun 52636).
- `GET http://127.0.0.1:5180/api/fleet` : HTTP 200, 3 lignes de flotte.
- `GET http://127.0.0.1:5180/` : la page sert l'UI React (build `ui/dist`).

## AC-03 : contournement Windows documenté dans AGENTS.md

Nouvelle entrée dans la section « API OpenCode / OpenChamber (instance réelle) »
de `AGENTS.md`, ligne 35 :

```
- **Sur Windows, `discover.mts` plante au démarrage du daemon** (`Executable not
found in $PATH: "ss"`) : `ss` n'existe pas, passer impérativement
`OPENCHAMBER_PORT` (port du process principal `OpenChamber.exe`, trouvé par
`Get-NetTCPConnection -OwningProcess <pid>` ; les autres `OpenChamber.exe` qui
écoutent sont des services d'extensions).
```

Le port 57123 est auto-alloué par OpenChamber : à revérifier au prochain
redémarrage (commande de découverte dans l'entrée AGENTS.md).
