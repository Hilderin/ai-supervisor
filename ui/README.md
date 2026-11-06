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
- `src/hooks/useFleetStream.ts` : SSE + poll 3 s.
- `src/store/fleetStore.ts` : flotte, erreur, fermetures, brouillons des composers.

Décisions et écarts avec la maquette : `docs/analyses/mvp1/implementation-ui-react.md`.
