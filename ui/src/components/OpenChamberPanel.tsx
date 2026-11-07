import { useEffect, useState } from 'react';
import { fetchOpenChamberMiniChatUrl } from '../lib/openchamberFrame';

interface Props {
  sessionId: string;
  sessionTitle: string;
  onClose: () => void;
}

export function OpenChamberPanel({ sessionId, sessionTitle, onClose }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setSrc(null);
    setError(null);
    void fetchOpenChamberMiniChatUrl(sessionId, controller.signal)
      .then(setSrc)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(String((reason as Error)?.message ?? reason));
      });
    return () => controller.abort();
  }, [sessionId]);

  const panelTitle = `OpenChamber - ${sessionTitle}`;

  return (
    <section data-testid="openchamber-panel" className="flex h-full min-h-0 flex-col overflow-hidden border border-border bg-card">
      <header className="flex h-[36px] shrink-0 items-center gap-[8px] border-b border-border px-[10px]">
        <span title={panelTitle} className="min-w-0 flex-1 truncate text-[12px] font-semibold text-text">{panelTitle}</span>
        <button
          type="button"
          aria-label="Fermer le panneau Mini Chat"
          title="Fermer le panneau Mini Chat"
          onClick={onClose}
          className="flex h-[24px] w-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-[18px] leading-none text-muted hover:bg-hover hover:text-text"
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div className="relative min-h-0 flex-1 bg-bg">
        {!src && !error ? <div className="absolute inset-0 flex items-center justify-center text-[12px] text-muted">Chargement d’OpenChamber…</div> : null}
        {error ? <div role="alert" className="absolute inset-0 flex items-center justify-center p-[16px] text-center text-[12px] text-danger">{error}</div> : null}
        {src ? (
          <iframe
            data-testid="openchamber-frame"
            title="Conversation OpenChamber"
            src={src}
            referrerPolicy="no-referrer"
            className="h-full w-full border-0"
          />
        ) : null}
      </div>
    </section>
  );
}
