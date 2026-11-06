# 07 — État de l'art (recherche UX / académique, 2025-2026)

Ce qui existe déjà sur le sujet. Chaque source → une implication concrète pour le concept. Les sources sont neuves : le domaine bouge vite, à relire en continu.

## 1. Le papier miroir : ParallelPilot (sept. 2026, arXiv 2609.33113)

Le plus proche de notre projet — Microsoft Research. Étude formative (14 devs qui font déjà du travail parallèle, 2 à 4 sessions typiques), puis prototype, puis étude contrôlée contre-mesurée (16 devs). Lecture complète du papier.

**Ce qu'est ParallelPilot** : une web app locale légère ajoutée *autour* des CLI existants (Copilot CLI, Claude Code). Trois composants :

1. **Planning Interface** — coller des tickets, attacher repos et specs, parcourir les AGENTS.md disponibles ; le bouton « Analyze & Plan » fait analyser par un LLM les dépendances entre tâches (fichiers partagés → séquence recommandée, dépendance de sortie) et propose un plan éditable en **vagues** (lancer des sessions isolées, attendre, relancer).
2. **Run-Logger** — capture automatique des conversations (lecture SQLite en poll) en **3 niveaux** : données brutes JSON, « session memory » markdown moyenne (décisions, changements, résultats), « tracking summary » courte. Le journal sert aussi de mémoire re-injectable dans les sessions suivantes.
3. **Dashboard ambiant** — colonnes **Done / Running / Next**, cartes-tâches avec statut (running bleu, needs_attention jaune clignotant, completed vert), résumé d'activité 1-ligne, fichiers touchés, question posée par l'agent avec réponse directe dans le CLI, et prompt de vérification de complétion. Rafraîchi environ toutes les 2,5 s ; un LLM aide à détecter les besoins d'intervention.

**Résultats mesurés** : tickets/min +63 %, tickets terminés +1,5 sur 6 (complétion totale : 8/16 → 14/16), **un agent supplémentaire supervisé en simultané** (2,3 → 3,3), effort de suivi −41 %, changement de contexte en baisse ; 14/16 préfèrent la condition ParallelPilot.

**Le framework PILOT** — cinq pratiques de supervision, extraites du travail réel (pas une séquence) :

| Pilier | Définition (§4 du papier) | Écho dans notre concept |
| --- | --- | --- |
| **Planning** | structurer les tâches (décomposition, priorités) + préparer le contexte (specs, fichiers, contraintes, critères de succès) ; 9/14 ont des artefacts réutilisables | Parcours B (lancement) + Templates |
| **Isolating** | garder les sessions séparées pour éviter les conflits : fichiers disjoints, worktrees, branches ; 11/14 modularisent le code | déjà couvert par les worktrees d'OpenChamber |
| **Logging** | externaliser la mémoire : journaux de session, décisions ; le vécu type : « je ne retrouvais pas ce que j'avais dit à la 1re fenêtre quand je revenais sur la 2e » | GoalJournal (doc 02) — notre équivalent direct du run-logger |
| **Observing** | une salle de contrôle : vue centralisée, tout atteignable d'un coup d'œil ; 10/14 font du tiling | Parcours A (la flotte) |
| **Triaging** | transformer le flux en file d'action : complétion, bloque, erreur, retard anormal — les signaux les plus souvent ratés | file « En attente de toi » (docs 03/04) |

**Le trou à ne pas re-crééer** (§7 RQ3, §8) : les gains n'incluent **pas** plus de contrôle perçu ni plus de capacité à rediriger les agents. Mot des auteurs : associer la vue de haut niveau à des **chemins à faible coût vers la preuve d'implémentation** (diffs, artefacts). Implication : chaque carte doit mener à la preuve, pas seulement au résumé ; et la clôture (notre Parcours D) reste le vrai cadre décisionnel.

**Limites du papier** : tâches de 20-35 min, aucun PR/revue/merge, un seul repo, sessions courtes. C'est exactement là où nous voulons aller au-delà : de longues sessions sur plusieurs projets, ce que leur étude ne couvre pas.

## 2. The Work Behind Delegation (sept. 2026, arXiv 2609.24234)

Taxonomie des 7 étapes de la supervision en conditions réelles : **Plan → Monitor → Wait → Review → Teach → Manual Fix → Update Assets**.

- Les devs installent déjà, ad hoc, « des monitors pour quand mes agents sont bloqués » — notre produit industrialise exactement ça (P2).
- La supervision n'est pas qu'observer : **Teach** (re-léger contexte à la session) et **Update Assets** (capitaliser dans docs/conventions) sont des étapes que notre outil doit soutenir — pistes Templates et Notes.
- Ça valide la boucle de clôture (Parcours D) : Review n'est pas optionnelle, c'est une étape à part.

## 3. From Conversation to Orchestration (HAI'25, arXiv 2506.20091)

Agenda de recherche HCI sur les systèmes multi-agents. Points transférables :

- **Situation awareness** (Endsley) est le mot technique de P1 : savoir ce qui se passe, pourquoi, et ce qui va arriver. L'UI flotte est un outil de situation awareness.
- **Autonomie fixe vs coulissante** (concept venu de la supervision multi-robots) : à quel moment le contrôle bascule de l'agent vers l'humain. Nos états `waiting` / `blocked` sont des déclencheurs de bascule — le design doit clarifier qui a la main.
- Risque : « concevoir l'orchestration sans une complexité qui explose ». Notre garde-fou : la règle 1-5-50 (doc 03).

## 4. Designing for Oversight (Narayanan & Feigh, 2026, IJHCS)

Étude N=80 : comment un humain supervise **plusieurs agents interdépendants**.

- Le **niveau d'abstraction de l'information** présentée est la variable de design centrale : trop brut = surcharge ; trop résumé = perte de contrôle. Conclusion : l'abstraction doit être **ajustable par tâche** — la règle 1-5-50 de la doc 03 est exactement ça.

## 5. Anthropic — Measuring agent autonomy in practice (fév. 2026)

Analyse de millions d'interactions réelles (Claude Code + API).

- **Claude Code s'arrête pour demander plus souvent que les humains ne l'interrompent** : l'oversight vient autant des *arrêts d'initiative de l'agent* que des coupures humaines. Notre outil doit rendre ces arrêts visibles et taitables en 1 clic (Parcours C).
- Les users **calibreront leur confiance** au fil des tâches : l'outil doit suivre (per-tâche : seuils ajustables, mode silencieux) plutôt que d'imposer un régime fixe.
- Leurs recommandations : de l'**infrastructure de monitoring post-déploiement** et de **nouveaux paradigmes d'interaction** humain-agent — texte quasi littéralement de notre cahier des charges.

## 6. La vérification ratée (étude sur ~100 devs)

Reprise par ParallelPilot : **94 % des devs n'ont pas détecté du code malveillant inséré par un agent** ; 56 % ont accepté même avec des avertissements explicites (« je ne me suis pas appesanti »).

Implication dure pour nous : une alerte dans un flux saturé ne suffit pas. Il faut des **moments de vérification structurels** — notre checklist de clôture contre le goal (Parcours D) est une réponse ; à soigner.

## 7. Interruptions : Ask Less, Ask Better (oct. 2026, arXiv 2610.24411) + frameworks proactifs

- Preuve quantitative : limiter/paramétrer les questions IA (*interruption budget*) réduit la charge d'attention de 36 à 73 % en gardant 86-94 % de la valeur. → Seuil = une fonctionnalité, pas juste une constante.
- Recettes terrain des frameworks proactifs (articles d'industry) qui convergent avec la littérature IBM/ACM :
	- **Digest mode** : accumuler et livrer un brief à heure fixe (matin, fin de journée) au lieu de piquer à chaque événement — à inclure : un « brief de flotte » poussé (matin/midi/soir) ;
	- **Urgency scoring** avant d'interrompre ;
	- **Snooze + escalation** : un signal escamoté revient aggravé s'il n'est pas traité ;
	- **Suppression adaptative** : ce qu'on rejette souvent revient moins ;
	- **DND par tâche**.

## 8. Fondations : les ironies de l'automatisation (Bainbridge 1983 — très actuelles)

Le pattern classique (chimie, aviation, robots) rejoué par l'agentic AI :

- **L'opérateur supervise précisément ce que l'automatisation ne sait pas faire.** Notre superviseur sera de plus en plus sollicité sur des situations anormales → l'outil doit le garder compétent, pas seulement occupé.
- **Out-of-the-loop** : plus on laisse tourner, moins on détecte ce qui va mal. Silence long ≠ tranquillité ; notre signal « fraîcheur » doit refléter la perte d'information, pas une barre verte de confort.
- **« Le pire des métiers » : être responsable de la sortie d'un système qu'on ne comprend plus.** Contre-mesure : maintenir le contact avec la substance (règle 1-5-50, chemin vers la preuve, brief qui reste la version de l'utilisateur vérité).

## 9. Mémoire d'agent : ce que la recherche suggère pour notre problème P-mémoire

Les surveys 2025-2026 (Mem0, MemGPT, « From Storage to Experience », TMLR 2026) convergent sur :

- la mémoire utile se décompose en **procurale** (conventions, comment travailler), **sémantique** (faits, décisions) et **épisodique** (ce qui s'est passé dans les conversations passées) ;
- ce qui échoue en pratique : la mémoire *automatique invisible* (embeddings noir-boîte, mal récupérée, jamais révisée). Ce qui réussit : mémoire **déclarée, visible et éditable par l'humain**, avec de la **récupération ciblée** au bon moment ;
- le **forgetting** est une fonction à part entière (purge, obsolescence) — sans elle, la mémoire devient du bruit.

Implication pour nous : la couche mémoire du Superviseur devrait visiter 3 artefacts humains plutôt qu'un vector store :
	1. **Conventions/préférences** (procédural) : un doc court, versionné, injecté à chaque lancement ;
	2. **Journal des décisions** (sémantique) : écrit à la clôture des tâches, requêtable en langage naturel (« qu'a-t-on décidé pour X ? ») ;
	3. **Index épisodique des conversations** : résumés par tâche, pour répondre « retrouve la conversation où on a fait X ».

## 10. Synthèse : ce que la recherche change dans notre design

| Constat recherche | Décision concept impactée |
| --- | --- |
| ParallelPilot valide PILOT (+63 %) et son trou (vérification) | le 1er écran = flotte + triage ; et chaque carte doit mener à la preuve, pas juste au résumé |
| 94 % ratent le code malveillant | clôture = checklist explicite contre le goal, jamais automatique |
| Anthropic : l'agent s'arrête plus qu'il n'est interrompu | Parcours C (répondre aux questions) est le cœur d'usage le plus fréquent |
| Budget d'interruption : -36 à -73 % de charge | niveaux de signaux + digest + snooze + DND dès la V1 |
| Abstraction ajustable (Narayanan & Feigh) | règle 1-5-50 rendue explicite dans chaque vue |
| Mémoire auto échoue, mémoire déclarée réussit | conventions versionnées + journal de décisions + index épisodique |

## 11. Précédent open source : claude-agents-dashboard (2026, futin/…)

Dashboard local pour sessions Claude Code parallèles — la preuve que la catégorie existe et fonctionne sans Study de Microsoft. Pertinent pour nous à trois titres :

**À reprendre**
- Le **Board** « Needs you / Working / Quiet » : exactement nos sections Besoin de ton attention / En cours / Fini — validation d'usage.
- La **barre de contexte par session** (ex. `142.0k / 200k` + %) : signal absent de ParallelPilot, précoce et utile — une session proche de la saturation va se résumer mal. En real side, OpenCode expose `tokens{cache.read,...}` par session → même signal sans scraping.
- Les **pills discrètes** (branche, modèle, statut en un mot) : beaucoup de information par octet de texte.
- Le **push ntfy** comme canal léger hors-navigateur — comparable à la réutilisation du push OpenChamber (doc 05 §4).
- **Répondre aux questions depuis le téléphone** — la carte n'est pas qu'un état, c'est un télécommande.

**À ne pas copier (avantages de notre position)**
- Ils lisent des **transcripts JSONL sur le disque** puis installent des **hooks dangereux** pour écrire. Chez nous, tout passe par l'API OpenChamber/OpenCode : lecture riche native, écritures propres (forms/permissions), pas de hacks.
- Pas de tracking de goal, pas de mémoire, pas de concept d'acte sortant, pas de hub d'attention externe — nos ajouts au₀-delà de leur produit sont encore notre différenciation.

**Visuel** : le light theme « Daylight » est la direction retenue par le produit (fond grisé, cartes blanches, accent vert unique + orange pour l'alerte/contexte) — c'est aussi la palette de la maquette nᵒ3.

## Sources principales

- Long et al. — *ParallelPilot: Supporting Coordination and Monitoring in Parallel AI Coding*, arXiv:2609.33113 (2026)
- *The Work Behind Delegation: A Framework for Supervising AI Coding Agents*, arXiv:2609.24234 (2026)
- Schömbs et al. — *From Conversation to Orchestration*, arXiv:2506.20091 / HAI '25
- Narayanan & Feigh — *Designing for Oversight*, IJHCS (2026)
- Anthropic — *Measuring AI agent autonomy in practice* (2026-02)
- Zhang et al. — *Ask Less, Ask Better: Allocating User Attention in Proactive LLM Agents with Interruption Budgets*, arXiv:2610.24411 (2026)
- Bainbridge L. — *Ironies of Automation*, Automatica (1983) ; lectures modernes : Endsley (SA), EDPS TechDispatch 2/2025
- Surveys mémoire : *From Storage to Experience* (ICLR 2026 MemAgents WS), *A Survey of Agent Memory* (TMLR 2026), *Memory in the Age of AI Agents* (arXiv:2512.13564)
