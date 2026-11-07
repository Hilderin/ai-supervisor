# SuperviseurTodoList

Plugin OpenCode v2 du repo Superviseur : restaure la todolist par session et y ajoute les numéros et une mise à jour unitaire par numéro.

Migration du plugin `OpenCodeTodoList` (repo séparé, qui n'est plus référencé) ; le fichier reste un ESM sans dépendance, chargé tel quel par OpenCode.

## Outils

| Outil | Rôle |
|---|---|
| `todowrite` | crée ou remplace la liste complète ; les éléments sont numérotés (1, 2, ...) |
| `todoread` | relit la liste courante (numérotée) |
| `todoupdate` | met à jour un ou plusieurs éléments **par numéro**, sans réécrire la liste |

`todoupdate` prend `{ updates: [{ num, status?, content?, priority? }] }` : plusieurs mises à jour dans un appel évitent N appels successifs. L'état passé est validé strictement (`pending`, `in_progress`, `completed`) et le numéro doit exister ; si une mise à jour est invalide, rien n'est appliqué et la liste courante est renvoyée avec les erreurs.

`todowrite` reste l'outil de changement de plan ; `todoupdate` sert à marquer `in_progress` / `completed` au fil de l'eau.

## Persistance et compaction

- liste stockée par session dans `ctx.storage` (KV durable du plugin) ;
- la liste ouverte est réinjectée avant chaque requête modèle via `ctx.session.hook("context")`, donc elle survit à la compaction.

## Installation (config globale OpenCode)

```jsonc
{
  "plugins": ["/home/guillaume/Documents/Projects/ai-supervisor/daemon/plugin/superviseur-todolist"]
}
```

Vérifier le chargement : `opencode api get /api/plugin`, le plugin doit apparaître avec `"id": "superviseur-todolist"`.

## Permissions

Les outils exposent les actions `todowrite`, `todoupdate` et `todoread` ; par défaut aucune permission n'est demandée.

## Note de migration

Le stockage est propre à chaque plugin : une session déjà ouverte au moment de la bascule repart avec une liste vide pour le nouveau plugin (elle recrée son plan au premier appel).
