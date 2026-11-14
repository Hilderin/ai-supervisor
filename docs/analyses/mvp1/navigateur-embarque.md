# Navigateur embarqué du Superviseur et attache CDP

Décision et implémentation du 2026-11-14. Le composant possède un navigateur, l'expose sur un
port CDP et publie ce port ; les tâches s'y rattachent au lieu de lancer un Chrome jetable.

## Le problème que ça règle

Un agent qui doit voir ou piloter une page n'avait aucune prise sur le navigateur du
propriétaire : l'outil navigateur d'OpenChamber est une surface fermée de 11 actions et ne
permet pas l'attache ; son port de débogage n'existe qu'en développement et pour la fenêtre de
dev. L'agent lançait donc son propre Chrome : profil temporaire (aucune session du
propriétaire), onglets `about:blank` qui traînent, et parfois le bandeau
`unsupported command-line flag --disable-blink-features=AutomationControlled`, qui vient d'un
argument de **lancement** et jamais d'une connexion.

## Rôles

| Pièce | Rôle |
|---|---|
| `electron/main.cjs` | démarre le navigateur (`remote-debugging-port=0`), lit `DevToolsActivePort`, publie le port au daemon, possède la vue native du panneau et son cycle de vie |
| `electron/preload.cjs` | pont minimal (`window.superviseurBrowser`) : rectangle, adresse, gestes, état ; aucun accès Node |
| `daemon/src/browser-cdp.mts` | conserve l'annonce, la rejoue sur disque, la sert avec une sonde de vivacité |
| `daemon/src/server.mts` | `GET` et `POST /api/fleet/browser` |
| `daemon/src/tools.mts` | met l'endpoint et l'interdiction du Chrome jetable dans le prompt de tâche |
| `ui/src/components/BrowserPanel.tsx` | colonne navigateur : adresse, précédent/suivant/recharger/fermer, chip du port publié |
| `skills/browser-attach-cdp/SKILL.md` | ce que l'agent doit faire : s'attacher, réutiliser l'onglet, échouer proprement |

## Contrat

- **Annonce** : le composant appelle `POST /api/fleet/browser` `{ port, wsPath, pid }`. Le
  daemon refuse un port hors 1..65535 et n'écrase pas une annonce valide par une invalide.
- **Lecture** : `GET /api/fleet/browser` répond
  `{ available, cdpUrl, port, since, reason?, browser? }`. `available` vient d'une sonde
  `/json/version` (cache 2 s, délai 500 ms) : une entrée périmée n'est jamais dite disponible.
  `reason` vaut `not_published` (rien annoncé) ou `not_responding` (annoncé mais muet).
- **Fichier** : `<dossier de données>/browser-cdp.json` (`%APPDATA%\superviseur` en empaqueté,
  `data/` du dépôt en dev), même contenu que l'annonce, écrit atomiquement. C'est le repli pour
  un agent qui n'a que le disque.
- **Une seule page** : pas d'onglets. `target=_blank` et `window.open` chargent dans la page
  courante. Fermer le panneau cache la vue sans détruire la page.

## Pourquoi `WebContentsView` et pas `<webview>`

Playwright ne construit une page que pour les targets CDP de type `page` ; une `<webview>`
Electron produit un target `webview`, invisible pour lui, même avec un port ouvert. Mesuré :

| Panneau | Target CDP | Playwright voit la page |
|---|---|---|
| `<webview>` | `webview` | non |
| `WebContentsView` | `page` | oui |

## Vérifier

```powershell
# 1. le composant publie son endpoint (application lancée)
curl -s http://127.0.0.1:5180/api/fleet/browser

# 2. ouvrir le panneau (bouton « Navigateur ») et saisir une adresse
#    la chip « CDP <port> » affiche le port publié

# 3. un client Playwright s'attache au MÊME navigateur
node -e "const {chromium}=require('playwright');(async()=>{const b=await chromium.connectOverCDP('http://127.0.0.1:<port>');console.log(b.contexts()[0].pages().map(p=>p.url()));await b.close();})()"
```

Contrôles attendus : les pages listées sont celle du shell et celle du panneau, aucun
`chrome.exe` n'apparaît, `browser.close()` détache sans fermer le navigateur.

## Risques assumés

- Le port CDP est en **loopback mais non authentifié** : tout processus local peut piloter le
  navigateur, et aussi l'UI du Superviseur (le port expose tous les targets du processus).
  C'est le prix de l'attache ; à traiter comme l'API locale du daemon, pas comme un service
  public.
- Le panneau est réservé à l'application de bureau (hors Electron, le pont est absent et le
  panneau le dit). Sous 1100 px de large il est masqué, comme les autres colonnes.
- Une page créée n'est pas détruite à la fermeture du panneau : c'est voulu (l'agent la
  retrouve), mais cela garde un processus de rendu vivant.

## Références

- Analyse complète (diagnostic des trois symptômes, comparaison skill / plugin / intégration,
  PoC) : `F:\GitHub\browser-attach-poc\docs\analyse-browser-embedded.md`, hors dépôt.
- Skill : `skills/browser-attach-cdp/SKILL.md` (versionné ici).
