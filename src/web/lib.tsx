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

/** Where you were on each page, so going back to a list lands where you left it. */
const scrollPositions = new Map<string, number>();

function restoreScroll(path: string) {
  // Two frames: one for React to render the cached page, one for layout.
  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, scrollPositions.get(path) ?? 0)));
}

if (!DEMO) {
  window.history.scrollRestoration = 'manual';
  window.addEventListener('popstate', () => restoreScroll(currentPath()));
}

export function navigate(to: string) {
  if (to === currentPath()) return;
  scrollPositions.set(currentPath(), window.scrollY);
  if (DEMO) demoPath = to;
  else window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
  // A drop page always opens at the top; a list returns to where you were.
  if (to.startsWith('/drop/')) window.scrollTo(0, 0);
  else restoreScroll(to);
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

/** Last answer per URL: a page you return to shows at once, then refreshes quietly. */
const apiCache = new Map<string, unknown>();

/** GET a JSON endpoint; Cloudflare Access cookies travel with same-origin requests. */
export function useApi<T>(url: string | null): Loadable<T> {
  const cached = url ? ((apiCache.get(url) as T | undefined) ?? null) : null;
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: cached, error: null, loading: Boolean(url) && cached === null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const hit = (apiCache.get(url) as T | undefined) ?? null;
    setState((s) => ({ data: hit ?? s.data, loading: hit === null, error: null }));
    fetch(url, { headers: { accept: 'application/json' } })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'Your sign-in has expired. Reload the page to sign in again.' : `The server answered ${res.status}.`);
        return (await res.json()) as T;
      })
      .then((data) => {
        apiCache.set(url, data);
        if (!cancelled) setState({ data, error: null, loading: false });
      })
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
