// Web Push: service worker registration, subscribe / unsubscribe.
import { CFG, state, rpc, store, deviceLabel, isIOS, isStandalone } from './core.js';

export const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

let regPromise = null;
export function registerSW() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  if (!regPromise) {
    regPromise = navigator.serviceWorker.register('./sw.js').catch((e) => {
      console.warn('Service worker registration failed', e);
      return null;
    });
  }
  return regPromise;
}

// The server generates the push key pair; its public half arrives with the dashboard data.
const vapidKey = () => (state.data && state.data.settings.vapid_public_key) || CFG.vapid || '';

function vapidBytes() {
  const b64 = String(vapidKey()).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSub() {
  const reg = await registerSW();
  if (!reg || !reg.pushManager) return null;
  try { return await reg.pushManager.getSubscription(); } catch { return null; }
}

// 'unsupported' | 'needs-install' | 'unconfigured' | 'denied' | 'on' | 'off'
export async function pushStatus() {
  if (isIOS && !isStandalone()) return 'needs-install';
  if (!pushSupported) return 'unsupported';
  if (!vapidKey()) return 'unconfigured';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  return (await currentSub()) ? 'on' : 'off';
}

// Let the service worker remember what it needs to re-subscribe on its own.
async function rememberForSW() {
  try {
    const cache = await caches.open('sip-meta');
    await cache.put('./__sip_meta', new Response(JSON.stringify({ key: state.key, role: state.role || 'her', ua: deviceLabel() }), { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* cache storage unavailable */ }
}

async function subscribeNow() {
  const reg = await registerSW();
  if (!reg) throw new Error("Couldn't start notifications on this device.");
  await navigator.serviceWorker.ready;
  const opts = { userVisibleOnly: true, applicationServerKey: vapidBytes() };
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe(opts);
    } catch (e) {
      // A stale subscription made with an older server key blocks a new one.
      const old = await reg.pushManager.getSubscription();
      if (!old) throw e;
      await old.unsubscribe();
      sub = await reg.pushManager.subscribe(opts);
    }
  }
  await rpc('subscribe', { p_role: state.role || 'her', p_sub: sub.toJSON(), p_ua: deviceLabel() });
  store.set('sip-sub-at', String(Date.now()));
  rememberForSW();
  return sub;
}

// Must be called from a tap. Returns the resulting status.
export async function enablePush() {
  const before = await pushStatus();
  if (before === 'needs-install' || before === 'unsupported' || before === 'unconfigured' || before === 'denied') return before;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  await subscribeNow();
  return 'on';
}

export async function disablePush() {
  const sub = await currentSub();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch { /* already gone */ }
  try { await rpc('unsubscribe', { p_endpoint: endpoint }); } catch { /* server prunes dead endpoints itself */ }
  store.del('sip-sub-at');
  try { await caches.delete('sip-meta'); } catch { /* ignore */ }
}

// Quietly keep the server's copy of this device's subscription fresh.
export async function refreshPush(force) {
  if (!pushSupported || !vapidKey() || !state.key || !state.role) return;
  if (Notification.permission !== 'granted') return;
  const last = Number(store.get('sip-sub-at') || 0);
  const sub = await currentSub();
  if (sub && !force && Date.now() - last < 12 * 3600 * 1000) return;
  if (!sub && (!last || force)) return; // never enabled here: don't subscribe behind her back
  try { await subscribeNow(); } catch (e) { console.warn('Push refresh failed', e); }
}
