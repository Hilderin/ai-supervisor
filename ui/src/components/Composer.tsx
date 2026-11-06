import { useLayoutEffect, useRef, useState } from 'react';
import { sendPrompt } from '../lib/api';
import { cx } from '../lib/cx';
import { INPUT } from '../lib/ui';
import { useFleetStore } from '../store/fleetStore';
import { SendIcon } from './Icons';

interface Props {
  sessionId: string;
}

const MAX_HEIGHT = 120;

/** Composer auto-grow : Enter envoie, Shift+Enter saute une ligne. */
export function Composer({ sessionId }: Props) {
  const text = useFleetStore((s) => s.drafts[sessionId] ?? '');
  const setDraft = useFleetStore((s) => s.setDraft);
  const clearDraft = useFleetStore((s) => s.clearDraft);
  const ref = useRef<HTMLTextAreaElement>(null);
  const interacted = useRef(false);
  const [atMax, setAtMax] = useState(false);

  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    // au premier rendu à vide, laisser la hauteur auto (comme la maquette) ;
    // ensuite (frappe, brouillon restauré) ajuster à scrollHeight + 1
    if (!text && !interacted.current) return;
    const isMax = ta.scrollHeight > MAX_HEIGHT;
    setAtMax(isMax);
    ta.style.height = 'auto';
    ta.style.height = `${isMax ? MAX_HEIGHT : ta.scrollHeight + 1}px`;
  }, [text]);

  const send = () => {
    const value = text.trim();
    if (!value) return;
    clearDraft(sessionId);
    ref.current?.blur();
    void sendPrompt(sessionId, value).catch((e) => console.error('[send]', e));
  };

  return (
    <div className="mt-[12px] flex items-end gap-[7px] border-t border-border pt-[10px]">
      <textarea
        ref={ref}
        rows={1}
        value={text}
        onChange={(e) => {
          interacted.current = true;
          setDraft(sessionId, e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        className={cx(
          INPUT,
          'max-h-[120px] flex-1 resize-none text-[14px] leading-[1.45] focus:border-[#c9cfc9]',
          atMax ? 'overflow-y-auto' : 'overflow-y-hidden',
        )}
      />
      <button
        type="button"
        title="Envoyer"
        onClick={send}
        className={cx(
          'h-[26px] w-[26px] shrink-0 cursor-pointer rounded-[7px] bg-transparent p-[2px] text-arrow transition-colors hover:text-green',
          text.trim() ? 'text-green' : null,
        )}
      >
        <SendIcon />
      </button>
    </div>
  );
}
