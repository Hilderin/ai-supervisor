# Intégration du mini chat OpenChamber en iframe : faisabilité

Étude initiale du 2026-11-07, avant tout changement d'UI. Verdict : **partiel**. Le mini chat et son ciblage par conversation existent, mais la politique CSP de l'instance réelle interdit son cadrage depuis le Superviseur.

## Contexte et méthode

- OpenChamber Desktop 2.6.1, instance HTTP locale `http://127.0.0.1:57123`.
- Superviseur web courant `http://127.0.0.1:5180/fleet`.
- Inspection du checkout OpenChamber (`packages/web`, `packages/ui`), requêtes HTTP aux deux services, ouverture du mini chat dans un navigateur sur une session réelle de supervision et tentative d'iframe depuis une page réellement servie par le Superviseur.
- Aucun redémarrage ni changement de configuration de l'instance OpenChamber pendant l'étude.

## Résultats

| Sujet | Observation | Verdict |
|---|---|---|
| Page mini chat | `GET /mini-chat.html` renvoie 200. L'entrée est `packages/web/mini-chat.html`, montée par `packages/web/src/mini-chat-main.tsx` dans `ElectronMiniChatApp`, puis `MiniChatLayout`. | Faisable |
| Ciblage session | `?mode=session&sessionId=ses_…` est lu par `ElectronMiniChatApp.tsx`, puis sélectionne la session après chargement du store. Le lien a ouvert la vraie session Superviseur, transcript et composer compris. Le même paramètre permet de viser les sessions des cartes. | Faisable |
| CSP / X-Frame-Options | Les réponses `/` et `/mini-chat.html` ne renvoient pas `X-Frame-Options`. Sur la configuration initiale, elles renvoyaient `Content-Security-Policy: frame-ancestors 'self' openchamber-ui://app capacitor://localhost https://localhost`. L'origine du Superviseur `http://127.0.0.1:5180` était absente : la politique bloquait l'iframe directe. | Bloqué sur la configuration initiale, débloqué après configuration |
| Option de configuration | Le serveur du checkout calcule cette politique dans `packages/web/server/lib/security/request-security.js` et ajoute les origines configurées par `OPENCHAMBER_FRAME_ANCESTORS`. Le serveur installé doit être relancé avec `http://127.0.0.1:5180` autorisé. Cette variable ne change pas la politique de l'instance déjà lancée. | Faisable avec configuration et redémarrage |
| Cookies / session | Le mini chat ciblé s'ouvre dans le navigateur sans écran de connexion sur cette instance. Le mode protégé par mot de passe n'a donc pas été vérifié. Les deux URL ont le même schéma et hôte, avec des ports distincts : elles sont de même site pour les cookies, mais d'origines différentes pour la CSP. | Partiel, auth protégée à retester |
| Fermeture et contrôles | `MiniChatLayout` n'a pas de bouton web de fermeture. Le panneau parent propose un retour au chat du Superviseur ou au détail de tâche. Les actions natives du mini chat restent propres à sa coque. | Implémenté, fermeture vérifiée |
| Console / source maps | Aucune erreur source map sur le chargement de la session valide. Le test avec un id invalide a donné les erreurs API attendues (`session.get` 400). La page de test servie sur `http://127.0.0.1:5180` a tenté de cadrer le mini chat et Chromium a confirmé : `Framing 'http://127.0.0.1:57123/' violates ... frame-ancestors ... The request has been blocked.` | Blocage CSP reproduit dans le navigateur |

## Décision de phase

L'URL de session est validée. Sur la configuration initiale, l'iframe directe ne fonctionnait pas : le blocage venait d'une règle de sécurité explicite du serveur, pas du mini chat.

La voie la plus petite est d'autoriser explicitement `http://127.0.0.1:5180` via `OPENCHAMBER_FRAME_ANCESTORS` et de relancer OpenChamber. Le propriétaire a validé cette voie. La première itération proposait le mini chat en remplacement du panneau gauche ; le navigateur a confirmé le blocage CSP tant que l'origine n'était pas autorisée. Le daemon a ensuite été relancé et l'endpoint construit le lien à partir du port OpenChamber découvert.

Le premier redémarrage a changé le PID, mais la CSP est restée inchangée. Après une nouvelle relance avec la variable configurée, l'en-tête comprend `http://127.0.0.1:5180` et l'iframe charge le mini chat. L'environnement du processus Electron principal ne contenait toujours pas la variable, donc **l'en-tête HTTP effectif est la source de vérité**, pas le seul environnement de ce processus. Le navigateur n'a plus d'erreur CSP ni d'erreur source map ; deux alertes bénignes `ResizeObserver loop completed with undelivered notifications` proviennent de l'iframe OpenChamber.

OpenChamber héberge aussi le processus OpenCode qui exécute la session de travail ; le redémarrer au milieu d'un tour peut interrompre celui-ci.

## Retour propriétaire et placement final

Le propriétaire a confirmé que la première itération fonctionnait. Il a demandé à préserver le chat du Superviseur lorsqu'un mini chat OpenChamber s'ouvre. Décision validée : panneau dédié à droite du détail de tâche ; le chat du Superviseur reste visible si la largeur suffit, se replie automatiquement sinon, et se restaure à la fermeture uniquement s'il avait été replié par cette ouverture. La version révisée a été buildée et vérifiée manuellement dans le navigateur : liens du Superviseur, de la carte et du détail, panneau à droite, repli et restauration. Le propriétaire doit encore essayer cette disposition révisée.

## Sources

- OpenChamber : `packages/web/server/index.js`, `packages/web/server/lib/security/request-security.js`, `packages/web/mini-chat.html`, `packages/web/src/mini-chat-main.tsx`, `packages/ui/src/apps/ElectronMiniChatApp.tsx`, `packages/ui/src/components/mini-chat/MiniChatLayout.tsx`.
- Superviseur : `ui/src/components/SupervisorChat.tsx`, `ui/src/components/SessionCard.tsx`, `ui/src/components/TaskInspector.tsx`, `docs/analyses/mvp1/implementation-ui-react.md`.
