import { readFileSync } from 'node:fs';
import type { JobMessage, JobQueue } from '../jobs/types.ts';

export function fakeKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
  } as unknown as Pick<KVNamespace, 'get' | 'put'> & { store: Map<string, string> };
}

export function fakeQueue() {
  const sent: Array<{ body: JobMessage; delaySeconds?: number }> = [];
  const queue: JobQueue = {
    sendBatch: async (msgs) => {
      sent.push(...msgs);
    },
  };
  return { queue, sent };
}

export interface Route {
  status?: number;
  body?: string;
  file?: string;
  headers?: Record<string, string>;
}

/** fetch() that serves fixtures by URL prefix and records every request. */
export function fakeFetch(routes: Record<string, Route | ((req: Request) => Route)>) {
  const requests: Request[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    requests.push(req);
    const match = Object.keys(routes)
      .filter((prefix) => req.url.startsWith(prefix))
      .sort((a, b) => b.length - a.length)[0];
    if (!match) return new Response('not found', { status: 404 });
    const entry = routes[match];
    const r = typeof entry === 'function' ? entry(req) : (entry as Route);
    const body = r.file ? readFileSync(r.file, 'utf8') : (r.body ?? '');
    return new Response(r.status === 304 ? null : body, { status: r.status ?? 200, headers: r.headers ?? {} });
  }) as typeof fetch;
  return { impl, requests };
}
