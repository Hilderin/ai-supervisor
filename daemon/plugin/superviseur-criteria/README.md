# SuperviseurCriteria

Plugin OpenCode v2 du repo Superviseur : expose les critères d'acceptation à l'agent d'une tâche. Spécification : `docs/analyses/mvp1/criteres-acceptation.md`.

## Outils

| Outil | Rôle |
|---|---|
| `criteria_list` | lit la liste (réfs, états, preuves, notes) ; ne déclenche rien |
| `criteria_add` | crée un critère `{title, detail?, methods[]}` ; démarre « à faire » |
| `criteria_remove` | retire `{ref}` ; la ref n'est jamais réattribuée |
| `criteria_update` | modifie `{ref, title?, detail?, methods?}` ; un critère non « à faire » repasse « à faire » (preuve et jugement invalidés) |
| `criteria_to_validate` | soumet une preuve `{ref, evidence[]}` ; « à faire » ou « à corriger » devient « à valider » |
| `criteria_set_status` | juge `{ref, status, note}` : « validated » (note = ce qui a été vérifié) ou « to_fix » (raison obligatoire) |

## Qui juge

L'agent de la tâche est son propre juge : plus de sous-agent vérificateur
(décision du 2026-11-12). Les instructions d'usage honnête vivent dans les
descriptions des tools : valider seulement après une vérification réelle,
raison obligatoire sur « à corriger », jamais de validation « pour avancer ».
Le propriétaire lit la liste, les preuves et les notes.

## Méthodes et preuves

Méthodes (au moins une par critère) : `unit_test`, `e2e`, `browser_nav`, `screenshot`, `human`, `text`, `code_excerpt`, `artifact`, `command`, `diff`, `doc`.

Preuve = `{kind, text, path?, start_line?, line_count?}` ; `screenshot`, `code_excerpt` et `artifact` exigent un `path` de fichier existant du projet (vérifié au dépôt par le daemon), `code_excerpt` exige `start_line` et `line_count`.

## Installation

Ajouter le chemin du dossier dans `~/.config/opencode/opencode.jsonc` (`"plugins"`) et redémarrer OpenCode (leçon : changer la liste des plugins exige un redémarrage). Vérifier : `opencode api get /api/plugin`, le plugin doit apparaître avec `"id": "superviseur-criteria"`.

Le daemon reçoit les appels sur `POST /api/criteria/:name` et valide l'appelant (tâche connue du Superviseur, jamais le chat de supervision).
