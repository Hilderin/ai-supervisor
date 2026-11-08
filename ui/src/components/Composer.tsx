import { useRef } from 'react';
import { sendPrompt } from '../lib/api';
import type { ComposerAttachment } from '../lib/attachments';
import { cx } from '../lib/cx';
import { INPUT } from '../lib/ui';
import { useFleetStore } from '../store/fleetStore';
import { ComposerInput } from './ComposerInput';
import { SendIcon } from './Icons';

const EMPTY: ComposerAttachment[] = [];

/** Composer du détail : même zone de saisie que le chat (collage, dépôt, pièces jointes). */
export function Composer({ sessionId }: { sessionId: string }) {
  const text = useFleetStore((s) => s.drafts[sessionId] ?? '');
  const attachments = useFleetStore((s) => s.attachments[sessionId] ?? EMPTY);
  const setDraft = useFleetStore((s) => s.setDraft);
  const clearDraft = useFleetStore((s) => s.clearDraft);
  const setAttachments = useFleetStore((s) => s.setAttachments);
  const ref = useRef<HTMLTextAreaElement>(null);

  const send = () => {
    const value = text.trim();
    if (!value && !attachments.length) return;
    clearDraft(sessionId);
    setAttachments(sessionId, []);
    if (document.activeElement !== ref.current) ref.current?.focus();
    void sendPrompt(sessionId, value, attachments).catch((e) => {
      console.error('[send]', e);
      // le message n'est pas parti : rendre le brouillon et ses pièces jointes,
      // sans écraser ce que le propriétaire aurait déjà retapé entre-temps
      const store = useFleetStore.getState();
      if (!store.drafts[sessionId]) setDraft(sessionId, value);
      if (!(store.attachments[sessionId]?.length ?? 0)) setAttachments(sessionId, attachments);
    });
  };

  const hasContent = !!text.trim() || attachments.length > 0;

  return (
    <ComposerInput
      value={text}
      onChange={(value) => setDraft(sessionId, value)}
      onSubmit={send}
      placeholder="Écrire à cette tâche…"
      attachments={attachments}
      onAttachmentsChange={(next) => setAttachments(sessionId, next)}
      textareaRef={ref}
      maxHeight={120}
      ariaLabel="Écrire à cette tâche"
      textareaTestId="task-composer"
      textareaClassName={cx(
        INPUT,
        'flex-1 text-[14px] leading-[1.45] focus:border-[#c9cfc9]',
      )}
      actions={
        <button
          type="button"
          title="Envoyer"
          aria-label="Envoyer"
          onClick={(e) => {
            e.stopPropagation();
            send();
          }}
          disabled={!hasContent}
          className={cx(
            'h-[26px] w-[26px] shrink-0 cursor-pointer rounded-[7px] bg-transparent p-[2px] text-arrow transition-colors hover:text-green disabled:cursor-default disabled:opacity-40',
            hasContent ? 'text-green' : null,
          )}
        >
          <SendIcon />
        </button>
      }
      className="mt-[12px] border-t border-border pt-[10px]"
    />
  );
}
