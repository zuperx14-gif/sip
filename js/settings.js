// Settings sheet. Changes save themselves a moment after you make them.
import { $, h, icon, state, rpc, load, on, emit, toast, setKey, setRole, store, fmtDur, shiftDay, dayLabel } from './core.js';
import { pushStatus, enablePush, disablePush, refreshPush } from './push.js';

const sheet = $('#settings');
const backdrop = $('#sheet-backdrop');
const body = $('#settings-body');
const saveState = $('#save-state');

// ---------- autosave ----------
let pending = {};
let timer = null;
let saving = false;
let okTimer = null;

function mark(kind, text) {
  clearTimeout(okTimer);
  saveState.className = `save-state ${kind}`;
  saveState.replaceChildren(...(kind === 'ok' ? [icon('check'), text] : [text]));
  if (kind === 'ok') okTimer = setTimeout(() => saveState.replaceChildren(), 2200);
}
function queue(patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'reminders') {
      pending.reminders ||= {};
      for (const [kind, val] of Object.entries(v)) pending.reminders[kind] = { ...(pending.reminders[kind] || {}), ...val };
    } else pending[k] = v;
  }
  mark('', 'Saving…');
  clearTimeout(timer);
  timer = setTimeout(flush, 550);
}
async function flush() {
  clearTimeout(timer);
  if (saving || !Object.keys(pending).length) return;
  const p = pending;
  pending = {};
  saving = true;
  try {
    await rpc('save_settings', { p });
    mark('ok', 'Saved');
    await load();
  } catch (e) {
    mark('err', "Couldn't save");
    toast(e.message);
  }
  saving = false;
  if (Object.keys(pending).length) flush();
}

// ---------- controls ----------
function row(title, desc, control, cls) {
  return h('div', { class: `row${cls ? ` ${cls}` : ''}` },
    h('div', { class: 'row-text' }, h('b', { text: title }), desc ? h('span', { text: desc }) : null), control);
}
function toggle(label, checked, onChange) {
  const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch' }, input, h('i'));
}
function stepper(label, value, { min, max, step }, onChange) {
  let v = Number(value) || min;
  const out = h('output', { text: fmtDur(v * 60000) });
  const dec = h('button', { type: 'button', 'aria-label': `Less: ${label}` }, icon('minus'));
  const inc = h('button', { type: 'button', 'aria-label': `More: ${label}` }, icon('plus'));
  const sync = () => { out.textContent = fmtDur(v * 60000); dec.disabled = v <= min; inc.disabled = v >= max; };
  const bump = (dir) => {
    const st = typeof step === 'function' ? step(v, dir) : step;
    const snapped = dir > 0 ? Math.floor(v / st) * st + st : Math.ceil(v / st) * st - st;
    v = Math.min(max, Math.max(min, snapped));
    sync();
    onChange(v);
  };
  dec.addEventListener('click', () => bump(-1));
  inc.addEventListener('click', () => bump(1));
  sync();
  return h('div', { class: 'stepper', role: 'group', 'aria-label': label }, dec, out, inc);
}
const intervalStep = (v, dir) => (v < 60 || (v === 60 && dir < 0) ? 5 : 15);
function timeInput(label, value, onChange) {
  const input = h('input', { class: 'field', type: 'time', 'aria-label': label, required: true });
  input.value = String(value || '').slice(0, 5);
  input.addEventListener('change', () => { if (/^\d{2}:\d{2}$/.test(input.value)) onChange(input.value); });
  return input;
}
function group(title, list, note) {
  return h('section', { class: 'group' }, title ? h('h3', { class: 'group-title', text: title }) : null, h('div', { class: 'list' }, list), note ? h('p', { class: 'group-note', text: note }) : null);
}

// ---------- sections ----------
function quietSection(s) {
  let windows = (s.quiet_windows || []).map((w) => [String(w[0]).slice(0, 5), String(w[1]).slice(0, 5)]);
  const list = h('div', { class: 'list' });
  const save = () => queue({ quiet_windows: windows.filter((w) => /^\d{2}:\d{2}$/.test(w[0]) && /^\d{2}:\d{2}$/.test(w[1]) && w[0] !== w[1]) });
  const draw = () => {
    const rows = windows.map((w, i) => h('div', { class: 'row' }, h('div', { class: 'quiet-row', style: 'flex:1' },
      timeInput(`Quiet time ${i + 1} starts`, w[0], (v) => { w[0] = v; save(); }),
      h('span', { text: 'to' }),
      timeInput(`Quiet time ${i + 1} ends`, w[1], (v) => { w[1] = v; save(); }),
      h('button', { class: 'iconbtn soft', type: 'button', 'aria-label': `Remove quiet time ${i + 1}`, onclick: () => { windows.splice(i, 1); draw(); save(); } }, icon('x')))));
    rows.push(h('div', { class: 'row' }, h('button', { class: 'textbtn accent', type: 'button', style: 'display:flex;align-items:center;gap:8px;padding-left:0', onclick: () => { windows.push(['13:00', '14:00']); draw(); save(); } },
      icon('plus'), h('span', { text: 'Add a quiet time' }))));
    list.replaceChildren(...rows);
    list.querySelectorAll('.textbtn svg').forEach((x) => { x.style.width = '18px'; x.style.height = '18px'; });
  };
  draw();
  return h('section', { class: 'group' }, h('h3', { class: 'group-title', text: 'Quiet times' }), list,
    h('p', { class: 'group-note', text: 'No nudges during these. Handy for meetings, classes or naps.' }));
}

const PUSH_COPY = {
  on: ['on', 'On for this device'],
  off: ['', 'Off for this device'],
  denied: ['bad', 'Blocked. Allow notifications for Sip in your browser or phone settings, then come back.'],
  'needs-install': ['', 'On iPhone, notifications only work once Sip is added to your Home Screen and opened from there.'],
  unsupported: ['', "This browser can't show notifications."],
  unconfigured: ['', "Notifications aren't set up on the server yet."],
};

function deviceSection(d) {
  const sec = h('section', { class: 'group' }, h('h3', { class: 'group-title', text: 'This device' }));
  const list = h('div', { class: 'list' });
  const pushRow = h('div', { class: 'row' });
  const drawPush = async () => {
    let st;
    try { st = await pushStatus(); } catch { st = 'unsupported'; }
    const [dot, desc] = PUSH_COPY[st] || PUSH_COPY.unsupported;
    const can = st === 'on' || st === 'off';
    const btn = can ? h('button', { class: `btn small ${st === 'on' ? '' : 'primary'}`, type: 'button', text: st === 'on' ? 'Turn off' : 'Turn on', onclick: async () => {
      btn.classList.add('busy');
      try {
        if (st === 'on') { await disablePush(); toast('Notifications off for this device'); }
        else { const r = await enablePush(); if (r === 'on') toast('Notifications are on'); }
        await load();
      } catch (e) { toast(e.message); }
      emit('pushchange');
      drawPush();
    } }) : null;
    pushRow.replaceChildren(h('i', { class: `status-dot ${dot}` }), h('div', { class: 'row-text' }, h('b', { text: 'Notifications' }), h('span', { text: desc })), ...(btn ? [btn] : []));
  };
  drawPush();

  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Whose device is this' });
  const drawSeg = () => seg.replaceChildren(...[['her', 'Nudges'], ['partner', 'Alerts']].map(([val, label]) => h('button', {
    type: 'button', 'aria-pressed': String((state.role || 'her') === val), text: label,
    onclick: async () => { if (state.role === val) return; setRole(val); drawSeg(); emit('role'); try { await refreshPush(true); await load(); } catch { /* ignore */ } },
  })));
  drawSeg();

  const testBtn = h('button', { class: 'btn small', type: 'button', text: 'Send', onclick: async () => {
    testBtn.classList.add('busy');
    try { await rpc('test_push'); toast('Test sent to every connected device'); } catch (e) { toast(e.message); }
    testBtn.classList.remove('busy');
  } });

  list.append(pushRow,
    row('This device is', 'Nudges gets the reminders. Alerts gets a heads-up when one is missed.', seg),
    row('Send a test notification', 'Pings every connected device.', testBtn));
  sec.append(list);

  const devs = d.devices || [];
  if (devs.length) {
    sec.append(h('p', { class: 'group-note', text: `Connected: ${devs.map((x) => `${x.ua || 'Device'} (${x.role === 'partner' ? 'partner' : 'hers'})`).join(', ')}` }));
  }
  return sec;
}

function ntfySection(s) {
  const sec = h('section', { class: 'group' }, h('h3', { class: 'group-title', text: 'Backup channel' }));
  const list = h('div', { class: 'list' });
  const topic = (label, value) => h('div', { class: 'row stack sub' },
    h('div', { class: 'row-text' }, h('b', { text: label })),
    h('div', { class: 'topic' }, h('span', { class: 'code', text: value || 'not set' }),
      h('button', { class: 'btn small', type: 'button', text: 'Copy', onclick: async () => {
        try { await navigator.clipboard.writeText(value); toast('Copied'); } catch { toast('Press and hold the name to copy it'); }
      } })));
  const draw = (onNow) => {
    const rows = [row('Also send via the ntfy app', 'A second way in, if regular notifications are flaky.', toggle('Also send via the ntfy app', onNow, (v) => { queue({ ntfy_enabled: v }); draw(v); }))];
    if (onNow) rows.push(topic('Nudges phone subscribes to', s.her_topic), topic('Alerts phone subscribes to', s.partner_topic));
    list.replaceChildren(...rows);
    note.hidden = !onNow;
  };
  const note = h('p', { class: 'group-note', text: 'Install the free ntfy app, tap +, and subscribe to the topic name for that phone.' });
  sec.append(list, note);
  draw(!!s.ntfy_enabled);
  return sec;
}

function tzControl(s) {
  let zones = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch { /* older browsers */ }
  if (!zones.length) {
    const input = h('input', { class: 'field', 'aria-label': 'Timezone', autocapitalize: 'off', spellcheck: 'false' });
    input.value = s.timezone || '';
    input.addEventListener('change', () => { if (input.value.trim()) queue({ timezone: input.value.trim() }); });
    return input;
  }
  if (s.timezone && !zones.includes(s.timezone)) zones = [s.timezone, ...zones];
  const sel = h('select', { class: 'field', 'aria-label': 'Timezone' }, zones.map((z) => h('option', { value: z, text: z.replace(/_/g, ' ') })));
  sel.value = s.timezone;
  sel.addEventListener('change', () => queue({ timezone: sel.value }));
  return sel;
}

// Two weeks of day chips; tap the nights that are work nights.
function shiftSection(d) {
  const s = d.settings;
  const on = new Set(d.shifts || []);
  const strip = h('div', { class: 'shift-strip', role: 'group', 'aria-label': 'Work nights' });
  for (let i = 0; i < 14; i++) {
    const key = shiftDay(d.today, i);
    const chip = h('button', { type: 'button', class: 'shift-chip', 'aria-pressed': String(on.has(key)),
      'aria-label': `${dayLabel(key, { weekday: 'long', month: 'short', day: 'numeric' })} night` },
      h('span', { text: i === 0 ? 'Today' : dayLabel(key, { weekday: 'short' }) }),
      h('b', { text: String(Number(key.slice(8))) }));
    chip.addEventListener('click', async () => {
      const next = chip.getAttribute('aria-pressed') !== 'true';
      chip.setAttribute('aria-pressed', String(next));
      mark('', 'Saving…');
      try {
        await rpc('set_shift', { p_day: key, p_on: next });
        mark('ok', 'Saved');
        load();
      } catch (e) {
        chip.setAttribute('aria-pressed', String(!next));
        mark('err', "Couldn't save");
        toast(e.message);
      }
    });
    strip.append(chip);
  }
  const link = h('input', { class: 'field wide', type: 'url', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    'aria-label': 'Calendar link', placeholder: 'Paste a calendar link' });
  link.value = s.calendar_url || '';
  link.addEventListener('change', () => queue({ calendar_url: link.value.trim() }));
  const word = h('input', { class: 'field', autocomplete: 'off', maxlength: '40', 'aria-label': 'Only events containing', placeholder: 'Any' });
  word.value = s.calendar_keyword || '';
  word.addEventListener('change', () => queue({ calendar_keyword: word.value.trim() }));
  const calRows = [h('div', { class: 'row col' }, h('div', { class: 'row-text' }, h('b', { text: 'Calendar link' }),
    h('span', { text: s.calendar_status || 'Night shifts on this calendar become work nights on their own. Checked every hour.' })), link)];
  if (s.calendar_url) calRows.push(row('Only events containing', 'Leave empty to count every overnight event.', word, 'sub'));

  return h('section', { class: 'group' },
    h('h3', { class: 'group-title', text: 'Work nights' }),
    h('div', { class: 'list' },
      ...calRows,
      h('div', { class: 'row col' }, strip),
      row('Sleep after a shift until', 'Quiet from the moment the shift ends until this time.', timeInput('Sleep after a shift until', s.day_sleep_end, (v) => queue({ day_sleep_end: v }))),
      row('Shift ends at', 'Only used for nights you tap. The calendar gives its own end time.', timeInput('Shift ends at', s.day_sleep_start, (v) => queue({ day_sleep_start: v })), 'sub')),
    h('p', { class: 'group-note', text: 'Work a night, sleep the next day: nudges keep going through the shift and stay quiet for sleep after it. No shift, normal night: the usual wake-up and bedtime apply. Nights can come from the calendar link or a tap.' }));
}

function build() {
  const d = state.data, s = d.settings;
  const rem = Object.fromEntries(d.reminders.map((r) => [r.kind, r]));
  const name = h('input', { class: 'field name', 'aria-label': 'Name', autocomplete: 'off', maxlength: '40', placeholder: 'Name' });
  name.value = s.her_name || '';
  name.addEventListener('input', () => queue({ her_name: name.value.trim() }));

  const kids = [];
  kids.push(group(null, [
    row('Pause everything', 'No nudges at all until you switch this off.', toggle('Pause everything', s.paused, (v) => queue({ paused: v }))),
  ]));
  kids.push(group('Schedule', [
    row('Name', null, name),
    row('Wakes up', null, timeInput('Wakes up', s.wake, (v) => queue({ wake: v }))),
    row('Goes to sleep', null, timeInput('Goes to sleep', s.sleep, (v) => queue({ sleep: v }))),
    row('Timezone', null, tzControl(s)),
  ], 'Nudges only happen between wake-up and bedtime.'));
  kids.push(shiftSection(d));

  const remRows = [];
  for (const [kind, label] of [['water', 'Water'], ['bathroom', 'Bathroom breaks']]) {
    const r = rem[kind];
    if (!r) continue;
    remRows.push(row(label, null, toggle(label, r.enabled, (v) => queue({ reminders: { [kind]: { enabled: v } } }))));
    remRows.push(row('Every', null, stepper(`${label} every`, r.interval_min, { min: 5, max: 480, step: intervalStep }, (v) => queue({ reminders: { [kind]: { interval_min: v } } })), 'sub'));
  }
  kids.push(group('Reminders', remRows));

  kids.push(group('Nudging', [
    row('Nudge again every', 'Until it gets marked done.', stepper('Nudge again every', s.nag_every_min, { min: 1, max: 60, step: 1 }, (v) => queue({ nag_every_min: v }))),
    row('Give up after', 'Then it counts as missed and the partner hears about it.', stepper('Give up after', s.window_min, { min: 5, max: 240, step: 5 }, (v) => queue({ window_min: v }))),
    row('Snooze length', null, stepper('Snooze length', s.snooze_min, { min: 5, max: 120, step: 5 }, (v) => queue({ snooze_min: v }))),
    row('Require a photo for water', 'Water only counts with a quick snap. Bathroom never needs one.', toggle('Require a photo for water', s.require_photo, (v) => queue({ require_photo: v }))),
  ]));
  kids.push(quietSection(s));
  kids.push(deviceSection(d));
  kids.push(ntfySection(s));

  let armed = false;
  const forget = h('button', { class: 'btn danger block', type: 'button', text: 'Forget this device', onclick: async () => {
    if (!armed) { armed = true; forget.textContent = 'Tap again to forget this device'; setTimeout(() => { armed = false; forget.textContent = 'Forget this device'; }, 4000); return; }
    forget.classList.add('busy');
    try { await disablePush(); } catch { /* best effort */ }
    closeSettings();
    store.del('sip-onboarded');
    setRole(null);
    setKey(null);
    emit('locked');
  } });
  kids.push(h('div', { class: 'sheet-actions' }, forget,
    h('p', { class: 'group-note', style: 'text-align:center', text: 'Turns off notifications here and removes the passcode from this device.' })));
  body.replaceChildren(...kids);
}

export function openSettings() {
  if (!state.data) return toast('Still loading. One sec.');
  build();
  saveState.replaceChildren();
  backdrop.hidden = false;
  sheet.hidden = false;
  body.scrollTop = 0;
  document.body.classList.add('locked');
  requestAnimationFrame(() => requestAnimationFrame(() => { backdrop.classList.add('open'); sheet.classList.add('open'); }));
  $('#settings-close').focus({ preventScroll: true });
}
export function closeSettings() {
  if (sheet.hidden) return;
  flush();
  backdrop.classList.remove('open');
  sheet.classList.remove('open');
  document.body.classList.remove('locked');
  setTimeout(() => { sheet.hidden = true; backdrop.hidden = true; }, 420);
}

$('#open-settings').addEventListener('click', openSettings);
$('#settings-close').addEventListener('click', closeSettings);
backdrop.addEventListener('click', closeSettings);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closeSettings(); });
on('locked', closeSettings);
