import { isClosedRow, useFleetStore } from '../store/fleetStore';
import { isDone, isWaiting } from '../lib/fleet';
import type { Fleet, FleetRow } from '../types';
import { SessionCard } from './SessionCard';

interface Props {
  fleet: Fleet | null;
  now: number;
}

interface SectionProps {
  dot: string;
  label: string;
  rows: FleetRow[];
  waiting: boolean;
  done: boolean;
  now: number;
}

function Section({ dot, label, rows, waiting, done, now }: SectionProps) {
  return (
    <>
      <div className="mb-[9px] mt-[18px] flex items-center gap-[8px] text-[13px] font-bold tracking-[.02em]">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {label}
        <span className="rounded-[9px] border border-border bg-card px-[8px] py-[1px] text-[11px] font-semibold text-muted">
          {rows.length}
        </span>
      </div>
      {rows.map((row) => (
        <SessionCard key={row.id} row={row} waiting={waiting} done={done} now={now} />
      ))}
    </>
  );
}

/** Trois sections : attention (form/permission), en cours, terminé. */
export function FleetBoard({ fleet, now }: Props) {
  const closed = useFleetStore((s) => s.closed);
  const placements = useFleetStore((s) => s.placements);

  const waiting: FleetRow[] = [];
  const running: FleetRow[] = [];
  const done: FleetRow[] = [];

  for (const row of fleet?.rows ?? []) {
    if (isClosedRow(row, closed)) continue;
    const section =
      placements[row.id]?.section ?? (isWaiting(row) ? 'waiting' : isDone(row) ? 'done' : 'running');
    if (section === 'waiting') waiting.push(row);
    else if (section === 'done') done.push(row);
    else running.push(row);
  }

  return (
    <>
      <Section dot="bg-orange" label="BESOIN DE TON ATTENTION" rows={waiting} waiting done={false} now={now} />
      <Section dot="bg-green" label="EN COURS" rows={running} waiting={false} done={false} now={now} />
      <Section dot="bg-green opacity-40" label="TERMINÉ" rows={done} waiting={false} done now={now} />
    </>
  );
}
