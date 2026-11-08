# SuperviseurCriteria

Plugin OpenCode v2 du repo Superviseur : expose les critères d'acceptation à l'agent principal d'une tâche. Spécification : `docs/analyses/mvp1/criteres-acceptation.md`.

## Outils

| Outil | Rôle |
|---|---|
| `criteria_list` | lit la liste (réfs, états, preuves, commentaires) ; ne déclenche rien |
| `criteria_add` | crée un critère `{title, detail?, methods[]}` ; démarre « à faire » |
| `criteria_remove` | retire `{ref}` ; la ref n'est jamais réattribuée |
| `criteria_update` | modifie `{ref, title?, detail?, methods?}` ; un critère non « à faire » repasse « à faire » (preuve invalidée) |
| `criteria_to_validate` | soumet une preuve `{ref, evidence[]}` ; « à faire » ou « à corriger » devient « à valider » |

## Ce que ces outils ne font PAS

- **Aucun tool d'approbation ni de refus** : les transitions vers « validé » et « à corriger » appartiennent au vérificateur, appliquées par le daemon depuis son JSON. Elles ne sont pas dispatchables ici.
- **Aucune écriture directe du statut** : toute écriture passe par la machine à états (`daemon/src/criteria.mts`) via le daemon.

## Méthodes et preuves

Méthodes (au moins une par critère) : `unit_test`, `e2e`, `browser_nav`, `screenshot`, `human`, `text`, `code_excerpt`, `artifact`, `command`, `diff`, `doc`.

Preuve = `{kind, text, path?, start_line?, line_count?}` ; `screenshot`, `code_excerpt` et `artifact` exigent un `path` de fichier existant du projet (vérifié au dépôt par le daemon), `code_excerpt` exige `start_line` et `line_count`.

## Installation

Ajouter le chemin du dossier dans `~/.config/opencode/opencode.jsonc` (`"plugins"`) et redémarrer OpenCode (leçon : changer la liste des plugins exige un redémarrage). Vérifier : `opencode api get /api/plugin`, le plugin doit apparaître avec `"id": "superviseur-criteria"`.

Le daemon reçoit les appels sur `POST /api/criteria/:name` et valide l'appelant (tâche connue du Superviseur, jamais le chat de supervision ni un compagnon).
