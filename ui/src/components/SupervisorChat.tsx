import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSupervisor } from '../hooks/useSupervisor';
import { cx } from '../lib/cx';
import { useSupervisorStore } from '../store/supervisorStore';
import { ChatMarkdown } from './ChatMarkdown';
import { OpenChamberIcon, PanelLeftIcon, PlusIcon, SendIcon } from './Icons';

interface Props {
  onCollapse: () => void;
}

function clock(at: number): string {
  if (!at) return '';
  return new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function SupervisorChat({ onCollapse }: Props) {
  useSupervisor();
  const state = useSupervisorStore((s) => s.state);
  const loading = useSupervisorStore((s) => s.loading);
  const sending = useSupervisorStore((s) => s.sending);
  const creating = useSupervisorStore((s) => s.creating);
  const sendError = useSupervisorStore((s) => s.sendError);
  const refreshError = useSupervisorStore((s) => s.refreshError);
  const error = sendError ?? refreshError;
  const draft = useSupervisorStore((s) => s.draft);
  const setDraft = useSupervisorStore((s) => s.setDraft);
  const send = useSupervisorStore((s) => s.send);
  const newConversation = useSupervisorStore((s) => s.newConversation);
  const stop = useSupervisorStore((s) => s.stop);
  const refresh = useSupervisorStore((s) => s.refresh);
  const clearErrors = useSupervisorStore((s) => s.clearErrors);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [stick, setStick] = useState(true);
  const [atMax, setAtMax] = useState(false);

  const messages = state?.messages ?? [];
  const busy = sending || state?.status === 'busy';
  const offline = !!refreshError;

  useLayoutEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    const isMax = ta.scrollHeight > 120;
    setAtMax(isMax);
    ta.style.height = 'auto';
    ta.style.height = `${isMax ? 120 : Math.max(34, ta.scrollHeight + 1)}px`;
  }, [draft]);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !stick) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, busy, stick]);

  const submit = () => {
    const value = draft.trim();
    if (!value || sending || busy || creating) return;
    void send(value);
    setStick(true);
  };

  const retry = () => {
    if (sendError) {
      if (draft.trim()) void send(draft);
      else clearErrors();
      return;
    }
    void refresh();
  };

  return (
    <aside
      data-testid="supervisor-chat"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[12px] border border-border bg-card"
    >
      <header className="flex items-center gap-[8px] border-b border-border px-[13px] py-[10px]">
        <span
          data-testid="supervisor-status"
          title={busy ? 'Le superviseur travaille' : 'Superviseur prêt'}
          className={cx(
            'h-[8px] w-[8px] shrink-0 rounded-full',
            offline ? 'bg-dot-off' : busy ? 'bg-orange animate-dot-blink' : 'bg-green',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-bold">Superviseur</div>
          <div className="text-[11px] text-muted">
            {offline ? 'hors ligne' : busy ? 'réfléchit…' : 'orchestrateur'}
          </div>
        </div>
        <button
          type="button"
          data-testid="supervisor-new"
          aria-label="Nouvelle conversation"
          title={busy ? 'Attends la fin du tour' : creating ? 'Nouvelle conversation…' : 'Nouvelle conversation'}
          disabled={sending || busy || creating}
          onClick={() => void newConversation()}
          className="flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] bg-transparent text-muted hover:bg-green-soft hover:text-green disabled:cursor-default disabled:opacity-40"
        >
          <PlusIcon />
        </button>
        <button
          type="button"
          data-testid="supervisor-collapse"
          aria-label="Replier le chat"
          title="Replier le chat"
          onClick={onCollapse}
          className="flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] bg-transparent text-muted hover:bg-hover hover:text-text"
        >
          <PanelLeftIcon />
        </button>
        {state?.sessionId ? (
          <button
            type="button"
            data-testid="supervisor-open"
            title="Ouvrir dans OpenChamber"
            onClick={() => window.open(`openchamber-ui://session/${state.sessionId}`)}
            className="flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] bg-transparent text-muted hover:bg-green-soft hover:text-green"
          >
            <OpenChamberIcon />
          </button>
        ) : null}
      </header>

      <div
        ref={listRef}
        data-testid="supervisor-messages"
        onScroll={(e) => {
          const el = e.currentTarget;
          setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
        }}
        className="min-h-0 flex-1 overflow-y-auto px-[13px] py-[12px]"
      >
        {loading ? (
          <div className="mt-[8px] text-[12.5px] text-muted">Connexion au superviseur…</div>
        ) : messages.length === 0 ? (
          <div data-testid="supervisor-empty" className="flex h-full flex-col justify-center gap-[10px]">
            <div className="text-[14px] font-semibold">Décris ce que tu veux lancer.</div>
            <div className="text-[12.5px] text-muted">
              Je précise le besoin si c'est flou, je crée la tâche dans le bon projet, et la carte apparaît à droite.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-[13px]">
            {messages.map((message) => (
              <div key={message.id} data-testid={`chat-${message.role}`} data-message-id={message.id}>
                {message.role === 'user' ? (
                  <div className="ml-auto max-w-[88%]">
                    <div className="whitespace-pre-wrap rounded-[10px] bg-[#e9f1eb] px-[10px] py-[7px] text-[13px] text-text">
                      {message.text}
                    </div>
                    {message.at ? (
                      <div className="mt-[3px] text-right text-[10px] text-placeholder">{clock(message.at)}</div>
                    ) : null}
                  </div>
                ) : (
                  <div className="max-w-[98%]">
                    {message.text ? <ChatMarkdown text={message.text} /> : null}
                    {message.tools.length ? (
                      <div className="mt-[5px] flex flex-wrap gap-[5px]">
                        {message.tools.map((tool, i) => (
                          <span
                            key={`${message.id}-${i}`}
                            data-tool={tool.name}
                            className={cx(
                              'rounded-[6px] border px-[6px] py-[2px] text-[10.5px]',
                              tool.ok === false || tool.status === 'failed' || tool.status === 'error'
                                ? 'border-[#e7b9b9] bg-[#fbeeee] text-danger'
                                : 'border-border bg-render text-muted',
                            )}
                          >
                            {tool.label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {message.at ? (
                      <div className="mt-[3px] text-[10px] text-placeholder">{clock(message.at)}</div>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
            {busy ? (
              <div data-testid="supervisor-busy" className="flex items-center gap-[7px] text-[12px] text-muted">
                <span className="h-[7px] w-[7px] rounded-full bg-orange animate-dot-blink" />
                Le superviseur travaille…
                {!sending && state?.status === 'busy' ? (
                  <button
                    type="button"
                    onClick={() => void stop()}
                    className="cursor-pointer rounded-[5px] border border-border bg-white px-[6px] py-[2px] text-[10.5px] text-muted hover:text-text"
                  >
                    Arrêter
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {error ? (
        <div data-testid="supervisor-error" className="mx-[13px] mb-[8px] flex items-center gap-[8px] rounded-[7px] bg-orange-soft px-[9px] py-[6px] text-[11.5px] text-attend">
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={retry}
            className="cursor-pointer rounded-[5px] border border-[#eec89a] bg-white px-[6px] py-[2px] text-[10.5px] text-attend hover:bg-[#fff6ec]"
          >
            Réessayer
          </button>
          <button
            type="button"
            title="Fermer le message"
            onClick={clearErrors}
            className="cursor-pointer rounded-[5px] px-[4px] py-[1px] text-[13px] leading-none text-attend hover:bg-[#fff6ec]"
          >
            ×
          </button>
        </div>
      ) : null}

      <div className="border-t border-border px-[13px] py-[10px]">
        <div className="flex items-end gap-[7px]">
          <textarea
            ref={inputRef}
            data-testid="supervisor-composer"
            rows={1}
            value={draft}
            disabled={sending || busy}
            placeholder={busy ? 'Le superviseur travaille…' : 'Décris une tâche…'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            className={cx(
              'max-h-[120px] min-h-[34px] flex-1 resize-none rounded-[8px] border border-border bg-white px-[9px] py-[7px] font-[inherit] text-[13px] leading-[1.45] text-text outline-none placeholder:text-placeholder focus:border-[#c9cfc9] disabled:opacity-60',
              atMax ? 'overflow-y-auto' : 'overflow-y-hidden',
            )}
          />
          <button
            type="button"
            data-testid="supervisor-send"
            title="Envoyer"
            aria-label="Envoyer"
            onClick={submit}
            disabled={sending || busy || creating || !draft.trim()}
            className={cx(
              'flex h-[30px] w-[30px] shrink-0 cursor-pointer items-center justify-center rounded-[7px] bg-transparent p-[3px] text-arrow transition-colors hover:text-green disabled:cursor-default disabled:opacity-40',
              draft.trim() && !sending && !busy && !creating ? 'text-green' : null,
            )}
          >
            <SendIcon />
          </button>
        </div>
        <div className="mt-[5px] text-[10.5px] text-placeholder">
          Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne.
        </div>
      </div>
    </aside>
  );
}
