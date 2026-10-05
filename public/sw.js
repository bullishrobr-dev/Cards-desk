/* Card Desk Drops service worker: push display, delivery receipts, app badge. No offline caching. */
const CONFIG_CACHE = 'cdd-config';
const RECEIPT_KEY = '/__cdd/receipt-url';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

async function receiptUrl() {
  try {
    const res = await (await caches.open(CONFIG_CACHE)).match(RECEIPT_KEY);
    return res ? (await res.text()) || null : null;
  } catch {
    return null;
  }
}

/** Tells the server this push arrived. Without it, a critical alert falls back to email after 5 minutes. */
async function sendReceipt(deliveryId) {
  const url = await receiptUrl();
  if (!url || !deliveryId) return;
  try {
    await fetch(url, { method: 'POST', mode: 'cors', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deliveryId }) });
  } catch {
    /* the email fallback covers a lost receipt */
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { notification: { title: 'Card Desk Drops', body: event.data ? event.data.text() : '' } };
  }
  // Declarative Web Push format; the same JSON is handled here on browsers without it.
  const n = data.notification || { title: 'Card Desk Drops', body: '' };
  const work = [
    self.registration.showNotification(n.title, {
      body: n.body,
      tag: n.tag,
      lang: 'en-GB',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      data: { url: n.navigate || '/', notificationId: data.notification_id || null },
    }),
    sendReceipt(data.delivery_id),
  ];
  if (n.app_badge !== undefined && 'setAppBadge' in self.navigator) {
    work.push(self.navigator.setAppBadge(Number(n.app_badge)).catch(() => undefined));
  }
  event.waitUntil(Promise.all(work));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { url, notificationId } = event.notification.data || {};
  event.waitUntil(
    (async () => {
      if (notificationId) {
        await fetch('/api/notifications/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: notificationId }) }).catch(() => undefined);
      }
      const target = new URL(url || '/', self.location.origin).href;
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of windows) {
        if ('focus' in w) {
          await w.focus();
          if ('navigate' in w) await w.navigate(target).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
