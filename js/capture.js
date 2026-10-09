// The one-tap confirm flow: full-screen camera, shutter, success moment.
import { $, state, rpc, load, on, emit, toast, buzz, wait, reducedMotion, KINDS, KIND_ICON, KIND_LABEL } from './core.js';

const el = $('#capture');
const video = $('#cap-video');
const MAX_EDGE = 640;
const MAX_CHARS = 380000; // server rejects anything over 400000

let kind = null;
let stream = null;
let busy = false;
let token = 0;       // invalidates in-flight camera starts
let wantCamera = false;

const photoRequired = () => kind === 'water' && !!(state.data && state.data.settings.require_photo);
const mode = () => el.dataset.mode;

function setMode(m) {
  el.dataset.mode = m;
  const need = photoRequired();
  $('#cap-skip').style.visibility = need ? 'hidden' : '';
  if (m === 'camera') {
    $('#cap-hint').textContent = kind === 'water'
      ? (need ? 'Glass in frame, then tap' : 'Show us that glass, then tap')
      : 'Tap to snap';
  } else if (m === 'confirm') {
    $('#cap-panel-title').textContent = 'Bathroom break?';
    $('#cap-panel-sub').textContent = "One tap and you're all set. No photo needed.";
    $('#cap-alt').hidden = true;
  } else if (m === 'fallback') {
    $('#cap-alt').textContent = kind === 'water' ? 'Skip photo' : 'Done without a photo';
    $('#cap-alt').hidden = need;
  }
  $('#cap-panel-icon').firstElementChild.setAttribute('href', `#i-${m === 'fallback' ? 'camera' : KIND_ICON[kind] || 'drop'}`);
}

let fallbackReason = null;
function fallback(reason) {
  fallbackReason = reason;
  const blocked = reason === 'NotAllowedError' || reason === 'SecurityError';
  $('#cap-panel-title').textContent = reason === 'slow' ? 'Waking the camera…' : blocked ? 'Camera is switched off' : "Can't reach the camera";
  $('#cap-panel-sub').textContent = reason === 'slow'
    ? 'If your phone is asking for permission, tap Allow.'
    : blocked
      ? "No stress. Use your phone's own camera instead" + (photoRequired() ? '.' : ', or skip the photo.')
      : "Use your phone's own camera instead" + (photoRequired() ? '.' : ', or skip the photo.');
  setMode('fallback');
}

async function startCamera() {
  wantCamera = true;
  const mine = ++token;
  setMode('starting');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return fallback('unsupported');
  // If the permission prompt (or a slow camera) keeps us waiting, don't leave her stuck on a spinner.
  const slow = setTimeout(() => { if (mine === token && mode() === 'starting') fallback('slow'); }, 2600);
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
    });
    clearTimeout(slow);
    if (mine !== token || el.hidden) { s.getTracks().forEach((t) => t.stop()); return; }
    stream = s;
    video.srcObject = s;
    try { await video.play(); } catch { /* autoplay will kick in via the attribute */ }
    if (mine !== token) return;
    setMode('camera');
  } catch (e) {
    clearTimeout(slow);
    if (mine !== token) return;
    wantCamera = false;
    fallback(e && e.name);
  }
}

function stopCamera() {
  token++;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  try { video.pause(); } catch { /* not playing */ }
  video.srcObject = null;
}

function toDataURL(source, w, h, mirror) {
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d');
  if (mirror) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(source, 0, 0, c.width, c.height);
  let q = 0.6;
  let url = c.toDataURL('image/jpeg', q);
  while (url.length > MAX_CHARS && q > 0.25) { q -= 0.12; url = c.toDataURL('image/jpeg', q); }
  if (url.length > MAX_CHARS) throw new Error('That photo is too big to save.');
  return url;
}

async function fileToDataURL(file) {
  let src, w, h, revoke;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
    w = src.width; h = src.height;
  } catch {
    const u = URL.createObjectURL(file);
    revoke = () => URL.revokeObjectURL(u);
    src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Couldn't read that photo.")); i.src = u; });
    w = src.naturalWidth; h = src.naturalHeight;
  }
  try { return toDataURL(src, w, h, false); }
  finally { if (revoke) revoke(); if (src.close) src.close(); }
}

const COPY = {
  water: { titles: ['Logged.', 'Cheers.', 'Nice one.'], subs: ['Future you says thanks.', 'Hydration: handled.', 'One more in the bank.'] },
  bathroom: { titles: ['Done.', 'All set.'], subs: ['Quick break, big win.', 'Back to your day.'] },
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// Plays the water-fill success moment while `work` runs. Resolves true on success.
export async function celebrate(k, work, onOk) {
  const s = $('#success');
  const copy = COPY[k] || COPY.water;
  $('#success-title').textContent = pick(copy.titles);
  $('#success-sub').textContent = pick(copy.subs);
  s.className = 'success';
  s.hidden = false;
  buzz(12);
  requestAnimationFrame(() => requestAnimationFrame(() => s.classList.add('fill')));
  let err = null;
  await Promise.all([Promise.resolve(work).catch((e) => { err = e || new Error('Something went wrong.'); }), wait(reducedMotion() ? 250 : 900)]);
  if (err) {
    s.hidden = true;
    s.className = 'success';
    toast(err.auth ? 'Passcode changed. Please sign in again.' : err.message);
    if (err.auth) load();
    return false;
  }
  s.classList.add('ok');
  buzz([18, 60, 30]);
  if (onOk) onOk();
  emit('logged', k);
  load();
  await wait(1150);
  s.classList.add('out');
  await wait(360);
  s.hidden = true;
  s.className = 'success';
  return true;
}

async function submit(photo) {
  if (busy) return;
  busy = true;
  const k = kind;
  const ok = await celebrate(k, rpc('ack', { p_kind: k, p_action: 'done', p_photo: photo }), () => closeCapture(true));
  busy = false;
  if (!ok && !el.hidden && stream) { try { await video.play(); } catch { /* ignore */ } }
}

function shoot() {
  if (busy || !stream || !video.videoWidth) return;
  let url;
  try { url = toDataURL(video, video.videoWidth, video.videoHeight, true); }
  catch (e) { return toast(e.message); }
  const flash = $('#cap-flash');
  flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
  video.pause();
  submit(url);
}

export function openCapture(k) {
  if (!KINDS.includes(k) || !state.key) return;
  if (!el.hidden && kind === k) return;
  stopCamera();
  kind = k;
  busy = false;
  wantCamera = false;
  $('#cap-title').textContent = KIND_LABEL[k];
  $('#cap-icon').firstElementChild.setAttribute('href', `#i-${KIND_ICON[k]}`);
  el.classList.remove('leaving');
  el.hidden = false;
  document.body.classList.add('locked');
  if (k === 'water') startCamera(); else setMode('confirm');
}

export function closeCapture(instant) {
  if (el.hidden) return;
  wantCamera = false;
  stopCamera();
  document.body.classList.remove('locked');
  if (instant) { el.hidden = true; return; }
  el.classList.add('leaving');
  setTimeout(() => { el.hidden = true; el.classList.remove('leaving'); }, 240);
}

export const captureOpen = () => !el.hidden;

$('#cap-close').addEventListener('click', () => closeCapture());
$('#cap-shutter').addEventListener('click', shoot);
$('#cap-skip').addEventListener('click', () => { if (!photoRequired()) submit(null); });
$('#cap-done').addEventListener('click', () => submit(null));
$('#cap-alt').addEventListener('click', () => {
  if (mode() === 'confirm') startCamera();
  else if (!photoRequired()) submit(null);
});
$('#cap-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file || el.hidden) return;
  try { submit(await fileToDataURL(file)); }
  catch (err) { toast(err.message || "Couldn't read that photo."); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.hidden && !busy) closeCapture(); });

// Never keep the camera running in the background.
document.addEventListener('visibilitychange', () => {
  if (el.hidden) return;
  if (document.hidden) { if (stream) stopCamera(); }
  else if (wantCamera && !stream && !busy) startCamera();
});
window.addEventListener('pagehide', stopCamera);
on('data', () => { if (el.hidden) return; if (mode() === 'fallback') fallback(fallbackReason); else setMode(mode()); });
on('locked', () => closeCapture(true));
