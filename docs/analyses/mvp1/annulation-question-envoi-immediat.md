# Envoi pendant une question en attente : annulation et envoi immédiat (2026-11-10)

## Problème

Quand une session (le chat de supervision ou une tâche de la flotte) attend la
réponse à une question du tool `question`, un message du propriétaire était mis
en file d'attente OpenChamber : le tour est `busy` (le tool question est
`pending`), donc l'UI file le message, et la file n'est livrée qu'au retour
idle. Or la session ne revient jamais idle tant que la question attend : le
message pourrissait la file au lieu de remplacer la question.

## Décisions

- **Une question en attente est remplacée par le message, jamais complétée.**
  L'envoi annule le formulaire (`DELETE /api/session/:id/form/:formId?message=…`,
  le même geste qu'OpenChamber) puis part tout de suite en `delivery: 'steer'`.
- **La décision vit côté daemon**, pas seulement dans l'UI :
  - `sendSupervisor` (chat) lit `statusSnapshot` : s'il y a des formulaires
    `question` en attente, il les annule puis POST le prompt avec
    `delivery: 'steer'` (le tour peut être busy après la reprise de l'agent).
    Les permissions ne sont jamais annulées par un envoi de message.
  - `/api/fleet/send` (panel de détail) et `send_task` (chat → tâche)
    appliquaient déjà ce geste : `pendingFor` + `cancelPendingForms`, envoi
    steer, trace `question annulée par message : …` au journal de la tâche.
- **Côté UI (store du chat)** : `send()` ne met en file que si le tour est busy
  SANS question en attente. Quand `pendingForms` n'est pas vide, le message
  part immédiatement (le daemon annule). Le pied du composer et le title du
  bouton disent le sens : « Une question attend : Envoyer annule la question et
  part tout de suite. »
- **File d'attente : boutons Modifier et Envoyer maintenant, comme
  OpenChamber.** OpenChamber fait « Envoyer » = `take` + prompt steer, et
  « Modifier » = `take` + retour au composer. Le daemon expose
  `POST /api/supervisor/queue/take` qui appelle la route
  `POST /api/message-queue/sessions/:id/items/:itemId/take` d'OpenChamber
  (elle retire l'item et renvoie son contenu COMPLET, pièces jointes incluses).
  Le texte renvoyé est dépouillé de l'encadrement (`stripOwnerWrap`) pour
  qu'un renvoi ou un brouillon ne soit pas wrappé deux fois.
- **Actions du store** : `sendQueued` (take puis envoi immédiat, chemin
  `immediate`) et `editQueued` (take puis brouillon + pièces jointes).
  L'état courant est relu AU MOMENT du set : un poll plus frais pendant
  l'attente du take ne doit pas être écrasé.

## Sémantique steer à connaître

Un steer admis pendant un tour est promu au PROCHAIN pas de l'agent
(`SessionInput.promoteSteers` d'OpenCode, appelé au début de chaque tentative
de tour). Concrètement : après l'annulation de la question, l'agent reprend et
lit le message à son pas suivant. Un modèle peut reposer une question en course
avant de lire le steer ; le message reste admis et sera livré, mais un
questionnement en boucle peut élever le bruit. Ce n'est pas un défaut du
chemin d'envoi.

## Tests

- `daemon/test/supervisorSendCancel.test.mts` : annulation + steer + trace
  journal au chat ; chemin normal sans `delivery` ni DELETE quand aucune
  question n'attend ; `takeQueuedSupervisor` (texte dépouillé + pièces jointes).
- `daemon/test/sendTaskCancel.test.mts` : harnais flotte ; `sendTask` annule la
  question, envoie en steer, trace au journal de la TÂCHE ; aucun DELETE sans
  question en attente.
- `ui/src/store/supervisorStore.test.tsx` : question en attente = envoi direct
  (jamais la file) ; `sendQueued` = take puis `/api/supervisor/send` ;
  `editQueued` = take puis brouillon restauré, item retiré de la liste ;
  `ComposerActions` annonce l'annulation quand une question attend.
