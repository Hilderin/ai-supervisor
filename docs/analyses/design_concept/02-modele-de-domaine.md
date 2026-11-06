# 02 — Modèle de domaine

Le vocabulaire commun. Une entité = une question que l'interface doit pouvoir répondre.

## Vue d'ensemble

```
Projet ── Session (OpenChamber) ── Goal ── Signal(s) de dérive
              │
              ├─ Todos (liste de l'agent)
              └─ Messages (brut, jamais affiché par défaut)

Tâche (AI Supervisor) = 1..n Sessions (V1: 1 tâche = 1 session)
```

**Tâche** ≠ **Session**. C'est le choix structurant du modèle :

- une **Session** est une conversation technique ; OpenChamber la gère déjà très bien ;
- une **Tâche** est une intention de l'utilisateur (« migrer le module auth », « corriger le bug de login ») ; elle survit aux sessions et peut les regrouper (échec → retry → nouvelle session pour le même goal).

Pour une V1, une tâche = 1 session active suffira très probablement. Le modèle laisse la porte ouverte sans coûter plus.

## Entités

### Task (le cœur)

| Champ | Source | Rôle |
| --- | --- | --- |
| `id`, `title` | déclaré au lancement (pré-rempli) | le fil conducteur « je le vois en un coup d'œil » |
| `goal` | déclaré au lancement ; l'agent peut le reformuler | la ligne d'arrivée, 1-3 bullets max |
| `status` | machine à états (voir doc 03) | `running / waiting / blocked / drifting / done / aborted` |
| `progress` | calculé sur les Todos + signaux | estimation *honnête* (voir doc 03) |
| `projectDir` | dérivé de la session | où ça se passe |
| `createdAt, updatedAt, lastActivityAt` | événements de messages | qui bouge, qui est mort |

### Signal (l'unité d'information du superviseur)

Tout ce qui mérite l'attention, calibré par sévérité :

| Niveau | Exemple | Traitement |
| --- | --- | --- |
| `info` | tâche démarrée, todo cochée, commit effectué | visible seulement sur la carte de la tâche |
| `attention` | session a terminé et attend une validation, inactivité > 2 h | badge sur la carte |
| `action` | question posée par l'agent, permission demandée, échec | remonte en tête de la file, toast |
| `alarm` | dérive détectée, tâche orpheline | toast persistante + notification push si configurée |

Une carte de tâche est résumée en **une phrase** par ses derniers signaux ; les détails sont derrière un expand, jamais affichés par défaut.

### Note / GoalJournal

La traçabilité du goal : au lancement, le goal est écrit. En cours, l'agent (via une directive dans le prompt système) peut **résumer son état** à intervalle dans un journal léger, qui *s'ajoute* au goal sans le remplacer. À la clôture : « fait / pas fait / dévié » contre les bullets initiaux.

## Principes de modélisation

1. **Lecture seule d'abord** : AI Supervisor observe ; il n'écrit que sur actions explicites (répondre à une question, aborter, relancer).
2. **Dérivable > deviné** : on affiche ce qui est mesurable (temps, activité, todos). On *signale* ce qui est devinable avec doute (dérive) — jamais une décision silencieuse.
3. **Le goal est déclaratif** : jamais inventé par le système. L'utilisateur le saisit ; l'agent peut reformuler.
