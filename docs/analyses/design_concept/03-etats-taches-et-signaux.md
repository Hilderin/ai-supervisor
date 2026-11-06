# 03 — États d'une tâche et niveaux de texte

Deux problèmes distincts, traités ensemble : **quel est l'état de la flotte ?** et **quel niveau d'information on montre ?**

## 0. Confiance et progression : trois voies, une recommandation

| Voie | Mécanisme | Avantages | Risques |
| --- | --- | --- | --- |
| **A. Mécanique** (gratuit) | dérivée des événements : todos cochées, fraîcheur du dernier outil, retries, oscillation fichiers, budget token vs goal | jamais fausse, aucune latence, déjà disponible via l'API | aveugle au sens : ne sait pas dire « je me suis trompé de piste » |
| **B. Auto-déclaration par l'agent** (tool dédié) | un tool `supervisor.report(progress, confiance, raison)` que l'agent appelle en fin de tour — injecté via le mécanisme agent-tool d'OpenChamber (même canal que `openchamber_memory`, prouvé en prod) | sémantique riche (« piste fausse, 25 %, repars sur B »), court, dans la conversation même | biais d'optimisme : l'agent se surestime ; un tool de plus à nourrir |
| **C. Juge indépendant** (watchdog) | une session OpenCode à côté qui analyse, ou l'audit goal d'OpenChamber (3 questions oui/non, déjà implémenté) | jugement externe, peut contredire l'agent | coûte des tokens, latence |

**Recommandation : A en socle permanent + B en couche déclarée + C uniquement comme contre-calibrage.**

- Le pourcentage affiché sur la carte = **A** (honnête, toujours).
- Raison en une ligne (« étape : tests e2e ») et toute révision de trajectoire = **B** : le tool remplace le GoalJournal « prose » par un appel structuré — même idée, mieux cadrée.
- **C** n'est pas un moniteur permanent : on réutilise l'audit goal d'OpenChamber, et si besoin plus tard une session watchdog activée par tâche.

Règle de conflit : si B contredit A (l'agent dit « 90 % » mais zéro todo cochée), **A gagne l'affichage** et le désaccord déclenche le signal `drifting`.

## 1. Machine à états d'une tâche

```
running ──(question/permission)──────────────► waiting ──(réponse)──► running
  │                                              │
  │  tourne en rond, répétitions                  │ enbusy sans progression > N min
  ▼                                               ▼
drifting                                        blocked
  └────────────────(cf. todos finis / abort)──────┴──► done / aborted
```

| État | Source de détection | Résumé UI (1 ligne) |
| --- | --- | --- |
| `running` | session busy + dernier message agent récent | « Travaille — étape : <todo en cours> » |
| `waiting` | session idle et dernière action = question ou permission | « En attente de toi — <la question, en 1 ligne> » |
| `blocked` | busy mais zéro progression depuis N min, ou crash | « Bloqué — <raison> » |
| `drifting` | heuristiques (§2) | « Semble dériver — <signal> » |
| `done` | todos finis + session idle + goal confirmé | « Fini — <ce qui a été livré, 1 ligne> » |
| `aborted` | session abortée/supprimée ou tâche annulée | « Avortée » |

Seuls `waiting`, `blocked`, `drifting` **montent dans la zone d'alerte**. `running` et `aborted` restent visibles mais ne crient jamais.

## 2. Détection de dérive (heuristiques, du moins au plus coûteux)

Chaque point est un *signal* avec un seuil réglable, jamais un automatisme :

1. **Silence** : session busy mais aucun message depuis X min (X ≈ 5).
2. **Répétition** : même tool call (même fichier, même commande) N fois d'affilée sans nouveau todo coché.
3. **Todo délaissée** : la même todo `in_progress` depuis > 25 % du temps total de la tâche.
4. **Oscillation** : abandon d'un fichier puis retour dessus 2-3 tours plus tard.
5. **Aller-retour** : cycles répétés de revert/unrevert.
6. *(V2 — plus tard)* **Lecture du texte** : un petit LLM de résumé périodique qui juge si « le discours tourne en rond ». On n'y touche qu'une fois les signaux mécaniques bien rodés.

## 3. Progression honnête

**Mauvais** : `progress = todos_done / todos_total` — le pourcentage finale est un mensonge confortable, le seuil de « presque fini » durera des heures.
**Honnête** : trois indicateurs séparés, jamais un seul chiffre magique :

- **Étapes** : `x / y todos cochées` (données brutes, toujours vraies) ;
- **Fraîcheur** : temps depuis le dernier message agent — une barre qui ternit avec l'âge (verte à 1 min, orange à 10 min) ;
- **Distance au goal** : laissée à l'agent (1 bullet « reste à faire : … » dans son journal), affichée comme citation.

## 4. Niveaux de texte — la règle 1-5-50

Trois altitudes par carte, toujours accessibles dans le même ordre :

| Niveau | Contenu | Où on le voit |
| --- | --- | --- |
| **1** | une phrase « quoi / état » générée du dernier signal | carte au repos |
| **5** | bullets : dernier événement, todo en cours, question si waiting, dernier fichier touché | expand de la carte |
| **50** | la conversation réelle — on ne recopie **jamais** les longs textes ici | bouton « ouvrir dans OpenChamber » |

Contraintes dures :

- aucune carte ne dépasse 1 ligne au repos ;
- toutes notifications (toast, push) ≤ 80 caractères + le nom de la tâche ;
- le texte brut du dernier message agent, tronqué à ~200 caractères, avec « lire la suite dans OpenChamber » ;
- pas d'écran de liste avec du texte d'introduction ni des graphiques décoratifs : les listes ne contiennent que des états.
