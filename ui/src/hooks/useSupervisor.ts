import { useEffect } from 'react';
import { useSupervisorStore } from '../store/supervisorStore';

/**
 * Poll du chat : 1,2 s quand le superviseur travaille, 4 s au repos.
 * Le daemon pousse la flotte en SSE ; le chat garde un poll léger et simple.
 */
export function useSupervisor() {
  const status = useSupervisorStore((s) => s.state?.status);
  const sending = useSupervisorStore((s) => s.sending);
  const refresh = useSupervisorStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
    const ms = sending || status === 'busy' ? 1200 : 4000;
    const timer = setInterval(() => void refresh(), ms);
    return () => clearInterval(timer);
  }, [refresh, sending, status]);
}
