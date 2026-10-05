'use strict';
/* Ironicles — a private, self-hosted cycle tracker. The server keeps the data (one SQLite
   file); this page draws it and works like an app on a phone.

   Phases are estimates from cycle length: ovulation ~14 days before the next period
   (the luteal half of a cycle is the steady one), period = 5 days, fertile window =
   ovulation − 5 .. ovulation + 1, "late" past the expected length. Not medical advice,
   and not for contraception. */

/* ------------------------------------------------------------------ constants */
const SYMPTOMS = [
  { k: 'cramps', e: '😣' }, { k: 'headache', e: '🤕' }, { k: 'bloating', e: '🫧' }, { k: 'fatigue', e: '😴' },
  { k: 'acne', e: '😔' }, { k: 'nausea', e: '🤢' }, { k: 'sore breasts', e: '💢' }, { k: 'insomnia', e: '🌙' },
  { k: 'anxiety', e: '😰' }, { k: 'mood swings', e: '🎭' }, { k: 'cravings', e: '🍫' }, { k: 'backache', e: '🦵' },
  { k: 'hot flashes', e: '🔥' }, { k: 'spotting', e: '🩸' },
];
const MOODS = [
  { k: 'radiant', e: '😄', l: 'Radiant' }, { k: 'good', e: '😊', l: 'Good' }, { k: 'meh', e: '😐', l: 'Meh' },
  { k: 'tired', e: '😴', l: 'Tired' }, { k: 'sad', e: '😢', l: 'Sad' }, { k: 'angry', e: '😠', l: 'Angry' },
  { k: 'anxious', e: '😰', l: 'Anxious' }, { k: 'cozy', e: '🥰', l: 'Cozy' },
];
const FLOWS = [
  { k: 'none', l: 'None' }, { k: 'spotting', l: 'Spotting' }, { k: 'light', l: 'Light' },
  { k: 'medium', l: 'Medium' }, { k: 'heavy', l: 'Heavy' },
];
const FLOW_RANK = { none: 0, spotting: 1, light: 2, medium: 3, heavy: 4 };
const MOON = {
  new: ['🌑', 'New moon'], waxing_crescent: ['🌒', 'Waxing crescent'], first_quarter: ['🌓', 'First quarter'],
  waxing_gibbous: ['🌔', 'Waxing gibbous'], full: ['🌕', 'Full moon'], waning_gibbous: ['🌖', 'Waning gibbous'],
  last_quarter: ['🌗', 'Last quarter'], waning_crescent: ['🌘', 'Waning crescent'],
};
const MOON_ORDER = Object.keys(MOON);
const PHASES = {
  menstrual: {
    name: 'Period', long: 'Menstrual phase', e: '🌹', color: 'var(--rose)', soft: 'var(--rose-soft)',
    tip: 'Your body is shedding and releasing. Rest is an act of power right now.',
    recs: [
      { e: '🛁', t: 'Rest & warmth', b: 'Heating pads, warm baths and gentle movement are your friends this week.' },
      { e: '🥦', t: 'Iron-rich foods', b: 'Leafy greens, lentils and dark chocolate help replace what you lose.' },
      { e: '🧘', t: 'Gentle movement', b: 'Yin yoga, slow walks or stretching — honour the lower energy.' },
    ],
  },
  follicular: {
    name: 'Follicular', long: 'Follicular phase', e: '🌱', color: 'var(--teal)', soft: 'var(--teal-soft)',
    tip: 'Energy is rising. Focus sharpens and you feel more outgoing — use it.',
    recs: [
      { e: '💡', t: 'Start something new', b: 'Your most creative, focused stretch — good for learning or big projects.' },
      { e: '🏃', t: 'Push the workouts', b: 'Recovery is quicker now. Strength, HIIT or a new class all land well.' },
      { e: '🥗', t: 'Light, fresh food', b: 'Digestion is strong: salads, fruit and fermented foods.' },
    ],
  },
  ovulation: {
    name: 'Ovulation', long: 'Ovulation', e: '✨', color: 'var(--gold)', soft: 'var(--gold-soft)',
    tip: 'Peak energy and confidence — you are at your most magnetic.',
    recs: [
      { e: '💃', t: 'Say yes to plans', b: 'Charisma peaks. Catch up with friends or have that big conversation.' },
      { e: '🏋️', t: 'Go hard', b: 'Your body is at peak performance — enjoy it.' },
      { e: '🌿', t: 'Anti-inflammatory food', b: 'Berries, flaxseed and leafy greens support a busy few days.' },
    ],
  },
  luteal: {
    name: 'Luteal', long: 'Luteal phase', e: '🌙', color: 'var(--lav)', soft: 'var(--lav-soft)',
    tip: 'Your body is preparing. It is okay to slow down and take up space.',
    recs: [
      { e: '🎁', t: 'Self-care season', b: 'PMS can peak late in this phase. Magnesium (chocolate counts) and B6 may help.' },
      { e: '🛌', t: 'Prioritise sleep', b: 'Progesterone makes you sleepier — lean into it.' },
      { e: '📓', t: 'Journal it out', b: 'Feelings run deeper now. Writing turns overwhelm into clarity.' },
    ],
  },
  late: {
    name: 'Late', long: 'Later than usual', e: '⏳', color: 'var(--late)', soft: 'var(--late-soft)',
    tip: 'Your period is later than your usual cycle. Stress, travel, illness and sleep changes can all shift timing.',
    recs: [
      { e: '🫶', t: 'Be gentle', b: 'A late period is common. Keep logging — it sharpens the next prediction.' },
      { e: '🩺', t: 'If it keeps happening', b: 'Several late or missed periods in a row are worth mentioning to a clinician.' },
    ],
  },
};
const PHASE_ORDER = ['menstrual', 'follicular', 'ovulation', 'luteal', 'late'];

/* ---------------------------------------------------------------------- utils */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const buzz = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// dates are LOCAL calendar days (the old app used UTC: after 5 pm in Las Vegas it filed
// logs on tomorrow)
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const diff = (a, b) => Math.round((parse(a) - parse(b)) / 864e5);      // a - b, in days
const todayIso = () => iso(new Date());
const fmt = (s, o = { month: 'short', day: 'numeric' }) => s ? parse(s).toLocaleDateString(undefined, o) : '';
const fmtLong = s => fmt(s, { weekday: 'long', month: 'long', day: 'numeric' });
const fmtDay = s => fmt(s, { weekday: 'short', month: 'short', day: 'numeric' });
const fmtRange = (a, b) => parse(a).getMonth() === parse(b).getMonth() ? `${fmt(a)}–${parse(b).getDate()}` : `${fmt(a)}–${fmt(b)}`;
const plural = (n, w) => `${n} ${w}${Math.abs(n) === 1 ? '' : 's'}`;
function rel(s) {
  const n = diff(s, todayIso());
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${plural(n, 'day')}` : `${plural(-n, 'day')} ago`;
}
const pretty = s => {
  const m = /^pain[_ ]?(\d+)\s*of\s*10$/i.exec(String(s).trim());
  return m ? `pain ${m[1]}/10` : String(s).replace(/_/g, ' ').trim();
};
const symEmoji = k => (SYMPTOMS.find(s => s.k === k) || {}).e;
const moodOf = k => MOODS.find(m => m.k === k);

/* ---------------------------------------------------------------------- state */
const S = {
  today: null, summary: null, entries: [], loadedAt: 0, tab: 'today',
  selDay: null, query: '', scroll: {}, loading: false,
};
const CACHE_KEY = 'ironicles.state.v1';
const HDR = { 'X-Ironicles': '1' };
// first day of the week from the phone's locale (Monday in most of the world)
const WEEK_START = (() => {
  try { const l = new Intl.Locale(navigator.language); const w = l.getWeekInfo ? l.getWeekInfo() : l.weekInfo; return w && w.firstDay ? w.firstDay % 7 : 0; }
  catch { return 0; }
})();

/* ---------------------------------------------------------------- cycle model */
// the bands of one cycle, as cycle days (1-based, inclusive)
function model(length, plen = 5) {
  const L = Math.max(18, Math.min(45, Math.round(length || 28)));
  const P = Math.max(2, Math.min(9, Math.round(plen || 5)));
  const O = Math.max(P + 3, L - 14);
  return { len: L, plen: P, ov: O, menstrual: [1, P], follicular: [P + 1, O - 2], ovulation: [O - 1, O + 1],
    luteal: [O + 2, L], fertile: [Math.max(P + 1, O - 5), O + 1] };
}
function phaseOf(day, m) {
  if (day <= m.plen) return 'menstrual';
  if (day > m.len) return 'late';
  if (day < m.ovulation[0]) return 'follicular';
  if (day <= m.ovulation[1]) return 'ovulation';
  return 'luteal';
}

let E = null;   // derived engine for the current data
function buildEngine() {
  const t = S.today || {}, sm = S.summary || {};
  const today = todayIso();
  const starts = [...(sm.periodStarts || [])].sort();
  const last = t.lastPeriodStart || starts[starts.length - 1] || null;
  const next = t.predictedNext || sm.predictedNext || null;
  let length = null;
  if (last && next) length = diff(next, last);
  const m = model(length || Math.round(sm.avgLength || 28), 5);
  const day = last ? diff(today, last) + 1 : null;
  const until = next ? diff(next, today) : null;
  let phase = day ? phaseOf(day, m) : null;
  if (phase && until !== null && until < 0) phase = 'late';
  // likely window from the spread of the last six cycles
  const lens = (sm.cycleLengths || []).slice(-6);
  const win = last && lens.length >= 2 ? [addDays(last, Math.min(...lens)), addDays(last, Math.max(...lens))] : null;

  // cycles: past (actual lengths), current, then three projected
  const cycles = [];
  starts.forEach((s, i) => {
    const nx = starts[i + 1];
    cycles.push({ start: s, len: nx ? diff(nx, s) : m.len, m: nx ? model(diff(nx, s)) : m, current: !nx, predicted: false });
  });
  if (next) {
    let p = until !== null && until < 0 ? addDays(today, 1) : next;   // late: due any day from tomorrow
    for (let i = 0; i < 3; i++) { cycles.push({ start: p, len: m.len, m, predicted: true }); p = addDays(p, m.len); }
  }
  E = { today, starts, last, next, until, m, day, phase, win, cycles,
    fertileNow: day ? (day >= m.fertile[0] && day <= m.fertile[1] && phase !== 'late') : false };
  document.documentElement.dataset.phase = phase || 'menstrual';
  return E;
}

function cycleFor(d) {
  let c = null;
  for (const x of E.cycles) { if (x.start <= d) c = x; else break; }
  return c;
}
function dayInfo(d) {
  const c = cycleFor(d);
  if (!c) return null;
  const cd = diff(d, c.start) + 1;
  let ph = phaseOf(cd, c.m);
  if (c.current && E.until !== null && E.until < 0 && d >= E.next) ph = 'late';
  return { cd, phase: ph, cycle: c, fertile: cd >= c.m.fertile[0] && cd <= c.m.fertile[1] && ph !== 'late',
    ov: cd === c.m.ov, predPeriod: c.predicted && cd <= c.m.plen && d >= E.today };
}

/* ----------------------------------------------------------------- entries */
const byDay = () => {
  const m = new Map();
  for (const e of S.entries) { if (!m.has(e.day)) m.set(e.day, []); m.get(e.day).push(e); }
  return m;
};
function topFlow(list) {
  let best = null;
  for (const e of list || []) if (e.flow && FLOW_RANK[e.flow] > (FLOW_RANK[best] || 0)) best = e.flow;
  return best;
}
function painOf(e) {
  if (e.extras && Number.isFinite(e.extras.pain)) return e.extras.pain;
  for (const s of e.symptoms || []) { const m = /^pain[_ ]?(\d+)\s*of\s*10$/i.exec(s); if (m) return +m[1]; }
  const m = /(\d+)\s*\/\s*10/.exec(e.mood || '');
  return m ? +m[1] : null;
}
// the person's own words (free-text symptoms), most used first — offered beside the presets
function customSymptoms() {
  const known = new Set(SYMPTOMS.map(s => s.k));
  const c = new Map();
  for (const e of S.entries) for (const s of e.symptoms || []) {
    if (known.has(s) || /^pain[_ ]?\d+\s*of\s*10$/i.test(s) || s.includes(';')) continue;
    c.set(s, (c.get(s) || 0) + 1);
  }
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
}
function quickSymptoms() {
  const freq = new Map();
  for (const e of S.entries) for (const s of e.symptoms || []) if (!/pain[_ ]?\d/i.test(s) && !s.includes(';')) freq.set(s, (freq.get(s) || 0) + 1);
  const mine = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
  const out = [...new Set([...mine.slice(0, 6), ...['cramps', 'headache', 'bloating', 'fatigue', 'backache', 'cravings', 'sore breasts', 'nausea']])];
  return out.slice(0, 10);
}

// one tap on Today: the same thing logged alone is taken back; flow and mood replace a
// solo one of their kind; a fuller entry (several things, notes or pain) is never
// half-deleted from a chip
function todayChips() {
  const out = [];
  for (const e of S.entries.filter(x => x.day === E.today)) {
    const parts = [];
    if (e.flow) parts.push(['flow', e.flow]);
    for (const s of e.symptoms || []) parts.push(['symptom', s]);
    if (e.mood) parts.push(['mood', e.mood]);
    const solo = parts.length === 1 && !(e.notes || '').trim() && painOf(e) === null;
    for (const [k, v] of parts) out.push({ k, v, id: e.id, solo });
  }
  return out;
}
async function quickToggle(field, value) {
  buzz();
  const chips = todayChips();
  const same = chips.filter(c => c.k === field && c.v === value);
  if (same.length) {
    const solo = same.filter(c => c.solo).map(c => c.id);
    if (!solo.length) { toast('That’s part of a fuller entry — tap it below to edit.'); return; }
    const gone = S.entries.filter(e => solo.includes(e.id));
    await removeEntries(solo, `${pretty(value)} removed`, gone);
    return;
  }
  const payload = { date: E.today, include_moon: true, symptoms: [] };
  if (field === 'flow') payload.flow = value; else if (field === 'symptom') payload.symptoms = [value]; else payload.mood = value;
  const swap = field === 'symptom' ? [] : chips.filter(c => c.k === field && c.solo).map(c => c.id);
  const swapped = S.entries.filter(e => swap.includes(e.id));
  const lastBefore = E.last;
  const id = await saveEntry(null, payload, { replace: swap });
  if (!id) return;
  const undo = async () => {
    await api('DELETE', `/api/entries/${id}`).catch(() => null);
    for (const g of swapped) await api('POST', '/api/log', { date: g.day, flow: g.flow, symptoms: g.symptoms, mood: g.mood, notes: g.notes, include_moon: true }).catch(() => null);
    await load(true);
  };
  await S.reloading;
  const started = field === 'flow' && E.last === E.today && lastBefore !== E.today;
  toast(started ? 'Period started — cycle day 1' : `${field === 'mood' ? (moodOf(value)?.e || '') + ' ' : ''}${pretty(value)} logged`, 'Undo', undo);
}

/* --------------------------------------------------------------------- api */
async function api(method, path, body) {
  const headers = method === 'GET' ? {} : { ...HDR, ...(body ? { 'Content-Type': 'application/json' } : {}) };
  const r = await fetch(path, { method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), credentials: 'same-origin' });
  if (r.status === 401 && path !== '/api/login' && path !== '/api/settings/passcode') { showLock(); throw new Error('locked'); }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.detail || `HTTP ${r.status}`);
  }
  return r.json();
}
async function load(force) {
  if (S.loading && !force) return;
  S.loading = true;
  try {
    const st = await api('GET', `/api/state?today=${todayIso()}`);
    S.today = st.today; S.summary = st.summary; S.entries = st.entries; S.loadedAt = Date.now(); S.version = st.version;
    // with a passcode on, nothing is kept on the device where the lock can't protect it
    try {
      if (AUTH.required) localStorage.removeItem(CACHE_KEY);
      else localStorage.setItem(CACHE_KEY, JSON.stringify({ today: st.today, summary: st.summary, entries: st.entries, at: Date.now() }));
    } catch {}
    renderAll();
  } catch (e) {
    if (e.message === 'locked') return;
    if (!S.today) $('#v-today').innerHTML = emptyHTML('📡', 'Can’t reach Ironicles', 'Check your connection, then pull down to retry.');
    else toast('Offline — showing what was saved last');
  } finally { S.loading = false; }
}
function fromCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (c && c.today) { S.today = c.today; S.summary = c.summary; S.entries = c.entries || []; return true; }
  } catch {}
  return false;
}
async function saveEntry(id, payload, opt = {}) {
  try {
    let res;
    if (id) {
      res = await api('PUT', `/api/entries/${id}`, payload);
      S.entries = S.entries.map(e => e.id === id ? { ...e, ...entryFrom(payload), id } : e);
    } else {
      res = await api('POST', '/api/log', payload);
      S.entries = [{ ...entryFrom(payload), id: res.id, created_at: new Date().toISOString() }, ...S.entries];
    }
    if (opt.replace && opt.replace.length) {
      await Promise.all(opt.replace.map(rid => api('DELETE', `/api/entries/${rid}`).catch(() => null)));
      S.entries = S.entries.filter(e => !opt.replace.includes(e.id));
    }
    renderAll();
    S.reloading = load(true);     // predictions follow the server's own algorithm
    return id || res.id;
  } catch (e) { toast('Couldn’t save — ' + e.message); return null; }
}
function entryFrom(p) {
  return { day: p.date, flow: p.flow || null, symptoms: p.symptoms || [], mood: p.mood || null, notes: p.notes || null, extras: p.extras || {} };
}
async function removeEntries(ids, msg, gone) {
  try {
    await Promise.all(ids.map(id => api('DELETE', `/api/entries/${id}`)));
    S.entries = S.entries.filter(e => !ids.includes(e.id));
    renderAll();
    toast(msg, 'Undo', async () => {
      for (const g of gone) await api('POST', '/api/log', { date: g.day, flow: g.flow, symptoms: g.symptoms, mood: g.mood, notes: g.notes, extras: g.extras && Object.keys(g.extras).length ? g.extras : undefined, include_moon: true });
      load(true);
    });
    load(true);
  } catch (e) { toast('Couldn’t delete — ' + e.message); }
}

/* ------------------------------------------------------------------ render */
function renderAll() {
  if (!S.today) return;
  buildEngine();
  renderToday(); renderCalendar(); renderJournal(); renderInsights();
  observeTitle();
}
const emptyHTML = (e, b, p) => `<div class="empty"><div class="e">${e}</div><b>${esc(b)}</b><div>${esc(p)}</div></div>`;
const lt = (title, sub, right = '') => `<div class="lt"><div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>${right}</div>`;

function flowIcon(k, size = 26) {
  const fill = { none: 0, spotting: .25, light: .5, medium: .78, heavy: 1 }[k];
  const col = k === 'none' ? 'var(--mute)' : `var(--${k === 'spotting' ? 'spot' : k})`;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path d="M12 3.2c3.3 4 5.6 7.1 5.6 10.1A5.6 5.6 0 0 1 6.4 13.3c0-3 2.3-6.1 5.6-10.1Z" fill="${col}" fill-opacity="${Math.max(fill, .12)}" stroke="${col}" stroke-width="1.6"/>${k === 'none' ? '<path d="M5 19 19 5" stroke="var(--mute)" stroke-width="1.6"/>' : ''}</svg>`;
}

/* ----- Today */
function ringSVG() {
  const m = E.m, L = Math.max(m.len, E.day || 0), R = 118, C = 150, W = 20;
  const gap = Math.min(2.2, 120 / L);
  const step = 360 / L;
  let segs = '';
  for (let d = 1; d <= L; d++) {
    const ph = phaseOf(d, m);
    const a0 = (d - 1) * step + gap / 2 - 90, a1 = d * step - gap / 2 - 90;
    const past = E.day && d <= E.day;
    segs += `<path d="${arc(C, C, R, a0, a1)}" stroke="${PHASES[ph].color}" stroke-width="${W}" stroke-linecap="butt" fill="none"
      opacity="${past ? 1 : .26}" style="${reduced ? '' : `animation: seg-in .5s ${(d * 14)}ms both var(--ease)`}"/>`;
  }
  // fertile window + ovulation, outside the ring
  const f0 = (m.fertile[0] - 1) * step - 90, f1 = m.fertile[1] * step - 90;
  const fert = `<path d="${arc(C, C, R + 19, f0 + 1, f1 - 1)}" stroke="var(--teal)" stroke-width="4" stroke-linecap="round" fill="none" opacity=".75"/>`;
  const oa = ((m.ov - .5) * step - 90) * Math.PI / 180;
  const ov = `<circle cx="${C + (R + 19) * Math.cos(oa)}" cy="${C + (R + 19) * Math.sin(oa)}" r="5.5" fill="var(--gold)" stroke="var(--card)" stroke-width="2"/>`;
  let mark = '';
  if (E.day) {
    const a = ((Math.min(E.day, L) - .5) * step - 90) * Math.PI / 180;
    const x = C + R * Math.cos(a), y = C + R * Math.sin(a);
    mark = `<circle cx="${x}" cy="${y}" r="17" fill="var(--accent)" opacity=".18"/><circle cx="${x}" cy="${y}" r="11.5" fill="var(--card)" stroke="var(--accent)" stroke-width="5"/>`;
  }
  return `<svg viewBox="0 0 300 300" aria-hidden="true"><style>@keyframes seg-in{from{opacity:0}}</style>${segs}${fert}${ov}${mark}</svg>`;
}
function arc(cx, cy, r, a0, a1) {
  const p = a => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function renderToday() {
  const el = $('#v-today');
  const t = S.today, now = new Date();
  const hour = now.getHours();
  const hello = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const mn = t.moon && MOON[t.moon.phase];
  const moon = mn ? `<span class="moon-pill">${mn[0]} ${Math.round(t.moon.illumination * 100)}%</span>` : '';
  const gear = `<button class="icon-btn" data-act="settings" aria-label="Settings"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg></button>`;
  const head = lt(hello, fmtLong(E.today), `<div style="display:flex;gap:8px;align-items:center">${moon}${gear}</div>`);

  if (!E.day) {
    el.innerHTML = head + `<div class="stack"><div class="card">${emptyHTML('📖', 'Log your first period', 'Tap a flow below on the day it starts — Ironicles does the rest.')}</div>${quickCard()}</div>`;
    return;
  }
  const P = PHASES[E.phase];
  let line, sub;
  if (E.phase === 'late') {
    const late = E.until !== null && E.until < 0 ? -E.until : E.day - E.m.len;
    line = `${plural(late, 'day')} late`; sub = `Expected ${fmtDay(E.next)}`;
  } else if (E.phase === 'menstrual') {
    line = `Period · day ${E.day}`; sub = E.next ? `Next one ${fmtDay(E.next)}` : '';
  } else if (E.until === 0) {
    line = 'Period expected today'; sub = `Cycles run about ${E.m.len} days`;
  } else {
    line = `Period in ${plural(E.until, 'day')}`; sub = `Expected ${fmtDay(E.next)}`;
  }
  if (E.win && E.phase !== 'menstrual' && E.win[0] !== E.win[1]) sub += ` · likely ${fmtRange(E.win[0], E.win[1])}`;
  const pills = [`<span class="pill"><i></i>${esc(P.long)}</span>`];
  if (E.fertileNow) pills.push(`<span class="pill" style="background:var(--teal-soft)"><i style="background:var(--teal)"></i>Fertile window</span>`);

  const hero = `<div class="card hero">
    <div class="ring-wrap">${ringSVG()}
      <div class="ring-center"><div class="k">Cycle day</div><div class="big num">${E.day}</div><div class="u">${P.e} ${esc(P.name)}</div></div></div>
    <div class="hero-line">${esc(line)}</div>
    <div class="hero-sub">${esc(sub)}</div>
    <div class="hero-pills">${pills.join('')}</div></div>`;

  el.innerHTML = head + `<div class="stack">${hero}${nextCard()}${quickCard()}${todayEntriesCard()}${guideCard(P)}</div>`;
}

function nextCard() {
  const m = E.m, s = E.last, rows = [];
  const fs = addDays(s, m.fertile[0] - 1), fe = addDays(s, m.fertile[1] - 1), ovd = addDays(s, m.ov - 1);
  if (E.phase !== 'late') {
    if (E.today <= fe) rows.push({ e: '🌿', bg: 'var(--teal-soft)', t: E.today >= fs ? 'Fertile window' : 'Fertile window starts',
      s: E.today >= fs ? `until ${fmtDay(fe)}` : `${fmtRange(fs, fe)} (estimate)`, w: E.today >= fs ? `ends ${rel(fe)}` : rel(fs), d: fmt(E.today >= fs ? fe : fs) });
    if (E.today <= ovd) rows.push({ e: '✨', bg: 'var(--gold-soft)', t: 'Ovulation', s: `around ${fmtDay(ovd)} (estimate)`, w: rel(ovd), d: fmt(ovd) });
  }
  if (E.next && E.phase !== 'menstrual') rows.push({ e: '🌹', bg: 'var(--rose-soft)', t: 'Next period', s: E.win ? `likely ${fmtRange(E.win[0], E.win[1])}` : `expected ${fmtDay(E.next)}`, w: E.until >= 0 ? rel(E.next) : 'any day', d: fmt(E.next) });
  if (E.next) { const after = addDays(E.next, m.len); rows.push({ e: '🗓️', bg: 'var(--bg-2)', t: 'The one after', s: `if cycles stay ~${m.len} days`, w: rel(after), d: fmt(after) }); }
  if (!rows.length) return '';
  return `<div class="card"><div class="card-h"><h2>Coming up</h2></div><div class="next">${rows.map(r => `
    <div class="next-row"><div class="next-ic" style="background:${r.bg}">${r.e}</div>
      <div><b>${esc(r.t)}</b><span>${esc(r.s)}</span></div>
      <div class="when">${esc(r.d)}<small>${esc(r.w)}</small></div></div>`).join('')}</div></div>`;
}

function quickCard() {
  const chips = todayChips();
  const on = (k, v) => chips.find(c => c.k === k && c.v === v);
  const cls = (k, v) => { const c = on(k, v); return c ? (c.solo ? ' on' : ' on locked') : ''; };
  const flows = FLOWS.filter(f => f.k !== 'none').map(f =>
    `<button class="flow${cls('flow', f.k)}" data-act="q" data-k="flow" data-v="${f.k}">${flowIcon(f.k)}${f.l}</button>`).join('');
  const syms = quickSymptoms().map(s =>
    `<button class="chip${cls('symptom', s)}" data-act="q" data-k="symptom" data-v="${esc(s)}">${symEmoji(s) ? `<span class="e">${symEmoji(s)}</span>` : ''}${esc(pretty(s))}</button>`).join('');
  const moods = MOODS.map(m =>
    `<button class="chip${cls('mood', m.k)}" data-act="q" data-k="mood" data-v="${m.k}"><span class="e">${m.e}</span>${m.l}</button>`).join('');
  return `<div class="card"><div class="card-h"><h2>How’s today?</h2><button class="link" data-act="log-today">More details</button></div>
    <div class="group-t">Flow</div><div class="flows compact">${flows}</div>
    <div class="group-t">Feeling</div><div class="chips scroll">${syms}</div>
    <div class="group-t">Mood</div><div class="chips scroll">${moods}</div></div>`;
}

function entryTags(e) {
  const tags = [];
  if (e.flow && e.flow !== 'none') tags.push(`<span class="tag flow-tag" style="background:var(--${e.flow === 'spotting' ? 'spot' : e.flow})">${esc(e.flow)}</span>`);
  if (e.flow === 'none') tags.push(`<span class="tag">no flow</span>`);
  for (const s of e.symptoms || []) if (!/^pain[_ ]?\d/i.test(s)) tags.push(`<span class="tag">${symEmoji(s) ? symEmoji(s) + ' ' : ''}${esc(pretty(s))}</span>`);
  if (e.mood) { const m = moodOf(e.mood); tags.push(`<span class="tag">${m ? m.e + ' ' + m.l : esc(pretty(e.mood))}</span>`); }
  const p = painOf(e);
  if (p !== null) tags.push(`<span class="tag">pain ${p}/10</span>`);
  return tags.join('');
}
function todayEntriesCard() {
  const list = S.entries.filter(e => e.day === E.today);
  if (!list.length) return '';
  return `<div class="card"><div class="card-h"><h2>Logged today</h2><span class="tiny">tap to edit</span></div>${list.map(e => `
    <button class="entry" data-act="edit" data-id="${e.id}">
      <div class="entry-tags">${entryTags(e) || '<span class="tag">note</span>'}</div>
      ${e.notes ? `<div class="entry-notes">${esc(e.notes)}</div>` : ''}</button>`).join('')}</div>`;
}
function guideCard(P) {
  return `<div class="card"><div class="card-h"><h2>${P.e} ${esc(P.long)}</h2></div>
    <p class="muted" style="margin:0 0 12px">${esc(P.tip)}</p>
    <div class="carousel">${P.recs.map(r => `<div class="tip"><div class="ic">${r.e}</div><b>${esc(r.t)}</b><p>${esc(r.b)}</p></div>`).join('')}</div></div>`;
}

/* ----- Calendar */
function monthsRange() {
  const first = [E.starts[0], S.entries.length ? S.entries[S.entries.length - 1].day : null].filter(Boolean).sort()[0] || E.today;
  const a = parse(first); a.setDate(1);
  const b = parse(E.today); b.setDate(1); b.setMonth(b.getMonth() + 4);
  const out = [];
  for (const d = new Date(a); d <= b; d.setMonth(d.getMonth() + 1)) out.push([d.getFullYear(), d.getMonth()]);
  return out;
}
function renderCalendar() {
  const el = $('#v-calendar');
  const bd = byDay();
  const sel = S.selDay || E.today;
  const months = monthsRange();
  const dow = [...Array(7)].map((_, i) => `<span>${new Date(2024, 0, 7 + ((i + WEEK_START) % 7)).toLocaleDateString(undefined, { weekday: 'narrow' })}</span>`).join('');
  const pages = months.map(([y, mo]) => {
    const firstDow = (new Date(y, mo, 1).getDay() - WEEK_START + 7) % 7, dim = new Date(y, mo + 1, 0).getDate();
    let cells = '';
    for (let i = 0; i < firstDow; i++) cells += '<span class="d out"></span>';
    for (let d = 1; d <= dim; d++) {
      const ds = iso(new Date(y, mo, d));
      const list = bd.get(ds);
      const info = dayInfo(ds);
      const c = ['d'];
      const fl = topFlow(list);
      if (fl && fl !== 'none') c.push('p-' + fl);
      else if (info && info.predPeriod) c.push('pred', info.cycle === E.cycles.find(x => x.predicted) ? '' : 'soft');
      if (info && info.fertile && !fl) c.push('fertile');
      if (info && info.ov) c.push('ov');
      if (ds === E.today) c.push('today');
      if (ds === sel) c.push('sel');
      if (ds > E.today) c.push('future');
      const dot = list && list.some(e => (e.symptoms || []).length || e.mood || e.notes) ? '<i class="dot"></i>' : '';
      cells += `<button class="${c.join(' ')}" data-act="day" data-d="${ds}" aria-label="${esc(fmtLong(ds))}">${d}${dot}</button>`;
    }
    return `<div class="month" data-ym="${y}-${mo}"><div class="dow">${dow}</div><div class="grid">${cells}</div></div>`;
  }).join('');
  const legend = `<div class="legend">
    <span><i style="background:var(--medium)"></i>Period</span>
    <span><i style="box-shadow:inset 0 0 0 2px var(--rose)"></i>Predicted</span>
    <span><i style="background:var(--teal-soft);border:1px solid var(--teal)"></i>Fertile (est.)</span>
    <span><i style="background:var(--gold)"></i>Ovulation (est.)</span>
    <span><i style="background:var(--ink-2);opacity:.6;width:6px;height:6px"></i>Logged</span></div>`;
  const keepScroll = $('#pager') && S.tab === 'calendar' && S.calKeepLeft !== null ? $('#pager').scrollLeft : null;
  el.innerHTML = lt('Calendar', '', `<button class="text-btn" data-act="cal-today">Today</button>`) + `
    <div class="card" style="padding:14px 0 16px">
      <div class="cal-head" style="padding:0 14px"><button class="icon-btn" data-act="cal-prev" aria-label="Previous month"><svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg></button>
        <h2 id="cal-title"></h2>
        <button class="icon-btn" data-act="cal-next" aria-label="Next month"><svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg></button></div>
      <div class="pager" id="pager">${pages}</div>
      <div style="padding:0 14px">${legend}</div></div>
    <div id="day-panel" style="margin-top:14px">${dayPanel(sel)}</div>`;
  const pager = $('#pager');
  S.calMonth = months.findIndex(([y, mo]) => y === parse(sel).getFullYear() && mo === parse(sel).getMonth());
  S.calKeepLeft = keepScroll;
  requestAnimationFrame(calPlace);
  pager.addEventListener('scroll', () => requestAnimationFrame(calTitle), { passive: true });
}
// a hidden pager has no width: place it when the Calendar tab is showing
function calPlace() {
  const pager = $('#pager');
  if (!pager || !pager.clientWidth) return;
  pager.style.scrollSnapType = 'none';
  pager.scrollLeft = S.calKeepLeft ? S.calKeepLeft : pager.clientWidth * Math.max(0, S.calMonth);
  S.calKeepLeft = null;
  pager.style.scrollSnapType = '';
  calTitle();
}
function calTitle() {
  const pager = $('#pager'); if (!pager) return;
  const i = Math.round(pager.scrollLeft / Math.max(1, pager.clientWidth));
  const m = pager.children[i]; if (!m) return;
  const [y, mo] = m.dataset.ym.split('-').map(Number);
  const t = new Date(y, mo, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const h = $('#cal-title'); if (h && h.textContent !== t) h.textContent = t;
}
function dayPanel(ds) {
  const info = dayInfo(ds);
  const list = S.entries.filter(e => e.day === ds);
  const bits = [];
  if (info) {
    const P = PHASES[info.phase];
    bits.push(`<span class="pill" style="background:${P.soft}"><i style="background:${P.color}"></i>${info.cycle.predicted ? 'Predicted · ' : ''}Day ${info.cd} · ${esc(P.name)}</span>`);
    if (info.fertile) bits.push(`<span class="pill" style="background:var(--teal-soft)"><i style="background:var(--teal)"></i>Fertile (est.)</span>`);
    if (info.ov) bits.push(`<span class="pill" style="background:var(--gold-soft)"><i style="background:var(--gold)"></i>Ovulation (est.)</span>`);
  }
  const ents = list.length ? list.map(e => `<button class="entry" data-act="edit" data-id="${e.id}"><div class="entry-tags">${entryTags(e) || '<span class="tag">note</span>'}</div>${e.notes ? `<div class="entry-notes">${esc(e.notes)}</div>` : ''}</button>`).join('')
    : `<div class="muted" style="font-size:14px;padding:4px 2px 2px">${ds > E.today ? 'Nothing to log yet.' : 'Nothing logged.'}</div>`;
  return `<div class="card day-panel"><div class="card-h"><h2>${esc(fmtLong(ds))}</h2><span class="tiny">${esc(rel(ds))}</span></div>
    <div class="hero-pills" style="justify-content:flex-start;margin:0 0 12px">${bits.join('')}</div>
    ${ents}
    ${ds <= E.today ? `<button class="btn soft block" style="margin-top:12px" data-act="log-day" data-d="${ds}">＋ Log ${ds === E.today ? 'today' : 'this day'}</button>` : ''}</div>`;
}

/* ----- Journal */
function renderJournal() {
  const el = $('#v-journal');
  const q = S.query.trim().toLowerCase();
  const match = e => !q || [e.notes, e.mood, e.flow, ...(e.symptoms || []).map(pretty)].some(x => (x || '').toLowerCase().includes(q));
  const list = S.entries.filter(match);
  const groups = [];
  for (const e of list) {
    const c = cycleFor(e.day);
    const key = c ? c.start : 'before';
    let g = groups.find(x => x.key === key);
    if (!g) groups.push(g = { key, c, items: [] });
    g.items.push(e);
  }
  const head = lt('Journal', `${plural(S.entries.length, 'entry')}`.replace('entrys', 'entries'));
  const search = `<label class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <input id="jq" type="search" placeholder="Search notes, symptoms, moods" value="${esc(S.query)}" autocomplete="off"></label>`;
  const body = groups.length ? groups.map(g => {
    const title = !g.c ? 'Before tracking' : g.c.current ? 'This cycle' : `Cycle from ${fmt(g.c.start)}`;
    const meta = !g.c ? '' : g.c.current ? `since ${fmt(g.c.start)} · day ${E.day}` : `${g.c.len} days`;
    return `<div class="cycle-h"><b>${esc(title)}</b><span>${esc(meta)}</span></div>` + g.items.map(e => {
      const info = dayInfo(e.day);
      const P = info ? PHASES[info.phase] : null;
      const d = parse(e.day);
      return `<button class="jentry" data-act="edit" data-id="${e.id}">
        <div class="jdate"><b>${d.getDate()}</b><span>${esc(d.toLocaleDateString(undefined, { month: 'short' }))}</span>${P ? `<i style="background:${P.color}"></i>` : ''}</div>
        <div class="jbody"><div class="jmeta">${esc(d.toLocaleDateString(undefined, { weekday: 'long' }))}${info ? ` · cycle day ${info.cd} · ${esc(P.name)}` : ''}</div>
          <div class="entry-tags">${entryTags(e)}</div>${e.notes ? `<div class="entry-notes">${esc(e.notes)}</div>` : ''}</div></button>`;
    }).join('');
  }).join('') : `<div class="card" style="margin-top:14px">${emptyHTML('🔎', q ? 'No matches' : 'Nothing logged yet', q ? 'Try another word.' : 'Your entries and notes will collect here.')}</div>`;
  const had = document.activeElement && document.activeElement.id === 'jq';
  el.innerHTML = head + search + body;
  const inp = $('#jq');
  inp.addEventListener('input', () => { S.query = inp.value; renderJournal(); });
  if (had) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}

/* ----- Insights */
function renderInsights() {
  const el = $('#v-insights');
  const sm = S.summary || {};
  const lens = sm.cycleLengths || [];
  if (!E.starts.length) {
    el.innerHTML = lt('Insights') + `<div class="card">${emptyHTML('📈', 'Insights grow with you', 'After two periods you’ll see your cycle length, patterns and more.')}</div>`;
    return;
  }
  const avg = sm.avgLength, spread = lens.length ? Math.round((Math.max(...lens) - Math.min(...lens)) / 2) : null;
  // logged period length: consecutive flow days from each start (a 1-day gap is allowed)
  const flowDays = new Set(S.entries.filter(e => e.flow && e.flow !== 'none').map(e => e.day));
  const plens = E.starts.slice(0, -1).map(s => { let n = 1, d = s, miss = 0; while (miss < 2 && n < 12) { d = addDays(d, 1); if (flowDays.has(d)) { n += 1 + miss; miss = 0; } else miss++; } return n; });
  const plen = plens.length ? (plens.reduce((a, b) => a + b, 0) / plens.length) : null;

  const tiles = `<div class="tiles">
    <div class="tile"><div class="l">Average cycle</div><div class="v num">${avg ?? '—'}<small> days</small></div><div class="s">${spread !== null ? `give or take ${spread}` : 'needs two periods'}</div></div>
    <div class="tile"><div class="l">Next period</div><div class="v">${E.next ? esc(fmt(E.next)) : '—'}</div><div class="s">${E.next ? esc(E.until >= 0 ? rel(E.next) : 'any day now') : ''}</div></div>
    <div class="tile"><div class="l">Cycles</div><div class="v num">${lens.length}</div><div class="s">${lens.length ? `${Math.min(...lens)}–${Math.max(...lens)} days` : ''}</div></div>
    <div class="tile"><div class="l">Period (logged)</div><div class="v num">${plen ? plen.toFixed(1) : '—'}<small> days</small></div><div class="s">days with flow logged</div></div></div>`;

  el.innerHTML = lt('Insights', 'From your own logs') + `<div class="stack">${tiles}${lengthChart(lens)}${timelineCard()}${patternsCard('Symptoms', symptomStats())}${patternsCard('Moods', moodStats())}${painCard()}${moonCard()}
    <p class="foot">Estimates from what’s been logged — not medical advice, and not a method of birth control.</p></div>`;
}
function lengthChart(lens) {
  if (lens.length < 2) return '';
  const data = lens.slice(-8), starts = E.starts.slice(-data.length - 1, -1);
  const W = 320, H = 150, pad = 22, bw = Math.min(30, (W - pad) / data.length - 10);
  const max = Math.max(...data, 30), min = Math.min(18, ...data);
  const y = v => H - 20 - (v - min + 2) / (max - min + 2) * (H - 44);
  const avg = data.reduce((a, b) => a + b, 0) / data.length;
  const step = (W - pad) / data.length;
  const bars = data.map((v, i) => {
    const x = pad + i * step + (step - bw) / 2, top = y(v);
    return `<rect x="${x}" y="${top}" width="${bw}" height="${H - 20 - top}" rx="7" fill="var(--accent)" opacity="${i === data.length - 1 ? 1 : .55}"/>
      <text class="val" x="${x + bw / 2}" y="${top - 6}" text-anchor="middle">${v}</text>
      <text x="${x + bw / 2}" y="${H - 4}" text-anchor="middle">${esc(starts[i] ? fmt(starts[i], { month: 'short' }) : '')}</text>`;
  }).join('');
  const ay = y(avg);
  return `<div class="card chart"><div class="card-h"><h2>Cycle length</h2><span class="tiny">last ${data.length}</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cycle lengths ${esc(data.join(', '))} days">
      <line x1="${pad - 6}" x2="${W}" y1="${ay}" y2="${ay}" stroke="var(--ink-2)" stroke-width="1" opacity=".5"/>
      <text x="0" y="${ay + 4}">avg</text>${bars}</svg></div>`;
}
function timelineCard() {
  const flowDays = new Map();
  for (const e of S.entries) if (e.flow && e.flow !== 'none') flowDays.set(e.day, e.flow);
  const cyc = E.cycles.filter(c => !c.predicted).slice(-8).reverse();
  const maxLen = Math.max(...cyc.map(c => c.current ? Math.max(E.day || 0, c.len) : c.len), 28);
  const rows = cyc.map(c => {
    const len = c.current ? E.day : c.len;
    const pct = n => (n / maxLen * 100).toFixed(2);
    let segs = `<i style="left:${pct(c.m.fertile[0] - 1)}%;width:${pct(c.m.fertile[1] - c.m.fertile[0] + 1)}%;background:var(--teal-soft)"></i>`;
    segs += `<i style="left:${pct(c.m.ov - 1)}%;width:${pct(1)}%;background:var(--gold);opacity:.8"></i>`;
    for (let d = 0; d < Math.min(len, 12); d++) {
      const f = flowDays.get(addDays(c.start, d));
      if (f) segs += `<i style="left:${pct(d)}%;width:${pct(1)}%;background:var(--${f === 'spotting' ? 'spot' : f})"></i>`;
    }
    if (c.current) segs += `<i style="left:${pct(len - 1)}%;width:3px;background:var(--ink)"></i>`;
    return `<div class="tl-row"><span class="lbl">${esc(fmt(c.start))}</span><span class="tl-track" style="width:${pct(c.current ? c.len : len)}%;min-width:30%">${segs}</span><span class="len num">${c.current ? `d${len}` : len}</span></div>`;
  }).join('');
  return `<div class="card"><div class="card-h"><h2>Your cycles</h2><span class="tiny">newest first</span></div>${rows}
    <div class="phase-key" style="margin-top:10px"><span><i style="background:var(--medium)"></i>Flow logged</span><span><i style="background:var(--teal-soft);border:1px solid var(--teal)"></i>Fertile (est.)</span><span><i style="background:var(--gold)"></i>Ovulation (est.)</span></div></div>`;
}
function statsBy(keyFn) {
  const m = new Map();
  for (const e of S.entries) {
    const info = dayInfo(e.day);
    for (const k of keyFn(e)) {
      if (!k) continue;
      const s = m.get(k) || { k, n: 0, by: {}, days: [], daysBy: {} };
      s.n++;
      if (info) {
        s.by[info.phase] = (s.by[info.phase] || 0) + 1; s.days.push(info.cd);
        (s.daysBy[info.phase] = s.daysBy[info.phase] || []).push(info.cd);
      }
      m.set(k, s);
    }
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}
function symptomStats() {
  return statsBy(e => (e.symptoms || []).flatMap(s => s.split(';')).map(s => s.trim().toLowerCase().replace(/_/g, ' '))
    .filter(s => s && !/^pain\s?\d/.test(s) && !/^pain \d+ ?of ?10$/.test(s))).slice(0, 8);
}
function moodStats() { return statsBy(e => e.mood && !/\d\s*\/\s*10/.test(e.mood) ? [e.mood.toLowerCase()] : []).slice(0, 6); }
function patternsCard(title, stats) {
  if (!stats.length) return '';
  const rows = stats.map(s => {
    const tot = Object.values(s.by).reduce((a, b) => a + b, 0) || 1;
    const bar = PHASE_ORDER.filter(p => s.by[p]).map(p => `<i style="width:${(s.by[p] / tot * 100).toFixed(1)}%;background:${PHASES[p].color}"></i>`).join('');
    const top = PHASE_ORDER.filter(p => s.by[p]).sort((a, b) => s.by[b] - s.by[a])[0];
    const median = a => { const x = [...a].sort((p, q) => p - q); return x.length ? x[(x.length - 1) >> 1] : null; };
    const dominant = top && s.by[top] / tot >= .6;
    const med = median(dominant ? s.daysBy[top] : s.days);
    const where = top === 'menstrual' ? 'during your period' : `in your ${PHASES[top]?.name.toLowerCase()} phase`;
    const note = !Object.keys(s.by).length ? 'Logged before your first tracked period'
      : s.n >= 3 && dominant ? `Mostly ${where}${med ? ` · around cycle day ${med}` : ''}`
      : med && s.n >= 3 ? `Spread through the cycle · typically around day ${med}` : '';
    const label = moodOf(s.k) ? `${moodOf(s.k).e} ${moodOf(s.k).l}` : `${symEmoji(s.k) ? symEmoji(s.k) + ' ' : ''}${pretty(s.k)}`;
    return `<div class="pat"><div class="pat-h">${esc(label)}<span>${s.n}×</span></div>${bar ? `<div class="pat-bar">${bar}</div>` : ''}${note ? `<div class="pat-note">${esc(note)}</div>` : ''}</div>`;
  }).join('');
  return `<div class="card"><div class="card-h"><h2>${esc(title)} through your cycle</h2></div>${rows}
    <div class="phase-key" style="margin-top:10px">${PHASE_ORDER.slice(0, 4).map(p => `<span><i style="background:${PHASES[p].color}"></i>${PHASES[p].name}</span>`).join('')}</div></div>`;
}
function painCard() {
  const by = {};
  let n = 0;
  for (const e of S.entries) {
    const p = painOf(e); const info = dayInfo(e.day);
    if (p === null || !info) continue;
    (by[info.phase] = by[info.phase] || []).push(p); n++;
  }
  if (n < 2) return '';
  const rows = PHASE_ORDER.filter(p => by[p]).map(p => {
    const a = by[p].reduce((x, y) => x + y, 0) / by[p].length;
    return `<div class="tl-row"><span class="lbl">${esc(PHASES[p].name)}</span><span class="tl-track" style="width:100%"><i style="left:0;width:${a * 10}%;background:${PHASES[p].color}"></i></span><span class="len num">${a.toFixed(1)}</span></div>`;
  }).join('');
  return `<div class="card"><div class="card-h"><h2>Pain by phase</h2><span class="tiny">average of ${n} logs, 0–10</span></div>${rows}</div>`;
}
function moonPhaseOf(ds) {
  const d = parse(ds), ref = Date.UTC(2000, 0, 6, 18, 14), dt = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const age = (((dt - ref) / 864e5) % 29.53058867 + 29.53058867) % 29.53058867;
  const cut = [1.84566, 5.53699, 9.22831, 12.91963, 16.61096, 20.30228, 23.99361, 27.68493];
  const i = cut.findIndex(c => age < c);
  return i === -1 ? 'new' : MOON_ORDER[i];
}
function moonCard() {
  if (E.starts.length < 3) return '';
  const c = Object.fromEntries(MOON_ORDER.map(k => [k, 0]));
  for (const s of E.starts) c[moonPhaseOf(s)]++;
  const max = Math.max(...Object.values(c), 1);
  const top = MOON_ORDER.filter(k => c[k] === max);
  return `<div class="card"><div class="card-h"><h2>Periods & the moon</h2><span class="tiny">${E.starts.length} starts</span></div>
    <div class="moons">${MOON_ORDER.map(k => `<div class="m"><div class="col"><div class="b" style="height:${Math.max(3, c[k] / max * 64)}px;opacity:${c[k] ? .85 : .2}"></div></div><span class="e">${MOON[k][0]}</span><span>${c[k]}</span></div>`).join('')}</div>
    <div class="pat-note" style="margin-top:10px">${max > 1 ? `Most often near the ${esc(top.map(k => MOON[k][1].toLowerCase()).join(' and '))}.` : 'No pattern yet — just for fun.'}</div></div>`;
}

/* ------------------------------------------------------------- log sheet */
function openLog({ id = null, day = null } = {}) {
  const e = id ? S.entries.find(x => x.id === id) : null;
  const st = {
    id, day: e ? e.day : (day || E.today), flow: e ? e.flow : null, symptoms: new Set(e ? e.symptoms || [] : []),
    mood: e ? e.mood : null, notes: e ? e.notes || '' : '', pain: e ? painOf(e) : null,
  };
  // legacy pain tags become the pain field on save
  for (const s of [...st.symptoms]) if (/^pain[_ ]?\d+\s*of\s*10$/i.test(s)) st.symptoms.delete(s);
  if (st.mood && /\d\s*\/\s*10/.test(st.mood) && st.pain !== null) st.mood = null;

  const draw = () => {
    const custom = customSymptoms();
    const extra = [...st.symptoms].filter(s => !SYMPTOMS.some(x => x.k === s) && !custom.includes(s));
    const yours = [...custom, ...extra];
    const y = addDays(E.today, -1);
    const other = st.day !== E.today && st.day !== y;
    const moodExtra = st.mood && !moodOf(st.mood) ? `<button class="mood on" data-act="mood" data-v="${esc(st.mood)}"><span class="e">💬</span>${esc(pretty(st.mood))}</button>` : '';
    $('#sheet-body').innerHTML = `
      <div class="sheet-top" data-drag><div><h2>${id ? 'Edit entry' : 'Log'}</h2><div class="sub">${esc(fmtLong(st.day))}${dayInfo(st.day) ? ` · cycle day ${dayInfo(st.day).cd}` : ''}</div></div>
        <button class="icon-btn" data-act="close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <div class="dates">
        <button class="chip${st.day === E.today ? ' on' : ''}" data-act="date" data-v="${E.today}">Today</button>
        <button class="chip${st.day === y ? ' on' : ''}" data-act="date" data-v="${y}">Yesterday</button>
        <label class="chip date-input${other ? ' on' : ''}">📅 ${other ? esc(fmt(st.day)) : 'Pick day'}<input type="date" id="log-date" max="${E.today}" value="${st.day}"></label></div>
      <div class="field"><div class="group-t">Flow</div><div class="flows">${FLOWS.map(f =>
        `<button class="flow${st.flow === f.k ? ' on' : ''}" data-act="flow" data-v="${f.k}">${flowIcon(f.k)}${f.l}</button>`).join('')}</div></div>
      <div class="field"><div class="group-t">Symptoms</div><div class="chips">${SYMPTOMS.map(s =>
        `<button class="chip${st.symptoms.has(s.k) ? ' on' : ''}" data-act="sym" data-v="${esc(s.k)}"><span class="e">${s.e}</span>${esc(s.k)}</button>`).join('')}</div>
        ${yours.length ? `<div class="group-t">Yours</div><div class="chips">${yours.map(s =>
          `<button class="chip${st.symptoms.has(s) ? ' on' : ''}" data-act="sym" data-v="${esc(s)}">${esc(pretty(s))}</button>`).join('')}</div>` : ''}
        <div class="custom"><input id="custom-sym" placeholder="Add your own…" enterkeyhint="done" autocomplete="off"><button class="chip add-chip" data-act="add-sym">Add</button></div></div>
      <div class="field"><div class="group-t">Mood</div><div class="moods">${MOODS.map(m =>
        `<button class="mood${st.mood === m.k ? ' on' : ''}" data-act="mood" data-v="${m.k}"><span class="e">${m.e}</span>${m.l}</button>`).join('')}${moodExtra}</div></div>
      <div class="field"><div class="group-t" style="display:flex;justify-content:space-between;align-items:center">Pain
        <label class="switch"><input type="checkbox" id="pain-on" ${st.pain !== null ? 'checked' : ''}> track</label></div>
        ${st.pain !== null ? `<div class="pain"><input type="range" id="pain" min="0" max="10" step="1" value="${st.pain}"><span class="pv num" id="pv">${st.pain}</span></div>` : ''}</div>
      <div class="field"><div class="group-t">Notes</div><textarea id="notes" placeholder="Anything worth remembering…">${esc(st.notes)}</textarea></div>
      <div class="sheet-foot">${id ? '<button class="btn ghost danger" data-act="del">Delete</button>' : ''}<button class="btn primary" data-act="save">${id ? 'Save changes' : 'Save'}</button></div>`;
    const date = $('#log-date');
    date.addEventListener('change', () => { if (date.value) { st.day = date.value; keep(); draw(); } });
    const pain = $('#pain');
    if (pain) pain.addEventListener('input', () => { st.pain = +pain.value; $('#pv').textContent = pain.value; buzz(4); });
    $('#pain-on').addEventListener('change', ev => { keep(); st.pain = ev.target.checked ? (st.pain ?? 3) : null; draw(); });
    $('#custom-sym').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); addCustom(); } });
  };
  const keep = () => { const n = $('#notes'); if (n) st.notes = n.value; };
  const addCustom = () => {
    const inp = $('#custom-sym'); const v = (inp.value || '').trim().toLowerCase();
    if (!v) return;
    keep(); st.symptoms.add(v); draw(); buzz();
  };
  const onClick = async ev => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act, v = b.dataset.v;
    if (a === 'close') return closeSheet();
    keep();
    if (a === 'date') { st.day = v; buzz(); draw(); }
    else if (a === 'flow') { st.flow = st.flow === v ? null : v; buzz(); draw(); }
    else if (a === 'sym') { st.symptoms.has(v) ? st.symptoms.delete(v) : st.symptoms.add(v); buzz(); b.classList.toggle('on'); }
    else if (a === 'mood') { st.mood = st.mood === v ? null : v; buzz(); draw(); }
    else if (a === 'add-sym') addCustom();
    else if (a === 'save') {
      if (!st.flow && !st.symptoms.size && !st.mood && !st.notes.trim() && st.pain === null) { toast('Pick something to log first'); return; }
      b.disabled = true;
      const payload = { date: st.day, flow: st.flow, symptoms: [...st.symptoms], mood: st.mood, notes: st.notes.trim() || null,
        include_moon: true, extras: st.pain !== null ? { pain: st.pain } : {} };
      const ok = await saveEntry(id, payload);
      if (ok) { closeSheet(); toast(id ? 'Updated ✓' : 'Saved ✓'); buzz(14); } else b.disabled = false;
    } else if (a === 'del') {
      const gone = S.entries.filter(x => x.id === id);
      closeSheet();
      await removeEntries([id], 'Entry deleted', gone);
    }
  };
  openSheet(draw, onClick);
}

/* ---------------------------------------------------------------- sheet */
let sheetHandler = null;
function openSheet(draw, onClick) {
  const sh = $('#sheet');
  draw();
  if (sheetHandler) $('#sheet-body').removeEventListener('click', sheetHandler);
  sheetHandler = onClick;
  $('#sheet-body').addEventListener('click', onClick);
  sh.hidden = false;
  document.documentElement.classList.add('lock', 'sheet-open');
  $('#sheet-body').scrollTop = 0;
  requestAnimationFrame(() => requestAnimationFrame(() => sh.classList.add('open')));
  $('#sheet-panel').focus({ preventScroll: true });
  if (!history.state || !history.state.sheet) history.pushState({ sheet: 1 }, '');
}
function closeSheet(fromPop) {
  const sh = $('#sheet');
  if (sh.hidden) return;
  if (!fromPop && history.state && history.state.sheet) { history.back(); return; }   // popstate closes it
  sh.classList.remove('open');
  document.documentElement.classList.remove('lock', 'sheet-open');
  const p = $('#sheet-panel');
  p.style.transform = '';
  setTimeout(() => { if (!sh.classList.contains('open')) sh.hidden = true; }, 380);
}
function wireSheetDrag() {
  const sh = $('#sheet'), panel = $('#sheet-panel'), body = $('#sheet-body');
  let y0 = null, dy = 0, t0 = 0, fromBody = false;
  const start = (y, isBody) => { y0 = y; dy = 0; t0 = performance.now(); fromBody = isBody; };
  panel.addEventListener('touchstart', ev => {
    const inGrab = ev.target.closest('#sheet-grab, [data-drag]');
    if (inGrab || body.scrollTop <= 0) start(ev.touches[0].clientY, !inGrab);
  }, { passive: true });
  panel.addEventListener('touchmove', ev => {
    if (y0 === null) return;
    dy = ev.touches[0].clientY - y0;
    if (fromBody && (dy < 0 || body.scrollTop > 0)) { y0 = null; return; }
    if (dy > 0) {
      sh.classList.add('dragging');
      panel.style.transform = `translateY(${dy}px)`;
      $('#sheet-backdrop').style.opacity = String(Math.max(0, 1 - dy / 400));
      if (fromBody && ev.cancelable) ev.preventDefault();
    }
  }, { passive: false });
  const end = () => {
    if (y0 === null) return;
    const v = dy / Math.max(1, performance.now() - t0);
    sh.classList.remove('dragging');
    $('#sheet-backdrop').style.opacity = '';
    if (dy > 120 || v > .6) closeSheet();
    else panel.style.transform = '';
    y0 = null;
  };
  panel.addEventListener('touchend', end);
  panel.addEventListener('touchcancel', end);
  $('#sheet-backdrop').addEventListener('click', () => closeSheet());
  addEventListener('popstate', () => { if (!$('#sheet').hidden) closeSheet(true); });
  addEventListener('keydown', ev => { if (ev.key === 'Escape') closeSheet(); });
}

/* ---------------------------------------------------------------- toast */
let toastTimer = null;
function toast(msg, action, fn) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action)}</button>` : ''}`;
  if (action) t.querySelector('button').onclick = () => { t.classList.remove('show'); fn && fn(); };
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 5000 : 2400);
}

/* --------------------------------------------------------------- navigation */
function go(tab, { instant } = {}) {
  if (!$(`#v-${tab}`)) tab = 'today';
  if (tab === S.tab && !instant) { scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }); return; }
  S.scroll[S.tab] = scrollY;
  const swap = () => {
    for (const v of $$('.view')) v.hidden = v.id !== `v-${tab}`;
    for (const b of $$('.tab[data-tab]')) b.classList.toggle('on', b.dataset.tab === tab);
    S.tab = tab;
    if (tab === 'calendar') { S.calKeepLeft = null; requestAnimationFrame(calPlace); }
    $('#bar-title').textContent = $(`#v-${tab}`).dataset.title;
    scrollTo(0, S.scroll[tab] || 0);
    observeTitle();
  };
  history.replaceState(history.state, '', `#${tab}`);
  if (!instant && document.startViewTransition && !reduced) document.startViewTransition(swap);
  else swap();
  if (!instant) buzz(4);
}
let titleObs = null;
function observeTitle() {
  if (titleObs) titleObs.disconnect();
  const h = $(`#v-${S.tab} .lt h1`);
  if (!h) return;
  titleObs = new IntersectionObserver(([en]) => $('#bar').classList.toggle('show', !en.isIntersecting), { rootMargin: `-${48}px 0px 0px 0px` });
  titleObs.observe(h);
}

/* pull to refresh: the app has no browser chrome to pull, so it brings its own */
function wirePull() {
  const ptr = $('#ptr');
  let y0 = null, pull = 0;
  addEventListener('touchstart', ev => {
    if (scrollY <= 0 && $('#sheet').hidden && !ev.target.closest('.pager, .carousel, .chips.scroll')) { y0 = ev.touches[0].clientY; pull = 0; }
  }, { passive: true });
  addEventListener('touchmove', ev => {
    if (y0 === null) return;
    pull = Math.max(0, (ev.touches[0].clientY - y0) * .5);
    if (pull <= 0) return;
    ptr.style.transition = 'none';
    ptr.style.opacity = String(Math.min(1, pull / 60));
    ptr.style.transform = `translateY(${Math.min(pull, 90) - 60}px) rotate(${pull * 3}deg)`;
  }, { passive: true });
  addEventListener('touchend', async () => {
    if (y0 === null) return;
    y0 = null;
    ptr.style.transition = 'transform .3s var(--ease), opacity .3s';
    if (pull > 64) {
      ptr.style.transform = 'translateY(20px)'; ptr.classList.add('spin'); buzz(10);
      await Promise.all([load(true), sleep(500)]);
      ptr.classList.remove('spin');
    }
    ptr.style.transform = ''; ptr.style.opacity = '0';
    pull = 0;
  });
}

/* -------------------------------------------------------------- wiring */
function wire() {
  for (const b of $$('.tab[data-tab]')) b.addEventListener('click', () => go(b.dataset.tab));
  $('#tab-add').addEventListener('click', () => { buzz(); logToday(); });
  $('#views').addEventListener('click', ev => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'q') quickToggle(b.dataset.k, b.dataset.v);
    else if (a === 'log-today') logToday();
    else if (a === 'settings') openSettings();
    else if (a === 'edit') openLog({ id: +b.dataset.id });
    else if (a === 'day') { buzz(4); S.selDay = b.dataset.d; S.calKeepLeft = $('#pager').scrollLeft; for (const x of $$('.d.sel')) x.classList.remove('sel'); b.classList.add('sel'); $('#day-panel').innerHTML = dayPanel(S.selDay); }
    else if (a === 'log-day') openLog({ day: b.dataset.d });
    else if (a === 'cal-today') { S.selDay = E.today; S.calKeepLeft = null; renderCalendar(); }
    else if (a === 'cal-prev' || a === 'cal-next') {
      const p = $('#pager');
      p.scrollBy({ left: (a === 'cal-next' ? 1 : -1) * p.clientWidth, behavior: reduced ? 'auto' : 'smooth' });
    }
  });
  wireSheetDrag();
  wirePull();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - S.loadedAt > 60000) load();
  });
}
function logToday() {
  // one entry today that the app can edit whole → open it; otherwise a fresh one
  const mine = S.entries.filter(e => e.day === E.today);
  openLog(mine.length === 1 ? { id: mine[0].id } : { day: E.today });
}

const AUTH = { required: false, pinned: false };
async function boot() {
  wire();
  wireLock();
  const hash = (location.hash || '#today').slice(1);
  try { Object.assign(AUTH, await api('GET', '/api/auth')); } catch {}
  if (AUTH.required) { try { localStorage.removeItem(CACHE_KEY); } catch {} }
  if (AUTH.required && !AUTH.unlocked) { go(hash, { instant: true }); showLock(); return; }
  if (!AUTH.required && fromCache()) renderAll();
  else $('#v-today').innerHTML = lt('Ironicles', 'Loading…') + '<div class="stack"><div class="skel" style="height:360px"></div><div class="skel"></div></div>';
  go(hash, { instant: true });
  await load(true);
  if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

/* ------------------------------------------------------------------ lock */
function showLock() {
  closeSheet(true);
  S.today = null; S.summary = null; S.entries = [];
  for (const v of $$('.view')) v.innerHTML = '';
  document.documentElement.classList.add('locked');
  $('#lock').hidden = false;
  $('#lock-err').textContent = '';
  setTimeout(() => $('#lock-pass').focus(), 60);
}
function wireLock() {
  $('#lock-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const pass = $('#lock-pass').value;
    if (!pass) return;
    const btn = $('#lock-form button'); btn.disabled = true;
    try {
      await api('POST', '/api/login', { passcode: pass });
      $('#lock-pass').value = '';
      $('#lock').hidden = true;
      document.documentElement.classList.remove('locked');
      AUTH.unlocked = true;
      buzz(12);
      await load(true);
      go(S.tab, { instant: true });
    } catch (e) {
      $('#lock-err').textContent = e.message;
      $('#lock-box').animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(10px)' }, { transform: 'translateX(0)' }], { duration: 260 });
      buzz(30);
    } finally { btn.disabled = false; }
  });
}

/* -------------------------------------------------------------- settings */
function openSettings() {
  const st = { msg: '', err: '' };
  const draw = () => {
    const on = AUTH.required;
    const pass = AUTH.pinned
      ? `<p class="muted" style="margin:0">A passcode is set by the server (<code>IRONICLES_PASSCODE</code>). Change it there.</p>`
      : on ? `<p class="muted" style="margin:0 0 10px">On. Every device has to unlock once.</p>
          <input class="field-input" type="password" id="pc-cur" placeholder="Current passcode" autocomplete="current-password">
          <input class="field-input" type="password" id="pc-new" placeholder="New passcode (leave empty to turn off)" autocomplete="new-password">
          <div class="row-btns"><button class="btn soft" data-act="pc-save">Save</button><button class="btn ghost" data-act="lock-now">Lock now</button></div>`
      : `<p class="muted" style="margin:0 0 10px">Off. Anyone who can open this page can see your data.</p>
          <input class="field-input" type="password" id="pc-new" placeholder="Choose a passcode (4+ characters)" autocomplete="new-password">
          <input class="field-input" type="password" id="pc-new2" placeholder="Repeat it" autocomplete="new-password">
          <div class="row-btns"><button class="btn soft" data-act="pc-save">Turn on</button></div>`;
    $('#sheet-body').innerHTML = `
      <div class="sheet-top" data-drag><div><h2>Settings</h2><div class="sub">Ironicles ${esc(S.version || '')}</div></div>
        <button class="icon-btn" data-act="close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <div class="card"><div class="card-h"><h2>🔒 Passcode</h2></div>${pass}
        ${st.err ? `<div class="set-err">${esc(st.err)}</div>` : ''}${st.msg ? `<div class="set-ok">${esc(st.msg)}</div>` : ''}</div>
      <div class="card" style="margin-top:14px"><div class="card-h"><h2>📦 Your data</h2></div>
        <p class="muted" style="margin:0 0 10px">${plural(S.entries.length, 'entry').replace('entrys', 'entries')}, stored only on your server.</p>
        <div class="row-btns"><a class="btn soft" href="/api/export?format=json" download>Export JSON</a><a class="btn soft" href="/api/export?format=csv" download>Export CSV</a></div>
        <label class="btn ghost block" style="margin-top:8px">Import a JSON export<input type="file" id="imp" accept="application/json,.json" hidden></label></div>
      <div class="card" style="margin-top:14px"><div class="card-h"><h2>About</h2></div>
        <p class="muted" style="margin:0">Phases, fertile windows and ovulation are estimates from your own cycle lengths. They are not medical advice and not a method of birth control. Talk to a clinician about anything that worries you.</p></div>`;
    $('#imp').addEventListener('change', async ev => {
      const f = ev.target.files[0]; if (!f) return;
      try {
        const r = await api('POST', '/api/import', await f.text());
        toast(`Imported ${r.added} · skipped ${r.skipped} already here${r.invalid ? ` · ${r.invalid} unreadable` : ''}`);
        load(true);
      } catch (e) { toast('Import failed — ' + e.message); }
    });
  };
  const onClick = async ev => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'close') return closeSheet();
    if (b.dataset.act === 'lock-now') { await api('POST', '/api/logout').catch(() => {}); AUTH.unlocked = false; showLock(); return; }
    if (b.dataset.act === 'pc-save') {
      st.err = st.msg = '';
      const nw = ($('#pc-new') || {}).value || '';
      if (!AUTH.required && nw !== (($('#pc-new2') || {}).value || '')) { st.err = 'The two passcodes don’t match.'; draw(); return; }
      if (!AUTH.required && nw.length < 4) { st.err = 'Use at least 4 characters.'; draw(); return; }
      try {
        const r = await api('POST', '/api/settings/passcode', { current: ($('#pc-cur') || {}).value || null, new: nw || null });
        AUTH.required = r.required; AUTH.unlocked = true;
        if (r.required) { try { localStorage.removeItem(CACHE_KEY); } catch {} }
        st.msg = r.required ? 'Passcode saved. Other devices will need it next time.' : 'Passcode turned off.';
        buzz(12);
      } catch (e) { st.err = e.message; }
      draw();
    }
  };
  openSheet(draw, onClick);
}
boot();
