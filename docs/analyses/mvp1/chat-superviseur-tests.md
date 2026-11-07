# Chat de supervision : cas de tests de bout en bout

> Campagne du 2026-11-06. Chaque cas est joué contre l'instance réelle, avec captures dans le panneau navigateur ou via Playwright. Le statut est mis à jour au fur et à mesure. Un cas n'est `OK` que si le résultat visible dans le Superviseur correspond à l'attendu de `chat-superviseur.md`.

## Statuts

- `À faire`
- `En cours`
- `OK`
- `Échec`
- `Bloqué` (dépendance externe)

## Tableau de suivi

| # | Cas | Attendu | Statut | Feedback |
|---|---|---|---|---|
| C1 | Mise en page | Chat à gauche, flotte à droite, barre de page et barre de saisie absentes, pas de débordement à 1440 px | OK | Plus de logo, titre de page, « Masquer » ni Live ; le chat porte le titre. Chat 380, flotte 992, plus/panneau/flèche dans l'en-tête du chat. Poignée 320..480 mémorisée, onglets sous 1100. `layout-no-header.png` |
| C2 | État vide | Une phrase et une aide courte, aucun exemple, composer visible, aucun historique | OK | Aide seule, plus de suggestions ; composer actif, placeholder court, auto-grow jusqu'à 120 px, en-tête vert. `new-conversation-final.png`, `verify-ui2-composer.png` |
| C3 | Question générale | « météo de demain » ne crée aucune tâche au premier tour et n'appelle pas `start_task` ; elle propose une tâche de recherche | OK | Réponse « je n'ai pas la météo en direct, je peux lancer une tâche de recherche ; tu veux, et pour quelle ville ? », aucun `start_task`, aucune carte. `chat-c3-final.png` |
| C4 | Tâche explicite | `start_task` appelé, carte à droite, goal et brief stockés, récap court | OK | Deux tool chips, carte `Test E2E chat 98898`, récap court. `chat-c4.png` |
| C5 | Tâche ambiguë | L'agent pose une question et ne crée pas de tâche au premier tour | OK | Deux questions, aucun `start_task`, flotte inchangée. `chat-c5.png` |
| C6 | Progression par todo | La carte affiche `x/y` issu du `todowrite`, pas un pourcentage inventé | OK | `x/y` pendant le travail ; en TERMINÉ, `100 %` et le ratio reste en tooltip (plus de `2/3` avec barre pleine) ; fin de tour relancée par kick et verdict périmé masqué. `chat-c4.png`, `sub-b-c6-done.png` |
| C7 | État d'une tâche | « où en est X ? » utilise `list_tasks`/`get_task`, répond en deux phrases, pas de nouvelle tâche | OK | `get_task` force une lecture fraîche du `todowrite` (plus de « aucune étape » quand la carte affiche `1/3`) ; réponse courte, pas de tâche créée. `chat-c7-final.png` |
| C8 | `send_task` | Un ordre explicite envoie un texte ; une question en attente est annulée puis le texte part ; une permission reste bloquante | OK | Question annulée via `DELETE /form/:id`, texte envoyé, chip « a envoyé un message » ; « … a été annulée au passage ». Permission : chemin `waiting_human` non rejoué sur une vraie demande. `verify-chat-cancel.png`, `sub-c2-send-ok.png` |
| C9 | `close_task` | La tâche fermée disparaît de la flotte ; une activité ultérieure la rouvre | OK | Carte supprimée après `close_task` ; réouverture après réponse au formulaire. `chat-c9.png` |
| C10 | Exclusion du chat | La session de supervision n'apparaît pas dans la flotte et ne reçoit pas de compagnon | OK | Aucun `dir` `~/.superviseur` dans `/api/fleet` ; chat courant sans enfant |
| C11 | Persistance | Un rechargement de la page recharge le chat et la flotte sans perdre les messages | OK | Même fin de conversation après reload. `chat-c11-after.png` |
| C12 | Nouvelle conversation | Le bouton crée une nouvelle session, vide, et laisse l'ancienne dans OpenChamber | OK | Écran vide immédiat, nouvel id, 0 message, ancienne conservée. `new-conversation-final.png` |
| C13 | Repli du chat | L'icône de panneau masque le chat, un rail étroit le restaure, la flotte prend la largeur | OK | Chat absent, rail de 34 px, flotte 1354 px ; le rail rouvre le chat. `layout-no-header.png` |
| C14 | Erreur visible | Daemon/outil en échec : message d'erreur clair, aucun faux succès | OK | Envoi en panne : bandeau persistant, brouillon restauré, pas de bulle fantôme ; GET en panne : point gris/hors ligne. `verify-ui2-sendfail.png`, `chat-c14.png` |
| C15 | Sans todo | Une tâche sans `todowrite` n'affiche pas de barre de progression | OK | `todo` null, `progress` null sur « Test sans todo » |
| C16 | Doublon / plafond | Un doublon est refusé avec l'id existant ; le plafond est respecté | OK | Doublon refusé via le brief immédiat (pas seulement la flotte) ; daemon 5181 avec plafond 0 renvoie `limit` |
| C17 | Cartes existantes | Question, permission, composer et livraison fonctionnent toujours avec le chat ouvert | OK | Question, options, « Répondre » et « Annuler la question » ; bouton Répondre désactivé tant que rien n'est choisi. Permission non rejouée (bouton Autoriser inchangé). `sub-c-card-before.png`, `sub-c-card-after.png` |
| C18 | Fermeture sur attente | Fermer par le chat une tâche qui attend une question est refusé sans `force` ; avec `force`, la question est annulée et la fermeture journalisée | OK | `waiting_human` avec la question ; carte conservée ; confirmation carte puis `force` ferme et journalise l'abandon. `verify-card-close.png` |
| C19 | Annulation carte | Le bouton « Annuler la question » de la carte annule le formulaire et l'agent reprend sans réponse | OK | `DELETE /form/:id` via `/api/fleet/cancel-question` ; pendingForms vidé, carte toujours vivante. `verify-cancel-ui.png` |
| C20 | Recherche explicite | « cherche la météo à Montréal » lance une tâche de recherche dans `chats`, avec un goal et sans modification de fichier | OK | `start_task` direct, carte « Météo demain à Montréal » avec `chats` ; goal et critère de source datée. `weather-explicit.png` |
| C21 | Question de connaissance | Une question à laquelle l'agent peut répondre ne devient pas une tâche | OK | « Quelle est la capitale de la France ? » répond « Paris. », aucun nouvel outil, aucune carte. `knowledge-question.png` |
| C22 | Nouvelle sans LLM | L'icône `+` ne déclenche aucun tour LLM, n'affiche pas « le superviseur travaille », et vide le chat immédiatement | OK | `creating` séparé de `sending` ; écran vide à 150 ms, aucun `supervisor-busy`, 0 message, session créée en 0,4 à 1,3 s à chaud. `new-conversation-final.png` |

## Notes de campagne

- Les tests utilisent le vrai agent `superviseur-orchestrateur-<hash>` et de vraies sessions OpenChamber.
- Les tâches de test restent sans effet de bord : demander explicitement « ne modifie aucun fichier ».
- Nettoyage : fermer les tâches de test (`close_task` ou carte) et archiver les sessions de test dans OpenChamber.
- Captures principales : `/tmp/opencode/verify-ui2-*.png`, `sub-b-*.png`, `sub-c-*.png`, `chat-1280.png`.

## Revue indépendante

Quatre sous-agents ont rejoué les cas et produit des rapports séparés. Les défauts trouvés ont été corrigés et revérifiés.

| Série | Verdict | Défauts trouvés | Correctifs |
| --- | --- | --- | --- |
| C1, C2, C11, C12, C13, C14, C22 | OK après corrections | D1 statut « connexion… » sur session neuve ; D2 placeholder coupé ; D3 composer non auto-grow ; D4 horodatage utilisateur à gauche ; D5 composer actif pendant busy ; D6 erreur d'envoi effacée par le poll ; D7 frontière 1100 px incohérente ; D8 erreur collante ; D9 point vert hors ligne ; D10 poignée non accessible ; « Nouvelle » affichait un faux tour LLM et des suggestions | Statut inconnu traité comme idle ; placeholder court + auto-grow ; horodatage sous la bulle ; composer/Nouvelle désactivés en busy ; `sendError` séparé du poll ; une seule frontière 1100 ; bouton × et Réessayer ; point gris hors ligne ; poignée clavier + offset ; `creating` séparé, écran vide immédiat, suggestions retirées ; barre de page retirée, rail de réouverture, icônes + / panneau / flèche |
| C3, C20, C21, C5, C4, C6, C7 | OK après corrections | C3 refusait sec une info inaccessible ; C6 carte EN COURS avec `3/3` et résumé périmé pendant ~18 s ; C7 relayait un verdict périmé | C3/C20 : une info inaccessible propose ou lance une tâche de recherche dans `chats` ; C6 : kick de fin de tour non bloqué, verdict périmé masqué ; C7 : `get_task` frais |
| C8, C9, C17, C18, C19 | OK | « Répondre » sans sélection ne donnait aucun retour ; chip `send_task` non systématique ; fermeture sur attente perdait la question | Bouton désactivé tant qu'aucune réponse ; consigne « appelle réellement send_task » ; `send_task` annule la question ; `cancel_question` + bouton carte ; `close_task` refuse sauf `force` |
| C10, C15, C16 | OK | Doc/code divergeaient sur l'exclusion par dossier ; doublon immédiat pouvait créer deux sessions | Doc alignée sur l'exclusion du dossier ; garde `creating` + vérification dans `task_brief` avant la flotte |

## Régression finale et bascule de version

La passe finale du sous-agent a tourné pendant une bascule de code (daemon PID 106110, UI 18:32). Ses deux réserves C6/C7 ont été corrigées ensuite : libellé TERMINÉ cohérent (`100 %` au lieu de `2/3` avec barre pleine) et `get_task` qui force une lecture fraîche du `todowrite`. Les cas C8/C18/C19 ont été rejoués après reconstruction et redémarrage : `verify-forms.mjs`, `verify-chat-cancel.mjs`, `verify-card-close.mjs`. Le daemon final est celui qui contient `cancel_question`, `send_task` qui annule la question et `close_task` avec `force`.

Dernière vérification sur le build final : les quatre chemins A/B/C/D de `verify-forms.mjs` passent (envoi qui annule, annulation explicite, fermeture refusée puis forcée, bouton carte), `verify-chat-cancel.mjs` montre les réponses « question annulée au passage » et « la tâche reprend sans réponse », `verify-card-close.mjs` confirme la boîte de fermeture (annuler garde la carte, confirmer la retire). `verify-weather.mjs` montre la météo proposée puis lancée dans `chats` quand la demande est explicite ; `verify-knowledge.mjs` répond « Paris. » sans tâche ; `verify-new2.mjs` montre l'écran vide immédiat, sans indicateur de tour LLM, et la session créée à chaud en 0,4 à 1,3 s. `bun test daemon/test ui/src` : 110 pass. `bun daemon/test/companion-loop.mts` : 16/16. Capture finale : carte TERMINÉ à `100 %`, plus de `2/3` avec barre pleine.

## Réserves restantes

- **C9, latence de retrait** : après un `close_task` depuis le chat, la carte peut rester jusqu'au prochain frame de flotte (environ 3 s) alors que l'API la dit déjà absente. Ce n'est pas une erreur de contrat ; un retrait optimiste local serait un confort.
- **C17, permission** : le bouton « Autoriser » n'a pas été rejoué sur une vraie demande dans cette passe ; l'instance tourne en YOLO et le parcours d'approbation est hors scope ([permissions-yolo.md](permissions-yolo.md)).
- **C18/C19, annulation** : le bouton de carte et le chemin chat utilisent le même `DELETE` ; la confirmation `window.confirm` est un choix simple, remplaçable par une boîte maison si le rendu natif gêne.
- **Companion-loop** : `bun daemon/test/companion-loop.mts` est passé à 16/16 après la correction done ⇒ 100 sans plan.
- **Premier « Nouvelle » à froid** : après un redémarrage du daemon, la première création de session peut prendre quelques secondes (OpenCode initialise la session), même si l'écran est déjà vide et qu'aucun tour LLM n'est lancé. À chaud, la mesure est de 0,4 à 1,3 s. Pré-chauffer une session vide serait l'optimisation suivante si le froid gêne.

## Décisions d'implémentation

1. **Session de supervision** : session OpenChamber normale dans `~/.superviseur`, agent global versionné, plugin projet-local `superviseur-tools`.
2. **Confiance du dossier** : le daemon approuve l'empreinte du dossier via `/api/opencode/trust` avant de créer la session. Sans cela, OpenCode met le dossier en pause.
3. **Plugin** : projet-local, outils directs (`codemode: false`) ; l'agent a `openchamber*` et `execute` désactivés. Le daemon vérifie que l'appelant est bien la session de supervision.
4. **Exclusion** : tout le dossier `~/.superviseur` est hors flotte et hors compagnon ; les anciennes conversations restent dans OpenChamber mais ne polluent pas les cartes.
5. **Plan et progression** : le `todowrite` de la session de travail est la seule source ; le compagnon ne produit plus de plan. `busy` interdit TERMINÉ, une baisse à plan identique est refusée.
6. **Fin de tour** : un kick `end` (exécution terminée ou `session.idle`) n'est pas bloqué par l'intervalle de 20 s ; un verdict antérieur à la dernière activité est masqué en attendant le bilan.
7. **`start_task`** : session top-level sans `parentID`, brief stocké immédiatement ; doublon vérifié dans `task_brief` avant la flotte ; plafond par défaut 8.
8. **`send_task`** : seul outil d'écriture dans une tâche ; annule une question en attente puis envoie le texte ; une permission reste bloquante. `cancel_question` et le bouton de carte utilisent le même `DELETE /form/:id`. `close_task` refuse une attente sauf `force`. Pas de `reply_task`, pas de `merge_pr`.
9. **UI** : chat 380 px redimensionnable (320..480, mémorisé), onglets Chat/Tâches sous 1100 px, icône Envoyer identique aux cartes, erreurs d'envoi séparées du poll, auto-grow 120 px.
10. **Tests** : 110 tests unitaires UI/daemon, campagnes Playwright et quatre revues indépendantes.

## Questions à trancher

1. **Web** : le chat n'a pas d'outil web direct (phase 1). Une information inaccessible propose désormais une tâche de recherche, lancée dans `chats` quand elle est explicite. Confirmer que cette délégation est le comportement attendu, plutôt qu'un outil web direct dans le chat.
2. **Anciennes conversations** : le daemon ne les archive pas automatiquement quand l'agent change ; elles restent dans OpenChamber et sont exclues par dossier. Faut-il les archiver ou offrir un historique des conversations de supervision ?
3. **`close_task` pendant un tour busy** : la carte disparaît mais la session peut continuer. Faut-il bloquer la fermeture tant que la session est busy, ou laisser le geste humain ?
4. **`send_task` et formulaires** : on annule la question puis on envoie le texte (comme OpenChamber) ; une permission reste bloquante. Confirmer que c'est bien le comportement attendu et que l'annulation de question doit rester aussi accessible par le bouton de la carte.
5. **Plafond** : 8 tâches actives par défaut. À ajuster à l'usage.
6. **Modèle de l'orchestrateur** : le modèle actuel répond en 7 à 12 s. Garder ce compromis ou tester un modèle plus rapide ?
7. **Ancien plan du compagnon** : le champ `plan` reste toléré dans le JSON mais ignoré. Le retirer complètement du contrat à la prochaine migration ?
