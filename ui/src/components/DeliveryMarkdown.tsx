import { memo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
function DeliveryImage({ src, alt, sessionId }: ImageProps) {
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

/**
 * Markdown de la réponse agent : titres, listes, code, tableaux (GFM).
 * `skipHtml` et l'absence de `rehype-raw` garantissent que le HTML brut du
 * message n'est jamais interprété (pas de XSS). Les liens sortent dans un
 * nouvel onglet.
 */
export const DeliveryMarkdown = memo(function DeliveryMarkdown({
  markdown,
  sessionId,
}: {
  markdown: string;
  sessionId: string;
}) {
  return (
    <div className="delivery-md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          img: ({ src, alt }) => <DeliveryImage src={src} alt={alt} sessionId={sessionId} />,
          table: ({ children }) => (
            <div className="delivery-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {markdown}
      </Markdown>
    </div>
  );
});
