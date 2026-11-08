import { memo, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fenceUiBlocks } from '../openui/taggedBlocks';
import { DeliveryImage } from './DeliveryImage';
import { uiBlockComponents } from './UiBlock';

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
  const prepared = useMemo(() => fenceUiBlocks(markdown), [markdown]);
  return (
    <div className="delivery-md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          ...uiBlockComponents(sessionId),
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
        {prepared}
      </Markdown>
    </div>
  );
});
