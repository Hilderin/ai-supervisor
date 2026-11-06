# 11 — Notes du spike d'intégration (config réelle)

Spike joué le 2026-11-06 (~45 min) contre l'instance réelle de Guillaume, via les tools OpenChamber (MCP) + curl HTTP. Tout sur session jetable. L'objectif : vérifier que chaque geste de la maquette MVP1 a sa route réelle. Résultat : **les 4 gestes critiques sont confirmés en direct.**

## 1. Topologie réelle constatée

| Service | Adresse | Auth |
| --- | --- | --- |
| OpenChamber (desktop AppImage v2.6.1) | `127.0.0.1:57123` | **aucune** (confirme la doc, sans password UI) |
| OpenCode server (managé par OpenChamber) | `127.0.0.1:43735` | **Basic auth** — mot de passe possédé par OpenChamber, utilisateur inconnu (direct = 401) |

**Implication architecture forte** : le Superviseur parle à **OpenChamber uniquement** (port 57123), qui relit l'upstream OpenCode avec ses propres credentials. Aucun mot de passe à demander à l'utilisateur pour MVP1. La découverte de port dynamique (pid → `ss`) est à automatiser dans le daemon : `openchamber` en écoute locale, port souvent non fixe (pas 3000 sur cette machine).

## 2. Les endpoints confirmés, geste par geste

### Lecture flash (cartes flotte)
- `GET /api/sessions/status` : **l'endpoint clé, confirmé en direct** — `sessions{status: idle|busy, lastUpdateAt, turnStartedAt}` + section `pending{sessionId: {permissions[], forms[], pages[]}}`.
- Les **forms (questions) arrivent complètes** : id `frm_…`, title, `metadata.kind:"question"`, `fields[{key, title, description, type:"string", options[{value,label,description}], custom:true}]`.
- `custom:true` → le **champ libre toujours possible** est un fait natif de la stack, pas un choix que nous portons. Il confirme tel quel la décision carte v4.
- `GET /api/sessions/snapshot` : liste rapide des statuts, plus légère.
- `session.list` (MCP) : title, agent, model, cost, tokens (avec cache), outcome, `time.busy/idle/viewed`, durée du dernier tour (`metadata.openchamber.turn`), dossier, `parentID`. Tout ce que la carte v4 affiche est déjà servi.

### Répondre à une question (boucle complète, testée de bout en bout)
1. La session de test a suspendu sur le tool `question` → visible dans `pending.forms` en ~1 s ;
2. `POST /api/session/{id}/form/{formID}/reply` body `{"answer":{"q0":"curl"}}` → **la session a repris** et a terminé avec « OK ».
Le même cycle que le bouton Oui/Non de notre carte, confirmé sur la vraie instance.

### Création (saisie → session)
- `session.create` (MCP OpenChamber) avec prompt initial : session créée, prompt dispatché, id retourné immédiatement. L'équivalent `POST /api/openchamber/sessions` (HTTP) existe côté routes d'OpenChamber (à confirmer en POST direct lors du premier build).

### Flux temps réel
- `GET /api/event` (SSE d'OpenChamber) : cadre `server.connected` + heartbeat, **fonctionne sans auth**. Base du daemon de flotte confirmée.
- WS (`/api/global/event/ws`) : non testé au curl (upgrade), mais le SSE suffit pour MVP1.

## 3. Ce qui diverge du checkout / reste à vérifier

| Point | Constat | Impact |
| --- | --- | --- |
| `openapi.json` d'OpenCode | 401 en direct ; pas réexporté par OpenChamber (404) | le codegen se fera sur le checkout, mais chaque route restera validée au runtime (comme fait ici) |
| DELETE de session | 404 sur le proxy (`/api/session/:id` non mappé ; OpenCode direct = 401) | à retrouver (la route UI existe forcément) — pas bloquant : on archive plutôt qu'on supprime pour MVP1 |
| Persistances des statuts | la session test supprimée restait listée quelques instant après le DELETE raté | la flotte doit tolérer id fantômes (filter sur statuts vus > N min) |
| Deep-link session (↗) | format exact pas encore identifié (app desktop, routes internes) | à capturer depuis l'app au premier test UI |
| Formulaire « question » | observé en attente meme sur turn suivant quand on ré-équipe | règles : ne jamais re-prompt une session avec pending form |

## 4. Décisions du spike (reported in doc 06)

1. **Le Superviseur MVP1 = client HTTP de OpenChamber sur son port local auto-détecté** — aucun credential nécessaire.
2. **Le daemon de flotte** : un process Node qui (a) SSE `/api/event`, (b) poll `sessions/status` en file d'appoint (3 s, comme la maquette l'a confirmé), (c) sert une petite UI, (d) stocke son état local dans ce repo (JSON).
3. MVP1 n'a besoin de **ni MCP, ni SDK OpenCode** — du HTTP pur contre OpenChamber.

## 5. Et maintenant

Le squelette : `daemon (Node, SSE + poll + replay) → state.json → UI (la v4 branchée dessus)`. Next : choisir l'outillage exact (Node runtime, bundler) dans doc 12, puis coder le daemon minimal.
