import { memo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Markdown de la réponse agent : titres, listes, code, tableaux (GFM).
 * `skipHtml` et l'absence de `rehype-raw` garantissent que le HTML brut du
 * message n'est jamais interprété (pas de XSS). Les liens sortent dans un
 * nouvel onglet.
 */
export const DeliveryMarkdown = memo(function DeliveryMarkdown({ markdown }: { markdown: string }) {
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
