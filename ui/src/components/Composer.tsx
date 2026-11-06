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
  const setFocus = useFleetStore((s) => s.setFocus);
  // une frame de flotte (SSE ou GET) peut déplacer ou remonter la carte :
  // c'est le signal pour vérifier et restaurer le focus
  const fleetAt = useFleetStore((s) => s.fleet?.at);
  const ref = useRef<HTMLTextAreaElement>(null);
  const interacted = useRef(false);
  const [atMax, setAtMax] = useState(false);

  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    // le composeur de cette session avait le focus et la carte vient d'être
    // démontée/remontée ou déplacée (changement de section, fuite GET) :
    // rendre le curseur et ramener la carte en vue
    if (useFleetStore.getState().focused !== sessionId) return;
    if (document.activeElement === ta) return;
    ta.focus();
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
    const card = ta.closest('[data-sid]');
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [sessionId, text, fleetAt]);

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
    // garder le focus après l'envoi : le prompt peut faire changer la carte de place
    setFocus(sessionId);
    if (document.activeElement !== ref.current) ref.current?.focus();
    void sendPrompt(sessionId, value).catch((e) => console.error('[send]', e));
  };

  return (
    <div data-composer className="mt-[12px] flex items-end gap-[7px] border-t border-border pt-[10px]">
      <textarea
        ref={ref}
        rows={1}
        value={text}
        onFocus={() => setFocus(sessionId)}
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
