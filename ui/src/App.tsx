import { FleetBoard } from './components/FleetBoard';
import { useFleetStream } from './hooks/useFleetStream';
import { useNow } from './hooks/useNow';
import { useFleetStore } from './store/fleetStore';

export default function App() {
  useFleetStream();
  const fleet = useFleetStore((s) => s.fleet);
  const error = useFleetStore((s) => s.error);
  const now = useNow(1000);

  const live = fleet == null ? 'connexion…' : now - fleet.at < 8000 ? 'live' : 'reconnexion…';

  return (
    <div>
      <div className="mb-[14px] flex items-center justify-between">
        <div className="flex items-center gap-[9px]">
          <img src="/favicon.svg" alt="" aria-hidden="true" className="h-[26px] w-[26px]" />
          <h1 className="text-[16px] font-bold">Superviseur</h1>
        </div>
        <div className="text-[12px] text-muted">
          {live === 'live' ? <b className="text-green">Live</b> : live}
        </div>
      </div>

      <div className="rounded-[10px] border border-border bg-card">
        <input
          disabled
          placeholder="Création de session : au prochain jalon"
          className="w-full bg-transparent px-[14px] py-[12px] text-[14px] text-text outline-none placeholder:text-placeholder"
        />
      </div>

      <FleetBoard fleet={fleet} now={now} />

      {error ? (
        <div className="mt-[10px] rounded-[8px] bg-orange-soft px-[12px] py-[8px] text-[12px] text-attend">
          {error}
        </div>
      ) : null}
    </div>
  );
}
