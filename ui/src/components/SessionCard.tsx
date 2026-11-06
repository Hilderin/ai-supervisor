import { useEffect, useRef, useState } from 'react';
import { closeConversation, replyPermission } from '../lib/api';
import { cx } from '../lib/cx';
import { briefRow, dirName, isStaleTurn } from '../lib/fleet';
import { BTN_PRIMARY } from '../lib/ui';
import { useFleetStore } from '../store/fleetStore';
import type { FleetRow } from '../types';
import { Composer } from './Composer';
import { ConfidenceDots } from './ConfidenceDots';
import { CloseConversationIcon, OpenChamberIcon } from './Icons';
import { QuestionBox } from './QuestionBox';

interface Props {
  row: FleetRow;
  waiting: boolean;
  done: boolean;
  now: number;
}

export function SessionCard({ row, waiting, done, now }: Props) {
  const closeSession = useFleetStore((s) => s.closeSession);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const kebabRef = useRef<HTMLButtonElement>(null);

  const stale = isStaleTurn(row);
  const brief = stale ? 'Réflexion en cours…' : row.sup?.resume || briefRow(row, waiting, now);
  const dir = dirName(row.dir);

  const form = row.pendingForms?.[0];
  const perm = row.pendingPermissions?.[0];

  const showBars = !!row.sup && (row.sup.progress != null || row.sup.confiance != null);
  const progress = row.sup?.progress ?? 0;
  const rawConf = row.sup?.confiance;
  const conf = rawConf == null ? null : Math.max(0, Math.min(1, rawConf));

  const close = () => {
    setMenuOpen(false);
    closeSession(row.id);
    void closeConversation(row.id).catch((e) => console.error('[done]', e));
  };

  // un clic ailleurs referme le menu (même comportement que la maquette)
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || kebabRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [menuOpen]);

  const dotClass = waiting
    ? 'bg-orange animate-dot-blink'
    : row.status === 'busy'
      ? 'border-2 border-green border-t-transparent border-r-transparent animate-dot-spin'
      : done
        ? 'bg-green opacity-[.35]'
        : 'bg-green';

  return (
    <div
      data-sid={row.id}
      className={cx(
        'relative mb-[9px] rounded-[11px] border px-[13px] pb-[10px] pt-[11px]',
        waiting ? 'border-wait-border bg-wait' : 'border-border bg-card',
      )}
    >
      <div className="flex items-center gap-[9px]">
        <span className={cx('h-[10px] w-[10px] shrink-0 rounded-full', dotClass)} />
        <span className="max-w-[42%] overflow-hidden text-ellipsis whitespace-nowrap font-[650]">
          {row.title}
        </span>
        {waiting ? (
          <span className="shrink-0 whitespace-nowrap rounded-[9px] bg-orange px-[9px] py-[2px] text-[11.5px] font-semibold text-white">
            attends ta réponse
          </span>
        ) : null}
        <span className="flex-1" />
        {dir ? (
          <span
            title={row.dir}
            className="max-w-[130px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap rounded-[5px] bg-hover px-[7px] py-[2px] text-[11px] text-muted"
          >
            {dir}
          </span>
        ) : null}
        <button
          ref={kebabRef}
          type="button"
          title="Options"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className="flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] bg-transparent text-[14px] tracking-[1px] text-muted hover:bg-hover hover:text-text"
        >
          ⋯
        </button>
        <button
          type="button"
          title="Ouvrir dans OpenChamber"
          onClick={() => window.open(`openchamber-ui://session/${row.id}`)}
          className="flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] bg-transparent text-muted hover:bg-green-soft hover:text-green"
        >
          <OpenChamberIcon />
        </button>
      </div>

      <div className="mt-[5px] pr-[26px] text-[13.5px] text-muted">{brief}</div>
      {row.sup?.attend ? (
        <div className="mt-[3px] pr-[26px] text-[13.5px] text-attend">✋ {row.sup.attend}</div>
      ) : null}

      {showBars ? (
        <div className="mt-[8px] flex items-center gap-[10px]">
          <span className="h-[5px] flex-1 overflow-hidden rounded-[3px] bg-track">
            <span
              className={cx(
                'block h-full transition-[width] duration-500',
                progress > 0 && progress < 66 ? 'bg-amber' : 'bg-green',
              )}
              style={{ width: `${progress}%` }}
            />
          </span>
          <ConfidenceDots conf={conf} note={row.sup?.note} />
          <span className="w-[34px] text-right text-[12px] font-[650] tabular-nums">
            {Math.round(progress)}%
          </span>
        </div>
      ) : null}

      {perm ? (
        <div className="mt-[10px] border-t border-border pt-[10px]">
          <div className="mb-[8px] text-[14px] leading-[1.45]">Permission demandée</div>
          <div className="flex items-center gap-[7px]">
            <button
              type="button"
              onClick={() =>
                void replyPermission(row.id, String(perm.id ?? ''), 'once').catch((e) =>
                  console.error('[replyPermission]', e),
                )
              }
              className={BTN_PRIMARY}
            >
              Autoriser
            </button>
          </div>
        </div>
      ) : form ? (
        <QuestionBox key={form.id} sessionId={row.id} form={form} />
      ) : null}

      <Composer sessionId={row.id} />

      {done ? (
        <div className="mt-[9px] flex items-center gap-[7px] border-t border-border pt-[9px]">
          <span className="flex-1" />
          <button type="button" onClick={close} className={BTN_PRIMARY}>
            Fermer
          </button>
        </div>
      ) : null}

      {menuOpen ? (
        <div
          ref={menuRef}
          className="absolute top-[36px] right-[8px] z-50 min-w-[230px] overflow-hidden rounded-[8px] border border-border bg-card shadow-[0_6px_18px_rgba(0,0,0,.12)]"
        >
          <button
            type="button"
            onClick={close}
            className="flex w-full cursor-pointer items-center gap-[8px] bg-transparent px-[12px] py-[9px] text-left text-[13.5px] text-text hover:bg-hover"
          >
            <span className="shrink-0 opacity-[.65]">
              <CloseConversationIcon />
            </span>
            Fermer cette conversation
          </button>
        </div>
      ) : null}
    </div>
  );
}
