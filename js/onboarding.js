// First-run setup: role -> Home Screen -> notifications -> camera.
import { $, h, icon, state, setRole, store, emit, toast, isIOS, isAndroid, isStandalone } from './core.js';
import { pushStatus, enablePush } from './push.js';

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; if (current === 'install') draw(); });
window.addEventListener('appinstalled', () => { installPrompt = null; if (current === 'install') next(); });

let steps = [];
let current = null;
let camResult = null;

const partner = () => state.role === 'partner';
function plan() {
  const s = ['role'];
  if (!isStandalone()) s.push('install');
  s.push('notify');
  if (!partner()) s.push('camera');
  return s;
}

function logo() {
  const svg = icon('logo');
  svg.setAttribute('viewBox', '0 0 64 64');
  return svg;
}
function step(art, title, lede, ...extra) {
  return h('div', { class: 'ob-step' }, art ? h('div', { class: 'ob-art' }, art) : null, h('h1', { class: 'display', text: title }), lede ? h('p', { class: 'lede', text: lede }) : null, extra);
}
function li(n, text, ic) {
  return h('li', null, h('span', { class: 'n', text: String(n) }), h('p', { text }), ic ? icon(ic) : null);
}
function primary(text, onclick, cls) {
  return h('button', { class: `btn ${cls || 'primary'} block`, type: 'button', onclick }, h('span', { text }));
}

const views = {
  role() {
    const pickRole = (r) => { setRole(r); emit('role'); steps = plan(); next(); };
    const card = (r, ic, title, sub) => h('button', { class: 'role', type: 'button', onclick: () => pickRole(r) },
      h('span', { class: 'bubble' }, icon(ic)), h('span', { class: 'role-text' }, h('b', { text: title }), h('span', { text: sub })), icon('chevron'));
    return {
      body: step(h('div', { class: 'art-mark' }, logo()), 'Hello. Whose phone is this?', 'Sip sends gentle nudges to drink water and take a break, and makes ticking them off a one-tap thing.',
        h('div', { class: 'roles' },
          card('her', 'drop', 'This is my phone', "I'm the one getting the nudges"),
          card('partner', 'heart', "I'm the partner", 'I want a heads-up if one gets missed'))),
      foot: [],
    };
  },

  install() {
    const art = h('div', { class: 'art-phone' }, h('i'), h('i'), h('i'), h('i'), h('i', { class: 'app' }, logo()), h('i'), h('i'), h('i'), h('i'));
    if (isIOS) {
      const key = state.key || '';
      return {
        body: step(art, 'Put Sip on your Home Screen', "It opens like a real app. On iPhone it's also the only way notifications can reach you.",
          h('ol', { class: 'steps' },
            li(1, 'Tap the Share button in your browser', 'share'),
            li(2, 'Choose "Add to Home Screen"', 'plus-box'),
            li(3, 'Open Sip from your Home Screen', 'phone')),
          key ? h('p', { class: 'ob-note' }, 'It will ask for the passcode once more there: ', h('code', { text: key }), ' ',
            h('button', { class: 'textbtn accent', type: 'button', style: 'min-height:32px;padding:0 6px', text: 'Copy', onclick: async () => { try { await navigator.clipboard.writeText(key); toast('Passcode copied'); } catch { toast('Press and hold the passcode to copy it'); } } })) : null),
        foot: [primary("I'll finish in the app", next, 'soft')],
      };
    }
    if (installPrompt) {
      return {
        body: step(art, 'Put Sip on your Home Screen', 'One tap and it lives next to your other apps, with its own icon and no browser bars.'),
        foot: [primary('Install Sip', async () => {
          const p = installPrompt;
          try { p.prompt(); const res = await p.userChoice; installPrompt = null; if (res && res.outcome === 'accepted') next(); else draw(); }
          catch { installPrompt = null; draw(); }
        }), primary('Not now', next, 'soft')],
      };
    }
    if (isAndroid) {
      return {
        body: step(art, 'Put Sip on your Home Screen', 'It opens like a real app, with its own icon and no browser bars.',
          h('ol', { class: 'steps' },
            li(1, 'Tap the menu in the top corner of your browser', 'dots'),
            li(2, 'Choose "Add to Home screen" or "Install app"', 'plus-box'),
            li(3, 'Open Sip from your Home Screen', 'phone'))),
        foot: [primary('Next', next)],
      };
    }
    return {
      body: step(art, 'Keep Sip close', "On a computer, look for the install icon in the address bar, or just keep this tab around. On a phone, add it to the Home Screen from the browser's menu."),
      foot: [primary('Next', next)],
    };
  },

  notify() {
    const art = h('div', { class: 'art-notifs' },
      h('div', { class: 'art-notif' }, h('span', { class: 'app' }, logo()), h('span', null, h('b', { text: partner() ? 'Missed: water' : 'Water time' }), h('span', { text: partner() ? 'No water logged in the last 30 min.' : 'One glass, right now. Tap when done.' }))),
      h('div', { class: 'art-notif' }, h('span', { class: 'app' }, logo()), h('span', null, h('b', { text: 'Bathroom break' }), h('span', { text: "Don't hold it." }))));
    const title = partner() ? 'Get a heads-up' : 'Turn on your nudges';
    const lede = partner()
      ? "You'll only hear from Sip when a reminder gets missed. No noise otherwise."
      : 'A little tap on the shoulder when it is time, and again every few minutes until you tick it off.';
    const body = step(art, title, lede);
    const foot = [];
    const fill = (st) => {
      body.querySelectorAll('.ob-note').forEach((n) => n.remove());
      foot.length = 0;
      if (st === 'on') {
        body.append(h('p', { class: 'ob-note good' }, icon('check'), 'Notifications are on for this device.'));
        foot.push(primary('Continue', next));
      } else if (st === 'needs-install') {
        body.append(h('p', { class: 'ob-note warn', text: 'On iPhone, notifications only work after Sip is added to your Home Screen and opened from there. Do that first, and Sip will ask again when you open it.' }));
        if (steps.includes('install')) foot.push(primary('Show me how', () => go('install')));
        foot.push(primary('Continue without them', next, 'soft'));
      } else if (st === 'denied') {
        body.append(h('p', { class: 'ob-note warn', text: 'Notifications are blocked for Sip. You can allow them in your browser or phone settings, then switch them on from Settings in the app.' }));
        foot.push(primary('Continue', next));
      } else if (st === 'unsupported' || st === 'unconfigured') {
        body.append(h('p', { class: 'ob-note', text: st === 'unsupported' ? "This browser can't show notifications. Sip still works; you just won't get nudged here." : "Notifications aren't set up on the server yet." }));
        foot.push(primary('Continue', next));
      } else {
        const b = primary('Turn on notifications', async () => {
          b.classList.add('busy');
          let r = 'off';
          try { r = await enablePush(); } catch (e) { toast(e.message); }
          b.classList.remove('busy');
          if (r === 'off') toast('Not turned on yet. You can try again.');
          fill(r); $('#ob-foot').replaceChildren(...foot);
        });
        foot.push(b);
      }
    };
    fill('off');
    pushStatus().then((st) => { if (current === 'notify' && st !== 'off') { fill(st); $('#ob-foot').replaceChildren(...foot); } }).catch(() => {});
    return { body, foot };
  },

  camera() {
    const body = step(h('div', { class: 'art-cam' }), 'One tap to say done', 'When a nudge comes in, Sip opens straight to your camera. Snap your glass and you are finished. Photos only go to your partner.');
    const foot = [];
    if (camResult === 'ok') {
      body.append(h('p', { class: 'ob-note good' }, icon('check'), 'Camera is ready.'));
      foot.push(primary('Finish', next));
    } else if (camResult === 'no') {
      body.append(h('p', { class: 'ob-note', text: "No camera access here, and that's fine. You can still log with a tap, or allow the camera later in your browser settings." }));
      foot.push(primary('Finish', next));
    } else {
      const b = primary('Allow camera', async () => {
        b.classList.add('busy');
        try {
          const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
          s.getTracks().forEach((t) => t.stop());
          camResult = 'ok';
        } catch { camResult = 'no'; }
        if (current === 'camera') draw();
      });
      foot.push(b);
    }
    return { body, foot };
  },
};

function draw() {
  const v = views[current]();
  $('#ob-body').replaceChildren(v.body);
  $('#ob-foot').replaceChildren(...v.foot);
  const i = steps.indexOf(current);
  $('#ob-dots').replaceChildren(...steps.map((_, n) => h('i', { class: n === i ? 'on' : '' })));
  $('#ob-back').hidden = i <= 0;
  $('#ob-skip').hidden = current === 'role';
  $('#ob-skip').textContent = i === steps.length - 1 ? 'Done' : 'Skip';
  window.scrollTo(0, 0);
}
function go(name) { current = name; draw(); }
function next() {
  const i = steps.indexOf(current);
  if (i >= steps.length - 1) return finish();
  go(steps[i + 1]);
}
function finish() {
  current = null;
  store.set('sip-onboarded', '1');
  emit('onboarded');
}

export function startOnboarding(at) {
  camResult = null;
  steps = plan();
  if (at && steps.includes(at)) return go(at);
  go(state.role ? steps[1] || 'role' : 'role');
}

$('#ob-skip').addEventListener('click', next);
$('#ob-back').addEventListener('click', () => { const i = steps.indexOf(current); if (i > 0) go(steps[i - 1]); });
