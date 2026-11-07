import { memo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Markdown du chat : même rendu sûr que la livraison (GFM, skipHtml, pas de
 * rehype-raw). Les images ne sont pas affichées dans le chat en phase 1 : une
 * source locale ne doit pas produire d'icône cassée ni de fuite de chemin.
 */
export const ChatMarkdown = memo(function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="delivery-md chat-md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          img: () => null,
          table: ({ children }) => (
            <div className="delivery-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
});
