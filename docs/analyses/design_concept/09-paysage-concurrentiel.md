# 09 — Paysage concurrentiel : produits et repos existants (nov. 2026)

Recherche des produits et repos GitHub similaires au Superviseur, en complément de la recherche académique (doc 07). Le domaine bouge vite ; un annuaire communautaire suit l'ensemble (yetanotherorchestrator.app) — à relire en continu.

## 1. L'essentiel en une phrase

Le marché est **saturé côté orchestration** (lancer des agents en parallèle, isoler, reviewer, merger) et **presque vide côté supervision de l'attention** (triage, mémoire déclarée, vérification de clôture) — qui est exactement le cœur du concept.

## 2. Produits desktop orchestratrices

| Produit | Nature | Licence / prix | Couverture des douleurs |
| --- | --- | --- | --- |
| Conductor (Melty Labs, YC S24) | macOS natif ; Claude Code / Codex / Cursor / OpenCode en workspaces isolés, review + merge ; cloud + iOS en Pro ($50/mois) | Propriétaire, gratuit | Couvre partiellement P1, P9 ; pas de triage, mémoire ni vérification |
| Superset | Desktop agent-agnostic, workspaces remote + cloud, CLI + SDK + MCP | Elastic License 2.0, Pro $20/seat/mois | Le plus complet des rivaux ; supporte OpenCode ; toujours orienté « lancer + review » |
| Sculptor (Imbue) | Conteneurs + « Pairing Mode » (l'agent travaille hors checkout, sync vers le repo local) | Open source, beta gratuite | Centré Claude Code + Pi ; ne touche pas P11/P12 |
| Orca / Emdash / Nimbalyst | ADE open source multi-plateforme ; Emdash : 34 agents CLI, intake Linear/Jira/Notion/Asana, runs planifiés avec historique | MIT / Apache-2.0 | Couvrent « commencer » (P9) et l'isolation ; pas le triage ni la mémoire |
| Claude Code desktop (Anthropic) | Parallélisme natif, worktree option, diff, browser pane, SSH | Propriétaire | Claude Code uniquement |
| Claude Squad / Herdr / cmux | Terminal-first : tmux + worktrees ; Herdr a sidebar de statut + socket API + plugins | Open source (AGPL / Apache / GPL) | Multiplexeurs simples ; aucune couche sémantique |
| Vibe Kanban (BloopAI) | Kanban pour agents (26k étoiles GitHub, supporte OpenCode) | Apache-2.0 | **Annonce son sunset** ; kanban de planification, pas de supervision de l'attention |

## 3. Dashboards open-source GitHub (famille Claude Code)

Tous positionnés pareil (« monitor multiple Claude Code sessions »), tous **Claude Code uniquement**, locaux :

- **futin/claude-agents-dashboard** — le plus proche conceptuellement : monitor live (status, branche, contexte, tool en cours) lu directement des transcripts JSONL, et **réponses aux questions / rejets de plans / approbations depuis le navigateur ou le téléphone**. Se présente comme « monitor » et précise qu'il ne prouve pas la complétion ; pas de mémoire, pas de goals.
- Autres, très équivalents entre eux : trillion-labs/claude-code-orchestrator, amahpour/claude-code-command-center, AnimaNigra/ClaudeAgentOrchestrator, Stargx/claude-code-dashboard, yxwucq/CCUI (multi-worktree), gabinfay/claude-session-manager (auto-kill à 170 k tokens + skill de rétro justement pour « persister l'état »), ClickHouse/multiagent-terminal.
- **Apprentissage commun** : tous dérivent leur état des transcripts JSONL sur disque, sans API server (les CLIs n'en ont pas). Notre avantage structurel : OpenChamber expose une vraie API (doc 05) — pas besoin de parser les transcripts, mais la contrainte d'« indexer au vol » reste (doc 05 §11.3).

## 4. Côté OpenCode / OpenChamber

- **OpenChamber lui-même**, notre socle, expose déjà (doc 05) : statuts (working/waiting/finished/failed), **approvals**, scheduled tasks, Session Goals (avec runtime de continuation automatique), notes/todos/plans, notifications natives (desktop, push VAPID, APNs iOS), apps iOS/Android.
  ⚠️ Conséquence : nos douleurs P1, P5, P10 sont **partiellement couvertes par l'outil même que nous supposons insuffisant**. Le Superviseur devra démontrer sa valeur sur le « presque bon » d'OpenChamber, pas seulement dans le vide.
- **opencode-observability** (`npx opencode-observability`) : observabilité locale OpenCode-native (cartes live avec timeline 5 min, recherche transverse, replay de sessions, métriques tokens/erreurs). Observabilité pure, zéro action possible — pas un concurrent direct, mais un point de repère pour le monitoring.
- Deux issues OpenChamber notables, qui documentent nos douleurs dans leur propre tracker :
  - **#1441** — les sessions créées par le CLI OpenCode direct n'apparaissent pas dans OpenChamber (découverte limitée au serveur connecté) ;
  - **#2097** — stalling de sessions en boucle à 6+ parallèles sur un seul serveur ; réponse officielle : pas de scheduler ni d'équité builtin, une session par process CLI pour les boucles.

## 5. Synthèse : qui couvre quoi (les 6 axes de la vision, doc 01 §2)

| Axe de la vision | Qui le couvre aujourd'hui | Dégagement |
| --- | --- | --- |
| **Voir** — la flotte | OpenChamber, opencode-observability, tous les dashboards | Zone la moins différenciante |
| **Commencer** — point unique de lancement | Conductor, Superset, Vibe Kanban, Emdash | Concrètement traité, mais jamais relié au goal ni aux conventions |
| **Débloquer** — répondre sans changer de contexte | futin/claude-agents-dashboard (Claude Code only), OpenChamber (approvals) | Peu couvert multi-projets ; pas de triage priorisé |
| **Se rappeler** — mémoire déclarée | **Rien** (la « mémoire » des produits = réinjection de prompt, jamais éditable par l'humain) | **Vide** |
| **Piloter les machines** — tâches planifiées | Emdash (runs + historique), OpenChamber (cockpit sans historique) | Historique manquant côté OpenChamber (doc 05 §7) |
| **Vérifier** — clôture contre le goal | **Rien** ; Conductor consent explicitement « does not prove completion » | **Vide** — le trou de ParallelPilot §7 reste un trou produit |

## 6. Conséquences pour le design

1. **Différenciation assumée** : triage de l'attention (P5, P12 — digest, budgets d'interruption, snooze/escalade, DND par tâche, doc 07 §7) + mémoire déclarée (P8, doc 07 §9) + vérification de clôture (Parcours D). Trois axes que **aucun produit existant** ne couvre ensemble.
2. **Ne pas refaire l'écosystème** : le Superviseur réutilise OpenChamber, ne le remplace pas (règle doc 01 : aucun IDE, chat UI ni diff viewer) — pas d'orchestration d'exécution, pas de terminal, pas de kanban house.
3. **Cibler le MVP** : prioriser les axes « Vide » ou « Peu couvert » du tableau §5 (Débloquer, Se rappeler, Vérifier). Les axes déjà bien couverts (Voir brut, review/merge) restent un chemin vers OpenChamber.
4. **Apprentissages pratiques** :
   - la lecture JSONL des dashboards Claude Code confirme la nécessité d'indexer au vol côté WS, pas de re-lire après coup — déjà posé doc 05 §11.3 ;
   - l'auto-kill 170 k + skill « session retro pause » de gabinfay illustre le besoin d'extérioriser la mémoire avant la perte (doc 07 §9) ;
   - le sunset de Vibe Kanban rappelle la fragilité des orchestrators = le Superviseur s'adosse à l'outil qui existe plutôt que d'en réimplémenter un septième.

## Sources principales

- Conductor : docs.conductor.build ; fiche Continuum (2026-08, 4 harnesss dont OpenCode)
- Superset, Sculptor : superset.sh/compare (pages mises à jour oct. 2026)
- Orca, Emdash, Nimbalyst, Herdr, cmux : superset.sh/compare/conductor-alternative, superset.sh/compare/claude-squad-alternative
- Dashboards cités : github.com/futin/claude-agents-dashboard, trillion-labs/claude-code-orchestrator, amahpour/claude-code-command-center, AnimaNigra/ClaudeAgentOrchestrator, Stargx/claude-code-dashboard, yxwucq/CCUI, gabinfay/claude-session-manager, ClickHouse/multiagent-terminal
- Terminal : github.com/smtg-ai/claude-squad (AGPL-3.0) ; Herdr (Apache-2.0) ; cmux (GPL)
- Kanban : github.com/BloopAI/vibe-kanban (sunsetting) ; github.com/OAI-Labs/vibe-flow
- OpenCode : github.com/aymazon/opencode-observability ; openchamber issues #1441, #2097
- Annuaire : yetanotherorchestrator.app
