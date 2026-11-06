import { confidenceColor, confidenceLevel } from '../lib/fleet';

interface Props {
  conf: number | null;
  note?: string;
}

/**
 * Trois pastilles de confiance + tooltip HTML (confidence_reason).
 * Le tooltip est en HTML réel (pas attr()) pour que le texte long se replie.
 */
export function ConfidenceDots({ conf, note }: Props) {
  const level = confidenceLevel(conf);
  const color = confidenceColor(conf);

  return (
    <span className="group relative flex shrink-0 cursor-help items-center gap-[3px] p-[4px]">
      {[0, 1, 2].map((i) => (
        <i
          key={i}
          className="block h-[7px] w-[7px] rounded-full"
          style={{ background: i < level ? (color ?? undefined) : '#dcdedd' }}
        />
      ))}
      <span className="absolute right-[-6px] bottom-[18px] z-[70] hidden max-w-[300px] rounded-[9px] bg-ink px-[11px] py-[9px] text-left text-[12.5px] leading-[1.5] text-white shadow-[0_8px_22px_rgba(0,0,0,.22)] [overflow-wrap:anywhere] group-hover:block">
        {conf == null ? (
          <>
            <b>Confiance non disponible</b>
            {note ? (
              <>
                <br />
                {note}
              </>
            ) : null}
          </>
        ) : (
          <>
            <b>Confiance {Math.round(conf * 100)} %</b>
            {note ? (
              <>
                <br />
                {note}
              </>
            ) : null}
          </>
        )}
      </span>
    </span>
  );
}
