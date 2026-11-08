# UI du Superviseur

UI React (Vite + TypeScript + Tailwind v4 + Zustand) de la flotte. La référence visuelle validée est `reference/flotte-vanilla.html`.

## Commandes

```bash
bun install
bun run dev        # Vite sur 5173, /api proxé vers le daemon (127.0.0.1:5180)
bun run build      # tsc --noEmit puis build dans dist/
bun run typecheck
bun test
```

Le daemon sert `ui/dist` : lancer `bun run build` (ou `bun run build:ui` depuis la racine) avant `bun daemon/src/index.mts`.

## Repères

- `src/lib/fleet.ts` : placement des cartes (`isDone`, `isStaleTurn`), textes et confiance.
- `src/lib/answer.ts` : construction de l'objet `{ qN: valeur }` envoyé au daemon.
- `src/lib/delivery.ts` : états du bloc « Résultat » (chargement, vide, erreur, contenu).
- `src/lib/renderDoc.ts` : CSP et rapport de hauteur de l'iframe `openchamber_render`.
- `src/components/DeliveryBlock.tsx` : livraison inline à la demande (texte + rendu).
- `src/components/DeliveryMarkdown.tsx` : markdown GFM, HTML brut ignoré, images locales via `/api/fleet/asset`.
- `src/components/SupervisorChat.tsx` : chat de gauche, messages, tool chips, composer, erreurs, repli.
- `src/components/ComposerInput.tsx` : zone de saisie partagée (chat et détail) : collage, glisser-déposer, pièces jointes.
- `src/lib/attachments.ts` : validation et lecture des pièces jointes (types, 10 Mo, data URL).
- `src/lib/attachmentCitations.ts` : noms `image-1.png` et citations `[nom]` insérées dans le brouillon.
- Le chat propose Piloter / Investigation ; Investigation impose un projet OpenChamber et ne lit que ses fichiers via les outils bornés du daemon.
- `src/components/ChatMarkdown.tsx` : markdown du chat sans images locales ni HTML brut.
- `src/hooks/useSupervisor.ts` : poll 1,2 s quand le superviseur travaille, 4 s au repos.
- `src/store/supervisorStore.ts` : état du chat, `sendError` séparé de `refreshError`, brouillon, nouvelle conversation.
- `src/hooks/useFleetStream.ts` : SSE + poll 3 s.
- `src/store/fleetStore.ts` : flotte, erreur, fermetures, brouillons des composers.
- Routes du daemon : `/api/supervisor*` pour le chat, `/api/tools/*` pour les outils du plugin.

Le chat vit dans `~/.superviseur` et tout ce dossier est exclu de la flotte. Le plugin projet-local et le trust du dossier sont décrits dans `AGENTS.md` et `docs/analyses/mvp1/chat-superviseur.md`.

Décisions et écarts avec la maquette : `docs/analyses/mvp1/implementation-ui-react.md`.
