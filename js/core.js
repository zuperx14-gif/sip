// Shared state, API client and small DOM helpers.

export const CFG = window.CFG || {};
export const KINDS = ['water', 'bathroom'];

export const $ = (sel, root = document) => root.querySelector(sel);

export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

export const state = {
  key: store.get('sip-key'),
  role: store.get('sip-role'), // 'her' | 'partner' | null
  data: null,
  skew: 0,
  loadError: null,
};

// ---- tiny event bus ----
const listeners = {};
export function on(evt, fn) { (listeners[evt] ||= []).push(fn); }
export function emit(evt, payload) { (listeners[evt] || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } }); }

// ---- DOM ----
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid);
  return el;
}

const SVG = 'http://www.w3.org/2000/svg';
export function icon(name, cls) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}
export const KIND_ICON = { water: 'drop', bathroom: 'roll' };
export const KIND_LABEL = { water: 'Water', bathroom: 'Bathroom' };

// ---- API ----
export async function rpc(fn, args = {}) {
  if (!CFG.url) throw new Error("Sip isn't connected to its server yet.");
  let res;
  try {
    res = await fetch(`${CFG.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: CFG.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key: state.key, ...args }),
    });
  } catch {
    const err = new Error("Can't reach Sip right now. Check your connection.");
    err.offline = true;
    throw err;
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((body && body.message) || `Something went wrong (${res.status}).`);
    err.status = res.status;
    err.auth = /passcode/i.test(err.message);
    throw err;
  }
  return body;
}

let loading = null;
export function load() {
  if (!state.key) return Promise.resolve(false);
  if (loading) return loading;
  loading = (async () => {
    try {
      const data = await rpc('dashboard');
      state.data = data;
      state.skew = new Date(data.now).getTime() - Date.now();
      state.loadError = null;
      emit('data', data);
      return true;
    } catch (e) {
      if (e.auth) {
        setKey(null);
        emit('locked', e);
      } else {
        state.loadError = e;
        emit('loaderror', e);
      }
      return false;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export function setKey(k) {
  state.key = k || null;
  if (k) store.set('sip-key', k); else store.del('sip-key');
}
export function setRole(r) {
  state.role = r === 'partner' ? 'partner' : r === 'her' ? 'her' : null;
  if (state.role) store.set('sip-role', state.role); else store.del('sip-role');
}

// ---- time ----
export const now = () => Date.now() + state.skew;
const tz = () => (state.data && state.data.settings.timezone) || undefined;

function fmt(opts) {
  try { return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: tz() }); }
  catch { return new Intl.DateTimeFormat(undefined, opts); }
}
export const fmtClock = (d) => fmt({ hour: 'numeric', minute: '2-digit' }).format(new Date(d));
export const fmtWeekday = (d) => fmt({ weekday: 'short' }).format(new Date(d));
export function dayKey(d) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d)); }
  catch { return new Date(d).toISOString().slice(0, 10); }
}
export function shiftDay(key, delta) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
export const dayLabel = (key, opts) => new Intl.DateTimeFormat(undefined, { ...opts, timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`));

export function fmtDur(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  const hh = Math.floor(m / 60), mm = m % 60;
  return mm ? `${hh}h ${mm}m` : `${hh}h`;
}
export function hhmm(t) {
  // "08:00:00" -> "8:00 AM" in the viewer's locale style
  const [H, M] = String(t || '0:0').split(':').map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2020, 0, 1, H || 0, M || 0)));
}

// ---- feedback ----
let toastTimer;
export function toast(msg, action) {
  const t = $('#toast');
  t.replaceChildren(h('span', { text: msg }));
  if (action) t.append(h('button', { type: 'button', text: action.label, onclick: () => { t.classList.remove('show'); action.fn(); } }));
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 5000 : 2800);
}
export function buzz(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* unsupported */ }
}
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- platform ----
const ua = navigator.userAgent || '';
export const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = /Android/i.test(ua);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export function deviceLabel() {
  const dev = isIOS ? (/iPad/.test(ua) || navigator.platform === 'MacIntel' ? 'iPad' : 'iPhone')
    : isAndroid ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /CriOS|Chrome\//.test(ua) && !/Edg\//.test(ua) ? 'Chrome' : /Edg\//.test(ua) ? 'Edge' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${dev} · ${isStandalone() ? 'app' : br}`;
}
