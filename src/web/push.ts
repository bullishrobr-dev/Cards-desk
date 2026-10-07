/** Web Push from the page side. Subscribing must start from a tap (iOS requires a user gesture). */

const CONFIG_CACHE = 'cdd-config';
const RECEIPT_KEY = '/__cdd/receipt-url';

export type PushState = 'unsupported' | 'needs-home-screen' | 'denied' | 'off' | 'on';

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (import.meta.env.VITE_DEMO === '1' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}

export async function pushState(): Promise<PushState> {
  if (isIos() && !isStandalone()) return 'needs-home-screen'; // iOS only allows push in Home Screen apps
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Stores where the service worker sends delivery receipts. */
async function storeReceiptUrl(url: string | null) {
  if (!url || !('caches' in window)) return;
  const cache = await caches.open(CONFIG_CACHE);
  await cache.put(RECEIPT_KEY, new Response(url));
}

/** Call from a click handler. Asks permission, subscribes, and registers the subscription. */
export async function turnOnPush(): Promise<{ ok: true } | { ok: false; message: string }> {
  const config = (await (await fetch('/api/push/config')).json()) as { vapidPublicKey: string | null; receiptUrl: string | null };
  if (!config.vapidPublicKey) return { ok: false, message: 'Push is not configured on the server yet (VAPID keys missing).' };
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, message: 'Notifications were not allowed. You can change this in your device settings.' };
  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(config.vapidPublicKey) }));
  await storeReceiptUrl(config.receiptUrl);
  const res = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub.toJSON()) });
  return res.ok ? { ok: true } : { ok: false, message: `The server refused the subscription (${res.status}).` };
}

/** Keeps the receipt URL fresh on every launch (cheap, and survives cache clears). */
export async function refreshReceiptUrl() {
  try {
    const config = (await (await fetch('/api/push/config')).json()) as { receiptUrl: string | null };
    await storeReceiptUrl(config.receiptUrl);
  } catch {
    /* offline or signed out: try next launch */
  }
}

export function setBadge(count: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  if (count > 0) nav.setAppBadge?.(count).catch(() => undefined);
  else nav.clearAppBadge?.().catch(() => undefined);
}
