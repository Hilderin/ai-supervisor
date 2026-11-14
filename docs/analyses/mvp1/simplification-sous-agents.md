# Simplification : retrait des sous-agents, critères auto-gérés (2026-11-12)

## Décision

Après plusieurs semaines d'utilisation multi-projets, le propriétaire constate
que les deux sous-agents (compagnon analyste, vérificateur des critères)
n'apportent pas grand chose : ils polluent les conversations (sessions enfants
visibles dans OpenChamber, notifications `[superviseur]` dans les tâches) et
coûtent des tours de modèle. Ce qui aide vraiment : le plan (`planwrite`) et
les critères d'acceptation. Décision :

1. **Le compagnon (analyste) est retiré.** Plus de verdict, plus de résumé ni
   d'attente reformulée sur les cartes. Les informations utiles restent : plan
   (`planwrite`), critères, activité (SSE), livraison (dernier message),
   formulaires et permissions.
2. **Le vérificateur est retiré.** L'agent de la tâche est son propre juge :
   un nouveau tool `criteria_set_status` (plugin `superviseur-criteria`) porte
   `validated` ou `to_fix` avec une note obligatoire sur le refus. Les
   instructions d'usage honnête vivent dans la description du tool et dans le
   prompt initial de la tâche (pas de vérificateur extérieur à qui « se
   soumettre »). `criteria_to_validate` reste la seule porte vers « à valider »
   (une preuve est exigée).
3. **La bascule de supervision est retirée** (route `/api/fleet/supervision`,
   table lue `supervision`, badge et menu de carte, préférence
   `companion_model`). Sans sous-agents, il n'y a plus rien à activer.
4. **L'encadrement OWNER_WRAP est retiré** : les messages du propriétaire
   partent tels quels (chat, `send_task`, `/api/fleet/send`). Les consignes
   plan/critères/answer vivent dans le prompt initial de la tâche
   (`composePrompt`). `stripOwnerWrap` reste pour dépouiller l'historique.
5. **Les tools de flotte sont disponibles à TOUTE session** : nouveau plugin
   global `superviseur-fleet` (list_projects, list_tasks, get_task, start_task,
   send_task, cancel_question, close_task). Le plugin projet-local `superviseur`
   du chat ne garde que les lectures bornées d'investigation
   (read/glob/grep_project). Le daemon accepte ces tools de n'importe quelle
   session (plus de garde `not_supervisor` dessus) : depuis une discussion
   quelconque, un agent peut démarrer une tâche ou lui parler.

## État « terminé » déterministe

Sans verdict, la carte est TERMINÉE quand, et seulement quand :

- la session est au repos (pas busy, rien en attente) ;
- le plan est posé et à 100 % (`planwrite`) ;
- tous les critères définis sont validés.

> Amendement du 2026-11-14 (retour du propriétaire) : les critères sont
> facultatifs. Sans critère défini, le plan à 100 % suffit (`criteriaSatisfied`
> de `ui/src/lib/fleet.ts`) ; des critères définis doivent tous être validés.
> Voir [chat-superviseur.md](chat-superviseur.md) section 18.4.

Au repos sans ça (plan incomplet, absent, ou critères non validés), la carte
passe en **warning** (« à compléter ») : icône triangle orange et détail des
manques (étapes, critères). L'étoile mauve de « fini, à valider » disparaît.
L'hystérésis de section (8 s) est conservée : l'état est déterministe mais peut
rebondir quand l'agent ajoute un critère à la fin.

## Nettoyage du système vivant

- `daemon/scripts/purge-subagents.mts` : archive les sessions enfants connues
  des mappings et vide `companion_map`, `verifier_map`, `task_verdict` (exécuté
  une fois sur les deux bases, vivante et dev : 274 sessions archivées).
- Symlinks d'agents `superviseur-analyste*.md` et `superviseur-verificateur.md`
  retirés de `~/.config/opencode/agent`.
- `opencode.jsonc` : le plugin global `superviseur-verifier` est remplacé par
  `superviseur-fleet` (redémarrage d'OpenCode requis pour la nouvelle liste).

## Ce qui ne change pas

Le plan (plugin `superviseur-plan`), le tool `answer`, le tool `question`, la
livraison inline, l'auto-restart, le plafond de tâches, le mode Investigation.
