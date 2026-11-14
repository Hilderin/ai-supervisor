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
- **La page existe dès le démarrage** : le composant crée la vue à l'ouverture de la fenêtre,
  même panneau fermé (`electron/main.cjs`, `createWindow`), et charge `about:blank` dessus.
  Elle apparaît alors dans `/json/list` comme un target `page` (`about:blank`), ce qui donne une
  cible à une tâche avant que le propriétaire ait ouvert quoi que ce soit. Cette règle n'est pas
  cosmétique : Electron ne sait pas créer de cible à la demande (`Target.createTarget` répond
  `Not supported`, mesuré le 2026-11-14), donc sans cette page une tâche n'a **rien** à piloter
  et se rabat sur le shell ou échoue. Le `about:blank` initial n'est pas décoratif non plus :
  sans document, la page n'a pas de frame et un client CDP reste muet sur les commandes qui en
  dépendent (`Page.enable` sans réponse au-delà de 6 s, mesuré sur la vue vide ; Playwright
  l'appelle en s'attachant). `about:blank` est normalisé en URL vide dans l'état du panneau,
  pour que l'invite « Aucune page ouverte » reste vraie.
- **Révélation à la navigation** : toute navigation du document principal de la page du panneau
  vers une adresse http(s) (adresse tapée, `page.goto`, clic, redirection) envoie
  `superviseur:browser:reveal` au renderer quand le panneau est fermé ; l'UI ouvre alors le
  panneau, exactement comme le bouton « Navigateur » (repli du chat si la place manque). Une
  navigation de même document (ancre, `pushState`), une adresse non http(s) et l'initialisation
  en `about:blank` ne révèlent rien.

## Pourquoi `WebContentsView` et pas `<webview>`

Playwright ne construit une page que pour les targets CDP de type `page` ; une `<webview>`
Electron produit un target `webview`, invisible pour lui, même avec un port ouvert. Mesuré :

| Panneau | Target CDP | Playwright voit la page |
|---|---|---|
| `<webview>` | `webview` | non |
| `WebContentsView` | `page` | oui |

## Révélation du panneau : pourquoi ça ne marchait pas (2026-11-14)

Signalement du propriétaire : une tâche ouvre une page, le panneau navigateur ne s'ouvre pas.
Deux causes, cumulatives, et aucune ne vivait dans le daemon :

1. **La page n'existait pas tant que le panneau n'avait pas été ouvert.** `ensureBrowserView()`
   n'était appelé que par `applyBrowserLayout()` (qui exige `visible`) et par le geste
   « navigate » du panneau. Panneau fermé depuis le démarrage, il n'y avait donc **aucune**
   cible `page` : `/json/list` ne montrait que le shell, et `Target.createTarget` répond
   `Not supported`. La tâche ne pouvait rien ouvrir du tout ; le skill lui disait alors de
   demander au propriétaire d'ouvrir le panneau, d'où « ça ne s'ouvre pas ».
2. **Une navigation ne réveillait personne.** Même page existante (panneau ouvert puis fermé),
   `did-navigate` ne faisait que pousser `superviseur:browser:state`, que seul `BrowserPanel`
   écoutait : le panneau étant démonté, personne ne recevait l'état, et `browserOpen` restait
   faux. Reproduit sur l'instance réelle : panneau fermé, `Page.navigate` par CDP sur la page
   du panneau, panneau toujours absent du DOM et `superviseur.browser` toujours `closed`.

Correctif : la vue est créée à l'ouverture de la fenêtre (avec son `about:blank` initial), et
`did-start-navigation` (document principal, adresse http(s), pas de même-document) envoie
`superviseur:browser:reveal` ; `App.tsx` s'abonne par `watchBrowserReveal` et appelle
`openBrowser()` (même geste que le bouton, donc même repli du chat et même largeur). Le pont
`onReveal` est optionnel côté UI : une page servie avec un preload plus ancien (UI rechargée
avant redémarrage de l'application) n'ouvre rien plutôt que de jeter au montage.

Pas de réouverture en boucle par construction : **fermer le panneau n'est pas une navigation**.
Seule une navigation révèle, et le composant ne signale que les navigations. Vérifié : après
fermeture, 6 s sans réouverture ; une ancre ne rouvre pas ; une nouvelle navigation rouvre.

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

```powershell
# 4. la page du panneau existe même panneau fermé (titre vide, URL vide)
curl -s http://127.0.0.1:<port>/json/list

# 5. révélation : fermer le panneau, puis faire naviguer SA page par CDP.
#    Ici à la main, une tâche le fait par page.goto.
#    Attendu : le panneau s'ouvre seul sur cette adresse ; le fermer à nouveau
#    le laisse fermé (aucune navigation ne le rouvre) ; une navigation suivante
#    le rouvre.
```

Le scénario complet (cible exposée, révélation, fermeture qui tient, ancre ignorée,
nouvelle navigation) a été joué sur une seconde instance (port 5181, `SUPERVISEUR_USER_DATA`
dédié) avec `Page.navigate` par CDP sur la page du panneau : 7 contrôles sur 7. Capture :
[preuves/panneau-navigateur-revele.png](preuves/panneau-navigateur-revele.png) (panneau ouvert
par la navigation d'une tâche, seconde instance, panneau jamais ouvert avant).

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
