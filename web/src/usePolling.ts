import { useCallback, useEffect, useRef, useState } from "react";

/** Calls `load` now and every `ms` while the page is visible; exposes the latest value and error. */
export function usePolling<T>(load: () => Promise<T>, ms = 3000) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();
  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, ms);
    return () => clearInterval(timer);
  }, [refresh, ms]);

  return { data, error, refresh };
}
