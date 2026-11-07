import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSupervisor } from '../hooks/useSupervisor';
import { cx } from '../lib/cx';
import { taskTitleOf } from '../lib/fleet';
import { useFleetStore } from '../store/fleetStore';
import { useSupervisorStore } from '../store/supervisorStore';
import { fetchSupervisorProjects } from '../lib/api';
import type { ChatTool, Fleet, SupervisorMessage, SupervisorProject } from '../types';
import { ChatMarkdown } from './ChatMarkdown';
import { BroomIcon, CopyIcon, OpenChamberIcon, PanelLeftIcon, RevertIcon, SendIcon, StopIcon } from './Icons';

interface Props {
  onCollapse: () => void;
}

const MIN_COMPOSER = 34;
const MAX_COMPOSER = 360;

function clampComposer(n: number): number {
  return Math.max(MIN_COMPOSER, Math.min(MAX_COMPOSER, Math.round(n)));
}

function clock(at: number): string {
  if (!at) return '';
  return new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch { /* clipboard API refusée : repli sur une sélection temporaire */ }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try { document.execCommand('copy'); } finally { area.remove(); }
}

/** Boutons du composer : Envoyer au repos, Stop + Envoyer pendant un tour. */
export function ComposerActions({
  canStop,
  hasText,
  disabled,
  onSend,
  onStop,
}: {
  canStop: boolean;
  hasText: boolean;
  disabled: boolean;
  onSend: () => void;
  onStop: () => void;
}) {
  if (canStop) {
    return (
      <>
        {hasText ? (
          <button
            type="button"
            data-testid="supervisor-queue-send"
            title="Mettre en file d'attente"
            aria-label="Mettre le message en file d'attente"
            onClick={onSend}
            className="flex h-[30px] w-[30px] shrink-0 cursor-pointer items-center justify-center rounded-[7px] bg-transparent p-[3px] text-green transition-colors hover:text-green"
          >
            <SendIcon />
          </button>
        ) : null}
        <button
          type="button"
          data-testid="supervisor-stop"
          title="Arrêter"
          aria-label="Arrêter le superviseur"
          onClick={onStop}
          className="flex h-[30px] w-[30px] shrink-0 cursor-pointer items-center justify-center rounded-[7px] bg-transparent p-[3px] text-muted transition-colors hover:text-danger"
        >
          <StopIcon />
        </button>
      </>
    );
  }
  return (
    <button
      type="button"
      data-testid="supervisor-send"
      title="Envoyer"
      aria-label="Envoyer"
      onClick={onSend}
      disabled={disabled}
      className={cx(
        'flex h-[30px] w-[30px] shrink-0 cursor-pointer items-center justify-center rounded-[7px] bg-transparent p-[3px] text-arrow transition-colors hover:text-green disabled:cursor-default disabled:opacity-40',
        hasText && !disabled ? 'text-green' : null,
      )}
    >
      <SendIcon />
    </button>
  );
}

/** Bouton « Nettoyer » : vide le chat, l'ancienne conversation reste dans OpenChamber. */
export function CleanChatButton({
  busy,
  creating,
  disabled,
  onClick,
}: {
  busy: boolean;
  creating: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="supervisor-new"
      aria-label="Nettoyer le chat"
      title={
        busy
          ? 'Attends la fin du tour'
          : creating
            ? 'Nettoyage…'
            : "Nettoyer le chat (l'ancienne conversation reste dans OpenChamber)"
      }
      disabled={disabled}
      onClick={onClick}
      className="flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] bg-transparent text-muted hover:bg-green-soft hover:text-green disabled:cursor-default disabled:opacity-40"
    >
      <BroomIcon />
    </button>
  );
}

/** Bloc d'un `send_task` : destinataire résolu à l'affichage, texte complet. */
export function SentTaskBlock({ tool, fleet }: { tool: ChatTool; fleet: Fleet | null }) {
  if (!tool.text) return null;
  return (
    <div
      data-testid="sent-to"
      data-task-id={tool.taskId}
      className="mt-[6px] rounded-[7px] border border-border bg-render px-[8px] py-[6px] text-[11.5px] leading-[1.45] text-muted"
    >
      <div>
        Envoyé à <b className="text-text">« {taskTitleOf(fleet, tool.taskId, tool.title)} »</b>
      </div>
      <div className="mt-[2px] whitespace-pre-wrap text-text [overflow-wrap:anywhere]">{tool.text}</div>
    </div>
  );
}

/** Heure + actions d'un message sur une seule ligne : copier et revenir ici. */
export function MessageMeta({
  message,
  disabled,
  onRevert,
}: {
  message: SupervisorMessage;
  disabled: boolean;
  onRevert: (message: SupervisorMessage) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await copyText(message.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div
      data-testid="message-meta"
      className={cx(
        'mt-[3px] flex min-h-[15px] items-center gap-[6px]',
        message.role === 'user' ? 'justify-end' : 'justify-start',
      )}
    >
      {message.at ? (
        <span className="text-[10px] leading-none text-placeholder">{clock(message.at)}</span>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-[4px]">
        {message.text ? (
          <button
            type="button"
            data-testid="message-copy"
            title={copied ? 'Copié' : 'Copier le message'}
            aria-label={copied ? 'Copié' : 'Copier le message'}
            onClick={() => void copy()}
            className={cx(
              'flex h-[15px] w-[15px] cursor-pointer items-center justify-center rounded-[3px] hover:bg-hover',
              copied ? 'text-green' : 'text-placeholder hover:text-text',
            )}
          >
            <CopyIcon />
          </button>
        ) : null}
        <button
          type="button"
          data-testid="message-revert"
          title="Revenir à partir d'ici"
          aria-label="Revenir à partir d'ici"
          disabled={disabled}
          onClick={() => onRevert(message)}
          className="flex h-[15px] w-[15px] cursor-pointer items-center justify-center rounded-[3px] text-placeholder hover:bg-hover hover:text-attend disabled:cursor-default disabled:opacity-40"
        >
          <RevertIcon />
        </button>
      </div>
    </div>
  );
}

export function SupervisorChat({ onCollapse }: Props) {
  useSupervisor();
  const state = useSupervisorStore((s) => s.state);
  const fleet = useFleetStore((s) => s.fleet);
  const loading = useSupervisorStore((s) => s.loading);
  const sending = useSupervisorStore((s) => s.sending);
  const creating = useSupervisorStore((s) => s.creating);
  const sendError = useSupervisorStore((s) => s.sendError);
  const refreshError = useSupervisorStore((s) => s.refreshError);
  const error = sendError ?? refreshError;
  const draft = useSupervisorStore((s) => s.draft);
  const setDraft = useSupervisorStore((s) => s.setDraft);
  const send = useSupervisorStore((s) => s.send);
  const removeQueued = useSupervisorStore((s) => s.removeQueued);
  const revert = useSupervisorStore((s) => s.revert);
  const reverting = useSupervisorStore((s) => s.reverting);
  const modeUpdating = useSupervisorStore((s) => s.modeUpdating);
  const newConversation = useSupervisorStore((s) => s.newConversation);
  const stop = useSupervisorStore((s) => s.stop);
  const refresh = useSupervisorStore((s) => s.refresh);
  const clearErrors = useSupervisorStore((s) => s.clearErrors);
  const setMode = useSupervisorStore((s) => s.setMode);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const focusAfterClean = useRef(false);
  const [stick, setStick] = useState(true);
  const [atMax, setAtMax] = useState(false);
  const [composerHeight, setComposerHeight] = useState(() =>
    clampComposer(Number(localStorage.getItem('superviseur.composerHeight')) || MIN_COMPOSER),
  );
  const [projects, setProjects] = useState<SupervisorProject[]>([]);
  const [modeError, setModeError] = useState<string | null>(null);

  const messages = state?.messages ?? [];
  const queued = state?.queued ?? [];
  const busy = sending || state?.status === 'busy';
  const canStop = !sending && state?.status === 'busy';
  const offline = !!refreshError;

  useEffect(() => {
    let active = true;
    void fetchSupervisorProjects().then((items) => {
      if (active) setProjects(items);
    }).catch(() => {
      if (active) setModeError('Impossible de charger les projets.');
    });
    return () => { active = false; };
  }, []);

  const mode = state?.mode ?? 'pilot';
  const projectDirectory = state?.projectDirectory ?? '';
  const changeMode = async (nextMode: 'pilot' | 'investigation', nextProject = projectDirectory || null) => {
    setModeError(null);
    try { await setMode(nextMode, nextProject); }
    catch (e) { setModeError(e instanceof Error ? e.message : 'Changement de mode impossible.'); }
  };

  useEffect(() => {
    localStorage.setItem('superviseur.composerHeight', String(composerHeight));
  }, [composerHeight]);

  useLayoutEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const natural = ta.scrollHeight + 1;
    const height = Math.max(composerHeight, Math.min(natural, MAX_COMPOSER));
    setAtMax(natural > MAX_COMPOSER);
    ta.style.height = `${height}px`;
  }, [draft, composerHeight]);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !stick) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, busy, stick]);

  // après « Nettoyer », remettre le curseur dans le champ dès que la nouvelle
  // session est prête (le textarea est désactivé pendant `creating`)
  useEffect(() => {
    if (!focusAfterClean.current || creating) return;
    focusAfterClean.current = false;
    inputRef.current?.focus();
  }, [creating]);

  const clean = () => {
    focusAfterClean.current = true;
    void newConversation();
  };

  const submit = () => {
    const value = draft.trim();
    if (!value || creating || reverting || modeUpdating) return;
    void send(value);
    setStick(true);
  };

  const onRevert = (message: SupervisorMessage) => {
    if (reverting) return;
    const ok = window.confirm(
      'Revenir à ce message ? Les messages suivants seront supprimés de la conversation.',
    );
    if (!ok) return;
    void revert(message.id, message.role === 'user' ? message.text : undefined);
  };

  const startComposerResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = composerHeight;
    const move = (ev: PointerEvent) => setComposerHeight(clampComposer(startHeight + startY - ev.clientY));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
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
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border border-border bg-card"
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
            {offline ? 'hors ligne' : busy ? 'réfléchit…' : mode === 'investigation' ? 'investigation en lecture seule' : 'orchestrateur'}
          </div>
        </div>
        <CleanChatButton
          busy={busy}
          creating={creating}
          disabled={sending || busy || creating || reverting}
          onClick={clean}
        />
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

      <div className="flex items-center gap-[6px] border-b border-border px-[10px] py-[6px]">
        <label className="sr-only" htmlFor="supervisor-mode">Mode du chat</label>
        <select
          id="supervisor-mode"
          data-testid="supervisor-mode"
          value={mode}
          disabled={loading || !state || busy || modeUpdating || creating}
          onChange={(event) => void changeMode(event.target.value as 'pilot' | 'investigation')}
          title="Piloter lance et pilote des tâches. Investigation lit le projet sélectionné sans pouvoir le modifier."
          className="h-[27px] min-w-0 rounded-[6px] border border-border bg-white px-[6px] text-[11.5px] text-text outline-none disabled:opacity-60"
        >
          <option value="pilot">Piloter</option>
          <option value="investigation" disabled={!projectDirectory}>Investigation</option>
        </select>
        <label className="sr-only" htmlFor="supervisor-project">Projet d’investigation</label>
        <select
          id="supervisor-project"
          data-testid="supervisor-project"
          value={projectDirectory}
          disabled={loading || !state || busy || modeUpdating || creating || projects.length === 0}
          onChange={(event) => void changeMode(mode, event.target.value || null)}
          title="Projet autorisé en mode Investigation"
          className="h-[27px] min-w-0 flex-1 rounded-[6px] border border-border bg-white px-[6px] text-[11.5px] text-text outline-none disabled:opacity-60"
        >
          <option value="">Choisir un projet…</option>
          {projects.map((project) => (
            <option key={project.id} value={project.directory}>{project.name}</option>
          ))}
        </select>
      </div>
      {modeError ? <div data-testid="supervisor-mode-error" className="px-[12px] pt-[5px] text-[10.5px] text-danger">{modeError}</div> : null}

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
            <div className="text-[14px] font-semibold">{mode === 'investigation' ? 'Explorons le projet avant de cadrer.' : 'Décris ce que tu veux lancer.'}</div>
            <div className="text-[12.5px] text-muted">
              {mode === 'investigation'
                ? `Lecture seule de ${projects.find((project) => project.directory === projectDirectory)?.name ?? 'projet sélectionné'} : je peux lire, chercher et proposer un cadrage, sans lancer ni modifier.`
                : 'Je précise le besoin si c\'est flou, je crée la tâche dans le bon projet, et la carte apparaît à droite.'}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-[13px]">
            {messages.map((message) => (
              <div
                key={message.id}
                data-testid={`chat-${message.role}`}
                data-message-id={message.id}
              >
                {message.role === 'user' ? (
                  <div className="ml-auto max-w-[88%]">
                    <div className="whitespace-pre-wrap rounded-[10px] bg-[#e9f1eb] px-[10px] py-[7px] text-[13px] text-text">
                      {message.text}
                    </div>
                    <MessageMeta message={message} disabled={reverting} onRevert={onRevert} />
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
                    {message.tools
                      .filter((tool) => tool.name === 'send_task' && tool.ok !== false && tool.text)
                      .map((tool, i) => (
                        <SentTaskBlock
                          key={`sent-${message.id}-${i}`}
                          tool={tool}
                          fleet={fleet}
                        />
                      ))}
                    <MessageMeta message={message} disabled={reverting} onRevert={onRevert} />
                  </div>
                )}
              </div>
            ))}
            {busy ? (
              <div data-testid="supervisor-busy" className="flex items-center gap-[7px] text-[12px] text-muted">
                <span className="h-[7px] w-[7px] rounded-full bg-orange animate-dot-blink" />
                Le superviseur travaille…
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

      <div className="border-t border-border">
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Redimensionner la zone de saisie"
          title="Redimensionner la zone de saisie"
          tabIndex={0}
          onPointerDown={startComposerResize}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setComposerHeight((h) => clampComposer(h + 10));
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setComposerHeight((h) => clampComposer(h - 10));
            }
          }}
          className="group flex h-[9px] cursor-ns-resize touch-none items-center justify-center outline-none"
        >
          <span className="h-[3px] w-[34px] rounded-full bg-[#d5dad5] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        </div>
        <div className="px-[13px] pb-[10px]">
          {queued.length ? (
            <div
              data-testid="supervisor-queue"
              className="mb-[7px] max-h-[88px] overflow-y-auto rounded-[7px] border border-border bg-render px-[8px] py-[5px]"
            >
              <div className="mb-[2px] text-[10.5px] font-semibold text-muted">En attente · {queued.length}</div>
              {queued.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-[6px] py-[2px] text-[11.5px] leading-[1.35] text-muted"
                >
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{item.text}</span>
                  <button
                    type="button"
                    data-testid="supervisor-queue-remove"
                    title="Retirer de la file"
                    aria-label="Retirer de la file"
                    onClick={() => void removeQueued(item.id)}
                    className="shrink-0 cursor-pointer rounded-[4px] px-[3px] leading-none hover:text-danger"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex items-end gap-[7px]">
            <textarea
              ref={inputRef}
              data-testid="supervisor-composer"
              rows={1}
              value={draft}
              disabled={creating || modeUpdating}
              placeholder={
                creating
                  ? 'Nettoyage…'
                  : busy
                    ? 'Ton message sera mis en file…'
                    : mode === 'investigation'
                      ? 'Que veux-tu explorer dans ce projet ?'
                      : 'Décris une tâche…'
              }
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              className={cx(
                'min-h-[34px] flex-1 resize-none rounded-[8px] border border-border bg-white px-[9px] py-[7px] font-[inherit] text-[13px] leading-[1.45] text-text outline-none placeholder:text-placeholder focus:border-[#c9cfc9] disabled:opacity-60',
                atMax ? 'overflow-y-auto' : 'overflow-y-hidden',
              )}
            />
            <ComposerActions
              canStop={canStop && !creating && !reverting}
              hasText={!!draft.trim()}
              disabled={sending || creating || reverting || modeUpdating || !draft.trim()}
              onSend={submit}
              onStop={() => void stop()}
            />
          </div>
          <div className="mt-[5px] text-[10.5px] text-placeholder">
            {busy && draft.trim()
              ? "Entrée pour mettre en file, Maj+Entrée pour une nouvelle ligne."
              : busy
                ? 'Le superviseur travaille : ton message sera mis en file.'
                : 'Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne.'}
          </div>
        </div>
      </div>
    </aside>
  );
}
