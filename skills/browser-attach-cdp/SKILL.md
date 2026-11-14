---
name: browser-attach-cdp
description: Piloter le navigateur embarqué du Superviseur en s'y rattachant par CDP (Playwright connectOverCDP), au lieu de lancer un Chrome jetable. À charger DÈS QU'UNE TÂCHE doit voir ou piloter une page web (vérifier un écran, cliquer, remplir, capturer une preuve) dans une session où le propriétaire regarde le panneau navigateur du Superviseur, et dès qu'apparaissent « navigateur », « fureteur », « browser », « Playwright », « about:blank » ou « CDP ».
---

# Piloter le navigateur embarqué du Superviseur

Le Superviseur possède un navigateur embarqué (Electron). Il l'expose sur un port CDP local.
Ton travail est de t'y **rattacher**, jamais d'en lancer un.

Pourquoi c'est la seule bonne façon :

- un navigateur lancé par toi est un **autre** navigateur : profil jetable, aucune session du
  propriétaire, et des onglets `about:blank` qui traînent (Playwright en crée un par
  `newPage`) ;
- `connectOverCDP` ne lance rien et ne passe aucun argument de lancement, donc il ne peut pas
  faire apparaître le bandeau `unsupported command-line flag` ;
- la page que tu pilotes est celle que le propriétaire voit : ta vérification est sa preuve.

## 0. État du mécanisme

Le contrat ci-dessous est celui du composant. Si l'endpoint est absent ou ne répond pas, le
mécanisme n'est pas encore branché sur cette instance : va en section 5, ne lance rien.
Ne conclus jamais « donc je lance mon navigateur » : un Chrome jetable ne prouve rien au
propriétaire et laisse des onglets fantômes.

## 1. Trouver l'endpoint, dans cet ordre

1. `SUPERVISEUR_BROWSER_CDP` (variable d'environnement posée sur la tâche), valeur
   `http://127.0.0.1:<port>`.
2. `%APPDATA%\Superviseur\browser-cdp.json`, champ `cdpUrl` (écrit par le composant).
3. `GET /api/fleet/browser` sur l'API locale du Superviseur, champ `cdpUrl`.

Puis vérifie qu'il répond, sans rien lancer :

```bash
curl -s http://127.0.0.1:<port>/json/version
```

Réponse attendue : un JSON avec `webSocketDebuggerUrl` et un `Browser` du type
`Chrome/15x...Electron/4x...`. Un refus de connexion signifie **navigateur non démarré** :
va en section 5.

## 2. Se rattacher et prendre l'onglet du panneau

```js
import { chromium } from 'playwright';

const cdp = process.env.SUPERVISEUR_BROWSER_CDP || 'http://127.0.0.1:9333';
const browser = await chromium.connectOverCDP(cdp);

// Le contexte est celui du composant : jamais newContext(), jamais newPage().
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((p) => p !== null && !p.isClosed() && !isShellUrl(p.url()));

if (!page) {
  throw new Error('aucune page de panneau exposée : ne pas lancer de navigateur, voir section 5');
}
```

Règles dures :

- **jamais** `chromium.launch`, `launchPersistentContext`, `newContext`, `newPage` : le
  navigateur et son onglet appartiennent au composant ;
- **jamais** piloter la page du shell (l'interface du Superviseur). Elle est dans la même
  connexion, elle n'est pas ton sujet. Filtre par URL, pas par index dans la liste ;
- une action = l'onglet du panneau. Si la page est en `about:blank`, ce n'est pas une raison
  d'en créer une autre : `page.goto(url)` réutilise celle-là.

`isShellUrl` : l'URL du shell est celle du composant (par exemple `.../fleet`, `.../index.html`,
`file://.../shell.html`). Le plus sûr est de filtrer sur l'URL que la page est censée montrer
(celle du produit testé), et de vérifier le titre avant d'agir.

## 3. Piloter

```js
await page.goto('http://localhost:3000/ecran', { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Enregistrer' }).click();
await page.fill('#nom', 'valeur de test');
const texte = await page.textContent('.toast');
await page.screenshot({ path: 'captures/apres.png' });
```

Tout Playwright marche comme d'habitude : sélecteurs, `expect`, attentes, réseau
(`page.on('request')`), console (`page.on('console')`), `evaluate`. C'est précisément ce que
l'outil navigateur d'OpenChamber ne donne pas, et c'est pour cela que le rattachement existe.

## 4. Se déconnecter sans fermer

```js
await browser.close(); // détache le client ; le navigateur du composant reste ouvert
```

Ne tente pas d'arrêter le navigateur : sa vie appartient au composant. Ne ferme pas la page du
panneau à la fin, le propriétaire peut vouloir la regarder.

## 5. Si le navigateur n'est pas démarré

Ordre des réponses, du moins intrusif au plus :

1. Vérifier que le port est le bon (`/json/version` répond 403 ? mauvais port).
2. Dire au propriétaire que le navigateur du Superviseur n'expose pas de port, avec la preuve
   (`ECONNREFUSED` sur `http://127.0.0.1:<port>`), et proposer de démarrer le composant.
3. Si le panneau est là mais que Playwright ne voit **aucune** page de panneau (seulement la
   page du shell), c'est un panneau `webview` : les targets de type `webview` sont ignorés par
   Playwright. Le dire tel quel, ne pas contourner.
4. **Jamais** de repli sur un `chromium.launch` personnel.

## 6. Pièges connus

- Le port expose **tous** les targets du processus (shell compris) : filtrer, toujours.
- Un `webContents.debugger` déjà attaché par le composant (émulation de focus, thème) ne
  bloque pas la connexion CDP externe, mais DevTools ouvert sur la page peut gêner certaines
  commandes d'émulation.
- Le propriétaire peut recharger ou naviguer dans l'onglet pendant que tu travailles : relis
  l'URL avant d'agir, et ne suppose pas que l'état d'il y a dix secondes tient encore.
- Deux agents sur la même page se marchent dessus : si une autre tâche travaille la même URL,
  le signaler plutôt que cliquer au hasard.
- Une capture d'écran de preuve doit montrer l'état attendu : vérifie le fichier (sous-agent
  `vision`) avant de le citer.
- Le port est en loopback mais non authentifié : ne le publie pas, ne le relaie pas, ne le
  mets pas dans un log partageable.

## 7. Ce que ce skill ne fait pas

- Il ne démarre pas le navigateur : c'est le composant.
- Il ne remplace pas l'outil navigateur d'OpenChamber pour les gestes simples (capture,
  annotation) : celui-là montre la page au propriétaire sans code.
- Il ne pilote pas un navigateur distant par un tunnel : si le composant est sur une autre
  machine, le port doit être relayé par le composant lui-même, pas par toi.

## Origine

Skill versionné avec le Superviseur (il décrit le contrat de son composant navigateur, donc sa
place est ici et non dans une configuration personnelle non versionnée). Le lien vers ce
dossier se fait dans la configuration OpenCode (`skills`).
