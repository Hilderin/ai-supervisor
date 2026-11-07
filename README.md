# Superviseur

Interface web locale pour suivre les tâches lancées dans OpenChamber. Le daemon découvre le port local d'OpenChamber ; l'UI est servie sur `http://127.0.0.1:5180/fleet`.

## Lancer le Superviseur

```bash
bun run build:ui
bun run start
```

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
