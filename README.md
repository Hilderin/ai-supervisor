# Superviseur

Interface web locale pour suivre les tâches lancées dans OpenChamber. Le daemon découvre le port local d'OpenChamber ; l'UI est servie sur `http://127.0.0.1:5180/fleet`.

## Lancer le Superviseur

Installer les dépendances de l'UI avant le premier build (et après un changement
de `ui/package.json`) :

```bash
bun install --cwd ui
bun run build:ui
bun run start
```

Sur Windows, la découverte du port d'OpenChamber ne fonctionne pas (`ss` absent
du PATH) : passer le port explicitement, par exemple
`OPENCHAMBER_PORT=57123 bun run start` (le port du process principal
`OpenChamber.exe` se lit avec `Get-NetTCPConnection -OwningProcess <pid>` ; il
est auto-alloué, à revérifier à chaque redémarrage d'OpenChamber).

## Installer les plugins OpenCode

Les outils du Superviseur vivent dans des plugins OpenCode chargés globalement
(`~/.config/opencode/opencode.jsonc`, clé `plugins`) :

| Plugin | Rôle |
| --- | --- |
| `superviseur-plan` | plan de tâche par session (`planwrite` / `planupdate` / `planread`) ; remplace l'ancien plugin `OpenCodeTodoList`, à retirer de la config |
| `superviseur-task` | tool `answer` : réponse d'une tâche visible dans le Superviseur |
| `superviseur-criteria` | critères d'acceptation d'une tâche (`criteria_add` / `criteria_to_validate` / ...) |
| `superviseur-verifier` | lectures bornées du vérificateur (conversation, tool calls, artefacts) |

```jsonc
"plugins": [
  "<repo>/daemon/plugin/superviseur-plan",
  "<repo>/daemon/plugin/superviseur-task",
  "<repo>/daemon/plugin/superviseur-criteria",
  "<repo>/daemon/plugin/superviseur-verifier"
],
```

Remplacer `<repo>` par le chemin du clone (exemples des README des plugins).
Le cinquième plugin, `superviseur` (outils du chat de supervision), est installé
automatiquement par le daemon en projet-local dans `~/.superviseur` : ne pas le
mettre dans la config globale.

Après tout changement de cette liste, **redémarrer OpenCode** (leçon : la liste
des plugins n'est lue qu'au démarrage, `/api/location/reload` ne la recharge
pas). Vérifier que le plugin est chargé : `opencode api get /api/plugin`, il
doit apparaître avec son `id` (ex. `"superviseur-criteria"`).

## Autoriser le mini chat OpenChamber en iframe

Le mini chat OpenChamber s'ouvre dans le panneau latéral du Superviseur. OpenChamber doit autoriser l'origine web du Superviseur dans sa CSP `frame-ancestors`.

Avec le port Superviseur par défaut :

```bash
OPENCHAMBER_FRAME_ANCESTORS='http://127.0.0.1:5180' \
  /chemin/vers/OpenChamber.AppImage --no-sandbox
```

Définir cette variable dans l'environnement qui lance OpenChamber, puis redémarrer complètement l'application. Remplacer l'origine par celle réellement utilisée si le port ou l'hôte du Superviseur change. Si plusieurs origines sont nécessaires, les séparer par des espaces ou des virgules. N'autoriser que les origines de confiance ; ne pas utiliser `*`.

Pour vérifier que la configuration est appliquée, lire l'en-tête HTTP de la page mini chat :

```bash
port="$(ss -tlnp | sed -n '/"openchamber"/s/.*127\.0\.0\.1:\([0-9][0-9]*\).*/\1/p' | head -n1)"
curl -sI "http://127.0.0.1:${port}/mini-chat.html" \
  | grep -i content-security-policy
```

La directive `frame-ancestors` doit contenir `http://127.0.0.1:5180`. Vérifier cet en-tête après chaque redémarrage : un changement de PID ne suffit pas à confirmer que la CSP a été mise à jour.
