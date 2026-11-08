import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { FleetBoard } from './components/FleetBoard';
import { PanelLeftIcon } from './components/Icons';
import { SupervisorChat } from './components/SupervisorChat';
import { TaskInspector } from './components/TaskInspector';
import { OpenChamberPanel } from './components/OpenChamberPanel';
import { useFleetStream } from './hooks/useFleetStream';
import { useNow } from './hooks/useNow';
import { cardState } from './lib/cardState';
import { cx } from './lib/cx';
import {
  MIN_INSPECTOR_WIDTH,
  clampInspectorWidth,
  inspectorMaxWidth,
  panelWidths,
} from './lib/panelLayout';
import { useFleetStore } from './store/fleetStore';

const MIN_CHAT = 320;
const MAX_CHAT = 480;
const DEFAULT_CHAT = 380;

const DEFAULT_INSPECTOR = 460;
const MIN_OPENCHAMBER = 320;
const MAX_OPENCHAMBER = 680;
const DEFAULT_OPENCHAMBER = 380;
const MIN_FLEET = 320;

/** Colonne du chat et sa poignée, ou le rail replié (34 px + 8 px de marge). */
function chatAreaWidth(chatOpen: boolean, chatWidth: number): number {
  return chatOpen ? chatWidth + 15 : 42;
}

/** Valeur enregistrée, jamais 0 ni NaN : le repli est une vraie préférence. */
function storedWidth(key: string, fallback: number): number {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function clampWidth(n: number): number {
  return Math.max(MIN_CHAT, Math.min(MAX_CHAT, Math.round(n)));
}

function clampOpenChamber(n: number): number {
  return Math.max(MIN_OPENCHAMBER, Math.min(MAX_OPENCHAMBER, Math.round(n)));
}

export default function App() {
  useFleetStream();
  const fleet = useFleetStore((s) => s.fleet);
  const error = useFleetStore((s) => s.error);
  const selected = useFleetStore((s) => s.selected);
  const setSelected = useFleetStore((s) => s.setSelected);
  const placements = useFleetStore((s) => s.placements);
  const now = useNow(1000);
  const [chatOpen, setChatOpen] = useState(() => localStorage.getItem('superviseur.chat') !== 'closed');
  const [chatWidth, setChatWidth] = useState(() => clampWidth(storedWidth('superviseur.chatWidth', DEFAULT_CHAT)));
  // Largeurs VOULUES, pas les largeurs affichées : la fenêtre ne fait que les
  // contraindre, un redimensionnement n'écrase donc jamais la préférence.
  const [inspectorWanted, setInspectorWanted] = useState(
    () => Math.max(MIN_INSPECTOR_WIDTH, storedWidth('superviseur.inspectorWidth', DEFAULT_INSPECTOR)),
  );
  const [centerWanted, setCenterWanted] = useState(() => {
    const stored = Number(localStorage.getItem('superviseur.centerWidth'));
    if (Number.isFinite(stored) && stored > 0) return Math.round(stored);
    // rien d'enregistré : le central prend la place laissée par le détail
    const available = Math.max(0, window.innerWidth - chatAreaWidth(chatOpen, chatWidth) - 15);
    return Math.max(0, Math.min(available, Math.max(MIN_FLEET, available - inspectorWanted)));
  });
  const [openChamberWidth, setOpenChamberWidth] = useState(
    () => clampOpenChamber(storedWidth('superviseur.openChamberWidth', DEFAULT_OPENCHAMBER)),
  );
  // largeur réelle du conteneur des panneaux (barre de défilement éventuelle déduite)
  const [layoutWidth, setLayoutWidth] = useState(() => window.innerWidth);
  const [view, setView] = useState<'chat' | 'fleet' | 'openchamber'>('chat');
  const [openChamberSessionId, setOpenChamberSessionId] = useState<string | null>(null);
  const [openChamberTitle, setOpenChamberTitle] = useState<string | null>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const autoCollapsedChat = useRef(false);
  const viewBeforeOpenChamber = useRef<'chat' | 'fleet'>('chat');

  useEffect(() => {
    localStorage.setItem('superviseur.chat', chatOpen ? 'open' : 'closed');
  }, [chatOpen]);

  useEffect(() => {
    localStorage.setItem('superviseur.chatWidth', String(chatWidth));
  }, [chatWidth]);

  useEffect(() => {
    localStorage.setItem('superviseur.inspectorWidth', String(inspectorWanted));
  }, [inspectorWanted]);

  useEffect(() => {
    localStorage.setItem('superviseur.centerWidth', String(centerWanted));
  }, [centerWanted]);

  useEffect(() => {
    localStorage.setItem('superviseur.openChamberWidth', String(openChamberWidth));
  }, [openChamberWidth]);

  // mesure le conteneur : fenêtre, barre de défilement, panneaux masqués en étroit
  useLayoutEffect(() => {
    const element = layoutRef.current;
    if (!element) return;
    const measure = () => setLayoutWidth(element.clientWidth || window.innerWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const inspectorAvailable = Math.max(0, layoutWidth - chatAreaWidth(chatOpen, chatWidth) - 15);
  const { inspector: inspectorWidth } = panelWidths({
    windowWidth: layoutWidth,
    availableWidth: inspectorAvailable,
    inspectorWanted,
    centerWanted,
  });

  /** Pose la largeur du détail : la poignée fixe aussi ce que le central garde. */
  const sizeInspector = (next: number) => {
    const width = clampInspectorWidth(next, layoutWidth, inspectorAvailable);
    setInspectorWanted(width);
    setCenterWanted(Math.max(0, inspectorAvailable - width));
  };

  const selectedRow = selected
    ? (fleet?.rows.find((row) => row.id === selected) ?? null)
    : null;
  const selectedState = selectedRow ? cardState(selectedRow, placements[selectedRow.id]?.section) : null;

  const openChamber = (sessionId: string) => {
    if (!openChamberSessionId) viewBeforeOpenChamber.current = view === 'openchamber' ? 'chat' : view;
    const task = fleet?.rows.find((row) => row.id === sessionId);
    const isTaskSession = Boolean(task);
    if (isTaskSession) setSelected(sessionId);
    setOpenChamberTitle(task?.title ?? 'Superviseur');
    const hasInspector = isTaskSession || Boolean(selectedRow);
    const requiredWidth =
      MIN_FLEET + openChamberWidth + 15 +
      (hasInspector ? inspectorWidth + 15 : 0) +
      chatAreaWidth(chatOpen, chatWidth);
    const availableWidth = layoutRef.current?.clientWidth ?? window.innerWidth;
    if (chatOpen && requiredWidth > availableWidth) {
      autoCollapsedChat.current = true;
      setChatOpen(false);
    }
    setOpenChamberSessionId(sessionId);
    if (window.innerWidth <= 1100) setView('openchamber');
  };

  const closeOpenChamber = () => {
    setOpenChamberSessionId(null);
    setOpenChamberTitle(null);
    if (view === 'openchamber') setView(viewBeforeOpenChamber.current);
    if (autoCollapsedChat.current) {
      autoCollapsedChat.current = false;
      setChatOpen(true);
    }
  };

  const collapseChat = () => {
    autoCollapsedChat.current = false;
    setChatOpen(false);
  };

  const expandChat = () => {
    autoCollapsedChat.current = false;
    setChatOpen(true);
  };

  const startOpenChamberResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = openChamberWidth;
    const move = (ev: PointerEvent) => setOpenChamberWidth(clampOpenChamber(startWidth - (ev.clientX - startX)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // un clic hors des composers (menu de la carte, question, ailleurs) libère
  // le focus mémorisé : sans ce garde-fou, on rendrait le curseur bien après
  // que l'utilisateur a passé la main
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-composer]')) return;
      if (useFleetStore.getState().focused !== null) useFleetStore.getState().setFocus(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = chatWidth;
    const move = (ev: PointerEvent) => setChatWidth(clampWidth(startWidth + ev.clientX - startX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Le détail est la colonne de droite : tirer la poignée vers la gauche l'élargit.
  const startInspectorResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = inspectorWidth;
    const move = (ev: PointerEvent) => sizeInspector(startWidth - (ev.clientX - startX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="flex h-screen min-h-0 flex-col">
      {chatOpen || openChamberSessionId ? (
        <div
          data-testid="narrow-tabs"
          className="mb-[8px] flex shrink-0 self-start overflow-hidden rounded-[7px] border border-border bg-white min-[1100px]:hidden"
        >
          <button
            type="button"
            onClick={() => {
              setView('chat');
              expandChat();
            }}
            aria-pressed={view === 'chat'}
            className={cx(
              'cursor-pointer px-[9px] py-[4px] text-[11.5px]',
              view === 'chat' ? 'bg-green text-white' : 'bg-white text-muted',
            )}
          >
            Chat
          </button>
          <button
            type="button"
            onClick={() => setView('fleet')}
            aria-pressed={view === 'fleet'}
            className={cx(
              'cursor-pointer px-[9px] py-[4px] text-[11.5px]',
              view === 'fleet' ? 'bg-green text-white' : 'bg-white text-muted',
            )}
          >
              Tâches
            </button>
          {openChamberSessionId ? (
            <button
              type="button"
              onClick={() => setView('openchamber')}
              aria-pressed={view === 'openchamber'}
              className={cx(
                'cursor-pointer px-[9px] py-[4px] text-[11.5px]',
                view === 'openchamber' ? 'bg-green text-white' : 'bg-white text-muted',
              )}
            >
              OpenChamber
            </button>
          ) : null}
        </div>
      ) : null}

      <div ref={layoutRef} className="flex min-h-0 flex-1">
        {chatOpen ? (
          <div
            data-testid="chat-column"
            style={{ '--chat-width': `${chatWidth}px` } as CSSProperties}
            className={cx(
              'h-full w-[var(--chat-width)] min-h-0 min-w-0 shrink-0 max-[1100px]:w-full',
              view !== 'chat' ? 'max-[1100px]:hidden' : null,
            )}
          >
            <div className="h-full min-h-0">
              <SupervisorChat onCollapse={collapseChat} onOpenMiniChat={openChamber} />
            </div>
          </div>
        ) : (
          <div
            data-testid="chat-rail"
            className={cx(
              'mr-[8px] flex w-[34px] shrink-0 flex-col items-center border-r border-border bg-card pt-[5px]',
              view !== 'chat' ? 'max-[1100px]:hidden' : null,
            )}
          >
            <button
              type="button"
              data-testid="open-chat-rail"
              aria-label="Afficher le chat"
              title="Afficher le chat"
              onClick={() => {
                setView('chat');
                expandChat();
              }}
              className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] bg-transparent text-muted hover:bg-hover hover:text-text"
            >
              <PanelLeftIcon />
            </button>
          </div>
        )}

        {chatOpen ? (
          <div
            data-testid="chat-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionner le chat"
            tabIndex={0}
            title="Redimensionner le chat (flèches gauche/droite)"
            onPointerDown={startResize}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') { e.preventDefault(); setChatWidth((w) => clampWidth(w - 10)); }
              if (e.key === 'ArrowRight') { e.preventDefault(); setChatWidth((w) => clampWidth(w + 10)); }
              if (e.key === 'Home') { e.preventDefault(); setChatWidth(MIN_CHAT); }
              if (e.key === 'End') { e.preventDefault(); setChatWidth(MAX_CHAT); }
            }}
            className="group hidden w-[15px] shrink-0 cursor-col-resize touch-none select-none items-stretch justify-center outline-none min-[1100px]:flex"
          >
            <span className="relative flex w-[1px] items-center justify-center bg-border transition-colors group-hover:bg-green">
              <span className="h-[26px] w-[4px] rounded-full bg-[#d5dad5] transition-colors group-hover:bg-green" />
            </span>
          </div>
        ) : null}

        <main
          data-testid="fleet-pane"
          className={cx(
            'min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pr-[1px] max-[1100px]:pr-0',
            (chatOpen && view === 'chat') || view === 'openchamber' ? 'max-[1100px]:hidden' : null,
          )}
        >
          <FleetBoard fleet={fleet} now={now} onOpenChamber={openChamber} />
          {error ? (
            <div className="mt-[10px] rounded-[8px] bg-orange-soft px-[12px] py-[8px] text-[12px] text-attend">
              {error}
            </div>
          ) : null}
        </main>

        {selectedRow && selectedState ? (
          <div
            data-testid="inspector-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionner le détail de la tâche"
            tabIndex={0}
            title="Redimensionner le détail (flèches gauche/droite)"
            onPointerDown={startInspectorResize}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') { e.preventDefault(); sizeInspector(inspectorWidth + 10); }
              if (e.key === 'ArrowRight') { e.preventDefault(); sizeInspector(inspectorWidth - 10); }
              if (e.key === 'Home') { e.preventDefault(); sizeInspector(MIN_INSPECTOR_WIDTH); }
              if (e.key === 'End') { e.preventDefault(); sizeInspector(inspectorMaxWidth(layoutWidth, inspectorAvailable)); }
            }}
            className="group hidden w-[15px] shrink-0 cursor-col-resize touch-none select-none items-stretch justify-center outline-none min-[1100px]:flex"
          >
            <span className="relative flex w-[1px] items-center justify-center bg-border transition-colors group-hover:bg-green">
              <span className="h-[26px] w-[4px] rounded-full bg-[#d5dad5] transition-colors group-hover:bg-green" />
            </span>
          </div>
        ) : null}

        {selectedRow && selectedState ? (
          <aside
            data-testid="inspector-pane"
            style={{ '--inspector-width': `${inspectorWidth}px` } as CSSProperties}
            className={cx(
              'h-full min-h-0 w-[var(--inspector-width)] shrink-0 overflow-hidden border-l border-border bg-card max-[1100px]:w-full',
              (chatOpen && view === 'chat') || view === 'openchamber' ? 'max-[1100px]:hidden' : null,
            )}
          >
            <TaskInspector
              row={selectedRow}
              state={selectedState}
              now={now}
              onClose={() => setSelected(null)}
              onOpenChamber={openChamber}
            />
          </aside>
        ) : null}
        {openChamberSessionId ? (
          <>
            <div
              data-testid="openchamber-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label="Redimensionner le panneau OpenChamber"
              tabIndex={0}
              title="Redimensionner OpenChamber (flèches gauche/droite)"
              onPointerDown={startOpenChamberResize}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') { e.preventDefault(); setOpenChamberWidth((w) => clampOpenChamber(w + 10)); }
                if (e.key === 'ArrowRight') { e.preventDefault(); setOpenChamberWidth((w) => clampOpenChamber(w - 10)); }
                if (e.key === 'Home') { e.preventDefault(); setOpenChamberWidth(MIN_OPENCHAMBER); }
                if (e.key === 'End') { e.preventDefault(); setOpenChamberWidth(MAX_OPENCHAMBER); }
              }}
              className="group hidden w-[15px] shrink-0 cursor-col-resize touch-none select-none items-stretch justify-center outline-none min-[1100px]:flex"
            >
              <span className="relative flex w-[1px] items-center justify-center bg-border transition-colors group-hover:bg-green">
                <span className="h-[26px] w-[4px] rounded-full bg-[#d5dad5] transition-colors group-hover:bg-green" />
              </span>
            </div>
            <aside
              data-testid="openchamber-pane"
              style={{ '--openchamber-width': `${openChamberWidth}px` } as CSSProperties}
              className={cx(
                'h-full min-h-0 w-[var(--openchamber-width)] shrink-0 overflow-hidden border-l border-border bg-card max-[1100px]:w-full',
                view !== 'openchamber' ? 'max-[1100px]:hidden' : null,
              )}
            >
              <OpenChamberPanel
                sessionId={openChamberSessionId}
                sessionTitle={openChamberTitle ?? 'Superviseur'}
                onClose={closeOpenChamber}
              />
            </aside>
          </>
        ) : null}
      </div>
    </div>
  );
}
