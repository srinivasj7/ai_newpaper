import { useEffect, useState } from "react";

/**
 * Tracks connectivity via the browser's online/offline events. `navigator.onLine` is a coarse
 * signal (it means "there is a network interface", not "the internet is reachable"), so the data
 * layer still treats a failed fetch as the source of truth and falls back to cache — this hook only
 * drives the offline indicator and the retry-on-reconnect. Defaults to online where unsupported.
 */
export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine ?? true);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  return online;
}
