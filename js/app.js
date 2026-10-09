// Boot + routing between gate, onboarding and home.
import { $, state, store, load, on, emit, setKey, setRole, KINDS } from './core.js';
import { registerSW, refreshPush } from './push.js';
import { openCapture, closeCapture } from './capture.js';
import { showSkeleton, rerender, checkPush } from './home.js';
import { startOnboarding } from './onboarding.js';
import './settings.js';

const SCREENS = ['gate', 'onboard', 'home'];
let pendingDo = null;
let shown = null;

function show(name) {
  if (shown === name) return;
  shown = name;
  for (const id of SCREENS) $(`#${id}`).hidden = id !== name;
  window.scrollTo(0, 0);
}

// The passcode, a deep-link action and the role can all arrive in the hash.
function readHash() {
  const raw = location.hash.slice(1);
  if (!raw) return;
  const p = new URLSearchParams(raw);
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
  const k = p.get('k'), role = p.get('role'), act = p.get('do');
  if (k) setKey(k);
  if (role === 'her' || role === 'partner') { setRole(role); emit('role'); }
  if (KINDS.includes(act)) pendingDo = act;
}

function route() {
  if (!state.key) {
    closeCapture(true);
    show('gate');
    return;
  }
  if (pendingDo) {
    // She tapped a notification: straight to the camera, no detours.
    if (!state.role) setRole('her');
    store.set('sip-onboarded', '1');
    const k = pendingDo;
    pendingDo = null;
    show('home');
    showSkeleton();
    openCapture(k);
    load();
    return;
  }
  if (!state.role || !store.get('sip-onboarded')) {
    if (shown !== 'onboard') { show('onboard'); startOnboarding(); }
    load();
    return;
  }
  show('home');
  rerender();
  load();
  checkPush();
  refreshPush();
}

// ---- gate ----
const gateForm = $('#gate-form');
function gateError(msg) {
  $('#gate-msg').textContent = msg || '';
  if (msg) { gateForm.classList.remove('shake'); void gateForm.offsetWidth; gateForm.classList.add('shake'); }
}
gateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#gate-key');
  const v = input.value.trim();
  if (!v) return gateError('Type the passcode first.');
  const btn = $('#gate-go');
  btn.classList.add('busy');
  gateError('');
  setKey(v);
  const ok = await load();
  btn.classList.remove('busy');
  if (ok) { input.value = ''; route(); }
  else if (state.key) {
    // Not a passcode problem (offline, server down): say so and let her retry.
    gateError(state.loadError ? state.loadError.message : 'Something went wrong. Try again.');
    setKey(null);
  }
});
$('#gate-key').addEventListener('input', () => gateError(''));

on('locked', (err) => {
  show('gate');
  closeCapture(true);
  if (err && err.auth) gateError("That passcode didn't work. Try again?");
});
on('onboarded', route);
on('onboard', (step) => { show('onboard'); startOnboarding(step); });
on('pushchange', checkPush);

window.addEventListener('hashchange', () => { if (location.hash.length > 1) { readHash(); route(); } });
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.type === 'do' && KINDS.includes(m.kind)) { pendingDo = m.kind; route(); }
    else if (m.type === 'do' || m.type === 'refresh') load();
  });
}

readHash();
registerSW();
route();
