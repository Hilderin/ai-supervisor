# SuperviseurCriteria

Plugin OpenCode v2 du repo Superviseur : expose les critères d'acceptation à
l'agent d'une tâche. Spécification : `docs/analyses/mvp1/criteres-acceptation.md`
(section 13 : migration « critères natifs session » du 2026-11-13).

## Architecture (depuis le 2026-11-13)

L'état vit DANS le plugin : storage durable `ctx.storage`, clé
`session/<sessionID>` (mêmes conventions que `superviseur-plan`). La machine à
états vit dans `state.js`, module pur sans dépendance (node:fs, node:path,
node:child_process seulement), testé directement par
`daemon/test/criteria-state.test.mts`.

AUCUN appel au daemon : les outils marchent même quand le Superviseur est
fermé. Le daemon LIT la liste dans les tool parts des messages (le metadata de
chaque résultat porte `{ok, criteria, counts}`), via `daemon/src/criteria.mts`,
et la flotte n'affiche que ces lectures. La reprise automatique réinjecte la
liste connue dans la session neuve avec `criteria_import`.

## Outils

| Outil | Rôle |
|---|---|
| `criteria_list` | lit la liste (réfs, états, preuves, notes) ; ne déclenche rien |
| `criteria_add` | crée un critère `{title, detail?, methods[]}` ; démarre « à faire » |
| `criteria_remove` | retire `{ref}` ; la ref n'est jamais réattribuée (prochaine ref = max connu + 1) |
| `criteria_update` | modifie `{ref, title?, detail?, methods?}` ; un critère non « à faire » repasse « à faire » (preuve et jugement invalidés) |
| `criteria_to_validate` | soumet une preuve `{ref, evidence[]}` ; « à faire » ou « à corriger » devient « à valider » |
| `criteria_set_status` | juge `{ref, status, note}` : « validated » (note = ce qui a été vérifié) ou « to_fix » (raison obligatoire) |
| `criteria_import` | remplace la liste entière ; usage borné à la reprise automatique (le message de reprise porte la liste complète en JSON) |

Chaque critère porte au moins une méthode de validation : `unit_test`, `e2e`,
`browser_nav`, `screenshot`, `human`, `text`, `code_excerpt`, `artifact`,
`command`, `diff`, `doc`.

## Qui juge

L'agent de la tâche est son propre juge : plus de sous-agent vérificateur
(décision du 2026-11-12). Les instructions d'usage honnête vivent dans les
descriptions des tools : valider seulement après une vérification réelle,
raison obligatoire sur « à corriger », jamais de validation « pour avancer ».
Le propriétaire lit la liste, les preuves et les notes.

## Preuves

Preuve = `{kind, text, path?, start_line?, line_count?}` ; `screenshot`,
`code_excerpt` et `artifact` exigent un `path` de fichier existant du projet
(vérifié au dépôt PAR LE PLUGIN : chemin relatif, pas de sortie du projet, pas
de lien symbolique, fichier réel), `code_excerpt` exige `start_line` et
`line_count`. Le dossier projet vient de `context.directory` (le dossier de la
session OpenCode).

## Réinjection de contexte

Comme le plan, la liste est réinjectée en forme compacte (une ligne par
critère, plafonnée à 24) avant chaque requête modèle (`ctx.session.hook("context")`) :
elle survit à la compaction. Le détail complet reste dans `criteria_list`.

## Installation

Le chemin du dossier figure dans `~/.config/opencode/opencode.jsonc`
(`"plugins"`) : chargé globalement. Tout changement de la liste des plugins
exige un redémarrage d'OpenCode (leçon). Vérifier : `opencode api get
/api/plugin`, le plugin doit apparaître avec `"id": "superviseur-criteria"`.
