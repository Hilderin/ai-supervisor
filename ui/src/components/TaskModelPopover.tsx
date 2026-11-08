/**
 * Engrenage du détail d'une tâche : modèle propre à la tâche.
 *
 * Il vit dans l'en-tête, juste à gauche de la flèche OpenChamber. Le popover
 * est un portail en position fixe (le panneau de détail peut défiler) et reste
 * petit : un select, le modèle effectif, Enregistrer / Fermer.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { saveTaskModel } from '../lib/api';
import type { TaskModelInfo } from '../types';
import { ModelSelect } from './ConfigPopover';
import { GearIcon } from './Icons';

const WIDTH = 330;
const GAP = 8;
const MARGIN = 8;

/** Libellé du modèle affiché dans le détail (pur, testé). */
export function taskModelLabel(info: TaskModelInfo | null, loading: boolean, error: string | null): string {
  if (loading && !info) return 'modèle…';
  if (error && !info) return 'modèle indisponible';
  const name = info?.name?.trim();
  return `modèle · ${name || 'défaut de la session'}`;
}

/** Contenu du popover, séparé pour le rendu statique des tests. */
export function TaskModelFields({
  info,
  value,
  loading,
  error,
  saveError,
  onChange,
}: {
  info: TaskModelInfo | null;
  value: string;
  loading: boolean;
  error: string | null;
  saveError: string | null;
  onChange: (next: string) => void;
}) {
  if (!info) {
    return (
      <div data-testid="task-model-loading" className="text-[11px] text-muted">
        {error ?? (loading ? 'Chargement du catalogue…' : 'Modèle indisponible.')}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-[8px]">
      <ModelSelect
        testId="task-model-select"
        label="Modèle de la tâche"
        value={value}
        models={info.models}
        defaultLabel="Défaut de la session"
        onChange={onChange}
      />
      <div data-testid="task-model-effective" className="text-[10.5px] leading-[1.4] text-muted">
        Effectif : <b className="font-normal text-text">{info.name ?? info.effective ?? 'inconnu'}</b>
        {info.model ? null : ' (défaut de la session)'}
      </div>
      {saveError ? (
        <div
          data-testid="task-model-error"
          role="status"
          className="rounded-[6px] bg-orange-soft px-[7px] py-[5px] text-[10.5px] leading-[1.4] text-attend"
        >
          {saveError}
        </div>
      ) : null}
    </div>
  );
}

export function TaskModelPopover({
  sessionId,
  info,
  loading,
  error,
  onSaved,
}: {
  sessionId: string;
  info: TaskModelInfo | null;
  loading: boolean;
  error: string | null;
  onSaved: (info: TaskModelInfo) => void;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // à l'ouverture, le select part de la préférence de la tâche
  useEffect(() => {
    if (!open) return;
    setValue(info?.model ?? '');
    setSaveError(null);
  }, [open, info?.model]);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const pop = popRef.current?.getBoundingClientRect();
      if (!anchor || !pop) return;
      const left = Math.min(
        Math.max(MARGIN, anchor.right - pop.width),
        window.innerWidth - pop.width - MARGIN,
      );
      let top = anchor.bottom + GAP;
      if (top + pop.height > window.innerHeight - MARGIN) {
        top = Math.max(MARGIN, anchor.top - pop.height - GAP);
      }
      setPos({ left, top });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, info, saveError]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await saveTaskModel(sessionId, value || null);
      if (!result.ok || !result.info) {
        setSaveError(result.message ?? 'Changement de modèle impossible.');
        return;
      }
      onSaved(result.info);
      if (result.persisted === false) {
        setSaveError('Modèle appliqué à la session, mais la tâche n’a pas de brief : il ne sera pas conservé pour une reprise.');
        return;
      }
      setOpen(false);
    } catch {
      setSaveError('Changement de modèle impossible. Le daemon répond-il ?');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        data-testid="task-config-button"
        aria-label="Changer le modèle de la tâche"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Changer le modèle de la tâche (${info?.name ?? 'chargement…'})`}
        onClick={() => setOpen(v => !v)}
        className="flex h-[24px] w-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] bg-transparent text-muted hover:bg-hover hover:text-text"
      >
        <GearIcon />
      </button>

      {open
        ? createPortal(
            <div
              ref={popRef}
              role="dialog"
              aria-label="Modèle de la tâche"
              style={{
                position: 'fixed',
                left: pos?.left ?? 0,
                top: pos?.top ?? 0,
                width: WIDTH,
                visibility: pos ? 'visible' : 'hidden',
              }}
              className="z-[200] flex max-h-[calc(100vh-16px)] flex-col rounded-[9px] border border-border bg-card px-[11px] py-[9px] text-left shadow-[0_8px_22px_rgba(0,0,0,.16)]"
            >
              <div className="mb-[7px] text-[11.5px] font-semibold">Modèle de la tâche</div>
              <TaskModelFields
                info={info}
                value={value}
                loading={loading}
                error={error}
                saveError={saveError}
                onChange={(next) => { setValue(next); setSaveError(null); }}
              />
              <div className="mt-[9px] flex items-center justify-end gap-[6px] border-t border-border pt-[8px]">
                <button
                  type="button"
                  data-testid="task-model-close"
                  onClick={() => setOpen(false)}
                  className="cursor-pointer rounded-[6px] px-[8px] py-[3px] text-[11px] text-muted hover:bg-hover hover:text-text"
                >
                  Fermer
                </button>
                <button
                  type="button"
                  data-testid="task-model-save"
                  disabled={!info || saving}
                  onClick={() => void save()}
                  className="cursor-pointer rounded-[6px] bg-green px-[9px] py-[3px] text-[11px] font-semibold text-white disabled:cursor-default disabled:opacity-50"
                >
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
