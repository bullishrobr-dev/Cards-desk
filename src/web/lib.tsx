import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from 'react';

export const DEMO = import.meta.env.VITE_DEMO === '1';

/** The demo build keeps its path in memory: it runs inside a sandboxed frame with its own URL. */
let demoPath = '/';
const currentPath = () => (DEMO ? demoPath : window.location.pathname + window.location.search);

/** A tiny History-API router: the app has a handful of fixed paths. */
export function usePath(): string {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onPop = () => setPath(currentPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}

export function navigate(to: string) {
  if (to === currentPath()) return;
  if (DEMO) demoPath = to;
  else window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
}

export function Link({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={onClick} className={className}>
      {children}
    </a>
  );
}

export interface Loadable<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** GET a JSON endpoint; Cloudflare Access cookies travel with same-origin requests. */
export function useApi<T>(url: string | null): Loadable<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: Boolean(url) });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch(url, { headers: { accept: 'application/json' } })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'Your sign-in has expired. Reload the page to sign in again.' : `The server answered ${res.status}.`);
        return (await res.json()) as T;
      })
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((e: unknown) => !cancelled && setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e), loading: false })));
    return () => {
      cancelled = true;
    };
  }, [url, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
