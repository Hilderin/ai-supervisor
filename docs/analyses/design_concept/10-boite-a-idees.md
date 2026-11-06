# Boîte à idées

Idées et suggestions en vrac, à creuser (ou non) plus tard. Rien d'engagé ici : une idée peut être ajoutée en deux lignes, puis promue vers un doc de conception si elle tient.

## Idées

### Envoyer des instructions pendant qu'une tâche travaille

Comme le fait OpenChamber : pouvoir envoyer un message à une session **même quand sa tâche est en cours d'exécution**, sans attendre qu'elle se termine ou qu'elle pose une question.

Deux modes d'envoi :

- **Mode « queue »** : le message est mis en file et sera traité par la session dès qu'elle a fini son tour actuel. Pour les demandes qui peuvent attendre (« ensuite, ajoute aussi un test », « quand tu as fini, commit »).
- **Mode « send direct »** : le message part immédiatement dans la conversation en cours. Pour les corrections de cap (« non, pas ce fichier », « arrête, change d'approche ») — utile justement quand on voit la tâche partir dans la mauvaise direction depuis le Superviseur.

Implications à creuser :

- Dans l'UI : comment distinguer visuellement les deux modes (champ unique avec un toggle ? deux boutons d'envoi ?) sans que ce soit un geste compliqué.
- Comment représenter la file d'attente d'une session (les messages en attente sont-ils visibles ? annulables ? réordonnables ?).
- Ce que l'API OpenCode server / OpenChamber permet réellement pour injecter un message dans une session active (voir doc 05).
- Lien avec le concept de « débloquer » du doc 04 : le send direct est le cas général de « répondre à une question bloquante ».
