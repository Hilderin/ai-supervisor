# Activité en direct sur la carte et dans le détail

## Besoin

La carte restait muette entre deux mises à jour de plan, de critères ou de
question. Le propriétaire veut une seule ligne discrète qui dit ce que l'agent
fait à l'instant (réflexion, édition de fichier, écriture, recherche, commande
shell), visible sur la carte et en haut du panneau de détail.

## Source de vérité

Le flux SSE d'OpenChamber (`/api/event`) publie les étapes du tour. Le daemon
les consomme déjà pour les erreurs et l'index local des messages :

| Événement | Activité |
| --- | --- |
| `session.execution.started`, `session.step.started` | Réflexion |
| `session.reasoning.started`, `session.reasoning.delta` | Réflexion |
| `session.text.started`, `session.text.delta` | Rédaction |
| `session.tool.input.started` | type de l'outil, sans sujet (arguments en cours) |
| `session.tool.called` | type + sujet (nom de fichier, motif, commande) |
| `session.tool.progress` | conserve la ligne courante |
| `session.tool.success`, `session.tool.failed` | conserve la ligne jusqu'au pas suivant |
| `session.execution.succeeded/failed/interrupted`, `session.idle` | efface la ligne |

Deux pièges de l'instance réelle, constatés en vérification :

- `session.tool.called` ne porte pas toujours `name`. Le nom vient de
  `session.tool.input.started` (même `id`) : le tracker garde une table
  `id → nom`, sinon la ligne restait bloquée sur « Réflexion » pendant toute la
  commande.
- `session.reasoning.ended` arrive après `session.tool.input.started`. Il ne
  doit pas réécrire la ligne : sinon l'outil est recouvert par « Réflexion »
  juste avant son exécution.

Filet de sécurité : si aucun événement n'est arrivé pour une session busy
(démarrage du daemon, coupure SSE), ou si la ligne connue a plus de 20 s,
`activity.mts` relit les 12 derniers messages (`GET
/api/session/:id/message?limit=12&order=desc`) et dérive l'état du dernier
message assistant. Les relectures sont espacées de 10 s au minimum par session.

## Rendu

`ActivityLine` (`ui/src/components/ActivityLine.tsx`) rend une seule ligne :
icône, libellé court, séparateur, sujet. Le sujet est tronqué par CSS
(`truncate`, `whitespace-nowrap`) ; le texte complet reste dans l'infobulle.
Aucun historique : chaque nouveau state remplace le précédent.

| Type | Icône | Libellé |
| --- | --- | --- |
| `thinking` | cerveau | Réflexion |
| `writing` | lignes de texte | Rédaction |
| `read` | fichier texte | Lecture |
| `edit` | crayon | Édition |
| `write` | fichier avec lignes | Écriture |
| `search` | loupe | Recherche |
| `shell` | terminal | Commande |
| `tool` | outil | libellé parlant (Plan, Critères, Réponse...) ou Outil |

La carte n'affiche la ligne que dans l'état `busy` ; le panneau de détail la
place dans sa bande d'en-tête, sous l'état et le dossier. Au repos, le daemon
n'expose pas `activity` et l'UI s'abstient même si un champ résiduel arrivait :
aucun texte trompeur ne reste après la fin du tour.

## Pourquoi un équivalent et pas le composant OpenChamber

OpenChamber possède déjà le rendu de référence
(`packages/ui/src/hooks/useAssistantStatus.ts`,
`packages/ui/src/components/chat/message/parts/toolPresentation.tsx`) : un
libellé court par type d'outil et une icône associée (`brain-ai-3`, `pencil`,
`file-edit`, `menu-search`, `terminal-box`). Ces composants vivent dans une
autre application (sprite d'icônes interne, i18n et thème propres) et ne sont
pas publiés comme dépendance : les importer ajouterait une dépendance UI
interdite par la consigne.

L'équivalent reprend donc les mêmes métaphores et le même gabarit visuel :
trait fin, 14 px, pictogramme par type, libellé court, sujet discret. Les
libellés sont en français comme le reste du Superviseur ; la référence
anglaise d'OpenChamber reste la source du découpage (Thinking, Edit file,
Write file, Search, Shell command).

## Coût et fréquence

- Les événements SSE alimentent le tracker en mémoire sans requête HTTP.
- La flotte est déjà reconstruite et publiée toutes les 3 s ; l'activité y est
  ajoutée avant publication, jamais dans une frame intermédiaire.
- Une relecture de secours par session busy est bornée à une tentative toutes
  les 10 s et la ligne n'est remplacée que si l'événement en cours est plus
  ancien que la requête.
- Pas de dépendance UI nouvelle, pas de modification du comportement des
  tâches : seule la lecture de l'activité est ajoutée.

## Vérification réelle

Sur l'instance OpenChamber réelle, une boucle externe a interrogé `GET
/api/fleet` toutes les 100 à 200 ms pendant que la tâche était busy. Le relevé
est conservé dans `activite-verification.log` : on y voit Réflexion, puis
Édition avec nom de fichier (`edit · activite-verif.md`), Écriture, Recherche
et Commande shell. Une capture prise par un sous-agent indépendant pendant une
commande montre la ligne dans la vraie carte (icône terminal, « Commande »
puis la commande), sans que l'outil de capture ne pollue l'activité observée.

## Tests

- `daemon/test/activity.test.mts` : mapping des cinq cas minimaux, troncature
  d'une commande, forme réelle des événements (sans `name` sur `called`),
  effacement en fin de tour, repli par messages.
- `ui/src/components/ActivityLine.test.tsx` : une ligne, troncature, icône par
  type, absence au repos.
- `ui/src/components/SessionCard.test.tsx` et `TaskInspector.test.tsx` : ligne
  unique sur la carte busy, même ligne en haut du détail, aucune ligne idle.
