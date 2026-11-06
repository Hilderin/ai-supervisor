import { useEffect } from 'react';
import { fetchFleet } from '../lib/api';
import { useFleetStore } from '../store/fleetStore';
import type { Fleet } from '../types';

/**
 * Flux de la flotte : SSE `/api/fleet/stream` (push) + poll 3 s en filet de sécurité.
 * Les frames SSE identiques sont ignorées (le daemon renvoie la même flotte 2x/s).
 */
export function useFleetStream(): void {
  const setFleet = useFleetStore((s) => s.setFleet);
  const setError = useFleetStore((s) => s.setError);

  useEffect(() => {
    let alive = true;
    let es: EventSource | null = null;
    let lastRaw = '';

    const refresh = async () => {
      try {
        const fleet = await fetchFleet();
        if (!alive) return;
        setFleet(fleet);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError('daemon injoignable : ' + String(e));
      }
    };

    void refresh();
    const poll = window.setInterval(() => void refresh(), 3000);

    try {
      es = new EventSource('/api/fleet/stream');
      es.onmessage = (ev) => {
        if (ev.data === lastRaw) return;
        lastRaw = ev.data;
        try {
          setFleet(JSON.parse(ev.data) as Fleet);
        } catch {
          /* frame partielle : le poll 3 s reste le filet */
        }
      };
    } catch {
      /* EventSource indisponible : le poll 3 s porte tout */
    }

    return () => {
      alive = false;
      window.clearInterval(poll);
      es?.close();
    };
  }, [setFleet, setError]);
}
