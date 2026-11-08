import { useState } from 'react';

interface ImageProps {
  src?: string;
  alt?: string;
  sessionId: string;
}

/**
 * Image d'une réponse agent. Les sources locales (capture dans le dossier de
 * la session) sont servies par le daemon via `/api/fleet/asset` : le
 * navigateur ne peut pas lire un chemin du disque, et l'UI n'est pas servie
 * par OpenChamber. Une image introuvable ou refusée affiche un texte discret
 * au lieu d'une icône cassée.
 */
export function DeliveryImage({ src, alt, sessionId }: ImageProps) {
  const [failed, setFailed] = useState(false);
  if (!src) return null;
  if (failed) {
    return <span className="delivery-img-error">Image indisponible{alt ? ` : ${alt}` : ''}</span>;
  }
  const local = !/^(?:https?:)?\/\//i.test(src) && !/^(?:data|blob):/i.test(src);
  const url = local
    ? `/api/fleet/asset?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(src)}`
    : src;
  return (
    <img
      src={url}
      alt={alt ?? ''}
      loading="lazy"
      className="delivery-img"
      onError={() => setFailed(true)}
    />
  );
}
