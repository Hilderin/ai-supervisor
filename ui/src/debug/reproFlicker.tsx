import '../index.css';
import { StrictMode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FleetBoard } from '../components/FleetBoard';
import { TaskInspector } from '../components/TaskInspector';
import { useNow } from '../hooks/useNow';
import { cardState } from '../lib/cardState';
import { useFleetStore } from '../store/fleetStore';
import type { CardState } from '../lib/cardState';
import type { Fleet, FleetRow, PlanStep } from '../types';

/**
 * Repro deterministe du flicker (mode debug, hors app) :
 * bun run dev puis http://localhost:5173/repro-flicker.html?fen=500&cycle=3000
 *
 * Rejoue le cycle reel du daemon (daemon/src/fleet.mts, runPoll) :
 * 1. a chaque `cycle` ms : un snapshot ENRICHE (plan + sup.progress du plan),
 * 2. pendant `fen` ms ensuite : le snapshot PAS ENCORE ENRICHE observe en
 *    production (capture SSE du 2026-11-07, t+84 s / t+155 s / t+175 s) :
 *    plan absent, sup.progress = la valeur du verdict du compagnon (pas celle
 *    du plan), voire sup strippé. La fenêtre = la durée du fetch
 *    /api/session/:id/message capté à chaque cache-miss de plan.mts.
 *
 * Sans le fix, l'UI échantillonne la fenêtre (SSE 500 ms + poll 3 s) :
 * la section « Plan » du détail est démontée/remontée, la barre de la carte
 * s'anime 38 % → 0 → 38 %. Avec le fix, les frames de fenêtre ne sont plus
 * publiées et la liste des dispositions reste vide.
 */

function useQueryInt(name: string, fallback: number): number {
  const v = Number(new URLSearchParams(window.location.search).get(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const STEPS: PlanStep[] = [
  { text: 'Lire les docs de conception', status: 'completed' },
  { text: 'Analyser le flux SSE vs GET', status: 'completed' },
  { text: 'Écrire la page de repro', status: 'completed' },
  { text: 'Poser le diagnostic', status: 'in_progress' },
  { text: 'Appliquer le fix', status: 'pending' },
  { text: 'Valider dans le navigateur', status: 'pending' },
  { text: 'Rédiger le bilan', status: 'pending' },
  { text: 'Nettoyer le mode debug', status: 'pending' },
];

const IDEAS_STEPS: PlanStep[] = [
  { text: 'Collecter les demandes', status: 'completed' },
  { text: 'Découper les chantiers', status: 'completed' },
  { text: 'Rédiger la note', status: 'completed' },
];

const AUTO_STEPS: PlanStep[] = [
  { text: 'Armé par le registre', status: 'completed' },
  { text: 'Session relancée', status: 'completed' },
  { text: 'Vérifier le verdict', status: 'completed' },
  { text: 'Archiver les fantômes', status: 'completed' },
  { text: 'Résumé de test', status: 'completed' },
];

function row(id: string, title: string, kind: 'enriched' | 'window'): FleetRow {
  if (id === 'ses_repro_diag') {
    // fenêtre : plan absent et progress 0 (le verdict du compagnon, PAS 38 du plan)
    return {
      id,
      title,
      dir: '/proj/ai-supervisor',
      status: 'busy',
      turnStartedAt: 1,
      lastUpdateAt: Date.now(),
      pendingForms: [],
      pendingPermissions: [],
      sup: kind === 'window'
        ? { resume: 'Réflexion en cours...', progress: 0, termine: false, at: 1 }
        : { resume: 'Le diagnostic est posé : publication avant enrichissement.', progress: 38, termine: false, at: 1 },
      plan: kind === 'window' ? undefined : { done: 3, total: 8, steps: STEPS },
    } as FleetRow;
  }
  if (id === 'ses_repro_auto') {
    return {
      id,
      title: 'Auto-restart de session de supervision',
      dir: '/proj/ai-supervisor',
      status: 'busy',
      turnStartedAt: 1,
      lastUpdateAt: Date.now(),
      pendingForms: [],
      pendingPermissions: [],
      sup: { resume: 'Consultation en cours...', progress: 99, termine: false, at: 1 },
      plan: kind === 'window' ? undefined : { done: 5, total: 5, steps: AUTO_STEPS },
    } as FleetRow;
  }
  return {
    id: 'ses_repro_ideas',
    title: 'Ajout d idées à la boîte à idées',
    dir: '/proj/ai-supervisor/docs',
    status: 'idle',
    turnStartedAt: 1,
    lastUpdateAt: Date.now() - 60_000,
    pendingForms: [],
    pendingPermissions: [],
    // fenêtre : sup strippé (conforme à la capture : progress absent, resume absent)
    sup: kind === 'window' ? { at: 1 } : { resume: 'En attente de validation.', progress: 99, termine: false, at: 1 },
    plan: kind === 'window' ? undefined : { done: 3, total: 3, steps: IDEAS_STEPS },
  } as FleetRow;
}

function DiagMachine({ fen, cycle }: { fen: number; cycle: number }) {
  const setFleet = useFleetStore(s => s.setFleet);
  const [kind, setKind] = useState<'enriched' | 'window'>('enriched');
  const [log, setLog] = useState<string[]>([]);
  const cycleRef = useRef(0);

  useEffect(() => {
    let alive = true;
    const push = (k: 'enriched' | 'window') => {
      if (!alive) return;
      setKind(k);
      const f: Fleet = {
        at: Date.now(),
        concern: null,
        rows: [row('ses_repro_diag', 'Diagnostique flicker UI web du superviseur', k),
               row('ses_repro_auto', 'Auto-restart de session de supervision', k),
               row('ses_repro_ideas', 'Ajout d idées à la boîte à idées', k)],
      };
      setFleet(f);
      setLog(l => [`${new Date().toISOString().slice(11, 23)} ${k}`, ...l].slice(0, 8));
    };
    const loop = () => {
      if (!alive) return;
      cycleRef.current += 1;
      push('enriched');
      setTimeout(() => alive && push('window'), cycle);
      setTimeout(() => alive && loop(), cycle + fen);
    };
    loop();
    return () => { alive = false; };
  }, [cycle, fen, setFleet]);

  return (
    <div>
      <div id="repro-kind" className="mb-2 px-2 py-1 text-[12px] font-semibold">
        Repro (cycle {cycle} ms, fenêtre non-enrichie {fen} ms) — frame courante : {kind}
      </div>
      <ol id="repro-log" className="px-2 py-1 text-[11px] text-muted">
        {log.map((l, i) => <li key={i}>{l}</li>)}
      </ol>
      <div className="px-2 py-1 text-[11px] text-muted">
        Sans le fix : la section « Plan » du détail disparaît et revient, la barre de la
        première carte s’anime 38 % → 0 → 38 % à chaque cycle. Avec le fix : stable.
      </div>
    </div>
  );
}

/** Counter de démontages : #plan-visible et #bar-width, lisible par ChromeHeadless. */
function FlickerCounter() {
  const [plan, setPlan] = useState(0);
  const [bar, setBar] = useState(0);
  const planWas = useRef(true);
  const barWas = useRef('');
  useEffect(() => {
    const check = () => {
      const planEl = !!document.querySelector('[data-testid=plan-section]');
      const barEl = document.querySelector('.bg-track > span') as HTMLElement | null;
      const barW = barEl ? barEl.style.width : '<absent>';
      if (planEl !== planWas.current) {
        planWas.current = planEl;
        if (!planEl) setPlan(p => p + 1);
      }
      if (barW !== barWas.current) {
        barWas.current = barW;
        if (barW === '<absent>' || barW === '0%') setBar(b => b + 1);
      }
    };
    const obs = new MutationObserver(check);
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    check();
    const t = window.setInterval(check, 100);
    return () => { obs.disconnect(); window.clearInterval(t); };
  }, []);
  useEffect(() => {
    document.body.setAttribute('data-flicker-plan', String(plan));
    document.body.setAttribute('data-flicker-bar', String(bar));
  }, [plan, bar]);
  return null;
}

function App() {
  const fen = useQueryInt('fen', 500);
  const cycle = useQueryInt('cycle', 3000);
  useNow(1000);
  const selected = useFleetStore(s => s.selected);
  const setSelected = useFleetStore(s => s.setSelected);
  const fleet = useFleetStore(s => s.fleet);
  const placements = useFleetStore(s => s.placements);

  useEffect(() => { setSelected('ses_repro_diag'); }, [setSelected]);

  const sel = selected && fleet ? fleet.rows.find(r => r.id === selected) ?? null : null;
  const selState: CardState | null = sel ? cardState(sel, placements[sel.id]?.section) : null;

  return (
    <>
      <FlickerCounter />
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ width: 470 }}>
          <DiagMachine fen={fen} cycle={cycle} />
          <FleetBoard fleet={fleet} now={Date.now()} onOpenChamber={() => {}} />
        </div>
        <div style={{ width: 480 }}>
          {sel && selState ? (
            <TaskInspector row={sel} state={selState} now={Date.now()} onClose={() => setSelected(null)} onOpenChamber={() => {}} />
          ) : null}
        </div>
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
