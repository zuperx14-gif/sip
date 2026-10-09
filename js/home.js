// Home (her) and partner dashboard.
import {
  $, h, icon, state, rpc, load, on, emit, toast, now, fmtClock, fmtDur, hhmm, dayKey, shiftDay, dayLabel,
  KINDS, KIND_ICON, KIND_LABEL,
} from './core.js';
import { openCapture, celebrate, captureOpen } from './capture.js';
import { pushStatus, enablePush } from './push.js';

const hero = $('#hero');
const partner = () => state.role === 'partner';
let sigs = {};
let pushState = null;
let selectedDay = null;
let logExpanded = false;
let lastWater = null;

// ---------- model ----------
function minutesNow(tz) {
  try {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(now()));
    const get = (t) => Number(p.find((x) => x.type === t).value);
    return (get('hour') % 24) * 60 + get('minute');
  } catch { const d = new Date(now()); return d.getHours() * 60 + d.getMinutes(); }
}
const toMin = (t) => { const [H, M] = String(t).split(':').map(Number); return (H || 0) * 60 + (M || 0); };
function quietEnd(s) {
  const m = minutesNow(s.timezone);
  for (const w of s.quiet_windows || []) {
    const a = toMin(w[0]), b = toMin(w[1]);
    if (a === b) continue;
    if (a < b ? (m >= a && m < b) : (m >= a || m < b)) return w[1];
  }
  return null;
}

function model() {
  const d = state.data, s = d.settings;
  const rems = d.reminders.filter((r) => KINDS.includes(r.kind));
  const active = rems.filter((r) => r.enabled);
  const due = s.paused ? [] : active.filter((r) => r.pending_since).sort((a, b) => new Date(a.pending_since) - new Date(b.pending_since));
  const upcoming = active.filter((r) => !r.pending_since && r.next_due).sort((a, b) => new Date(a.next_due) - new Date(b.next_due));
  let st = 'next';
  if (s.paused) st = 'paused';
  else if (!active.length) st = 'off';
  else if (due.length) st = 'due';
  else if (!s.awake || !upcoming.length) st = 'asleep';
  return { s, rems, due, upcoming, st, focus: due[0] || upcoming[0] || null };
}

function dayStats(key) {
  const rows = state.data.stats.filter((x) => x.day === key);
  const sum = (k, f) => rows.filter((x) => !k || x.kind === k).reduce((a, x) => a + (Number(x[f]) || 0), 0);
  return { water: sum('water', 'done'), bathroom: sum('bathroom', 'done'), done: sum(null, 'done'), missed: sum(null, 'missed') };
}

function streak() {
  const p = state.data.points;
  if (p) return p.streak;
  let n = 0;
  let key = state.data.today;
  for (let i = 0; i < 30; i++, key = shiftDay(key, -1)) {
    const d = dayStats(key);
    if (d.missed > 0) break;
    if (d.done === 0) { if (i === 0) continue; break; }
    n++;
  }
  return n;
}

function waterTarget() {
  const s = state.data.settings;
  const r = state.data.reminders.find((x) => x.kind === 'water');
  if (!r || !r.interval_min) return 8;
  let span = toMin(s.sleep) - toMin(s.wake);
  if (span <= 0) span += 1440;
  return Math.max(1, Math.round(span / r.interval_min));
}

// ---------- hero ----------
function setText(el, text) { if (el.textContent !== text) el.textContent = text; }

function setCountdown(el, ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  let sig, parts;
  if (total >= 3600) {
    const hh = Math.floor(total / 3600), mm = Math.floor((total % 3600) / 60);
    sig = `h${hh}:${mm}`;
    parts = () => [String(hh), h('small', { text: 'h' }), String(mm).padStart(2, '0'), h('small', { text: 'm' })];
  } else {
    const mm = Math.floor(total / 60), ss = total % 60;
    sig = `m${mm}:${ss}`;
    parts = () => [`${mm}:${String(ss).padStart(2, '0')}`];
  }
  if (el.dataset.sig !== sig) { el.dataset.sig = sig; el.replaceChildren(...parts()); }
  el.classList.remove('words');
}
function setWords(el, text) {
  if (el.dataset.sig !== `w${text}`) { el.dataset.sig = `w${text}`; el.textContent = text; }
  el.classList.add('words');
}

function heroActions(m) {
  const box = $('#hero-actions');
  const f = m.focus;
  const sig = partner() ? 'none' : `${m.st}|${f ? f.kind : ''}|${m.s.require_photo}|${m.s.snooze_min}`;
  if (sigs.hero === sig) return;
  sigs.hero = sig;
  box.replaceChildren();
  if (partner()) return;
  if (m.st === 'due') {
    const k = f.kind;
    const main = k === 'water'
      ? h('button', { class: 'btn light', type: 'button', onclick: () => openCapture('water') }, icon('camera'), h('span', { text: 'Snap it' }))
      : h('button', { class: 'btn light', type: 'button', onclick: () => quickDone('bathroom') }, icon('check'), h('span', { text: 'Done' }));
    const snooze = h('button', { class: 'btn glassy', type: 'button', onclick: (e) => doSnooze(k, e.currentTarget) }, h('span', { text: `Snooze ${m.s.snooze_min}m` }));
    box.append(main, snooze);
  } else if (m.st === 'paused') {
    box.append(h('button', { class: 'btn light', type: 'button', onclick: (e) => resume(e.currentTarget) }, h('span', { text: 'Resume nudges' })));
  }
}

function updateHero() {
  if (!state.data) return;
  const m = model();
  const t = now();
  const kicker = $('#hero-kicker'), big = $('#hero-big'), sub = $('#hero-sub');
  hero.dataset.state = m.st;
  hero.classList.toggle('compact', partner());
  let level = 0.5;
  const f = m.focus;

  if (m.st === 'due') {
    const left = new Date(f.pending_since).getTime() + m.s.window_min * 60000 - t;
    setText(kicker, m.due.length > 1 ? `Due now · ${m.due.length} things` : `Due now · ${KIND_LABEL[f.kind]}`);
    if (partner()) {
      setWords(big, f.kind === 'water' ? 'Water is due' : 'Bathroom break is due');
      setText(sub, `${f.nags ? `Nudged ${f.nags + 1} times` : 'Just nudged'} · ${left > 0 ? `${fmtDur(left)} until it counts as missed` : 'about to count as missed'}`);
    } else {
      setWords(big, f.kind === 'water' ? "Water o'clock" : 'Bathroom break');
      setText(sub, left > 60000 ? `${fmtDur(left)} left before it counts as missed` : 'Last call before it counts as missed');
    }
    level = 0.13;
  } else if (m.st === 'next') {
    const until = new Date(f.next_due).getTime() - t;
    setText(kicker, `Next up · ${KIND_LABEL[f.kind]}`);
    if (until > 0) {
      setCountdown(big, until);
      const other = m.upcoming[1];
      setText(sub, `Around ${fmtClock(f.next_due)}${other ? ` · ${KIND_LABEL[other.kind].toLowerCase()} in ${fmtDur(new Date(other.next_due).getTime() - t)}` : ''}`);
    } else {
      setWords(big, 'Any second now');
      setText(sub, partner() ? 'A nudge is on its way.' : 'Your nudge is on its way.');
    }
    const frac = Math.min(1, Math.max(0, until / (f.interval_min * 60000)));
    level = 0.16 + 0.56 * frac;
  } else if (m.st === 'asleep') {
    const q = quietEnd(m.s);
    setText(kicker, q ? 'Quiet time' : 'Sleeping');
    setWords(big, q ? 'Shh, quiet time' : 'Resting up');
    setText(sub, q ? `Nudges pick back up at ${hhmm(q)}.` : `Nudges start again at ${hhmm(m.s.wake)}.`);
    level = 0.42;
  } else if (m.st === 'paused') {
    setText(kicker, 'Paused');
    setWords(big, 'On pause');
    setText(sub, partner() ? 'No nudges are going out right now.' : 'No nudges until you switch them back on.');
    level = 0.3;
  } else {
    setText(kicker, 'Off');
    setWords(big, 'All quiet');
    setText(sub, 'Both reminders are switched off in settings.');
    level = 0.22;
  }
  hero.style.setProperty('--level', level.toFixed(3));
  heroActions(m);
  updateTiles(m, t);
}

// ---------- tiles ----------
function buildTiles(m) {
  const box = $('#tiles');
  box.classList.remove('skeleton');
  box.hidden = partner();
  if (partner()) { box.replaceChildren(); return; }
  box.replaceChildren(...m.rems.map((r) => {
    const snapOnly = r.kind === 'water' && m.s.require_photo;
    const actions = snapOnly
      ? [h('button', { class: 'btn primary', type: 'button', onclick: () => openCapture(r.kind) }, icon('camera'), h('span', { text: 'Snap' }))]
      : r.kind !== 'water'
      ? [h('button', { class: 'btn primary', type: 'button', onclick: () => quickDone(r.kind) }, h('span', { text: 'Done' }))]
      : [
        h('button', { class: 'btn primary', type: 'button', onclick: () => quickDone(r.kind) }, h('span', { text: 'Done' })),
        h('button', { class: 'btn soft cam', type: 'button', 'aria-label': `Log ${KIND_LABEL[r.kind].toLowerCase()} with a photo`, onclick: () => openCapture(r.kind) }, icon('camera')),
      ];
    return h('div', { class: 'tile', 'data-kind': r.kind },
      h('div', { class: 'tile-head' }, h('span', { class: 'bubble' }, icon(KIND_ICON[r.kind])), h('span', { class: 'tile-title', text: KIND_LABEL[r.kind] })),
      h('p', { class: 'tile-sub' }),
      h('div', { class: 'tile-actions' }, actions));
  }));
}

function updateTiles(m, t) {
  if (partner()) return;
  for (const r of m.rems) {
    const el = $(`.tile[data-kind="${r.kind}"]`);
    if (!el) continue;
    const due = !!r.pending_since && r.enabled && !m.s.paused;
    let text;
    if (!r.enabled) text = 'Switched off';
    else if (m.s.paused) text = 'Paused';
    else if (due) text = 'Due now';
    else if (!r.next_due) text = 'Resting';
    else {
      const until = new Date(r.next_due).getTime() - t;
      text = until <= 0 ? 'Any second now' : !m.s.awake ? `Next at ${fmtClock(r.next_due)}` : `Next in ${fmtDur(until)}`;
    }
    setText($('.tile-sub', el), text);
    el.classList.toggle('due', due);
    el.classList.toggle('off', !r.enabled);
  }
}

// ---------- actions ----------
function quickDone(kind) {
  if (kind === 'water' && state.data && state.data.settings.require_photo) return openCapture(kind);
  return celebrate(kind, rpc('ack', { p_kind: kind, p_action: 'done', p_photo: null }));
}
async function doSnooze(kind, btn) {
  btn.classList.add('busy');
  try {
    await rpc('ack', { p_kind: kind, p_action: 'snooze', p_photo: null });
    toast(`Snoozed for ${state.data.settings.snooze_min} min`);
    await load();
  } catch (e) { toast(e.message); }
  btn.classList.remove('busy');
}
async function resume(btn) {
  btn.classList.add('busy');
  try { await rpc('save_settings', { p: { paused: false } }); toast('Nudges are back on'); await load(); }
  catch (e) { toast(e.message); }
  btn.classList.remove('busy');
}

// ---------- photos ----------
const photos = new Map();
function getPhoto(id) {
  if (!photos.has(id)) {
    const p = rpc('photo', { p_id: id }).then((src) => (typeof src === 'string' && src.startsWith('data:image/') ? src : null));
    p.catch(() => photos.delete(id));
    photos.set(id, p);
  }
  return photos.get(id);
}
const lazy = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  for (const en of entries) if (en.isIntersecting) { lazy.unobserve(en.target); fillThumb(en.target); }
}, { rootMargin: '200px' }) : null;
function fillThumb(img) {
  getPhoto(Number(img.dataset.id)).then((src) => {
    if (!src) return;
    img.onload = () => img.classList.add('ready');
    img.src = src;
  }).catch(() => {});
}
function thumbImg(id) {
  const img = h('img', { alt: '', 'data-id': id, decoding: 'async' });
  if (lazy) lazy.observe(img); else fillThumb(img);
  return img;
}

const viewer = $('#viewer');
async function openViewer(e) {
  const img = $('#viewer-img');
  img.removeAttribute('src');
  $('#viewer-spin').hidden = false;
  $('#viewer-cap').textContent = `${KIND_LABEL[e.kind] || e.kind} · ${whenLabel(e.created_at)}`;
  if (!viewer.open) viewer.showModal();
  try {
    const src = await getPhoto(e.id);
    if (!viewer.open) return;
    $('#viewer-spin').hidden = true;
    if (!src) { viewer.close(); return toast('That photo is no longer stored.'); }
    img.src = src;
  } catch (err) { viewer.close(); toast(err.message); }
}
$('#viewer-close').addEventListener('click', () => viewer.close());
viewer.addEventListener('click', (e) => { if (e.target === viewer) viewer.close(); });

function whenLabel(ts) {
  const key = dayKey(ts), today = state.data.today;
  const day = key === today ? 'Today' : key === shiftDay(today, -1) ? 'Yesterday' : dayLabel(key, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${day}, ${fmtClock(ts)}`;
}

// ---------- cards ----------
function cardHead(title, meta) {
  return h('div', { class: 'card-head' }, h('h2', { class: 'card-title', text: title }), meta || null);
}

function renderToday() {
  const d = state.data;
  const t = dayStats(d.today);
  const st = streak();
  const box = $('#today');
  const dateMeta = h('span', { class: 'card-meta', text: dayLabel(d.today, { weekday: 'short', month: 'short', day: 'numeric' }) });
  const streakChip = h('span', { class: `streak${st >= 2 ? ' hot' : ''}` }, icon('flame'),
    h('span', { text: st === 0 ? 'No streak yet' : st >= 30 ? '30+ day streak' : `${st}-day streak` }));

  if (partner()) {
    box.replaceChildren(
      cardHead('Today', streakChip),
      h('div', { class: 'glance' },
        h('div', { class: 'mini' }, h('b', { text: String(t.water) }), h('span', { text: t.water === 1 ? 'glass' : 'glasses' })),
        h('div', { class: 'mini' }, h('b', { text: String(t.bathroom) }), h('span', { text: t.bathroom === 1 ? 'bathroom break' : 'bathroom breaks' })),
        h('div', { class: `mini${t.missed ? ' bad' : ''}` }, h('b', { text: String(t.missed) }), h('span', { text: 'missed' }))));
    return;
  }

  const target = waterTarget();
  let meter;
  if (target <= 20) {
    meter = h('div', { class: 'drops', role: 'img', 'aria-label': `${t.water} of ${target} glasses today` });
    meter.style.setProperty('--cols', String(target > 10 ? Math.ceil((target + (t.water > target ? 1 : 0)) / 2) : target + (t.water > target ? 1 : 0)));
    for (let i = 0; i < target; i++) {
      const dr = icon('drop-fill', i < t.water ? 'full' : '');
      if (lastWater != null && t.water > lastWater && i === Math.min(t.water, target) - 1) dr.classList.add('pop');
      meter.append(dr);
    }
    if (t.water > target) meter.append(h('span', { class: 'more', text: `+${t.water - target}` }));
  } else {
    meter = h('div', { class: 'bar-meter', role: 'img', 'aria-label': `${t.water} of ${target} glasses today` },
      h('i', { style: `width:${Math.min(100, (t.water / target) * 100)}%` }));
  }
  lastWater = t.water;
  const week = weekDays().reduce((a, x) => a + x.done, 0);
  box.replaceChildren(
    cardHead('Today', dateMeta),
    h('div', { class: 'today-main' },
      h('p', { class: 'today-count' }, String(t.water), h('small', { text: `of ${target} glasses` })),
      streakChip),
    meter,
    h('div', { class: 'minis' },
      h('div', { class: 'mini' }, h('b', { text: String(t.bathroom) }), h('span', { text: t.bathroom === 1 ? 'Bathroom break' : 'Bathroom breaks' })),
      h('div', { class: `mini${t.missed ? ' bad' : ''}` }, h('b', { text: String(t.missed) }), h('span', { text: 'Missed' })),
      h('div', { class: 'mini' }, h('b', { text: String(week) }), h('span', { text: 'Done this week' }))));
}

// Points: +200 water and +100 bathroom for a clean day, 3x off for any miss.
function renderPoints() {
  const box = $('#points');
  const p = state.data.points;
  box.hidden = !p;
  if (!p) return;
  const fmt = (n) => `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString()}`;
  const goal = p.goal || 30;
  const into = p.streak % goal;
  const laps = Math.floor(p.streak / goal);
  const lost = p.today.lost;
  const todayLine = lost < 0
    ? h('p', { class: 'pts-today bad', text: `${fmt(lost)} today. A missed check-in costs 3×.` })
    : h('p', { class: 'pts-today', text: partner() ? '+300 banks tonight if the day stays clean.' : '+300 is yours tonight if today stays clean.' });
  const bar = h('div', { class: 'pts-bar', role: 'img', 'aria-label': `${into} of ${goal} days toward the next streak milestone` },
    h('i', { style: `width:${(into / goal) * 100}%` }));
  box.replaceChildren(
    cardHead('Points', h('span', { class: 'card-meta', text: p.best_streak ? `Best streak ${p.best_streak}` : '' })),
    h('p', { class: `pts-total${p.total < 0 ? ' neg' : ''}` }, fmt(p.total), h('small', { text: 'points' })),
    todayLine,
    bar,
    h('div', { class: 'pts-legend' },
      h('span', { text: p.streak === 0 ? 'Streak starts with one clean day' : `Day ${into || goal} of ${goal}` }),
      h('span', { text: laps > 0 ? `${laps} × 30-day streak` : `${goal - into} to a 30-day streak` })),
    h('p', { class: 'pts-rules', text: 'Clean day: +200 water, +100 bathroom. Any miss: −600 or −300 instead.' }));
}

function weekDays() {
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const key = shiftDay(state.data.today, -i);
    out.push({ key, ...dayStats(key) });
  }
  return out;
}

function renderWeek() {
  const days = weekDays();
  const today = state.data.today;
  if (!selectedDay || !days.some((d) => d.key === selectedDay)) selectedDay = today;
  const max = Math.max(1, ...days.map((d) => d.done + d.missed));
  const meta = h('span', { class: 'card-meta', 'aria-live': 'polite' });
  const cols = [];
  const select = (key) => {
    selectedDay = key;
    const d = days.find((x) => x.key === key);
    cols.forEach((c) => { const on_ = c.dataset.key === key; c.classList.toggle('sel', on_); c.setAttribute('aria-pressed', String(on_)); });
    const name = key === today ? 'Today' : dayLabel(key, { weekday: 'short', day: 'numeric' });
    meta.textContent = d.done + d.missed === 0 ? `${name} · nothing logged` : `${name} · ${d.done} done, ${d.missed} missed`;
  };
  for (const d of days) {
    const bars = h('span', { class: 'chart-bars' });
    const total = d.done + d.missed;
    if (!total) bars.append(h('i', { class: 'z' }));
    else {
      // segments share the bar height in proportion to their counts
      bars.style.height = `${Math.max(8, Math.round((total / max) * 118))}px`;
      if (d.missed) bars.append(h('i', { class: 'm', style: `flex:${d.missed} 0 0` }));
      if (d.done) bars.append(h('i', { class: 'd', style: `flex:${d.done} 0 0` }));
    }
    const wd = dayLabel(d.key, { weekday: 'narrow' });
    const col = h('button', {
      class: `chart-col${d.key === today ? ' today' : ''}`, type: 'button', 'data-key': d.key,
      'aria-label': `${dayLabel(d.key, { weekday: 'long' })}: ${d.done} done, ${d.missed} missed`,
      onclick: () => select(d.key), onmouseenter: () => select(d.key),
    }, h('span', { class: 'chart-track' }, bars), h('span', { class: 'chart-day', text: wd }));
    cols.push(col);
  }
  $('#week').replaceChildren(
    cardHead('Last 7 days', meta),
    h('div', { class: 'chart' }, cols),
    h('div', { class: 'legend' },
      h('span', null, h('i', { style: 'background:var(--chart-done)' }), 'Done'),
      h('span', null, h('i', { style: 'background:var(--chart-missed)' }), 'Missed')));
  select(selectedDay);
}

function renderGallery() {
  const box = $('#gallery');
  box.hidden = !partner();
  if (!partner()) { box.replaceChildren(); return; }
  const shots = state.data.recent.filter((e) => e.has_photo).slice(0, 6);
  box.replaceChildren(
    cardHead('Latest photos'),
    shots.length
      ? h('div', { class: 'gallery' }, shots.map((e) => h('button', { class: 'shot', type: 'button', 'aria-label': `Photo, ${whenLabel(e.created_at)}`, onclick: () => openViewer(e) },
        thumbImg(e.id), h('time', { text: fmtClock(e.created_at) }))))
      : h('p', { class: 'empty', text: "No photos yet. They'll land here as soon as one is snapped." }));
}

const STATUS = { done: 'Done', missed: 'Missed', snoozed: 'Snoozed' };
function renderLog() {
  const all = state.data.recent;
  const box = $('#log');
  if (!all.length) {
    box.replaceChildren(cardHead('Recent'), h('p', { class: 'empty', text: partner() ? "Nothing logged yet. It'll fill in as the day goes." : 'Nothing yet. Your first sip will show up here.' }));
    return;
  }
  const rows = logExpanded ? all : all.slice(0, 6);
  const kids = [cardHead('Recent')];
  let lastDay = null, lastRow = null;
  for (const e of rows) {
    const key = dayKey(e.created_at);
    if (key !== lastDay) {
      if (lastRow) lastRow.classList.add('last');
      lastDay = key;
      const today = state.data.today;
      kids.push(h('p', { class: 'log-day', text: key === today ? 'Today' : key === shiftDay(today, -1) ? 'Yesterday' : dayLabel(key, { weekday: 'long', month: 'short', day: 'numeric' }) }));
    }
    const status = STATUS[e.status] ? e.status : 'done';
    lastRow = h('div', { class: `log-row ${status}` },
      h('span', { class: 'bubble' }, icon(status === 'missed' ? 'alert' : status === 'snoozed' ? 'clock' : KIND_ICON[e.kind] || 'drop')),
      h('div', { class: 'log-text' },
        h('b', { text: KIND_LABEL[e.kind] || String(e.kind) }),
        h('span', null, h('em', { text: STATUS[status] }), ` · ${fmtClock(e.created_at)}`)),
      e.has_photo ? h('button', { class: 'thumb', type: 'button', 'aria-label': 'View photo', onclick: () => openViewer(e) }, icon('camera'), thumbImg(e.id)) : null);
    kids.push(lastRow);
  }
  if (lastRow) lastRow.classList.add('last');
  if (all.length > 6) {
    kids.push(h('div', { class: 'more-row' }, h('button', { class: 'textbtn accent', type: 'button', text: logExpanded ? 'Show less' : `Show all ${all.length}`, onclick: () => { logExpanded = !logExpanded; renderLog(); } })));
  }
  box.replaceChildren(...kids);
}

// ---------- header + banner ----------
function renderHeader() {
  const s = state.data.settings;
  const name = String(s.her_name || '').trim();
  if (partner()) {
    $('#hello-eyebrow').textContent = 'Partner view';
    $('#hello-name').textContent = name ? `${name}’s day` : 'Today';
  } else {
    const hr = Math.floor(minutesNow(s.timezone) / 60);
    $('#hello-eyebrow').textContent = hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : hr < 22 ? 'Good evening' : 'Winding down';
    $('#hello-name').textContent = name ? `Hi, ${name}` : 'Hi there';
  }
  $('#foot-note').textContent = partner() ? 'You get a heads-up whenever one is missed.' : 'Made with love, one glass at a time.';
}

function renderBanner() {
  const box = $('#banner');
  if (state.loadError) {
    box.className = 'banner warn';
    box.replaceChildren(icon('alert'), h('span', { text: state.loadError.message }),
      h('button', { class: 'btn small', type: 'button', text: 'Retry', onclick: (e) => { e.currentTarget.classList.add('busy'); load(); } }));
    box.hidden = false;
    return;
  }
  if (pushState === 'off') {
    box.className = 'banner';
    box.replaceChildren(icon('bell'), h('span', { text: partner() ? 'Alerts are off on this device.' : 'Nudges are off on this phone.' }),
      h('button', { class: 'btn small', type: 'button', text: 'Turn on', onclick: async (e) => {
        const b = e.currentTarget; b.classList.add('busy');
        try {
          const r = await enablePush();
          toast(r === 'on' ? "You're all set" : r === 'denied' ? 'Notifications are blocked in your browser settings.' : 'Not turned on yet.');
        } catch (err) { toast(err.message); }
        b.classList.remove('busy');
        checkPush();
      } }));
    box.hidden = false;
    return;
  }
  if (pushState === 'needs-install') {
    box.className = 'banner';
    box.replaceChildren(icon('phone'), h('span', { text: 'Add Sip to your Home Screen to get nudges here.' }),
      h('button', { class: 'btn small', type: 'button', text: 'How', onclick: () => emit('onboard', 'install') }));
    box.hidden = false;
    return;
  }
  box.hidden = true;
}

export async function checkPush() {
  try { pushState = await pushStatus(); } catch { pushState = null; }
  if (state.data || state.loadError) renderBanner();
}

// ---------- render ----------
function render() {
  const d = state.data;
  const m = model();
  renderHeader();
  renderBanner();
  const tileSig = JSON.stringify([state.role, m.rems.map((r) => [r.kind, r.enabled]), m.s.require_photo]);
  if (sigs.tiles !== tileSig) { sigs.tiles = tileSig; sigs.hero = null; buildTiles(m); }
  updateHero();
  const dataSig = JSON.stringify([state.role, d.today, d.points, d.stats, d.recent, d.settings.wake, d.settings.sleep, d.settings.timezone, m.rems.map((r) => r.interval_min)]);
  if (sigs.data !== dataSig) {
    sigs.data = dataSig;
    renderToday();
    renderPoints();
    renderGallery();
    renderWeek();
    renderLog();
  }
}

export function showSkeleton() {
  if (state.data) return;
  hero.dataset.state = 'loading';
  const box = $('#tiles');
  box.classList.add('skeleton');
  box.hidden = partner();
  box.replaceChildren(h('div', { class: 'skel-block' }, h('i', { class: 'skel' })), h('div', { class: 'skel-block' }, h('i', { class: 'skel' })));
}

export function rerender() { sigs = {}; if (state.data) render(); else showSkeleton(); }

on('data', render);
on('loaderror', () => renderBanner());
on('role', rerender);

// Live countdown + polling
let lastPoll = Date.now();
setInterval(() => {
  if (!state.data || document.hidden || $('#home').hidden) return;
  if (!captureOpen()) updateHero();
  const m = model();
  const overdue = m.st === 'next' && m.focus && new Date(m.focus.next_due).getTime() - now() < -4000;
  const every = m.st === 'due' || overdue ? 12000 : 30000;
  if (Date.now() - lastPoll > every) { lastPoll = Date.now(); load(); }
}, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.key) { lastPoll = Date.now(); load(); } });
