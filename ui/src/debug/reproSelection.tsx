import '../index.css';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FleetBoard } from '../components/FleetBoard';
import { TaskInspector } from '../components/TaskInspector';
import { cardState } from '../lib/cardState';
import { useFleetStore } from '../store/fleetStore';
import type { Fleet, FleetRow } from '../types';

/**
 * Banc d'essai temporaire : la flotte et le panneau de détail pilotés par le
 * store, sans daemon ni vraie tâche. On y vérifie que la tâche sélectionnée
 * qui disparaît laisse le panneau ouvert sur sa voisine, sans démontage.
 */

const row = (id: string, title: string): FleetRow => ({
  id,
  title,
  status: 'idle',
  dir: '/tmp/demo',
  pendingForms: [],
  pendingPermissions: [],
});

const TASKS = [
  row('a', 'A · première'),
  row('b', 'B · deuxième'),
  row('c', 'C · troisième'),
  row('d', 'D · quatrième'),
];

let frameAt = 1;

function Panel({ onStats }: { onStats: (s: string) => void }) {
  const fleet = useFleetStore((s) => s.fleet);
  const selected = useFleetStore((s) => s.selected);
  const placements = useFleetStore((s) => s.placements);
  const slotRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(0);
  const empty = useRef(0);

  const selectedRow = selected ? (fleet?.rows.find((r) => r.id === selected) ?? null) : null;
  const selectedState = selectedRow ? cardState(selectedRow, placements[selectedRow.id]?.section) : null;

  useEffect(() => {
    const el = slotRef.current;
    if (!el) return;
    const report = () => {
      onStats(`panneau monté ${mounted.current} fois · panneau vide ${empty.current} fois`);
    };
    report();
    const obs = new MutationObserver((list) => {
      for (const m of list) {
        m.addedNodes.forEach((n) => {
          if (n instanceof HTMLElement && n.dataset.testid === 'inspector-pane') mounted.current += 1;
          if (n instanceof HTMLElement && n.dataset.testid === 'inspector-empty') empty.current += 1;
        });
      }
      report();
    });
    obs.observe(el, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [onStats]);

  return (
    <div ref={slotRef} data-testid="panel-slot" className="h-[560px] w-[420px] shrink-0 overflow-hidden">
      {selectedRow && selectedState ? (
        <aside
          data-testid="inspector-pane"
          className="h-full w-full shrink-0 overflow-hidden border-l border-border bg-card"
        >
          <TaskInspector
            row={selectedRow}
            state={selectedState}
            now={Date.now()}
            onClose={() => useFleetStore.getState().setSelected(null)}
            onOpenChamber={() => {}}
          />
        </aside>
      ) : (
        <div data-testid="inspector-empty" className="p-4 text-muted">
          aucun détail ouvert
        </div>
      )}
    </div>
  );
}

function Harness() {
  const fleet = useFleetStore((s) => s.fleet);
  const selection = useFleetStore((s) => s.selected);
  const [stats, setStats] = useState('');
  const [visible, setVisible] = useState<string[]>(TASKS.map((t) => t.id));

  const frame = (ids: string[]) => {
    setVisible(ids);
    const rows = TASKS.filter((t) => ids.includes(t.id));
    frameAt += 1;
    const snapshot: Fleet = { at: frameAt, rows, concern: null };
    useFleetStore.getState().setFleet(snapshot);
  };

  const select = (id: string) => useFleetStore.getState().setSelected(id);

  useEffect(() => {
    // ordre neuf pour le banc d'essai (le rang persisté est partagé entre onglets)
    try {
      window.localStorage.removeItem('superviseur.fleet.order.v1');
    } catch {
      /* stockage indisponible : sans importance ici */
    }
    useFleetStore.setState({
      fleet: null,
      order: {},
      nextRank: 1,
      seenAt: {},
      orderHydrated: false,
      closed: {},
      selected: null,
    });
    frame(TASKS.map((t) => t.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen flex-col gap-3 bg-bg p-3 text-text">
      <div className="flex flex-wrap gap-2" data-testid="actions">
        <button data-testid="select-b" className="rounded border px-2 py-1" onClick={() => select('b')}>sélectionner B</button>
        <button data-testid="select-d" className="rounded border px-2 py-1" onClick={() => select('d')}>sélectionner D</button>
        <button data-testid="select-a" className="rounded border px-2 py-1" onClick={() => select('a')}>sélectionner A</button>
        <button data-testid="frame-no-b" className="rounded border px-2 py-1" onClick={() => frame(['a', 'c', 'd'])}>flotte sans B</button>
        <button data-testid="frame-no-d" className="rounded border px-2 py-1" onClick={() => frame(['a', 'b', 'c'])}>flotte sans D</button>
        <button data-testid="frame-no-a" className="rounded border px-2 py-1" onClick={() => frame(['b', 'c', 'd'])}>flotte sans A</button>
        <button data-testid="frame-empty" className="rounded border px-2 py-1" onClick={() => frame([])}>flotte vide</button>
        <button data-testid="close-b" className="rounded border px-2 py-1" onClick={() => useFleetStore.getState().closeSession('b')}>clôturer B</button>
        <button data-testid="reset" className="rounded border px-2 py-1" onClick={() => { useFleetStore.getState().setSelected(null); frame(TASKS.map((t) => t.id)); }}>réinitialiser</button>
      </div>
      <output data-testid="stats" className="text-[12px] text-muted">{stats}</output>
      <output data-testid="selected" className="text-[12px] font-semibold">
        sélection : {selection ?? 'aucune'}
      </output>
      <output data-testid="visible-ids" className="text-[12px] text-muted">{visible.join(',')}</output>
      <div className="flex min-h-0 flex-1 gap-3">
        <main className="min-h-0 flex-1 overflow-y-auto">
          <FleetBoard fleet={fleet} now={Date.now()} onOpenChamber={() => {}} />
        </main>
        <Panel onStats={setStats} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
