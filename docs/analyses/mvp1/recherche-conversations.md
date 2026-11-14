# Recherche de conversations et restauration d'une carte fermée

> Lot du 2026-11-14. Le propriétaire perdait une carte dès qu'il la fermait en
> « Terminé » ; le dashboard gagne une loupe de recherche qui la retrouve par
> son titre ou par un mot d'un de ses messages, et la remet dans le tableau.

## Besoin

1. Retirer l'entête de la section des cartes (« Aucune tâche en attente » et
   « X tâches ») : cette ligne n'apportait rien.
2. Pouvoir remettre dans le dashboard une carte fermée en « Terminé »,
   autrement dit la rouvrir sans passer par l'API à la main.
3. Le point 2 s'appuie sur une recherche de type palette (Ctrl-P
   d'OpenChamber) : loupe en haut du dashboard, popup avec champ, résultats
   portant titre, projet, date et heure de la dernière activité, et extrait du
   message trouvé quand la correspondance vient d'un message.
4. La recherche doit aussi porter sur les titres des conversations.

## Décisions

### La loupe remplace l'entête

Le bandeau collant garde sa hauteur (34 px) et son rôle : l'indicateur
« N en attente » et le bouton « Suivante » n'apparaissent que lorsqu'une tâche
attend réellement. Le reste de la ligne est libre, la loupe est posée à droite.
Aucun compteur permanent n'est affiché.

### Raccourci : Ctrl+Shift+K

Ctrl-P est déjà la palette d'OpenChamber, Ctrl-F sa recherche dans la page.
La liste des bindings par défaut d'OpenChamber a été relevée dans son bundle
(`mod+p`, `mod+f`, `mod+k a/b/c/g/h/i/l/n/p/r/t`, `mod+shift+b/e/f/m/n/o/t`,
`mod+alt+n/r/v`, `alt+g`, `alt+w`, etc.) : **Ctrl+Shift+K** est libre. Il est
écrit dans l'infobulle du bouton (« Rechercher une conversation
(Ctrl+Shift+K) ») et rappelé dans le pied du popup.

### Deux sources, une ligne par conversation

- **Titres** : le catalogue des sessions déjà lu par le poll de flotte
  (`sessionCatalog()` de `fleet.mts`), comparaison en minuscules et sans
  accents.
- **Messages** : l'index d'OpenChamber, `GET /api/openchamber/message-search`
  (activé sur l'instance). Le daemon ne relit jamais les conversations une par
  une : l'index est la seule source, et un 503 (index désactivé) laisse les
  titres s'afficher avec un avertissement.

Les deux listes sont fusionnées par `sessionId` : une conversation trouvée par
son titre ET par un message reste une seule ligne, qui garde l'extrait (il dit
pourquoi elle sort) et le drapeau de titre. Ordre : correspondances de titre
d'abord (on cherche souvent une conversation par son nom), puis dernière
activité décroissante ; 12 résultats au maximum.

Sont écartés : les sous-sessions (`parentID`), les conversations archivées et
le dossier `~/.superviseur` (le chat de supervision n'est pas une carte).

### Mise en page d'un résultat, et pourquoi

```text
Refonte du dashboard            [titre] [fermée]              [Restaurer]
ai-supervisor · 14 nov. 14:32
│ réponse de l’agent  … la refonte avance …
```

1. **Le titre en premier** : c'est l'identité que le propriétaire cherche.
   Les étiquettes « titre » et « fermée » sont à côté, en petit.
2. **Projet puis date et heure** sur une ligne discrète : un même titre peut
   exister dans deux projets ; la date lève l'ambiguïté des doublons.
3. **L'extrait indenté sous un filet**, précédé du rôle (« ton message » ou
   « réponse de l'agent ») : il explique la correspondance sans concurrencer
   le titre. Les occurrences sont surlignées par des segments `<mark>`.
4. **L'action à droite** : « Restaurer » (vert) pour une carte fermée,
   « Voir » pour une conversation encore présente. Cliquer la ligne fait la
   même chose que le bouton.

L'extrait utilise les marqueurs privés de l'index (U+E000 ouverture, U+E001
fermeture) : `parseSnippet` les transforme en segments, jamais en HTML.

## Daemon

- `daemon/src/search-core.mts` : noyau pur (normalisation, extraits, fusion,
  tri, plafond, exclusions) ; aucune base ni réseau, donc testable seul.
- `daemon/src/search.mts` : `searchConversations` (catalogue + index) et
  `restoreConversation` (`reopenTaskState`, refus `session_gone` si la session
  n'existe plus, est archivée ou est un enfant) ; `setBase` câblé dans
  `index.mts`.
- `GET /api/search?q=…` : `{ state: ok | too_short | unavailable, results }`.
  Moins de deux caractères ne part pas (`too_short`).
- `POST /api/fleet/restore { sessionId }` : 200 `{ ok, sessionId }` ou 404
  `session_gone`. Un événement `note` est journalisé.
- `state.mts` : `closedTaskIds()` (une requête, pas une lecture par session).

## UI

- `SearchPopover.tsx` : bouton loupe, portail `position:fixed` centré en haut
  (largeur 620 px au plus), autofocus, frappe amortie 220 ms, requête
  précédente annulée, Échap et clic extérieur, raccourci global.
- `fleetStore.forgetClosed(id)` : la carte restaurée doit aussi perdre son
  marqueur local `closed`, sinon l'UI la masque encore alors que le daemon l'a
  rouverte.
- `FleetBoard` : la restauration pose `pendingFlash` ; le défilement et le
  flash orange attendent le frame suivant, car la carte n'existe pas encore
  dans le DOM au moment du clic. « Voir » sélectionne la carte et la flashe
  immédiatement.
- États du popup : consigne sous deux caractères, « Recherche… », aucun
  résultat, index indisponible, erreur de restauration.

## Vérifications

- `bun test daemon/test/search.test.mts` : 17 tests (extraits, normalisation,
  fusion, ordre, plafond, fermée, état de l'index, restauration, refus).
- `bun test ui` : 303 tests, dont `SearchPopover.test.tsx` (rendu des
  résultats, actions, bandeau sans compteur, tâche en attente conservée) et
  `fleetStore.test.ts` (`forgetClosed`).
- `bun run build:ui` : typecheck et build passent.
- Instance réelle (daemon de dev, port 5180) : `/api/search?q=superviseur`
  renvoie des résultats avec extraits marqués ; une carte fermée restaurée par
  `POST /api/fleet/restore` réapparaît dans `/api/fleet` (0 → 1), puis a été
  refermée pour rendre l'état du propriétaire.
- Navigateur : loupe et Ctrl+Shift+K ouvrent le popup ; les résultats
  affichent titre, projet, date, extrait et « Restaurer » ; un clic sur
  « Restaurer » referme le popup, la carte réapparaît et porte l'anneau orange
  du flash.
