import { cx } from '../lib/cx';
import type { FleetActivity } from '../types';
import { ActivityIcon } from './Icons';

interface Props {
  activity?: FleetActivity | null;
  className?: string;
}

/**
 * Une seule ligne discrète : icône du type, libellé court, puis le sujet
 * (nom de fichier, motif, commande). Le sujet est tronqué par CSS sur une
 * ligne ; le texte complet reste dans l'infobulle. Aucun historique : le
 * composant rend l'état courant, jamais une liste.
 */
export function ActivityLine({ activity, className }: Props) {
  if (!activity) return null;
  const full = activity.title ?? [activity.label, activity.detail].filter(Boolean).join(' · ');
  return (
    <span
      data-testid="activity-line"
      aria-label={full}
      title={full}
      className={cx(
        'flex min-w-0 max-w-full items-center gap-[6px] whitespace-nowrap text-[11.5px] leading-[1.3] text-muted',
        className,
      )}
    >
      <span className="flex h-[14px] w-[14px] shrink-0 items-center justify-center opacity-[.78]">
        <ActivityIcon kind={activity.kind} />
      </span>
      <span className="shrink-0 font-medium">{activity.label}</span>
      {activity.detail ? (
        <>
          <span aria-hidden="true" className="shrink-0 text-placeholder">
            ·
          </span>
          <span
            data-testid="activity-detail"
            className="min-w-0 truncate font-normal"
          >
            {activity.detail}
          </span>
        </>
      ) : null}
    </span>
  );
}
