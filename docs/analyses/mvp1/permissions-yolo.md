# Permissions : mode YOLO, à traiter plus tard

> Décision du 2026-11-06 : l'instance tourne en mode YOLO. On ne développe pas le parcours d'approbation des permissions maintenant. Le code existant reste en place pour plus tard, mais aucun travail de permission n'est engagé dans le MVP du chat de supervision.

## Ce qui existe déjà

- `/api/sessions/status` expose `pending[sessionId].permissions` en plus des formulaires. La flotte les connaît déjà.
- La carte affiche « Permission demandée » et un bouton « Autoriser » (`decision: once`) quand `pendingPermissions` est non vide.
- `POST /api/fleet/reply` relaie une décision vers OpenChamber (`/api/session/:id/permission/:requestID/reply`).
- `send_task` refuse une tâche qui attend une permission et renvoie `waiting_human` : on n'annule pas une autorisation comme une question.
- `close_task` refuse une attente sauf `force` explicite.

## Pourquoi on ne va pas plus loin maintenant

- En YOLO, l'agent ne demande pas de permission : le cas est rare ou inexistant.
- Le chemin n'a jamais été exercé sur une vraie demande de permission. Le bouton et le proxy sont testés sur flotte factice, pas en conditions réelles.
- Un parcours d'approbation demande des choix de sécurité (once / always / reject, portée par agent, audit) qui ne sont pas nécessaires pour le chat de supervision.
- Le chat ne doit pas simuler une réponse à une permission avec du texte libre. Une permission est une décision structurée, pas une conversation.

## À faire plus tard

1. Provoquer une vraie demande de permission sur une session jetable, avec YOLO désactivé, et vérifier la carte, le bouton, la décision et la reprise.
2. Décider des portées : `once`, `always`, `reject`, et éventuellement « toujours pour cet agent » ou « pour cette tâche ».
3. Ajouter une trace d'audit : qui a autorisé, quoi, quand, et pour quelle session.
4. Décider si le chat peut répondre à une permission sur ordre explicite, ou si la carte reste le seul canal. Recommandation actuelle : la carte reste le canal.
5. Décider si le Superviseur peut basculer YOLO par tâche ou par agent, et où l'afficher.
6. Vérifier que l'auto-accept d'OpenChamber et le bouton du Superviseur ne se contredisent pas.

## Ce qu'il ne faut pas faire

- Ne pas annuler une permission avec `DELETE /form/:id` : ce endpoint concerne les questions, pas les autorisations.
- Ne pas répondre « oui » à une permission depuis `send_task` sans ordre explicite et sans montrer la demande.
- Ne pas afficher une attente de permission si `pendingPermissions` est vide. En YOLO, la carte ne doit pas inventer une alerte.

## Références

- [Chat de supervision](chat-superviseur.md) : `send_task`, `cancel_question`, `close_task`, permissions.
- [Tests du chat](chat-superviseur-tests.md) : C8 et C17, permission non rejouée.
- [Objectif MVP1](objectif-mvp1.md) : capacité 3, chemin permission.
- [UI React](implementation-ui-react.md) : rendu de la boîte permission.
