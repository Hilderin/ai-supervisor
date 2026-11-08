import { useEffect, useState } from 'react';
import { fetchTaskModel } from '../lib/api';
import type { TaskModelInfo } from '../types';

/**
 * Modèle d'une tâche pour le panneau de détail : préférence de la tâche,
 * modèle effectif et catalogue. Rechargé quand la tâche sélectionnée change ;
 * le panneau peut remplacer l'info après un enregistrement sans re-fetch.
 */
export function useTaskModel(sessionId: string): {
  info: TaskModelInfo | null;
  loading: boolean;
  error: string | null;
  setInfo: (info: TaskModelInfo | null) => void;
} {
  const [info, setInfo] = useState<TaskModelInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    setInfo(null);
    fetchTaskModel(sessionId, ctl.signal)
      .then((next) => { if (!ctl.signal.aborted) setInfo(next); })
      .catch(() => {
        if (ctl.signal.aborted) return;
        setError('Modèle de la tâche indisponible.');
      })
      .finally(() => { if (!ctl.signal.aborted) setLoading(false); });
    return () => ctl.abort();
  }, [sessionId]);

  return { info, loading, error, setInfo };
}
