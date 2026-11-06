import { useEffect, useState } from 'react';

/** Horloge partagée pour les âges (« il y a 12 s ») et l'indicateur Live. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}
