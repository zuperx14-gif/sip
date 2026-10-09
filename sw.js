/* Sip service worker: push notifications only. No app-shell caching on purpose
   (a stale dashboard is worse than no offline mode), so there is no fetch handler. */

const SCOPE = self.registration.scope;
const asset = (p) => new URL(p, SCOPE).href;
const HAS_ACTIONS = typeof Notification !== 'undefined' && 'actions' in Notification.prototype;

// config.js assigns window.CFG; scripts can only be imported at startup.
try { self.window = self; importScripts('./config.js'); } catch (e) { /* re-subscribe just won't run */ }

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; }
  catch { try { d = { body: event.data.text() }; } catch { d = {}; } }
  if (!d || typeof d !== 'object') d = {};

  const opts = {
    body: d.body || '',
    icon: asset('icons/icon-192.png'),
    badge: asset('icons/badge-96.png'),
    tag: d.tag || 'sip',
    renotify: true,
    requireInteraction: !!d.urgent,
    data: d,
  };
  if (d.urgent) opts.vibrate = [120, 60, 120];
  if (HAS_ACTIONS && d.ack && d.kind) {
    opts.actions = [
      { action: 'done', title: 'Done' },
      { action: 'snooze', title: d.snooze_min ? `Snooze ${d.snooze_min}m` : 'Snooze' },
    ];
  }
  event.waitUntil(self.registration.showNotification(d.title || 'Sip', opts));
});

async function appClients() {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return all.filter((c) => c.url.startsWith(SCOPE));
}

async function ackFromNotification(d, action) {
  try {
    const res = await fetch(d.ack.url, {
      method: 'POST',
      headers: { apikey: d.ack.apikey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key: d.ack.key, p_kind: d.kind, p_action: action }),
    });
    if (!res.ok) throw new Error(`ack failed: ${res.status}`);
    for (const c of await appClients()) c.postMessage({ type: 'refresh' });
  } catch (e) {
    // Don't let a failed tap vanish silently: put the reminder back, without buttons.
    await self.registration.showNotification("That didn't go through", {
      body: 'Tap to open Sip and log it there.',
      icon: asset('icons/icon-192.png'),
      badge: asset('icons/badge-96.png'),
      tag: d.tag || 'sip',
      data: { ...d, ack: null },
    });
  }
}

async function openApp(d) {
  const kind = d.kind === 'water' || d.kind === 'bathroom' ? d.kind : null;
  const clients = await appClients();
  if (clients.length) {
    const client = clients.find((c) => c.focused) || clients[0];
    let focused = client;
    try { focused = (await client.focus()) || client; } catch { /* focus can be refused */ }
    focused.postMessage({ type: 'do', kind });
    return;
  }
  let url = SCOPE;
  try { url = new URL(d.url || './', SCOPE).href; } catch { /* keep scope */ }
  if (!url.startsWith(SCOPE)) url = SCOPE;
  await self.clients.openWindow(url);
}

self.addEventListener('notificationclick', (event) => {
  const d = event.notification.data || {};
  event.notification.close();
  if ((event.action === 'done' || event.action === 'snooze') && d.ack && d.kind) {
    event.waitUntil(ackFromNotification(d, event.action));
  } else {
    event.waitUntil(openApp(d));
  }
});

// The browser rotated the subscription: re-subscribe and tell the server, using
// what the page left for us in Cache Storage.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open('sip-meta');
      const hit = await cache.match('./__sip_meta');
      if (!hit) return;
      const meta = await hit.json();
      const cfg = self.CFG;
      if (!cfg || !cfg.url || !meta.key) return;
      const options = (event.oldSubscription && event.oldSubscription.options) || { userVisibleOnly: true, applicationServerKey: cfg.vapid };
      const sub = event.newSubscription || await self.registration.pushManager.subscribe(options);
      const post = (fn, body) => fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: cfg.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_key: meta.key, ...body }),
      });
      await post('subscribe', { p_role: meta.role || 'her', p_sub: sub.toJSON(), p_ua: meta.ua || null });
      if (event.oldSubscription && event.oldSubscription.endpoint !== sub.endpoint) {
        await post('unsubscribe', { p_endpoint: event.oldSubscription.endpoint });
      }
    } catch (e) {
      // The page re-syncs the subscription the next time it is opened.
    }
  })());
});
