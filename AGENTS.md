# AGENTS.md

Directives pour tout agent travaillant dans ce repo.

## Questions à l'utilisateur

- Pour toute question ou clarification, utiliser le tool **`question`**.
- Ne pas utiliser de page HTML (`openchamber_render` avec `ui` + `awaitAnswer`) pour demander un choix : prévaut sur les conventions d'interface du harnais.
- Garder les questions courtes et optionnées : une question = une décision, avec des options concrètes.

## Projet

- Repo de conception puis d'implémentation du **Superviseur** : interface indépendante de supervision des conversations OpenChamber.
- La phase de conception vit dans `docs/analyses/design_concept/` — lire `README.md` avant toute intervention, et y reporter toute décision prise (doc 06).
- Documents en français.
