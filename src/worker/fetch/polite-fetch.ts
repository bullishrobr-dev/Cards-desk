import { detectChallenge } from './challenge.ts';

export type Expected = 'json' | 'html' | 'xml';

export interface PoliteRequest {
  url: string;
  userAgent: string;
  expected: Expected;
  etag?: string | null;
  lastModified?: string | null;
  timeoutMs?: number;
}

export type PoliteResult =
  | { kind: 'ok'; status: number; body: string; etag: string | null; lastModified: string | null }
  | { kind: 'not_modified'; status: 304 }
  | { kind: 'challenge'; status: number; reason: string; retryAfter: string | null }
  | { kind: 'http_error'; status: number; retryAfter: string | null }
  | { kind: 'network_error'; error: string };

const ACCEPT: Record<Expected, string> = {
  json: 'application/json',
  html: 'text/html,application/xhtml+xml',
  xml: 'application/xml,text/xml',
};

/**
 * One polite GET: descriptive User-Agent, conditional headers, a timeout, and challenge
 * detection. Robots and back-off are decided by the caller before this is called.
 */
export async function politeFetch(req: PoliteRequest, fetchImpl: typeof fetch = fetch): Promise<PoliteResult> {
  const headers: Record<string, string> = {
    'user-agent': req.userAgent,
    accept: ACCEPT[req.expected],
    'accept-language': 'en-GB,en;q=0.8',
  };
  if (req.etag) headers['if-none-match'] = req.etag;
  if (req.lastModified) headers['if-modified-since'] = req.lastModified;

  let res: Response;
  try {
    res = await fetchImpl(req.url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(req.timeoutMs ?? 20_000),
    });
  } catch (err) {
    return { kind: 'network_error', error: err instanceof Error ? err.message : String(err) };
  }

  if (res.status === 304) return { kind: 'not_modified', status: 304 };

  const body = await res.text();
  const verdict = detectChallenge(res.status, res.headers, body.slice(0, 4096), req.expected);
  if (verdict.challenged) {
    return { kind: 'challenge', status: res.status, reason: verdict.reason ?? 'challenge', retryAfter: res.headers.get('retry-after') };
  }
  if (!res.ok) return { kind: 'http_error', status: res.status, retryAfter: res.headers.get('retry-after') };

  return {
    kind: 'ok',
    status: res.status,
    body,
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
  };
}
