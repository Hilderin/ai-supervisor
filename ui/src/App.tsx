import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { FleetBoard } from './components/FleetBoard';
import { PanelLeftIcon } from './components/Icons';
import { SupervisorChat } from './components/SupervisorChat';
import { useFleetStream } from './hooks/useFleetStream';
import { useNow } from './hooks/useNow';
import { cx } from './lib/cx';
import { useFleetStore } from './store/fleetStore';

const MIN_CHAT = 320;
const MAX_CHAT = 480;
const DEFAULT_CHAT = 380;

function clampWidth(n: number): number {
  return Math.max(MIN_CHAT, Math.min(MAX_CHAT, Math.round(n)));
}

export default function App() {
  useFleetStream();
  const fleet = useFleetStore((s) => s.fleet);
  const error = useFleetStore((s) => s.error);
  const now = useNow(1000);
  const [chatOpen, setChatOpen] = useState(() => localStorage.getItem('superviseur.chat') !== 'closed');
  const [chatWidth, setChatWidth] = useState(() => clampWidth(Number(localStorage.getItem('superviseur.chatWidth')) || DEFAULT_CHAT));
  const [view, setView] = useState<'chat' | 'fleet'>('chat');
  const layoutRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('superviseur.chat', chatOpen ? 'open' : 'closed');
  }, [chatOpen]);

  useEffect(() => {
    localStorage.setItem('superviseur.chatWidth', String(chatWidth));
  }, [chatWidth]);

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

  return (
    <div className="flex h-[calc(100vh-40px)] min-h-0 flex-col">
      {chatOpen ? (
        <div
          data-testid="narrow-tabs"
          className="mb-[8px] flex shrink-0 self-start overflow-hidden rounded-[7px] border border-border bg-white min-[1100px]:hidden"
        >
          <button
            type="button"
            onClick={() => setView('chat')}
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
        </div>
      ) : null}

      <div ref={layoutRef} className="flex min-h-0 flex-1">
        {chatOpen ? (
          <div
            data-testid="chat-column"
            style={{ '--chat-width': `${chatWidth}px` } as CSSProperties}
            className={cx(
              'h-full w-[var(--chat-width)] min-h-0 min-w-0 shrink-0 max-[1100px]:w-full',
              view === 'fleet' ? 'max-[1100px]:hidden' : null,
            )}
          >
            <SupervisorChat onCollapse={() => setChatOpen(false)} />
          </div>
        ) : (
          <div
            data-testid="chat-rail"
            className="mr-[8px] flex w-[34px] shrink-0 flex-col items-center border-r border-border bg-card pt-[5px]"
          >
            <button
              type="button"
              data-testid="open-chat-rail"
              aria-label="Afficher le chat"
              title="Afficher le chat"
              onClick={() => {
                setView('chat');
                setChatOpen(true);
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
            'min-h-0 min-w-0 flex-1 overflow-y-auto pr-[1px]',
            chatOpen && view === 'chat' ? 'max-[1100px]:hidden' : null,
          )}
        >
          <FleetBoard fleet={fleet} now={now} />
          {error ? (
            <div className="mt-[10px] rounded-[8px] bg-orange-soft px-[12px] py-[8px] text-[12px] text-attend">
              {error}
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
