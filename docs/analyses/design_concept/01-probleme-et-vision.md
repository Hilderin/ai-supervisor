# 01 — Problème et vision

Situation : vous pilotez simultanément 3 à 6 conversations OpenChamber, souvent en réunion Zoom en parallèle. Le produit brouillon s'appelle **le Superviseur**.

## 1. Liste complète des problèmes (à jour)

| # | Douleur | Ce que le Superviseur implique |
| --- | --- | --- |
| P1 | **Liste des conversations complexe et manuelle** dans OpenChamber | vue « flotte » générée automatiquement par état, pas par projet |
| P2 | **Gestion manuelle des projets** dans OpenChamber | sélecteur de projets, raccourcis réutilisant la config OpenChamber |
| P3 | **Beaucoup de scroll** dans conversations/projets pour tout retrouver | tri par état + recherche instantanée |
| P4 | **Conversations en cours / terminées introuvables** | séparation nette actives / archivées, mémoire des tâches passées |
| P5 | **Je ne sais plus qui me pose une question** | `sessions/status` (permissions + questions en attente) → file « en attente de toi » |
| P6 | **Suivre plusieurs conversations à la fois est confus** — je consulte, je me trompe de conversation | cartes résumées en 1 ligne + chemin court vers la preuve (doc 07 : « low-cost paths back to evidence ») |
| P7 | **Retrouver une conversation vieille de semaines** ; souhait : « retrouve-moi la conversation là-dessus » | message-search d'OpenChamber + synthèse par un agent chercheur (à tester) |
| P8 | **Mémoire problématique** : je me répète sur la méthode (analyse → je révise → plan avec statuts TODO/CODED/VALIDATED) ; les décisions prises et mes préférences ne sont pas retenues ; le tool mémoire d'OpenChamber ne fonctionne pas bien | conventions versionnées injectées au lancement + éditeur de la mémoire OpenChamber + journal de décisions (doc 07 §9) |
| P9 | **Aucun point central pour « juste commencer une tâche »** | lancement guidé : tâche + goal + template + agent + projet (parcours B) |
| P10 | **Tâches planifiées difficiles à gérer** ; elles créent des conversations polluantes | cockpit des scheduled tasks + historique de runs + distinction visuelle des sessions issues du planificateur |
| P11 | **Aucune vue d'ensemble de l'avancement** : progression, nombre de tâches, certitude qu'on fait la bonne chose, quelle tâche vérifier en premier | machine à états + progression honnête + priorisation de l'attention (docs 02/03) |
| P12 | **Épuisement mental** de tout vérifier en même temps que des réunions | design ambiant : notifications d'une ligne, digest, ne-pas-déranger par tâche |

## 2. Vision reformulée

Pas seulement un dashboard : un **poste de commandement** de la flotte.

1. **Voir** — l'état de toutes les sessions, tous les projets, en un écran : qui travaille, qui m'attend, qui a fini, qui dérive.
2. **Commencer** — le point unique pour démarrer une tâche : goal, conventions, template, projet.
3. **Débloquer** — répondre à une question ou autoriser une permission sans changer de contexte.
4. **Se rappeler** — décisions, préférences et conversations passées, retrouvables en langage naturel.
5. **Piloter les machines** — les tâches planifiées depuis le même endroit, avec leur historique.
6. **Vérifier** — fermer la boucle contre le goal initial, sous forme de checklist explicite, pas d'un sentiment.

## 3. Opportunités hors MVP

Palette de commandes (lancer une tâche, en français), vue mobile PWA, réinjection des décisions d'une clôture vers la mémoire, ambiance notification réglable par tâche, petit modèle local qui classe les urgences.

À ne pas refaire : un IDE, un chat UI, un diff viewer — renvoyer à OpenChamber, toujours.

## 4. Gardes-fous

✅ OpenChamber expose déjà l'essentiel des données (doc 05) — le Superviseur est une couche de calibrage et d'action, pas une nouvelle collecte de données.
✅ Le framework PILOT (doc 07 §1) prouve la valeur avec des chiffres (+63 % de tickets) et désigne le piège : superviser ≠ vérifier.
⚠️ Risque nᵒ1 : transformer le Superviseur en deuxième mur de texte. La règle 1-5-50 est un engagement de conception, pas un vœu.
⚠️ Risque nᵒ2 : P1-P12 décrivent un périmètre complet. **Il faut** un MVP vertical centré sur trois douleurs d'abord — à choisir dans la doc 06.
