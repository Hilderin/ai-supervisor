# SuperviseurPlan

Plugin OpenCode v2 du repo Superviseur : restaure le plan par session et y ajoute les numéros et une mise à jour unitaire par numéro.

Migration du plugin `OpenCodeTodoList` (repo séparé, qui n'est plus référencé), puis renommage `todo*` → `plan-*` (2026-11-07) pour distinguer le plan (séquence d'étapes de la session de travail) des objectifs (goal, objective). Le fichier reste un ESM sans dépendance, chargé tel quel par OpenCode.

## Outils

| Outil | Rôle |
|---|---|
| `planwrite` | crée ou remplace le plan complet ; les éléments sont numérotés (1, 2, ...) |
| `planread` | relit le plan courant (numéroté) |
| `planupdate` | met à jour un ou plusieurs éléments **par numéro**, sans réécrire le plan |

`planupdate` prend `{ updates: [{ num, status?, content?, priority? }] }` : plusieurs mises à jour dans un appel évitent N appels successifs. L'état passé est validé strictement (`pending`, `in_progress`, `completed`) et le numéro doit exister ; si une mise à jour est invalide, rien n'est appliqué et le plan courant est renvoyé avec les erreurs.

`planwrite` reste l'outil de changement de plan ; `planupdate` sert à marquer `in_progress` / `completed` au fil de l'eau.

## Persistance et compaction

- plan stocké par session dans `ctx.storage` (KV durable du plugin) ;
- le plan ouvert est réinjecté avant chaque requête modèle via `ctx.session.hook("context")`, donc il survit à la compaction (balise `<plan_list>`).

## Renommage todo* → plan-* (compatibilité)

- le lecteur du daemon (`daemon/src/plan.mts`) accepte les deux générations de noms : les tool parts `todowrite` / `todoupdate` des sessions créées avant la bascule restent lus, et les deux clés de metadata (`todos`, ancienne ; `items`, nouvelle) sont acceptées ;
- le stockage du plugin est namespacé par id : une session déjà ouverte au moment de la bascule repart avec un plan vide pour le nouveau plugin (elle recrée son plan au premier appel).

## Installation (config globale OpenCode)

```jsonc
{
  "plugins": ["/home/guillaume/Documents/Projects/ai-supervisor/daemon/plugin/superviseur-plan"]
}
```

Vérifier le chargement : `opencode api get /api/plugin`, le plugin doit apparaître avec `"id": "superviseur-plan"`.

## Permissions

Les outils exposent les actions `planwrite`, `planupdate` et `planread` ; par défaut aucune permission n'est demandée.
