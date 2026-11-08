import { memo, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fenceUiBlocks } from '../openui/taggedBlocks';
import { uiBlockComponents } from './UiBlock';

/**
 * Markdown du chat : même rendu sûr que la livraison (GFM, skipHtml, pas de
 * rehype-raw). Les images ne sont pas affichées dans le chat en phase 1 : une
 * source locale ne doit pas produire d'icône cassée ni de fuite de chemin.
 *
 * Les fences `openui-lang` (ou `<openui-lang>`) sont dessinés par `UiBlock` ;
 * un bloc invalide ou partiel retombe en code brut, donc le streaming ne perd
 * jamais de texte.
 */
export const ChatMarkdown = memo(function ChatMarkdown({ text }: { text: string }) {
  const prepared = useMemo(() => fenceUiBlocks(text), [text]);
  return (
    <div className="delivery-md chat-md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          ...uiBlockComponents(),
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
        {prepared}
      </Markdown>
    </div>
  );
});
