import { buildPushPayload, type PushSubscription, type VapidKeys } from '@block65/webcrypto-web-push';

/** What the service worker receives. Declarative Web Push format (iOS 18.4+), parsed by the SW elsewhere. */
export interface PushBody {
  web_push: 8030;
  /** Lets the service worker run (to send the delivery receipt) on browsers that show declaratively. */
  mutable: true;
  notification: {
    title: string;
    body: string;
    navigate: string;
    lang: 'en-GB';
    tag: string;
    app_badge: string;
  };
  /** Our fields, ignored by the browser: echoed back in the receipt. */
  delivery_id: string;
  notification_id: string;
}

export type PushResult = { kind: 'sent'; status: number } | { kind: 'dead'; status: number } | { kind: 'failed'; status: number | null; error: string };

/** Sends one Web Push. 404/410 means the subscription is gone for good. */
export async function sendPush(
  sub: { endpoint: string; p256dh: string; auth: string },
  body: PushBody,
  vapid: VapidKeys,
  opts: { critical: boolean; ttlSeconds: number },
  fetchImpl: typeof fetch = fetch,
): Promise<PushResult> {
  const subscription: PushSubscription = { endpoint: sub.endpoint, expirationTime: null, keys: { p256dh: sub.p256dh, auth: sub.auth } };
  try {
    const payload = await buildPushPayload(
      { data: body as unknown as Record<string, string>, options: { ttl: opts.ttlSeconds, urgency: opts.critical ? 'high' : 'normal', topic: body.notification.tag.slice(0, 32) } },
      subscription,
      vapid,
    );
    const res = await fetchImpl(sub.endpoint, payload as RequestInit);
    if (res.status === 404 || res.status === 410) return { kind: 'dead', status: res.status };
    if (!res.ok) return { kind: 'failed', status: res.status, error: (await res.text()).slice(0, 300) };
    return { kind: 'sent', status: res.status };
  } catch (e) {
    return { kind: 'failed', status: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface EmailConfig {
  apiKey: string;
  to: string;
  from: string;
}

/** Fallback channel only. Resend's send endpoint; without a verified domain it can only send to the account's own address. */
export async function sendEmail(cfg: EmailConfig, subject: string, text: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; status: number | null; error?: string }> {
  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: cfg.from, to: [cfg.to], subject, text }),
    });
    return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status, error: (await res.text()).slice(0, 300) };
  } catch (e) {
    return { ok: false, status: null, error: e instanceof Error ? e.message : String(e) };
  }
}
