# 09 — Paysage concurrentiel : produits et repos existants (nov. 2026)

Recherche des produits et repos GitHub similaires au Superviseur, en complément de la recherche académique (doc 07). Panorama revérifié le **2026-11-06**. Le domaine bouge vite : l'annuaire communautaire `yetanotherorchestrator.app` recense à lui seul **29 apps desktop** (plus des catégories web dashboards, terminal UIs, cloud orchestrators), et un second annuaire existe (`github.com/andyrewlee/awesome-agent-orchestrators`) — à relire en continu.

## 1. L'essentiel en une phrase

Le marché est **saturé côté orchestration** (lancer des agents en parallèle, isoler, reviewer, merger). Côté attention, le **triage brut** (« ce qui m'attend ») est désormais couvert par plusieurs produits (§3bis) : une énième inbox ne différencie plus. Restent vides le **calibrage de l'attention** (priorisation, digest, budgets d'interruption, snooze/escalade, DND), la **mémoire déclarée** et la **vérification de clôture** — c'est exactement le cœur du concept.

## 2. Produits desktop d'orchestration

| Produit | Nature | Licence / prix | Couverture des douleurs |
| --- | --- | --- | --- |
| Conductor (Melty Labs, YC ; série A de 22 M$ en avr. 2026) | macOS natif ; Claude Code / Codex / Cursor / OpenCode en workspaces isolés, review + merge ; cloud (microVM) + iOS + API en Pro ($50/mois) | Propriétaire, gratuit en local | Couvre partiellement P1, P9 ; pas de triage, mémoire ni vérification |
| **Paradev** (ex-Superset jusqu'en oct. 2026) | Desktop agent-agnostic, workspaces remote + cloud, CLI + SDK + MCP, automations planifiées | Elastic License 2.0, Pro $20/seat/mois | Le plus complet des rivaux ; supporte OpenCode ; toujours orienté « lancer + review » ; le renommage en cours de route illustre la churn du marché |
| Sculptor (Imbue) | Conteneurs + « Pairing Mode » (l'agent travaille hors checkout, sync vers le repo local) | Open source, beta gratuite | Centré Claude Code + Pi ; ne touche pas P11/P12 |
| Orca / Emdash / Nimbalyst | ADE open source multi-plateforme ; Emdash : 34 agents CLI, intake Linear/Jira/Notion/Asana, runs planifiés avec historique | MIT / Apache-2.0 | Couvrent « commencer » (P9) et l'isolation ; pas le triage ni la mémoire |
| Claude Code desktop (Anthropic) | Parallélisme natif, worktree option, diff, browser pane, SSH | Propriétaire | Claude Code uniquement |
| Claude Squad / Herdr / cmux | Terminal-first : tmux + worktrees ; Herdr a sidebar de statut + socket API + plugins | Open source (AGPL / Apache / GPL) | Multiplexeurs simples ; aucune couche sémantique |
| **Agent Orchestrator** (Composio) / **Jean** (coolLabs) | Open source ; worktrees isolés, terminaux live, 20+ agents dont OpenCode ; Jean ajoute GitHub/Linear + mode headless | Apache-2.0 / open source | Mêmes primitives (lancer + isoler + review), aucune couche d'attention ; renforcent la saturation |
| Vibe Kanban (BloopAI) | Kanban pour agents (28,6k étoiles GitHub, supporte OpenCode) | Apache-2.0 | **Sunset annoncé le 10 avr. 2026** : bloop ferme, le projet continue en open source maintenu par la communauté ; kanban de planification, pas de supervision de l'attention |

## 3. Dashboards open-source GitHub (famille Claude Code)

Tous positionnés pareil (« monitor multiple Claude Code sessions »), tous **Claude Code uniquement**, locaux :

- **futin/claude-agents-dashboard** — le plus proche conceptuellement, et de loin le plus abouti : statuts `working / question / incomplete / idle`, colonnes **Needs you / Working / Quiet** et un layout **Triage**, l'attente nommée (`Answer / Plan? / Reply? / Allow?`), lecture des transcripts JSONL (poll 3 s, 256 derniers Ko), **réponses aux questions / rejets de plans / follow-ups depuis le navigateur ou le téléphone**, lancement de sessions, **routines planifiées avec journal d'exécution (Runs log)**, notifications push, post-mortems et « leçons » `/kaizen` auto-générées. Mais : Claude Code uniquement, monitoring déclaré *read-only*, mémoire auto-générée et non éditable par l'humain, pas de goals, pas de preuve de complétion.
- Autres, très équivalents entre eux : trillion-labs/claude-code-orchestrator, amahpour/claude-code-command-center, AnimaNigra/ClaudeAgentOrchestrator, Stargx/claude-code-dashboard, yxwucq/CCUI (multi-worktree), gabinfay/claude-session-manager (auto-kill à 170 k tokens + skill de rétro justement pour « persister l'état »), ClickHouse/multiagent-terminal, hoangsonww/Claude-Code-Agent-Monitor (dashboard + kanban + notifications).
- **Apprentissage commun** : tous dérivent leur état des transcripts JSONL sur disque, sans API server (les CLIs n'en ont pas). Notre avantage structurel : OpenChamber expose une vraie API (doc 05) — pas besoin de parser les transcripts, mais la contrainte d'« indexer au vol » reste (doc 05 §11.3). futin confirme aussi qu'un poll 3 s suffit à un monitoring très lisible : la difficulté n'est pas *voir*, c'est *décider*.

## 3bis. Les « inboxes d'attention » (nouveaux entrants 2026) — le vrai correctif à apporter

Le point le plus important de la veille 2026 : **le simple « ce qui m'attend » n'est plus un vide**.

- **Omniscio** (desktop Windows/macOS/Linux, faits auto-déclarés par l'éditeur) : « attention-first inbox », statuts `running / needs-you / error / stalled / waiting`, **les sessions qui ont besoin de toi trient en premier**, diff viewer avec résumé en langage clair. C'est le concurrent le plus proche de notre « Débloquer » — mais il *agrège* l'attente, il ne la **calibre** pas (ni digest, ni snooze, ni budget d'interruption, ni DND par tâche).
- **octomux** (« one unified permission inbox across agents ») et **agterm** (« live dashboard, attention states »), référencés dans l'annuaire `awesome-agent-orchestrators` : même famille, même limite.
- **jat** (web dashboard local-first, MIT, 20+ sessions en tmux, « Epic Swarm »), **Fusion** (« Command Center » avec kanban et suivi tokens/$ en temps réel), **Agent of Empires** (TUI Rust + web/PWA mobile) : confirment que « Voir la flotte » est devenu un *commodity*, y compris en self-hosted.
- **Implication** : en nov. 2026, vendre une énième inbox d'attention n'est plus une différenciation. Le dégagement est au-dessus — **calibrage** (doc 07 §7), **mémoire déclarée** (doc 07 §9), **vérification de clôture** (Parcours D) — et en dessous : le multi-projets et l'indépendance vis-à-vis d'un CLI unique.

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
| **Voir** — la flotte | OpenChamber, opencode-observability, tous les dashboards (futin, jat, Fusion, Omniscio…) | *Commodity* : zone la moins différenciante |
| **Commencer** — point unique de lancement | Conductor, Paradev, Vibe Kanban, Emdash, Agent Orchestrator, Jean, futin, Pane | Concrètement traité, mais jamais relié au goal ni aux conventions |
| **Débloquer** — répondre sans changer de contexte | futin (Claude Code only), Omniscio, octomux, agterm, OpenChamber (approvals) | **Inbox d'attention désormais courante** ; reste le **calibrage** (priorisation, digest, snooze/escalade, DND) et le multi-projets |
| **Se rappeler** — mémoire déclarée | Quasi-vide : futin loggue des « leçons » `/kaizen` auto-générées, mais **aucune mémoire déclarée et éditable par l'humain** (goals, conventions, décisions) | **Vide sur l'essentiel** |
| **Piloter les machines** — tâches planifiées | Emdash (runs + historique), futin (routines + Runs log), OpenChamber (cockpit sans historique) | Historique manquant côté OpenChamber (doc 05 §7) |
| **Vérifier** — clôture contre le goal | **Aucun produit** ne revendique de vérifier la complétion contre le goal initial ; au mieux des statuts (`incomplete`, `idle`) ou des checks CI. Seul le prototype de recherche ParallelPilot (doc 07 §1) propose un *prompt* de vérification | **Vide** — le trou identifié par la recherche reste un trou produit |

## 6. Conséquences pour le design

1. **Différenciation assumée** : ne pas vendre une énième inbox d'attention (futin, Omniscio, octomux la font déjà), mais le **calibrage** (P5, P12 — digest, budgets d'interruption, snooze/escalade, DND par tâche, doc 07 §7) + la **mémoire déclarée** (P8, doc 07 §9) + la **vérification de clôture** (Parcours D). Trois axes qu'**aucun produit existant** ne couvre ensemble.
2. **Ne pas refaire l'écosystème** : le Superviseur réutilise OpenChamber, ne le remplace pas (règle doc 01 : aucun IDE, chat UI ni diff viewer) — pas d'orchestration d'exécution, pas de terminal, pas de kanban maison. 29 apps desktop font déjà le « lancer + isoler + review ».
3. **Cibler le MVP** : prioriser les axes « Vide » du tableau §5 (calibrage de l'attention, Se rappeler, Vérifier). Les axes devenus *commodity* (Voir brut, inbox, review/merge) restent un chemin vers OpenChamber.
4. **Apprentissages pratiques** :
   - la lecture JSONL des dashboards Claude Code (poll 3 s, 256 Ko de queue chez futin) confirme la nécessité d'indexer au vol côté WS, pas de re-lire après coup — déjà posé doc 05 §11.3 ; mais futin montre aussi qu'un monitoring très complet reste un *monitor* : la valeur manquante est dans la décision, pas dans l'affichage ;
   - l'auto-kill 170 k + skill « session retro pause » de gabinfay, et les leçons `/kaizen` de futin, illustrent le besoin d'extérioriser la mémoire avant la perte — et leur limite : aucune n'est **éditable par l'humain** (doc 07 §9) ;
   - **churn du marché** : sunset de Vibe Kanban (bloop ferme le 10 avr. 2026, « couldn't find a business model » avec une base quasi tout-gratuite ; le projet survit en community-maintained) + renommage Superset → Paradev (oct. 2026). Le Superviseur s'adosse à l'outil qui existe plutôt que d'en réimplémenter un septième ;
   - la tagline même de Vibe Kanban — « *Your Engineering Bottleneck Has Shifted : accelerate the human planning and review your coding agents are waiting on* » — formule commercialement notre phare (l'attention humaine est le goulet). Personne ne la **calibre** pour autant : c'est notre place.

## Sources principales

- Conductor : docs.conductor.build ; fiche Continuum (2026-08, 4 harnesss dont OpenCode)
- Superset, Sculptor : superset.sh/compare (pages mises à jour oct. 2026)
- Orca, Emdash, Nimbalyst, Herdr, cmux : superset.sh/compare/conductor-alternative, superset.sh/compare/claude-squad-alternative
- Dashboards cités : github.com/futin/claude-agents-dashboard, trillion-labs/claude-code-orchestrator, amahpour/claude-code-command-center, AnimaNigra/ClaudeAgentOrchestrator, Stargx/claude-code-dashboard, yxwucq/CCUI, gabinfay/claude-session-manager, ClickHouse/multiagent-terminal
- Terminal : github.com/smtg-ai/claude-squad (AGPL-3.0) ; Herdr (Apache-2.0) ; cmux (GPL)
- Kanban : github.com/BloopAI/vibe-kanban (sunsetting) ; github.com/OAI-Labs/vibe-flow
- OpenCode : github.com/aymazon/opencode-observability ; openchamber issues #1441, #2097
- Annuaire : yetanotherorchestrator.app
