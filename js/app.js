(() => {
'use strict';

/* Ask the server which build it holds, bypassing every cache layer. */
async function fetchRemoteVersion() {
  try {
    const res = await fetch('js/app.js?cb=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return null;
    const txt = await res.text();
    const m = txt.match(/APP_VERSION\s*=\s*'([^']+)'/);
    return m ? m[1] : null;
  } catch (e) {
    console.warn('[DayFlow] version check failed', e);
    return null;
  }
}

/* ======================= Safe DOM binding =======================
   A single `document.getElementById(x).addEventListener(...)` against a
   missing element throws, and every listener registered after it silently
   never binds — which looks to the user like "half the app stopped working".
   Bind through this instead so a markup/script mismatch degrades gracefully. */
function on(id, evt, fn, opts) {
  const el = document.getElementById(id);
  if (!el) { console.warn('[DayFlow] missing element:', id); return null; }
  el.addEventListener(evt, fn, opts);
  return el;
}

/* ======================= Build info ======================= */
// Bump with every deploy. Surfaced in Settings so a stale cache is obvious.
const APP_VERSION = 'v26';
const APP_BUILT = '2026-08-16';

/* ======================= Storage ======================= */
const STORE_KEY = 'dayflow.v1';
const THEME_KEY = 'dayflow.theme';

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      // Merge over a blank state rather than trusting the stored object
      // wholesale: a partial or truncated save used to leave whole collections
      // undefined, which surfaces much later as an unexplained crash.
      const parsed = JSON.parse(raw);
      const base = blankState();
      return Object.assign(base, parsed, { settings: Object.assign(base.settings, parsed.settings || {}) });
    }
  } catch (e) { console.warn('load failed', e); }
  return blankState();
}

/* ======================= Undo =======================
   Every mutation funnels through saveState(), so snapshotting the *previous*
   state there covers the whole app without touching each call site. State is
   a few KB of JSON, so keeping a short stack of copies is cheap and exact —
   no per-action inverse logic to get subtly wrong. */
const UNDO_LIMIT = 25;
const undoStack = [];
let lastSnapshot = null;

function saveState(label) {
  const snap = lastSnapshot;
  lastSnapshot = JSON.stringify(state);
  localStorage.setItem(STORE_KEY, lastSnapshot);

  // `silent` covers housekeeping saves (migrations, reminder bookkeeping,
  // chat log) that a user would never think of as an action to undo.
  if (snap && label !== 'silent') {
    undoStack.push({ snap, label: typeof label === 'string' ? label : '' });
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    renderUndoBtn();
    // A named action gets a visible, thumb-reachable undo for a while — the
    // header button alone is too easy to miss right after a mis-tap.
    if (typeof label === 'string' && label) {
      try { showUndoBar(label); } catch (e) { /* bar not built yet during boot */ }
    }
  }
}

function renderUndoBtn() {
  const btn = document.getElementById('undoBtn');
  if (!btn) return;
  btn.hidden = undoStack.length === 0;
  const last = undoStack[undoStack.length - 1];
  btn.setAttribute('aria-label', last && last.label ? `Undo ${last.label}` : 'Undo');
}

function undoLast() {
  const entry = undoStack.pop();
  if (!entry) { toast('Nothing to undo'); return; }
  // Keep where the user is looking. The snapshot carries whatever view was
  // stored at the time, so restoring it wholesale could silently switch tabs
  // and leave the visible one showing pre-undo data.
  const here = { ...state.view };
  try {
    state = JSON.parse(entry.snap);
  } catch (e) {
    toast('Could not undo that');
    return;
  }
  state.view = here;
  ensureHabitSessions(state);
  ensureNewCollections(state);
  lastSnapshot = entry.snap;
  localStorage.setItem(STORE_KEY, entry.snap);
  renderUndoBtn();
  applyTheme();
  closeSheets();
  try { hideUndoBar(); } catch (e) { /* not built yet */ }
  renderAll();
  toast(entry.label ? `Undid ${entry.label}` : 'Undone');
}

/* ======================= Utils ======================= */
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const pad2 = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayStr = () => dateStr(new Date());
const addDays = (d, n) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };
const startOfWeek = (d) => { const c = new Date(d); const day = c.getDay(); const diff = (day === 0 ? -6 : 1) - day; return addDays(c, diff); };
const minToLabel = (min) => {
  let h = Math.floor(min / 60), m = min % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return `${h12}:${pad2(m)} ${ap}`;
};
// Compact form for the now-marker: the hour gutter is only ~36px wide, and the
// surrounding hour labels already establish AM/PM.
const minToShort = (min) => {
  let h = Math.floor(min / 60) % 12; if (h === 0) h = 12;
  return `${h}:${pad2(min % 60)}`;
};
const timeToMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const minToTimeInput = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const WDFULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* ======================= Time in captured text =======================
   "call mum at 3pm" should land on today's grid at 15:00 without the user
   opening anything. Deliberately conservative: a bare number never counts as
   a time, so "buy 2 pints" stays a plain task. */
function extractTimeFromTitle(raw) {
  const text = String(raw || '');

  const attempts = [
    // 3pm · 3:30 pm · at 11.45am
    { re: /\s*(?:\bat\b\s*|@\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?m\.?\b/i,
      build: (m) => {
        let h = parseInt(m[1], 10);
        const min = m[2] ? parseInt(m[2], 10) : 0;
        if (h < 1 || h > 12 || min > 59) return null;
        if (/p/i.test(m[3]) && h !== 12) h += 12;
        if (/a/i.test(m[3]) && h === 12) h = 0;
        return h * 60 + min;
      } },
    // at 15:45 (24h needs the "at" and a colon, so dates/scores don't match)
    { re: /\s*(?:\bat\b\s*|@\s*)(\d{1,2}):(\d{2})\b/,
      build: (m) => {
        const h = parseInt(m[1], 10), min = parseInt(m[2], 10);
        if (h > 23 || min > 59) return null;
        return h * 60 + min;
      } },
    // noon / midday / midnight
    { re: /\s*(?:\bat\b\s+|@\s*)?(noon|midday|midnight)\b/i,
      build: (m) => (/midnight/i.test(m[1]) ? 0 : 12 * 60) },
  ];

  for (const a of attempts) {
    const m = text.match(a.re);
    if (!m) continue;
    const startMin = a.build(m);
    if (startMin == null) continue;
    const title = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length))
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,.;:!?])/g, '$1')
      .trim()
      .replace(/[\s,–@-]+$/, '')
      .trim();
    if (!title) continue;              // the text was only a time; keep it as-is
    return { title, startMin };
  }
  return null;
}

/* ======================= Urgency ("when") =======================
   Optional and always set after the fact — capture stays one tap + type, per
   the app's core rule that dumping a task in never requires a decision. */
const URGENCIES = [
  { id: 'asap',  label: 'Do ASAP',       short: 'ASAP',  rank: 0 },
  { id: 'today', label: 'Do today',      short: 'Today', rank: 1 },
  { id: 'week',  label: 'Do this week',  short: 'Week',  rank: 2 },
  { id: 'month', label: 'Do this month', short: 'Month', rank: 3 },
];
const URGENCY_BY_ID = Object.fromEntries(URGENCIES.map(u => [u.id, u]));
function urgencyRank(u) { return URGENCY_BY_ID[u] ? URGENCY_BY_ID[u].rank : 4; }

/* ======================= Icons =======================
   Inline stroke icons (24px grid, currentColor) so they inherit theme + accent
   colour and stay crisp at any size. No emoji, no icon font, no network. */
const ICON_PATHS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>',
  target: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5L16 9.5"/>',
  sparkle: '<path d="M12 3.2l1.7 4.8 4.8 1.7-4.8 1.7L12 16.2l-1.7-4.8L5.5 9.7l4.8-1.7L12 3.2Z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/>',
  chart: '<path d="M3 21h18"/><path d="M6.5 21v-6M12 21V6M17.5 21v-9"/>',
  list: '<path d="M8.5 6h12M8.5 12h12M8.5 18h12"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  repeat: '<path d="m17 2.5 3.5 3.5L17 9.5"/><path d="M3.5 11.5v-1a4 4 0 0 1 4-4h13"/><path d="m7 21.5-3.5-3.5L7 14.5"/><path d="M20.5 12.5v1a4 4 0 0 1-4 4h-13"/>',
  timer: '<path d="M9.5 2.5h5"/><path d="M12 14v-4"/><circle cx="12" cy="14" r="7.75"/>',
  sliders: '<path d="M4 21v-6M4 11V3M12 21v-9M12 8V3M20 21v-4M20 13V3"/><path d="M1.5 15h5M9.5 8h5M17.5 17h5"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10.5v1.5a7 7 0 0 1-14 0v-1.5"/><path d="M12 19v3"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2.5"/>',
  play: '<path d="M7.5 4.8v14.4l12-7.2-12-7.2Z"/>',
  trash: '<path d="M3.5 6h17M8.5 6V3.8h7V6M18.5 6l-1 14.2h-11L5.5 6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6.5 9.2 17.3 4 12.1"/>',
  chevronLeft: '<path d="m14.5 18.5-6.5-6.5 6.5-6.5"/>',
  chevronRight: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  chevronDown: '<path d="m5.5 9 6.5 6.5L18.5 9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  arrowUp: '<path d="M12 19.5v-15M5 11.5l7-7 7 7"/>',
  download: '<path d="M12 3v12M7 10.5l5 5 5-5M4.5 21h15"/>',
  alarm: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2"/><path d="m4.5 3-2.2 2.2M19.5 3l2.2 2.2"/>',
  trophy: '<path d="M6.5 3.5h11v6.5a5.5 5.5 0 0 1-11 0V3.5Z"/><path d="M6.5 5.5h-2a2.5 2.5 0 0 0 2.5 2.5M17.5 5.5h2a2.5 2.5 0 0 1-2.5 2.5"/><path d="M9 20.5h6M12 16v4.5"/>',
  grip: '<circle cx="9" cy="6" r=".9"/><circle cx="15" cy="6" r=".9"/><circle cx="9" cy="12" r=".9"/><circle cx="15" cy="12" r=".9"/><circle cx="9" cy="18" r=".9"/><circle cx="15" cy="18" r=".9"/>',
  bolt: '<path d="M13.2 2.5 4.5 13.5h6.3l-.9 8 8.7-11h-6.3l.9-8Z"/>',
  crosshair: '<circle cx="12" cy="12" r="8.5"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
  undo: '<path d="M3.5 8.5h7v-7"/><path d="M3.9 14.2a8.5 8.5 0 1 0 1.4-6.4"/>',
  arrowRight: '<path d="M4.5 12h15M13.5 5.5l6.5 6.5-6.5 6.5"/>',
};

function icon(name, size = 20, opts = {}) {
  const p = ICON_PATHS[name];
  if (!p) return '';
  const fill = opts.fill ? 'currentColor' : 'none';
  const sw = opts.strokeWidth || 1.75;
  return `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" fill="${fill}" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

// The grid covers the whole day. A 6am–11pm window meant the "now" marker
// simply had nowhere to render late at night or early in the morning, and
// nothing could be scheduled outside those hours either.
const GRID_START_MIN = 0;
const GRID_END_MIN = 24 * 60;
const PX_PER_MIN = 56 / 60;

function toast(msg, ms) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, ms || 1800);
}

/* ======================= Initial state =======================
   A first run starts genuinely empty — no demo tasks, habits or records. The
   app should look like the user's own from the first second, not something
   they have to clean up first. */
function blankState() {
  return {
    tasks: [], habits: [], routines: [], chores: [], lists: [],
    alarmStacks: [], chatLog: [], aiMemory: { facts: [] },
    taskTimes: {}, recurring: [], calendar: null,
    settings: {
      theme: 'auto', remindersEnabled: false, colorScheme: 'orange', showSchedule: false,
      graceDays: true, transitionWarn: true, momentum: true, autoDecay: true,
      timeBar: true, focusMode: false, tutorialSeen: false, lastRecapDate: null,
      pushOn: false, pushServer: null, pushKey: null,
      lastExportAt: null, storagePersisted: null, keepAwake: true,
      license: null, firstRunAt: null, supportDismissedAt: null,
      work: { startMin: 9 * 60, endMin: 17 * 60, days: [1, 2, 3, 4, 5], gapMin: 10, auto: false },
    },
    view: { current: 'today', todayOffset: 0, weekOffset: 0 },
  };
}

/* Defaults for everything added after the first release. Kept in one table so a
   migration is a single line rather than a scattered pile of `undefined` checks. */
const SETTING_DEFAULTS = {
  graceDays: true, transitionWarn: true, momentum: true, autoDecay: true,
  timeBar: true, focusMode: false, tutorialSeen: false, lastRecapDate: null,
  pushOn: false, pushServer: null, pushKey: null,
  lastExportAt: null, storagePersisted: null, keepAwake: true,
  license: null, firstRunAt: null, supportDismissedAt: null, work: null,
};

/* ======================= State ======================= */
function ensureHabitSessions(s) {
  (s.habits || []).forEach(h => {
    if (!h.sessions) h.sessions = [];
    // Habits can now be checked off several times a day. Older data stored a
    // plain boolean per day; treat that as a single completion.
    if (!h.dailyTarget || h.dailyTarget < 1) h.dailyTarget = 1;
    // Only some habits are worth timing. Anything with existing records keeps
    // its timer; everything else starts without one.
    if (h.timed === undefined) h.timed = (h.sessions && h.sessions.length > 0);
    const c = h.completions || (h.completions = {});
    Object.keys(c).forEach(k => {
      if (c[k] === true) c[k] = 1;
      else if (typeof c[k] !== 'number' || c[k] <= 0) delete c[k];
    });
  });
}

function ensureNewCollections(s) {
  if (!s.alarmStacks) s.alarmStacks = [];
  if (!s.chatLog) s.chatLog = [];
  if (!s.aiMemory) s.aiMemory = { facts: [] };
  if (!s.aiMemory.facts) s.aiMemory.facts = [];
  if (s.settings && s.settings.showSchedule === undefined) s.settings.showSchedule = false;
  if (s.settings && !s.settings.alarmMethod) s.settings.alarmMethod = 'clock';
  // Existing installs seeded the day list as "Errands"; it's the To Do List now.
  (s.lists || []).forEach(l => { if (l.name === 'Errands') l.name = 'To Do List'; });

  if (!s.taskTimes) s.taskTimes = {};
  // Needed to answer "how long have you actually been using this" before ever
  // mentioning money.
  if (!s.settings.firstRunAt) s.settings.firstRunAt = Date.now();
  if (!s.recurring) s.recurring = [];
  if (!s.calendar) s.calendar = null;
  (s.habits || []).forEach(h => { if (h.archived === undefined) h.archived = false; });
  (s.chores || []).forEach(c => { if (c.archived === undefined) c.archived = false; });
  (s.routines || []).forEach(r => { if (r.archived === undefined) r.archived = false; });
  (s.tasks || []).forEach(t => { if (!Array.isArray(t.subtasks)) t.subtasks = []; });
  if (!s.settings) s.settings = {};
  Object.keys(SETTING_DEFAULTS).forEach(k => {
    if (s.settings[k] === undefined) s.settings[k] = SETTING_DEFAULTS[k];
  });
  // An existing install has already seen the app; only genuinely new installs
  // get the tour, so nobody is re-onboarded by an update.
  if (s.settings.tutorialSeen === false && (s.tasks || []).length + (s.habits || []).length > 0) {
    s.settings.tutorialSeen = true;
  }
  // touchedAt drives the stale-task sweep; backfill it from creation time.
  (s.tasks || []).forEach(t => {
    // Anything that isn't a plausible millisecond timestamp (older data used
    // small counters) is treated as "just touched" rather than three weeks
    // stale — parking a task the user has never seen would be baffling.
    if (!t.touchedAt || t.touchedAt < 1e12) t.touchedAt = (t.createdAt && t.createdAt > 1e12) ? t.createdAt : Date.now();
    if (t.someday === undefined) t.someday = false;
  });
}

let state = loadState();
if (!state.view) state.view = { current: 'today', todayOffset: 0, weekOffset: 0 };
if (!state.routines) state.routines = [];
if (!state.chores) state.chores = [];
if (!state.settings) state.settings = { theme: 'auto', remindersEnabled: false, colorScheme: 'orange' };
if (state.settings.remindersEnabled === undefined) state.settings.remindersEnabled = false;
if (!state.settings.colorScheme) state.settings.colorScheme = 'orange';
ensureHabitSessions(state);
ensureNewCollections(state);
// Persist any schema migration immediately, so the stored copy matches what
// the app is actually working with rather than waiting for the next edit.
saveState('silent');

/* ======================= Theme ======================= */
const COLOR_SCHEMES = [
  { id: 'orange', name: 'Orange', hex: '#ff8c42' },
  { id: 'blue', name: 'Blue', hex: '#3b82f6' },
  { id: 'green', name: 'Green', hex: '#22a06b' },
  { id: 'red', name: 'Red', hex: '#e5533d' },
  { id: 'purple', name: 'Purple', hex: '#8b5cf6' },
  { id: 'teal', name: 'Teal', hex: '#14b8a6' },
  { id: 'pink', name: 'Pink', hex: '#ec4899' },
  { id: 'amber', name: 'Amber', hex: '#e5a300' },
];

function contrastTextFor(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#17171a' : '#ffffff';
}

function applyTheme() {
  const t = state.settings?.theme || 'auto';
  document.documentElement.classList.remove('theme-light', 'theme-dark');
  if (t === 'light') document.documentElement.classList.add('theme-light');
  if (t === 'dark') document.documentElement.classList.add('theme-dark');
  document.querySelectorAll('#themeOptions .freq-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === t);
  });

  const schemeId = state.settings?.colorScheme || 'orange';
  const scheme = COLOR_SCHEMES.find(s => s.id === schemeId) || COLOR_SCHEMES[0];
  document.documentElement.style.setProperty('--accent', scheme.hex);
  document.documentElement.style.setProperty('--accent-text', contrastTextFor(scheme.hex));

  renderColorSwatches(schemeId);
}

function renderColorSwatches(selectedId) {
  const wrap = document.getElementById('colorSwatches');
  if (!wrap) return;
  if (!wrap.childElementCount) {
    COLOR_SCHEMES.forEach(s => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-swatch';
      btn.style.background = s.hex;
      btn.dataset.scheme = s.id;
      btn.setAttribute('aria-label', s.name);
      btn.innerHTML = `<span class="cs-check" style="color:${contrastTextFor(s.hex)}">${icon('check', 16, {strokeWidth: 2.6})}</span>`;
      btn.addEventListener('click', () => {
        state.settings.colorScheme = s.id;
        saveState();
        applyTheme();
      });
      wrap.appendChild(btn);
    });
  }
  wrap.querySelectorAll('.color-swatch').forEach(el => {
    el.classList.toggle('selected', el.dataset.scheme === selectedId);
  });
}

/* ======================= Navigation ======================= */
const views = ['today', 'week', 'habits', 'routines', 'chores', 'chat', 'stats'];
const titles = { today: 'Today', week: 'Week', habits: 'Habits', routines: 'Routines', chores: 'Chore Timer', chat: 'Assistant', stats: 'Stats' };

function switchView(name) {
  const changed = state.view.current !== name;
  state.view.current = name;
  views.forEach(v => document.getElementById('view-' + v).classList.toggle('active', v === name));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  document.getElementById('viewTitle').textContent = titles[name];
  updateInputBarMode();
  renderAll();
  // Entering Today with the schedule already expanded used to render the grid
  // parked at midnight, leaving the current-time marker far below the fold.
  if (name === 'today' && state.settings.showSchedule) scrollGridToRelevant();
}

// The single bottom input bar doubles as quick-capture and the chat composer.
function updateInputBarMode() {
  const isChat = state.view.current === 'chat';
  const input = document.getElementById('quickAddInput');
  document.getElementById('quickAddModeBtn').hidden = isChat;
  const sendBtn = document.querySelector('.quick-add-btn');
  if (sendBtn) sendBtn.innerHTML = icon(isChat ? 'arrowUp' : 'plus', 20, { strokeWidth: 2.1 });
  if (isChat) input.placeholder = 'Ask me anything…';
  else setQuickAddMode(quickAddMode);
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
});

/* ======================= Current day helpers ======================= */
function currentTodayDate() {
  return addDays(new Date(), state.view.todayOffset);
}

/* ======================= Render: Today ======================= */
function renderToday() {
  const d = currentTodayDate();
  const ds = dateStr(d);
  const isToday = ds === todayStr();
  document.getElementById('todayDateLabel').textContent =
    (isToday ? 'Today · ' : '') + `${WDFULL[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`;

  // Inbox: untimed tasks for this date, plus backlog (date null) shown only when viewing today
  const dayTasks = state.tasks.filter(t => t.date === ds);
  const untimed = dayTasks.filter(t => t.startMin == null && !t.done && !t.someday);
  const backlog = isToday ? state.tasks.filter(t => t.date === null && !t.done && !t.someday) : [];
  const allInbox = [...untimed, ...backlog]
    .sort((a, b) => (urgencyRank(a.urgency) - urgencyRank(b.urgency)) || (a.createdAt - b.createdAt));

  // Focus mode is the overwhelm valve: three things, nothing else. A forty-item
  // inbox is the thing that makes people close the app, not the work itself.
  const focus = !!state.settings.focusMode;
  const inboxTasks = focus ? allInbox.slice(0, 3) : allInbox;
  const hiddenCount = allInbox.length - inboxTasks.length;

  const inboxList = document.getElementById('inboxList');
  inboxList.innerHTML = '';
  inboxTasks.forEach(t => inboxList.appendChild(renderInboxItem(t)));
  document.getElementById('inboxCount').textContent = allInbox.length;

  const focusBtn = document.getElementById('focusBtn');
  if (focusBtn) {
    focusBtn.classList.toggle('active', focus);
    focusBtn.setAttribute('aria-pressed', focus ? 'true' : 'false');
  }
  const focusNote = document.getElementById('focusNote');
  if (focusNote) {
    focusNote.hidden = !(focus && hiddenCount > 0);
    focusNote.textContent = `${hiddenCount} more parked — they'll still be here`;
  }

  // Overdue leftovers: one tap beats re-dating them one at a time.
  const carryRow = document.getElementById('carryRow');
  if (carryRow) {
    const over = isToday ? overdueTasks().length : 0;
    carryRow.hidden = over === 0 || focus;
    if (over) document.getElementById('carryBtn').textContent =
      `Bring ${over} unfinished task${over === 1 ? '' : 's'} to today`;
  }

  const sdRow = document.getElementById('somedayRow');
  if (sdRow) {
    const n = somedayTasks().length;
    sdRow.hidden = n === 0 || focus;
    if (n) document.getElementById('somedayBtn').textContent = `Someday · ${n}`;
  }

  // checklist-today (lists attached to this date)
  const attached = state.lists.filter(l => l.attachedDate === ds);
  const section = document.getElementById('checklistTodaySection');
  const wrap = document.getElementById('checklistTodayList');
  wrap.innerHTML = '';
  if (attached.length === 0 || focus) {
    section.hidden = true;
  } else {
    section.hidden = false;
    attached.forEach(list => {
      const card = document.createElement('div');
      card.className = 'list-card';
      // With a single attached list the "To Do List" section label already
      // names it — repeating the name inside the card just reads as a dupe.
      if (attached.length > 1) {
        const head = document.createElement('div');
        head.className = 'list-card-head';
        head.innerHTML = `<span class="lname">${escapeHtml(list.name)}</span>`;
        card.appendChild(head);
      }
      list.items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'checklist-today-list-item';
        row.innerHTML = `<div class="checkbox ${item.done ? 'checked' : ''}">${icon('check', 15, {strokeWidth: 2.6})}</div><div class="lbl ${item.done ? 'done' : ''}">${escapeHtml(item.text)}</div>`;
        row.querySelector('.checkbox').addEventListener('click', (e) => {
          item.done = !item.done;
          e.currentTarget.classList.toggle('checked', item.done);
          e.currentTarget.classList.add('pop');
          setTimeout(() => e.currentTarget.classList.remove('pop'), 320);
          row.querySelector('.lbl').classList.toggle('done', item.done);
          saveState();
        });
        card.appendChild(row);
      });
      wrap.appendChild(card);
    });
  }

  renderScheduleToggle(ds);
  renderGrid(ds);
  renderBackupBanner();
  renderAutoScheduleRow(ds);
  const schedToggle = document.getElementById('scheduleToggle');
  if (schedToggle) schedToggle.hidden = focus;
  if (focus) document.getElementById('gridScroll').hidden = true;
  renderTimeBar();
}

function subtaskChip(t) {
  const n = (t.subtasks || []).length;
  if (!n) return '';
  const done = t.subtasks.filter(x => x.done).length;
  return `<span class="subtask-chip${done === n ? ' complete' : ''}">${done}/${n}</span>`;
}

function renderInboxItem(t) {
  const el = document.createElement('div');
  el.className = 'inbox-item';
  el.dataset.id = t.id;
  // The play button is the most important control on this row: it starts a
  // five-minute timer with zero decisions in between. Everything else on the
  // row is organising, and organising is never the bottleneck.
  el.innerHTML = `
    <div class="swipe-content"><span class="grip">${icon('grip', 16)}</span><span class="title">${escapeHtml(t.title)}</span>${t.urgency ? `<span class="u-tag ${t.urgency}">${URGENCY_BY_ID[t.urgency].short}</span>` : ''}${subtaskChip(t)}${t.ruleId ? `<span class="repeat-dot" title="Repeats" aria-label="Repeating task">${icon('repeat', 12)}</span>` : ''}${t.proposedMin != null ? `<button type="button" class="time-chip">${minToLabel(t.proposedMin)}</button>` : ''}<button type="button" class="start5-btn" aria-label="Start 5 minutes on ${escapeHtml(t.title)}">${icon('play', 13, { fill: true, strokeWidth: 0 })}<span>5m</span></button></div>
    <button type="button" class="swipe-delete-btn" aria-label="Delete task">${icon('trash', 18)}<span>Delete</span></button>
  `;
  el.querySelector('.start5-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    // A swipe that happens to end over this button is a swipe, not a start.
    if (el._wasDragged || el._swipeOpen) { el._wasDragged = false; return; }
    startTaskTimer(t, START_SMALL_MIN);
  });
  el.querySelector('.swipe-delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteTaskById(t.id);
  });
  const chip = el.querySelector('.time-chip');
  if (chip) chip.addEventListener('click', (e) => {
    e.stopPropagation();
    placeTask(t, t.date || currentTodayDateStr(), t.proposedMin);
    toast(`Scheduled for ${minToLabel(t.startMin)}`);
  });
  el.addEventListener('click', (e) => {
    if (el._wasDragged) { el._wasDragged = false; return; }
    if (el._swipeOpen) { closeAnyOpenSwipe(); return; }
    openBlockSheet(t, { forceDate: currentTodayDateStr() });
  });
  makeInboxDraggable(el, t);
  return el;
}

/* The hourly grid is collapsed by default — the first screen stays Inbox +
   To Do List. The toggle keeps a one-line summary so it isn't hidden blindly. */
function renderScheduleToggle(ds) {
  const open = !!state.settings.showSchedule;
  const toggle = document.getElementById('scheduleToggle');
  toggle.classList.toggle('open', open);
  document.getElementById('gridScroll').hidden = !open;

  const summaryEl = document.getElementById('scheduleSummary');
  if (open) { summaryEl.textContent = ''; return; }

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const isToday = ds === todayStr();
  // Show the time even while collapsed, so "now" is visible without expanding.
  const nowBit = isToday ? `now ${minToShort(nowMin)} · ` : '';

  const blocks = state.tasks
    .filter(t => t.date === ds && t.startMin != null)
    .sort((a, b) => a.startMin - b.startMin);

  if (!blocks.length) { summaryEl.textContent = `${nowBit}nothing scheduled`; return; }

  const n = `${nowBit}${blocks.length} block${blocks.length === 1 ? '' : 's'}`;
  const unfinished = blocks.filter(b => !b.done).length;
  const upcoming = isToday
    ? blocks.find(b => !b.done && b.startMin + b.durationMin > nowMin)
    : blocks.find(b => !b.done);

  if (upcoming) {
    summaryEl.textContent = `${n} · next ${upcoming.title} at ${minToLabel(upcoming.startMin)}`;
  } else if (unfinished) {
    // Past their slot but never ticked off — "all done" would be a lie.
    summaryEl.textContent = `${n} · ${unfinished} unfinished`;
  } else {
    summaryEl.textContent = `${n} · all done`;
  }
}

on('undoBtn', 'click', undoLast);

on('scheduleToggle', 'click', () => {
  state.settings.showSchedule = !state.settings.showSchedule;
  saveState();
  renderToday();
  if (state.settings.showSchedule) scrollGridToRelevant();
});

/* Opening the schedule at 6 AM is useless — jump to now (or the first block
   of the day when viewing another date) so the useful rows are on screen. */
function scrollGridToRelevant() {
  const scroller = document.getElementById('gridScroll');
  const ds = currentTodayDateStr();
  const isToday = ds === todayStr();
  let focusMin;
  if (isToday) {
    const now = new Date();
    focusMin = now.getHours() * 60 + now.getMinutes();
  } else {
    const first = state.tasks
      .filter(t => t.date === ds && t.startMin != null)
      .sort((a, b) => a.startMin - b.startMin)[0];
    focusMin = first ? first.startMin : 9 * 60;
  }
  const target = (Math.max(GRID_START_MIN, focusMin - 30) - GRID_START_MIN) * PX_PER_MIN;
  requestAnimationFrame(() => { scroller.scrollTop = target; });
}

function currentTodayDateStr() { return dateStr(currentTodayDate()); }

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Hour grid ---------- */
function buildHourLines() {
  const hourLines = document.getElementById('hourLines');
  hourLines.innerHTML = '';
  for (let m = GRID_START_MIN; m < GRID_END_MIN; m += 60) {
    const row = document.createElement('div');
    row.className = 'hour-row tap-target';
    row.dataset.min = m;
    row.style.height = (60 * PX_PER_MIN) + 'px';
    const label = document.createElement('div');
    label.className = 'hour-label';
    label.textContent = minToLabel(m).replace(':00', '');
    row.appendChild(label);
    const half = document.createElement('div');
    half.className = 'half-line';
    row.appendChild(half);
    hourLines.appendChild(row);
  }
  const totalHeight = (GRID_END_MIN - GRID_START_MIN) * PX_PER_MIN;
  document.getElementById('gridWrap').style.height = totalHeight + 'px';
  document.getElementById('gridWrap').style.marginLeft = '44px';
}
buildHourLines();

function gridYToMin(y) {
  let min = GRID_START_MIN + y / PX_PER_MIN;
  min = Math.round(min / 15) * 15;
  min = Math.max(GRID_START_MIN, Math.min(GRID_END_MIN - 15, min));
  return min;
}

// Maps a viewport point to a grid minute using the grid's own geometry,
// rather than hit-testing elementFromPoint — a dragged item's own ghost or
// an existing block sitting on that slot would otherwise shadow the drop
// target and silently swallow the drop.
function pointToGridMin(clientX, clientY) {
  const gridWrap = document.getElementById('gridWrap');
  const rect = gridWrap.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
  return gridYToMin(clientY - rect.top);
}

function renderGrid(ds) {
  const layer = document.getElementById('blocksLayer');
  layer.innerHTML = '';
  const dayTasks = state.tasks.filter(t => t.date === ds && t.startMin != null);
  dayTasks.forEach(t => layer.appendChild(renderBlock(t)));

  // "Now" marker: a labelled line so the current time is obvious at a glance,
  // rather than a hairline you have to go looking for.
  const nowLine = document.getElementById('nowLine');
  const isToday = ds === todayStr();
  if (isToday) {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    if (nowMin >= GRID_START_MIN && nowMin <= GRID_END_MIN) {
      nowLine.hidden = false;
      nowLine.style.top = ((nowMin - GRID_START_MIN) * PX_PER_MIN) + 'px';
      nowLine.innerHTML = `<span class="now-label">${minToShort(nowMin)}</span>`;
    } else {
      nowLine.hidden = true;
    }
  } else {
    nowLine.hidden = true;
  }

  // tap-to-place: click empty area of hour row
  document.querySelectorAll('.hour-row.tap-target').forEach(row => {
    row.onclick = (e) => {
      if (pendingPlace) {
        const rect = row.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;
        const min = gridYToMin((row.dataset.min - GRID_START_MIN) * PX_PER_MIN + offsetY);
        placeTask(pendingPlace, ds, min);
        pendingPlace = null;
        toast('Placed');
      }
    };
  });
}

function renderBlock(t) {
  const el = document.createElement('div');
  const ext = !!t.external;
  el.className = 'block' + (t.done ? ' done' : '') + (ext ? ' external' : '');
  el.dataset.id = t.id;
  const top = (t.startMin - GRID_START_MIN) * PX_PER_MIN;
  const height = Math.max(22, t.durationMin * PX_PER_MIN);
  el.style.top = top + 'px';
  el.style.height = height + 'px';

  // An event pulled from Google or Apple is somebody else's fact about your
  // day. It shows on the grid so the time is visibly taken, but it is not
  // draggable, deletable or editable here — that would silently diverge from
  // the calendar it came from.
  if (ext) {
    el.innerHTML = `<div class="swipe-content"><div class="block-title">${icon('calendar', 11)} ${escapeHtml(t.title)}</div><div class="block-time">${minToLabel(t.startMin)} · ${t.external.source === 'google' ? 'Google' : 'Calendar'}</div></div>`;
    el.addEventListener('click', () => {
      toast(`“${t.title}” comes from your ${t.external.source === 'google' ? 'Google' : 'Apple'} calendar — edit it there`, 3500);
    });
    return el;
  }

  el.innerHTML = `
    <div class="swipe-content"><div class="block-title">${escapeHtml(t.title)}</div><div class="block-time">${minToLabel(t.startMin)} · ${t.durationMin}m</div></div>
    <button type="button" class="swipe-delete-btn" aria-label="Delete task">${icon('trash', 18)}</button>
  `;
  el.querySelector('.swipe-delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteTaskById(t.id);
  });
  makeBlockDraggable(el, t);
  el.addEventListener('click', (e) => {
    if (el._wasDragged) { el._wasDragged = false; return; }
    if (el._swipeOpen) { closeAnyOpenSwipe(); return; }
    openBlockSheet(t);
  });
  return el;
}

/* ---------- Swipe-to-delete (shared) ---------- */
let openSwipeRow = null;
function closeSwipeRowObj(row) {
  row.content.style.transition = '';
  row.content.style.transform = '';
  row.el._swipeOpen = false;
  row.el.classList.remove('swiped');
}
function openSwipeRowObj(el, content, width) {
  if (openSwipeRow && openSwipeRow.el !== el) closeSwipeRowObj(openSwipeRow);
  content.style.transition = '';
  content.style.transform = `translateX(-${width}px)`;
  el._swipeOpen = true;
  // The revealed Delete button sits under the row content, and the 5m start
  // button rides right over it once the row slides across — so a tap aimed at
  // Delete would hit Start instead. Take the start button out of the running
  // for as long as the row is open.
  el.classList.add('swiped');
  openSwipeRow = { el, content };
}
function closeAnyOpenSwipe() {
  if (openSwipeRow) { closeSwipeRowObj(openSwipeRow); openSwipeRow = null; }
}
document.addEventListener('pointerdown', (e) => {
  if (openSwipeRow && !openSwipeRow.el.contains(e.target)) closeAnyOpenSwipe();
}, true);

function deleteTaskById(id) {
  closeAnyOpenSwipe();
  state.tasks = state.tasks.filter(x => x.id !== id);
  saveState('deleting a task');
  renderAll();
  toast('Task deleted');
}

let pendingPlace = null;

/* ---------- Drag: inbox item -> grid, or swipe left to delete ---------- */
const SWIPE_REVEAL = 84;
const SWIPE_AUTO_DELETE = 150;

function makeInboxDraggable(el, t) {
  const content = el.querySelector('.swipe-content');
  let axis = null, dragging = false, startX = 0, startY = 0, ghost = null, baseX = 0;
  el.addEventListener('pointerdown', (e) => {
    axis = null;
    dragging = false;
    startX = e.clientX;
    startY = e.clientY;
    baseX = el._swipeOpen ? -SWIPE_REVEAL : 0;
    const onMove = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (axis === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (axis === 'x') closeAnyOpenSwipe();
      }
      if (axis === 'x') {
        let nx = Math.min(0, Math.max(-SWIPE_REVEAL - 40, baseX + dx));
        content.style.transition = 'none';
        content.style.transform = `translateX(${nx}px)`;
        el._pendingSwipeX = nx;
        return;
      }
      // vertical: existing drag-to-place-on-grid behavior
      if (!dragging) {
        dragging = true;
        el.classList.add('dragging');
        ghost = el.cloneNode(true);
        ghost.style.position = 'fixed';
        ghost.style.width = el.getBoundingClientRect().width + 'px';
        ghost.style.zIndex = 100;
        ghost.style.pointerEvents = 'none';
        ghost.style.opacity = '0.9';
        document.body.appendChild(ghost);
      }
      if (dragging) {
        ghost.style.left = (ev.clientX - ghost.offsetWidth / 2) + 'px';
        ghost.style.top = (ev.clientY - 20) + 'px';
        highlightDropTarget(ev.clientX, ev.clientY);
      }
    };
    const onUp = (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (axis === 'x') {
        const nx = el._pendingSwipeX || 0;
        if (nx <= -SWIPE_AUTO_DELETE) {
          deleteTaskById(t.id);
          return;
        }
        if (nx <= -SWIPE_REVEAL / 2) openSwipeRowObj(el, content, SWIPE_REVEAL);
        else closeSwipeRowObj({ el, content });
        el._wasDragged = true;
      } else if (axis === 'y') {
        el.classList.remove('dragging');
        clearDropHighlights();
        if (dragging) {
          el._wasDragged = true;
          if (ghost) ghost.remove();
          const min = pointToGridMin(ev.clientX, ev.clientY);
          if (min != null) {
            placeTask(t, currentTodayDateStr(), min);
            toast('Placed on grid');
          }
        }
      }
      dragging = false;
      axis = null;
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
}

function highlightDropTarget(x, y) {
  clearDropHighlights();
  const el = document.elementFromPoint(x, y);
  const row = el && el.closest('.hour-row');
  if (row) row.style.background = 'color-mix(in srgb, var(--accent) 10%, transparent)';
}
function clearDropHighlights() {
  document.querySelectorAll('.hour-row').forEach(r => r.style.background = '');
}

/* ---------- Drag: block reposition within grid ---------- */
function makeBlockDraggable(el, t) {
  const content = el.querySelector('.swipe-content');
  const BLOCK_REVEAL = 60;
  let axis = null, dragging = false, startX = 0, startY = 0, origTop = 0, baseX = 0;
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    axis = null;
    dragging = false;
    startX = e.clientX;
    startY = e.clientY;
    origTop = parseFloat(el.style.top);
    baseX = el._swipeOpen ? -BLOCK_REVEAL : 0;
    const onMove = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (axis === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (axis === 'x') closeAnyOpenSwipe();
      }
      if (axis === 'x') {
        let nx = Math.min(0, Math.max(-BLOCK_REVEAL - 30, baseX + dx));
        content.style.transition = 'none';
        content.style.transform = `translateX(${nx}px)`;
        el._pendingSwipeX = nx;
        return;
      }
      if (!dragging && Math.abs(dy) > 6) { dragging = true; el.classList.add('dragging'); }
      if (dragging) {
        let newTop = origTop + dy;
        newTop = Math.max(0, newTop);
        el.style.top = newTop + 'px';
      }
    };
    const onUp = (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (axis === 'x') {
        const nx = el._pendingSwipeX || 0;
        if (nx <= -(BLOCK_REVEAL + 60)) {
          deleteTaskById(t.id);
          return;
        }
        if (nx <= -BLOCK_REVEAL / 2) openSwipeRowObj(el, content, BLOCK_REVEAL);
        else closeSwipeRowObj({ el, content });
        el._wasDragged = true;
      } else if (axis === 'y') {
        if (dragging) {
          el._wasDragged = true;
          el.classList.remove('dragging');
          const newTop = parseFloat(el.style.top);
          const min = gridYToMin(newTop);
          t.startMin = min;
          saveState();
          renderAll();
        }
      }
      dragging = false;
      axis = null;
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
}

function placeTask(t, ds, min) {
  t.date = ds;
  t.startMin = min;
  delete t.proposedMin;      // the suggestion has been acted on
  if (!t.durationMin) t.durationMin = 30;
  saveState('scheduling');
  renderAll();
}

/* ======================= Block sheet ======================= */
let activeBlock = null;
function openBlockSheet(t, opts = {}) {
  activeBlock = t;
  document.getElementById('blockTitleInput').value = t.title;
  // Leave the time blank for untimed tasks. Pre-filling it meant that merely
  // tagging urgency and saving would silently schedule the task at 9am and
  // pull it out of the inbox.
  document.getElementById('blockStartInput').value =
    t.startMin != null ? minToTimeInput(t.startMin)
    : (t.proposedMin != null ? minToTimeInput(t.proposedMin) : '');
  document.getElementById('blockStepInput').value = t.firstStep || '';
  const notesEl = document.getElementById('blockNotesInput');
  if (notesEl) notesEl.value = t.notes || '';

  // Prefill from evidence. Once a task title has been timed, its real median
  // beats whatever number was guessed the first time — unless the user has
  // deliberately set a duration for this task, which always wins.
  const typical = typicalMinutes(t.title);
  currentDuration = t.durationSet ? (t.durationMin || 30) : (typical != null ? typical : (t.durationMin || 30));
  updateDurLabel();

  const note = document.getElementById('blockTypicalNote');
  if (note) {
    const n = taskTimesCount(t.title);
    note.hidden = typical == null;
    if (typical != null) {
      note.textContent = `Usually takes you about ${typical} min (${n} time${n === 1 ? '' : 's'} timed).`;
    }
  }

  currentUrgency = t.urgency || null;
  renderUrgencyOptions();
  currentEnergy = t.energy || null;
  renderEnergyOptions();
  currentSubtasks = (t.subtasks || []).map(st => ({ ...st }));
  renderSubtaskEditor();
  currentRepeat = (state.recurring.find(r => r.id === t.ruleId) || {}).kind || 'none';
  renderRepeatOptions();
  document.getElementById('blockDoneBtn').textContent = t.done ? 'Mark not done' : 'Mark done';
  document.getElementById('blockUnscheduleBtn').style.display = t.startMin == null ? 'none' : 'flex';
  activeBlockOpts = opts;
  openSheet('blockSheet');
}
let activeBlockOpts = {};
let currentDuration = 30;
let currentUrgency = null;

function renderUrgencyOptions() {
  const wrap = document.getElementById('urgencyOptions');
  if (!wrap.childElementCount) {
    [...URGENCIES, { id: 'none', label: 'No rush' }].forEach(u => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'urgency-opt';
      btn.dataset.urgency = u.id;
      btn.innerHTML = `<span class="dot"></span><span>${u.label}</span>`;
      btn.addEventListener('click', () => {
        currentUrgency = (u.id === 'none' || currentUrgency === u.id) ? null : u.id;
        paintUrgencyOptions();
      });
      wrap.appendChild(btn);
    });
  }
  paintUrgencyOptions();
}

function paintUrgencyOptions() {
  document.querySelectorAll('#urgencyOptions .urgency-opt').forEach(el => {
    const id = el.dataset.urgency;
    el.classList.toggle('active', id === currentUrgency || (id === 'none' && !currentUrgency));
  });
}
function updateDurLabel() {
  const b = document.getElementById('blockDurBtn');
  if (b) b.textContent = fmtDuration(currentDuration);
}

/* Duration is a scrollable hour/minute wheel — nudging a two-hour block five
   minutes at a time was the slowest control in the app. */
const TASK_HOURS = Array.from({ length: 13 }, (_, i) => i);          // 0–12 hr
const TASK_MINS = Array.from({ length: 12 }, (_, i) => i * 5);       // 0–55 in 5s
let taskHourCtrl = null, taskMinCtrl = null;

function openTaskDurationPicker() {
  const h = Math.floor(currentDuration / 60);
  const m = Math.round((currentDuration % 60) / 5) * 5;
  openSheet('taskDurationSheet');                 // must be visible to scroll
  taskHourCtrl = buildWheelColumn(document.getElementById('taskHourCol'), TASK_HOURS, v => String(v), Math.min(h, 12));
  taskMinCtrl = buildWheelColumn(document.getElementById('taskMinCol'), TASK_MINS, v => pad2(v), Math.min(m, 55));
}

on('blockDurBtn', 'click', openTaskDurationPicker);

on('taskDurationSetBtn', 'click', () => {
  const h = taskHourCtrl ? taskHourCtrl.getValue() : 0;
  const m = taskMinCtrl ? taskMinCtrl.getValue() : 0;
  currentDuration = Math.max(5, h * 60 + m);
  if (activeBlock) activeBlock.durationSet = true;   // a deliberate choice outranks the median
  updateDurLabel();
  const sheet = document.getElementById('taskDurationSheet');
  if (sheet) sheet.hidden = true;
});

on('blockSaveBtn', 'click', () => {
  if (!activeBlock) return;
  const title = document.getElementById('blockTitleInput').value.trim();
  if (title) activeBlock.title = title;
  const timeVal = document.getElementById('blockStartInput').value;
  if (timeVal) {
    activeBlock.startMin = timeToMin(timeVal);
    delete activeBlock.proposedMin;
    if (!activeBlock.date) activeBlock.date = activeBlockOpts.forceDate || currentTodayDateStr();
  } else {
    activeBlock.startMin = null;   // cleared / never set: keep it in the inbox
    delete activeBlock.proposedMin;
    if (work().auto && (activeBlock.date === todayStr() || activeBlock.date === null)) {
      const at = autoPlaceTask(activeBlock, todayStr());
      if (at != null) setTimeout(() => toast(`Scheduled for ${minToLabel(at)}`), 60);
    }
  }
  activeBlock.durationMin = currentDuration;
  activeBlock.urgency = currentUrgency;
  const step = document.getElementById('blockStepInput').value.trim();
  if (step) activeBlock.firstStep = step; else delete activeBlock.firstStep;
  const notesVal = (document.getElementById('blockNotesInput') || {}).value;
  if (notesVal && notesVal.trim()) activeBlock.notes = notesVal.trim(); else delete activeBlock.notes;
  activeBlock.energy = currentEnergy;
  activeBlock.subtasks = currentSubtasks;
  upsertRuleFromTask(activeBlock, currentRepeat);
  touchTask(activeBlock);
  saveState();
  closeSheets();
  renderAll();
});

/* Repeat picker inside the task sheet. */
let currentRepeat = 'none';
function renderRepeatOptions() {
  const wrap = document.getElementById('repeatOptions');
  if (!wrap) return;
  if (!wrap.childElementCount) {
    REPEAT_KINDS.forEach(k => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'freq-opt repeat-opt';
      btn.dataset.repeat = k.id;
      btn.textContent = k.label;
      btn.addEventListener('click', () => { currentRepeat = k.id; paintRepeatOptions(); });
      wrap.appendChild(btn);
    });
  }
  paintRepeatOptions();
}
function paintRepeatOptions() {
  document.querySelectorAll('#repeatOptions .repeat-opt').forEach(el => {
    el.classList.toggle('active', el.dataset.repeat === currentRepeat);
  });
}

/* Two ways out of the sheet that both mean "begin now": a five-minute nibble,
   or the full planned block. Either one starts immediately. */
on('blockStart5Btn', 'click', () => {
  if (!activeBlock) return;
  const step = document.getElementById('blockStepInput').value.trim();
  if (step) activeBlock.firstStep = step;
  touchTask(activeBlock);
  saveState('silent');
  startTaskTimer(activeBlock, START_SMALL_MIN);
});

on('blockStartFullBtn', 'click', () => {
  if (!activeBlock) return;
  const step = document.getElementById('blockStepInput').value.trim();
  if (step) activeBlock.firstStep = step;
  touchTask(activeBlock);
  saveState('silent');
  startTaskTimer(activeBlock, currentDuration);
});

on('blockDoneBtn', 'click', () => {
  if (!activeBlock) return;
  activeBlock.done = !activeBlock.done;
  saveState();
  closeSheets();
  renderAll();
});

on('blockUnscheduleBtn', 'click', () => {
  if (!activeBlock) return;
  activeBlock.startMin = null;
  saveState();
  closeSheets();
  renderAll();
});

on('blockDeleteBtn', 'click', () => {
  if (!activeBlock) return;
  state.tasks = state.tasks.filter(x => x.id !== activeBlock.id);
  saveState('deleting a task');
  closeSheets();
  renderAll();
});

/* ======================= How long things really take =======================
   Estimating duration is the single worst-calibrated thing an ADHD brain is
   asked to do, and a planner that only ever stores the guess never corrects it.
   Every timed task writes its real elapsed time here, keyed by title, so the
   next identical task can be pre-filled with evidence instead of optimism. */
const TASK_TIME_CAP = 20;

function taskKey(title) {
  return (title || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function recordTaskTime(title, seconds) {
  const k = taskKey(title);
  if (!k || seconds < 20) return;
  if (!state.taskTimes) state.taskTimes = {};
  const arr = state.taskTimes[k] || (state.taskTimes[k] = []);
  arr.push(seconds);
  if (arr.length > TASK_TIME_CAP) arr.shift();
}

/* Median, not mean: one afternoon where a task got abandoned mid-way shouldn't
   permanently inflate every future estimate. */
function medianTaskSec(title) {
  const arr = (state.taskTimes || {})[taskKey(title)];
  if (!arr || !arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function typicalMinutes(title) {
  const sec = medianTaskSec(title);
  if (sec == null) return null;
  return Math.max(5, Math.round(sec / 60 / 5) * 5);
}

function taskTimesCount(title) {
  const arr = (state.taskTimes || {})[taskKey(title)];
  return arr ? arr.length : 0;
}

function touchTask(t) { if (t) t.touchedAt = Date.now(); }

/* ======================= Task focus timer =======================
   Starting is the hard part, not finishing. One tap gives a five-minute
   countdown and nothing else to decide — no duration, no scheduling, no
   category. Overtime is shown rather than punished, and the elapsed time is
   recorded either way so the estimate gets better on its own. */
const START_SMALL_MIN = 5;
let taskRun = null;          // { task, goalSec, startTs, interval }
let momentumTimer = null;

function taskRunEl(id) { return document.getElementById(id); }

function startTaskTimer(t, goalMin, opts = {}) {
  if (!t) return;
  clearInterval(taskRun && taskRun.interval);
  clearInterval(momentumTimer);
  const goalSec = Math.max(60, Math.round((goalMin || START_SMALL_MIN) * 60));
  taskRun = { task: t, goalSec, startTs: opts.resumeTs || Date.now(), interval: null };
  saveLiveTimer({ kind: 'task', id: t.id, startTs: taskRun.startTs, goalSec });
  acquireWakeLock();

  taskRunEl('taskRunName').textContent = t.title;
  const stepEl = taskRunEl('taskRunStep');
  stepEl.textContent = t.firstStep ? t.firstStep : '';
  stepEl.hidden = !t.firstStep;

  const typical = typicalMinutes(t.title);
  taskRunEl('taskRunAvg').innerHTML = typical != null
    ? `Usually takes you <span class="avg-val">${typical} min</span>`
    : `Just ${Math.round(goalSec / 60)} minutes. You can stop after that.`;

  taskRunEl('taskRunNext').hidden = true;
  taskRunEl('taskRunBody').hidden = false;
  taskRunEl('taskRunOverlay').hidden = false;
  taskRunTick();
  taskRun.interval = setInterval(taskRunTick, 250);
  closeSheets();
}

function taskRunTick() {
  if (!taskRun) return;
  const elapsed = Math.round((Date.now() - taskRun.startTs) / 1000);
  const left = taskRun.goalSec - elapsed;
  const num = taskRunEl('taskRunNum');
  const over = taskRunEl('taskRunOver');
  if (left >= 0) {
    num.textContent = fmtMinSec(left);
    num.classList.remove('overtime');
    over.hidden = true;
  } else {
    num.textContent = fmtMinSec(elapsed);
    num.classList.add('overtime');
    over.hidden = false;
    over.textContent = `${fmtMinSec(-left)} past ${Math.round(taskRun.goalSec / 60)} min — that's fine, it's just data`;
  }
}

function endTaskRun(markDone) {
  if (!taskRun) return null;
  clearInterval(taskRun.interval);
  clearLiveTimer();
  const { task, goalSec } = taskRun;
  const elapsed = Math.round((Date.now() - taskRun.startTs) / 1000);
  taskRun = null;

  recordTaskTime(task.title, elapsed);
  touchTask(task);
  if (markDone) task.done = true;
  saveState(markDone ? 'finishing a task' : 'silent');

  if (elapsed >= 20) {
    const planned = task.durationMin || Math.round(goalSec / 60);
    const actualMin = Math.max(1, Math.round(elapsed / 60));
    // The estimate-vs-actual line is the whole point: seeing "you thought 15,
    // it took 35" a few times does more for planning than any advice.
    if (markDone && Math.abs(actualMin - planned) >= 5) {
      toast(`Planned ${planned} min · took ${actualMin} min`, 4200);
    } else if (markDone) {
      toast(`Done in ${fmtMinSec(elapsed)}`);
    } else {
      toast(`${fmtMinSec(elapsed)} logged — progress counts`);
    }
  }
  return { task, elapsed, markDone };
}

/* Momentum: the gap between finishing one thing and starting the next is where
   an hour disappears. Offer the next task immediately, with an easy out. */
function nextInboxTask(afterId) {
  const ds = currentTodayDateStr();
  return state.tasks
    .filter(t => !t.done && !t.someday && t.id !== afterId && (t.date === ds || t.date === null))
    .sort((a, b) => (urgencyRank(a.urgency) - urgencyRank(b.urgency)) || (a.createdAt - b.createdAt))[0] || null;
}

function offerMomentum(prevId) {
  const next = state.settings.momentum ? nextInboxTask(prevId) : null;
  if (!next) { closeTaskRun(); return; }
  taskRunEl('taskRunBody').hidden = true;
  taskRunEl('taskRunNext').hidden = false;
  taskRunEl('taskRunNextTitle').textContent = next.title;
  let n = 10;
  const countEl = taskRunEl('taskRunNextCount');
  countEl.textContent = `Starting in ${n}…`;
  clearInterval(momentumTimer);
  momentumTimer = setInterval(() => {
    n--;
    if (n <= 0) {
      clearInterval(momentumTimer);
      startTaskTimer(next, START_SMALL_MIN);
    } else {
      countEl.textContent = `Starting in ${n}…`;
    }
  }, 1000);
  taskRunEl('taskRunNextGoBtn').onclick = () => { clearInterval(momentumTimer); startTaskTimer(next, START_SMALL_MIN); };
  taskRunEl('taskRunNextSkipBtn').onclick = () => { clearInterval(momentumTimer); closeTaskRun(); renderAll(); };
}

function closeTaskRun() {
  clearInterval(momentumTimer);
  if (taskRun) clearInterval(taskRun.interval);
  taskRun = null;
  clearLiveTimer();
  if (!anyTimerRunning()) releaseWakeLock();
  const ov = taskRunEl('taskRunOverlay');
  if (ov) ov.hidden = true;
  const nx = taskRunEl('taskRunNext');
  if (nx) nx.hidden = true;
  const bd = taskRunEl('taskRunBody');
  if (bd) bd.hidden = false;
}

on('taskRunDoneBtn', 'click', () => {
  const res = endTaskRun(true);
  renderAll();
  if (res) offerMomentum(res.task.id); else closeTaskRun();
});
on('taskRunKeepBtn', 'click', () => {
  if (!taskRun) return;
  taskRun.goalSec += 5 * 60;
  taskRunTick();
  toast('Five more minutes');
});
on('taskRunStopBtn', 'click', () => { endTaskRun(false); closeTaskRun(); renderAll(); });
on('taskRunCloseBtn', 'click', () => { endTaskRun(false); closeTaskRun(); renderAll(); });

/* ======================= Ambient time bar =======================
   "You have 40 minutes" is a number; a bar that visibly empties is a feeling.
   Time blindness responds to the second one. */
function renderTimeBar() {
  const bar = document.getElementById('timeBar');
  if (!bar) return;
  if (!state.settings.timeBar || state.view.current !== 'today') { bar.hidden = true; return; }

  const ds = todayStr();
  if (currentTodayDateStr() !== ds) { bar.hidden = true; return; }

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const blocks = state.tasks
    .filter(t => t.date === ds && t.startMin != null && !t.done)
    .sort((a, b) => a.startMin - b.startMin);

  const current = blocks.find(b => b.startMin <= nowMin && nowMin < b.startMin + (b.durationMin || 30));
  const next = blocks.find(b => b.startMin > nowMin);

  let pct = 0, label = '', tone = '';
  if (current) {
    const dur = current.durationMin || 30;
    const left = Math.max(0, current.startMin + dur - nowMin);
    pct = Math.min(1, (nowMin - current.startMin) / dur);
    label = `${Math.ceil(left)} min left · ${current.title}`;
    tone = left <= 5 ? 'urgent' : 'active';
  } else if (next) {
    const gapStart = blocks.filter(b => b.startMin + (b.durationMin || 30) <= nowMin)
      .reduce((m, b) => Math.max(m, b.startMin + (b.durationMin || 30)), Math.max(0, nowMin - 120));
    const span = Math.max(1, next.startMin - gapStart);
    pct = Math.min(1, Math.max(0, (nowMin - gapStart) / span));
    const until = Math.ceil(next.startMin - nowMin);
    label = `${until} min until ${next.title}`;
    tone = until <= 5 ? 'urgent' : '';
  } else {
    bar.hidden = true;
    return;
  }

  bar.hidden = false;
  bar.className = 'time-bar' + (tone ? ' ' + tone : '');
  document.getElementById('timeBarFill').style.width = (pct * 100).toFixed(1) + '%';
  document.getElementById('timeBarLabel').textContent = label;
}

/* ======================= Stale task decay =======================
   An inbox nobody can triage becomes a source of guilt rather than a tool.
   Anything untouched for three weeks steps aside on its own — still there,
   just not in the way, and restorable in one tap. */
const STALE_DAYS = 21;

function sweepStaleTasks() {
  if (!state.settings.autoDecay) return 0;
  const cutoff = Date.now() - STALE_DAYS * 86400000;
  let moved = 0;
  state.tasks.forEach(t => {
    if (t.done || t.someday || t.startMin != null) return;
    if ((t.touchedAt || t.createdAt || 0) < cutoff) { t.someday = true; moved++; }
  });
  if (moved) saveState('silent');
  return moved;
}

function somedayTasks() { return state.tasks.filter(t => t.someday && !t.done); }

function renderSomedaySheet() {
  const wrap = document.getElementById('somedayList');
  if (!wrap) return;
  const items = somedayTasks();
  wrap.innerHTML = '';
  if (!items.length) {
    wrap.innerHTML = '<p class="settings-note" style="text-align:left;">Nothing here. Tasks land in Someday once they have sat untouched for three weeks.</p>';
    return;
  }
  items.forEach(t => {
    const row = document.createElement('div');
    row.className = 'someday-row';
    row.innerHTML = `<span class="sd-title">${escapeHtml(t.title)}</span>
      <button type="button" class="pill-btn small" data-act="back">Bring back</button>
      <button type="button" class="pill-btn small danger" data-act="del" aria-label="Delete">${icon('trash', 15)}</button>`;
    row.querySelector('[data-act="back"]').addEventListener('click', () => {
      t.someday = false;
      t.date = currentTodayDateStr();
      touchTask(t);
      saveState('bringing a task back');
      renderSomedaySheet();
      renderAll();
      toast('Back in your inbox');
    });
    row.querySelector('[data-act="del"]').addEventListener('click', () => {
      state.tasks = state.tasks.filter(x => x.id !== t.id);
      saveState('deleting a task');
      renderSomedaySheet();
      renderAll();
    });
    wrap.appendChild(row);
  });
}

function openSomeday() { renderSomedaySheet(); openSheet('somedaySheet'); }

/* ======================= Carry forward =======================
   Re-dating yesterday's leftovers one at a time is exactly the kind of
   administrative tax that makes people abandon a planner. */
function overdueTasks() {
  const ds = todayStr();
  return state.tasks.filter(t => !t.done && !t.someday && t.date && t.date < ds);
}

function carryForward() {
  const items = overdueTasks();
  if (!items.length) return;
  const ds = currentTodayDateStr();
  items.forEach(t => { t.date = ds; t.startMin = null; touchTask(t); });
  saveState('carrying tasks forward');
  renderAll();
  toast(`${items.length} task${items.length === 1 ? '' : 's'} moved to today`);
}

/* ======================= Day recap =======================
   ADHD memory badly under-credits the day; by evening the six things that got
   done are invisible and only the undone ones are loud. This counts them. */
function buildRecap(ds) {
  const tasksDone = state.tasks.filter(t => t.done && t.date === ds);
  const habitsDone = state.habits.filter(h => habitCount(h, ds) > 0)
    .map(h => ({ name: h.name, n: habitCount(h, ds), target: habitTarget(h) }));
  const practiceSec = state.habits.reduce((a, h) =>
    a + (h.sessions || []).filter(s => s.date === ds).reduce((x, s) => x + s.seconds, 0), 0);
  const left = state.tasks.filter(t => !t.done && !t.someday && t.date === ds).length;
  return { tasksDone, habitsDone, practiceSec, left };
}

function openRecap() {
  const ds = todayStr();
  const r = buildRecap(ds);
  const wrap = document.getElementById('recapBody');
  const count = r.tasksDone.length + r.habitsDone.length;

  let html = `<div class="recap-hero"><div class="rh-num">${count}</div><div class="rh-lbl">${count === 1 ? 'thing done today' : 'things done today'}</div></div>`;

  if (r.tasksDone.length) {
    html += '<div class="section-label" style="padding-left:0">Tasks</div><div class="recap-list">';
    r.tasksDone.forEach(t => { html += `<div class="recap-row">${icon('check', 15, { strokeWidth: 2.4 })}<span>${escapeHtml(t.title)}</span></div>`; });
    html += '</div>';
  }
  if (r.habitsDone.length) {
    html += '<div class="section-label" style="padding-left:0">Habits</div><div class="recap-list">';
    r.habitsDone.forEach(h => {
      html += `<div class="recap-row">${icon('target', 15)}<span>${escapeHtml(h.name)}${h.target > 1 ? ` · ${h.n}/${h.target}` : ''}</span></div>`;
    });
    html += '</div>';
  }
  if (r.practiceSec > 0) {
    html += `<div class="recap-note">${fmtMinSec(r.practiceSec)} of timed practice logged.</div>`;
  }
  if (!count) {
    html = `<div class="recap-hero"><div class="rh-num">—</div><div class="rh-lbl">Quiet day. That happens, and tomorrow is untouched.</div></div>`;
  }
  if (r.left) {
    html += `<div class="recap-note">${r.left} still open — they roll over, nothing is lost.</div>`;
  }
  wrap.innerHTML = html;
  openSheet('recapSheet');
}

/* The recap is a nice moment, not an interruption. It waits for a natural
   pause — the app opening, or coming back to the foreground — and never
   appears over an open sheet or a running timer, which is how it ended up
   landing on top of somebody mid-swipe. */
const LAUNCHED_AT = Date.now();
let recapWindowOpen = true;
setTimeout(() => { recapWindowOpen = false; }, 90000);

function anythingOpen() {
  if ([...document.querySelectorAll('.sheet')].some(s => !s.hidden)) return true;
  const overlays = ['routineRunOverlay', 'choreRunOverlay', 'habitRunOverlay', 'taskRunOverlay', 'tourOverlay'];
  return overlays.some(id => { const el = document.getElementById(id); return el && !el.hidden; });
}

function maybeAutoRecap() {
  if (state.settings.lastRecapDate === todayStr()) return;
  const h = new Date().getHours();
  if (h < 21) return;
  if (!recapWindowOpen) return;         // only near a launch or a return to the app
  if (anythingOpen()) return;           // never over something the user is doing
  const r = buildRecap(todayStr());
  if (!r.tasksDone.length && !r.habitsDone.length) return;   // nothing to celebrate, don't nag
  state.settings.lastRecapDate = todayStr();
  saveState('silent');
  openRecap();
}

/* ======================= Undo bar =======================
   The little header button is easy to miss in the second after a mis-tap, so
   an undoable action also parks a labelled bar within thumb reach. */
let undoBarTimer = null;
function showUndoBar(label) {
  const bar = document.getElementById('undoBar');
  if (!bar) return;
  document.getElementById('undoBarLabel').textContent = label ? `Undo ${label}` : 'Undo last change';
  bar.hidden = false;
  // Lift the toast clear of the bar, or the two land on top of each other and
  // neither is readable.
  document.body.classList.add('undo-open');
  clearTimeout(undoBarTimer);
  undoBarTimer = setTimeout(() => { bar.hidden = true; document.body.classList.remove('undo-open'); }, 12000);
}
function hideUndoBar() {
  const bar = document.getElementById('undoBar');
  clearTimeout(undoBarTimer);
  if (bar) bar.hidden = true;
  document.body.classList.remove('undo-open');
}
on('undoBarBtn', 'click', () => { undoLast(); hideUndoBar(); });
on('undoBarClose', 'click', hideUndoBar);

/* ======================= Quick add ======================= */
let quickAddMode = 'task'; // 'task' | 'habit'

function setQuickAddMode(mode) {
  quickAddMode = mode;
  const btn = document.getElementById('quickAddModeBtn');
  const input = document.getElementById('quickAddInput');
  if (mode === 'habit') {
    btn.innerHTML = icon('target', 20);
    btn.classList.add('habit-mode');
    input.placeholder = 'New daily habit…';
  } else {
    btn.innerHTML = icon('check', 20);
    btn.classList.remove('habit-mode');
    input.placeholder = 'Add a task…';
  }
}

on('quickAddModeBtn', 'click', () => {
  setQuickAddMode(quickAddMode === 'task' ? 'habit' : 'task');
});

/* Thoughts arrive in bursts, not one at a time. Pasting or dictating a list
   creates one task per line instead of a single unusable blob. */
function splitLines(raw) {
  return raw
    .split(/[\r\n]+/)
    .map(s => s.trim().replace(/^[-•*–]\s*/, '').replace(/^\d{1,2}[.)]\s+/, '').trim())
    .filter(Boolean);
}

/* A text input silently strips newlines from its value, so a *typed* burst
   can't arrive as lines — semicolons are the one separator people actually
   reach for mid-flow. Pasting is handled separately, where the clipboard still
   carries the real line breaks. */
function splitTyped(raw) {
  if (!raw.includes(';')) return [raw];
  const parts = raw.split(';').map(s => s.trim()).filter(Boolean);
  return parts.length >= 2 && parts.every(s => s.length >= 2) ? parts : [raw];
}

function addTasksBulk(lines) {
  const dateForNew = state.view.current === 'today' ? currentTodayDateStr() : null;
  lines.forEach(line => {
    const parsed = extractTimeFromTitle(line);
    state.tasks.push({
      id: uid(),
      title: parsed ? parsed.title : line,
      date: parsed ? (dateForNew || todayStr()) : dateForNew,
      startMin: null,
      proposedMin: parsed ? parsed.startMin : undefined,
      durationMin: typicalMinutes(parsed ? parsed.title : line) || 30,
      done: false,
      someday: false,
      createdAt: Date.now(),
      touchedAt: Date.now(),
    });
  });
  saveState('adding tasks');
  renderAll();
  toast(`${lines.length} tasks captured`);
}

on('quickAddInput', 'paste', (e) => {
  if (state.view.current === 'chat' || quickAddMode === 'habit') return;
  const text = (e.clipboardData || window.clipboardData || {}).getData
    ? (e.clipboardData || window.clipboardData).getData('text')
    : '';
  const lines = splitLines(text || '');
  if (lines.length < 2) return;                 // a normal paste behaves normally
  e.preventDefault();
  document.getElementById('quickAddInput').value = '';
  addTasksBulk(lines);
});

on('quickAddForm', 'submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('quickAddInput');
  const title = input.value.trim();
  if (!title) return;

  if (state.view.current === 'chat') {
    input.value = '';
    handleChatInput(title);
    return;
  }

  if (quickAddMode === 'habit') {
    state.habits.push({ id: uid(), name: title, freq: { type: 'daily' }, completions: {}, sessions: [], dailyTarget: 1, timed: false });
    saveState();
    input.value = '';
    setQuickAddMode('task');
    renderAll();
    toast('Habit added — tracking starts today');
    return;
  }

  const multi = title.includes('\n') ? splitLines(title) : splitTyped(title);
  if (multi.length > 1) {
    input.value = '';
    addTasksBulk(multi);
    return;
  }

  const parsed = extractTimeFromTitle(title);
  const dateForNew = state.view.current === 'today' ? currentTodayDateStr() : null;

  if (parsed) {
    // Capture stays capture: a stated time is remembered as a suggestion, but
    // the task still lands in the inbox so nothing is scheduled behind your back.
    state.tasks.push({ id: uid(), title: parsed.title, date: dateForNew || todayStr(),
      startMin: null, proposedMin: parsed.startMin, durationMin: typicalMinutes(parsed.title) || 30,
      done: false, someday: false, createdAt: Date.now(), touchedAt: Date.now() });
    input.value = '';
    saveState();
    renderAll();
    toast(`In your inbox — tap ${minToLabel(parsed.startMin)} to schedule it`, 3000);
    return;
  }

  const fresh = { id: uid(), title, date: dateForNew, startMin: null,
    durationMin: typicalMinutes(title) || 30, done: false, someday: false,
    createdAt: Date.now(), touchedAt: Date.now() };
  state.tasks.push(fresh);
  input.value = '';
  saveState();
  const at = maybeAutoPlace(fresh);
  renderAll();
  toast(at != null ? `Scheduled for ${minToLabel(at)}` : 'Added to inbox');
});

/* ======================= Render: Week ======================= */
function renderWeek() {
  const base = addDays(startOfWeek(new Date()), state.view.weekOffset * 7);
  const end = addDays(base, 6);
  document.getElementById('weekRangeLabel').textContent = `${MON[base.getMonth()]} ${base.getDate()} – ${MON[end.getMonth()]} ${end.getDate()}`;

  const grid = document.getElementById('weekGrid');
  grid.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(base, i);
    const ds = dateStr(d);
    const isToday = ds === todayStr();
    const dayEl = document.createElement('div');
    dayEl.className = 'week-day' + (isToday ? ' is-today' : '');
    dayEl.dataset.date = ds;
    dayEl.innerHTML = `<div class="week-day-head"><span class="wd-name">${WD[d.getDay()]}</span><span class="wd-date">${MON[d.getMonth()]} ${d.getDate()}</span></div>`;
    const blocksWrap = document.createElement('div');
    blocksWrap.className = 'week-blocks';
    blocksWrap.dataset.date = ds;
    const dayTasks = state.tasks.filter(t => t.date === ds && t.startMin != null).sort((a, b) => a.startMin - b.startMin);
    dayTasks.forEach(t => {
      const b = document.createElement('div');
      b.className = 'week-block' + (t.done ? ' done' : '');
      b.dataset.id = t.id;
      b.innerHTML = `<span class="wt">${minToLabel(t.startMin).replace(' ', '')}</span><span>${escapeHtml(t.title)}</span>`;
      b.addEventListener('click', () => { if (!b._wasDragged) openBlockSheet(t); b._wasDragged = false; });
      makeWeekBlockDraggable(b, t);
      blocksWrap.appendChild(b);
    });
    dayEl.appendChild(blocksWrap);
    grid.appendChild(dayEl);
  }
}

function makeWeekBlockDraggable(el, t) {
  let dragging = false, startX = 0, startY = 0, ghost = null;
  el.addEventListener('pointerdown', (e) => {
    startX = e.clientX; startY = e.clientY;
    const onMove = (ev) => {
      if (!dragging && (Math.abs(ev.clientX - startX) > 8 || Math.abs(ev.clientY - startY) > 8)) {
        dragging = true;
        el.classList.add('dragging');
        ghost = el.cloneNode(true);
        ghost.style.position = 'fixed';
        ghost.style.width = el.getBoundingClientRect().width + 'px';
        ghost.style.zIndex = 100;
        ghost.style.pointerEvents = 'none';
        ghost.style.opacity = '0.9';
        document.body.appendChild(ghost);
      }
      if (dragging) {
        ghost.style.left = (ev.clientX - ghost.offsetWidth / 2) + 'px';
        ghost.style.top = (ev.clientY - 16) + 'px';
        document.querySelectorAll('.week-day').forEach(d => d.classList.remove('drop-target'));
        const target = document.elementFromPoint(ev.clientX, ev.clientY);
        const dayEl = target && target.closest('.week-day');
        if (dayEl) dayEl.classList.add('drop-target');
      }
    };
    const onUp = (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.querySelectorAll('.week-day').forEach(d => d.classList.remove('drop-target'));
      if (dragging) {
        el._wasDragged = true;
        if (ghost) ghost.remove();
        el.classList.remove('dragging');
        const target = document.elementFromPoint(ev.clientX, ev.clientY);
        const dayEl = target && target.closest('.week-day');
        if (dayEl && dayEl.dataset.date !== t.date) {
          t.date = dayEl.dataset.date;
          saveState();
          renderAll();
          toast('Moved to ' + dayEl.dataset.date);
        }
      }
      dragging = false;
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
}

on('todayPrev', 'click', () => { state.view.todayOffset--; renderAll(); });
on('todayNext', 'click', () => { state.view.todayOffset++; renderAll(); });
on('weekPrev', 'click', () => { state.view.weekOffset--; renderAll(); });
on('weekNext', 'click', () => { state.view.weekOffset++; renderAll(); });

/* ======================= Habits ======================= */
function habitFreqLabel(h) {
  const base = h.freq.type === 'daily' ? 'Daily' : `${h.freq.count}× / week`;
  const t = habitTarget(h);
  return t > 1 ? `${base} · ${t}× a day` : base;
}

function habitTarget(h) { return Math.max(1, h.dailyTarget || 1); }
function habitCount(h, ds) {
  const v = h.completions[ds];
  return typeof v === 'number' ? v : (v ? 1 : 0);
}
// "Done" still means the day's goal was met, so streaks work unchanged.
function habitDoneOn(h, ds) { return habitCount(h, ds) >= habitTarget(h); }

function bumpHabit(h, ds, delta) {
  const next = Math.max(0, habitCount(h, ds) + delta);
  if (next === 0) delete h.completions[ds];
  else h.completions[ds] = next;
  saveState();
  return next;
}

/* A forty-day streak wiped by one bad day is the moment people delete the app,
   and the all-or-nothing framing is exactly backwards for ADHD: the miss was
   never a choice. One free miss per rolling week keeps the streak alive without
   making it meaningless — two misses in a week still ends it. */
function graceEnabled() { return state.settings.graceDays !== false; }

// How many of the last N days the habit was actually done. Shown next to the
// streak so a miss cannot erase the evidence of everything else.
function showedUpCount(h, days) {
  let n = 0;
  for (let i = 0; i < days; i++) if (habitDoneOn(h, dateStr(addDays(new Date(), -i)))) n++;
  return n;
}

// True when the current streak is only alive because a grace day absorbed a miss.
function streakUsedGrace(h) {
  return h.freq.type === 'daily' && graceEnabled() && computeStreak(h) > computeStreakStrict(h);
}

function computeStreakStrict(h) {
  if (h.freq.type !== 'daily') return computeStreak(h);
  let streak = 0;
  let d = new Date();
  if (!habitDoneOn(h, todayStr())) d = addDays(d, -1);
  while (habitDoneOn(h, dateStr(d))) { streak++; d = addDays(d, -1); }
  return streak;
}

function computeStreak(h) {
  // current streak: consecutive qualifying periods up to today with completion
  let streak = 0;
  if (h.freq.type === 'daily') {
    let d = new Date();
    // if today not done yet, streak counts up to yesterday
    if (!habitDoneOn(h, todayStr())) d = addDays(d, -1);
    let graceAt = null;          // how many days back the free miss was spent
    for (let scanned = 0; scanned < 400; scanned++) {
      if (habitDoneOn(h, dateStr(d))) { streak++; d = addDays(d, -1); continue; }
      // A miss. Spend the week's grace on it if it is available, otherwise stop.
      if (!graceEnabled()) break;
      if (graceAt !== null && scanned - graceAt < 7) break;
      if (streak === 0) break;   // nothing to protect yet
      graceAt = scanned;
      d = addDays(d, -1);
    }
  } else {
    // weekly: count consecutive weeks meeting count threshold
    let weekStart = startOfWeek(new Date());
    // check current week partial - only count if already met threshold
    const countInWeek = (ws) => {
      let c = 0;
      for (let i = 0; i < 7; i++) if (habitDoneOn(h, dateStr(addDays(ws, i)))) c++;
      return c;
    };
    if (countInWeek(weekStart) < h.freq.count) weekStart = addDays(weekStart, -7);
    while (countInWeek(weekStart) >= h.freq.count) { streak++; weekStart = addDays(weekStart, -7); }
  }
  return streak;
}

function computeLongestStreak(h) {
  // scan last 400 days
  let longest = 0;
  if (h.freq.type === 'daily') {
    let cur = 0;
    for (let i = 400; i >= 0; i--) {
      const ds = dateStr(addDays(new Date(), -i));
      if (habitDoneOn(h, ds)) { cur++; longest = Math.max(longest, cur); }
      else cur = 0;
    }
  } else {
    let cur = 0;
    let ws = addDays(startOfWeek(new Date()), -56 * 7);
    for (let w = 0; w < 57; w++) {
      let c = 0;
      for (let i = 0; i < 7; i++) if (habitDoneOn(h, dateStr(addDays(ws, i)))) c++;
      if (c >= h.freq.count) { cur++; longest = Math.max(longest, cur); } else cur = 0;
      ws = addDays(ws, 7);
    }
  }
  return longest;
}

/* ---------- Habit practice stats ---------- */
function habitPR(h) {
  if (!h.sessions || !h.sessions.length) return null;
  return h.sessions.reduce((m, s) => Math.max(m, s.seconds), 0);
}
function habitAvgSession(h) {
  if (!h.sessions || !h.sessions.length) return null;
  return Math.round(h.sessions.reduce((a, s) => a + s.seconds, 0) / h.sessions.length);
}
function habitTotalPracticeSeconds(h) {
  return (h.sessions || []).reduce((a, s) => a + s.seconds, 0);
}
function habitSessionsInRange(h, days) {
  const cutoff = dateStr(addDays(new Date(), -days));
  return (h.sessions || []).filter(s => s.date >= cutoff);
}

/* Effort is the honest headline number — "showed up 23 of the last 30 days"
   survives a bad week in a way a reset streak counter never does. */
function showedUpLine(h) {
  const n = showedUpCount(h, 30);
  if (!n) return 'No days logged yet — the first one is the whole trick.';
  const grace = streakUsedGrace(h) ? ' · a grace day is holding your streak' : '';
  return `Showed up <strong>${n}</strong> of the last 30 days${grace}`;
}

function renderHabits() {
  const list = document.getElementById('habitsList');
  list.innerHTML = '';
  const live = state.habits.filter(h => !h.archived);
  document.getElementById('habitsCount').textContent = live.length;
  const ds = todayStr();
  live.forEach(h => {
    const card = document.createElement('div');
    card.className = 'habit-card';
    const done = habitDoneOn(h, ds);
    const streak = computeStreak(h);
    const pr = habitPR(h);
    const avg = habitAvgSession(h);
    card.innerHTML = `
      <div class="habit-top">
        <div class="habit-check ${done ? 'checked' : ''}">${habitCheckInner(h, ds)}</div>
        <div class="habit-info">
          <div class="habit-name">${escapeHtml(h.name)}</div>
          <div class="habit-freq">${habitFreqLabel(h)}</div>
        </div>
        ${h.timed ? `<button type="button" class="habit-practice-btn" aria-label="Time a practice session">${icon('play', 15, {fill:true, strokeWidth:0})}</button>` : ''}
        <div class="habit-streak">
          <div class="n">${streak}</div>
          <div class="lbl">streak</div>
        </div>
      </div>
      <div class="heatmap" data-id="${h.id}"></div>
      <div class="habit-showed">${showedUpLine(h)}</div>
      ${h.timed && pr != null ? `<div class="habit-practice-meta">${icon('trophy', 13)} PR <span class="pr">${fmtMinSec(pr)}</span> · avg ${fmtMinSec(avg)} · total ${fmtMinSec(habitTotalPracticeSeconds(h))}</div>` : ''}
    `;
    const checkEl = card.querySelector('.habit-check');
    const refresh = () => {
      checkEl.classList.toggle('checked', habitDoneOn(h, ds));
      checkEl.innerHTML = habitCheckInner(h, ds);
      checkEl.classList.add('pop');
      setTimeout(() => checkEl.classList.remove('pop'), 320);
      const nEl = card.querySelector('.n');
      nEl.textContent = computeStreak(h);
      nEl.classList.add('tick');
      setTimeout(() => nEl.classList.remove('tick'), 320);
      const showed = card.querySelector('.habit-showed');
      if (showed) showed.innerHTML = showedUpLine(h);
      renderHeatmap(card.querySelector('.heatmap'), h);
    };

    // Tap always moves forward; press-and-hold takes one back.
    let held = false, holdTimer = null;
    checkEl.addEventListener('pointerdown', () => {
      held = false;
      holdTimer = setTimeout(() => {
        held = true;
        if (habitCount(h, ds) > 0) {
          bumpHabit(h, ds, -1);
          refresh();
          toast(habitTarget(h) > 1 ? `Removed one — ${habitCount(h, ds)}/${habitTarget(h)} today` : 'Unchecked');
        }
      }, 500);
    });
    const cancelHold = () => clearTimeout(holdTimer);
    checkEl.addEventListener('pointerup', cancelHold);
    checkEl.addEventListener('pointerleave', cancelHold);
    checkEl.addEventListener('pointercancel', cancelHold);

    checkEl.addEventListener('click', () => {
      if (held) { held = false; return; }
      const target = habitTarget(h);
      if (target === 1 && habitCount(h, ds) >= 1) bumpHabit(h, ds, -1);  // single-target stays a toggle
      else bumpHabit(h, ds, 1);
      refresh();
      const now = habitCount(h, ds);
      if (target > 1 && now === target) toast(`${h.name} complete for today`);
      else if (target > 1 && now > 0) toast(`${now}/${target} today`);
    });
    card.querySelector('.habit-name').addEventListener('click', () => openHabitSheet(h));
    const practiceBtn = card.querySelector('.habit-practice-btn');
    if (practiceBtn) practiceBtn.addEventListener('click', () => startHabitTimer(h));
    list.appendChild(card);
    renderHeatmap(card.querySelector('.heatmap'), h);
  });
}

/* Single-target habits show a tick; multi-target ones become a counter with a
   ring that fills as the day's tally climbs. */
function habitCheckInner(h, ds) {
  const target = habitTarget(h);
  if (target === 1) return icon('check', 19, { strokeWidth: 2.4 });
  const count = habitCount(h, ds);
  const pct = Math.min(1, count / target) * 360;
  return `<span class="hc-ring" style="background: conic-gradient(var(--accent) ${pct}deg, transparent 0deg)"></span>` +
         `<span class="hc-count">${count}<span class="hc-target">/${target}</span></span>`;
}

/* One box per day of the current month, laid out as a calendar so an unbroken
   run reads as a literal chain and a gap is impossible to miss. */
function renderHeatmap(container, h) {
  container.innerHTML = '';
  const today = new Date();
  const year = today.getFullYear(), month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();   // 0 = Sunday
  const leading = (firstWeekday + 6) % 7;                   // grid starts Monday
  const target = habitTarget(h);
  const todayDate = today.getDate();

  const head = document.createElement('div');
  head.className = 'month-grid month-head';
  ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach(d => {
    const c = document.createElement('div');
    c.className = 'month-dow';
    c.textContent = d;
    head.appendChild(c);
  });
  container.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'month-grid';

  for (let i = 0; i < leading; i++) {
    const pad = document.createElement('div');
    pad.className = 'month-cell pad';
    grid.appendChild(pad);
  }

  let hit = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = dateStr(new Date(year, month, d));
    const count = habitCount(h, ds);
    const cell = document.createElement('div');
    cell.className = 'month-cell';
    if (count > 0) {
      cell.classList.add('on');
      hit++;
      if (count < target) cell.style.opacity = String(0.35 + 0.5 * (count / target));
    }
    if (d === todayDate) cell.classList.add('today');
    if (d > todayDate) cell.classList.add('future');
    cell.title = `${MON[month]} ${d}${target > 1 ? ` — ${count}/${target}` : ''}`;
    grid.appendChild(cell);
  }
  container.appendChild(grid);

  const caption = document.createElement('div');
  caption.className = 'month-caption';
  const streak = computeStreak(h);
  const remaining = daysInMonth - todayDate;
  caption.innerHTML = `<span>${MON[month]} · ${hit}/${daysInMonth} days</span>` +
    (streak > 1
      // Loss framing ("don't break it") turns a good run into something to be
      // anxious about, which is the opposite of what keeps people going.
      ? `<span class="chain">${streak} in a row</span>`
      : `<span class="chain quiet">${remaining} day${remaining === 1 ? '' : 's'} left this month</span>`);
  container.appendChild(caption);
}

on('addHabitBtn', 'click', () => openHabitSheet(null));

let activeHabit = null;
let habitFreqType = 'daily';
let habitFreqCount = 3;
let habitDailyTarget = 1;
let habitTimed = false;

function openHabitSheet(h) {
  activeHabit = h;
  document.getElementById('habitNameInput').value = h ? h.name : '';
  habitFreqType = h ? h.freq.type : 'daily';
  habitFreqCount = h && h.freq.type === 'weekly' ? h.freq.count : 3;
  habitDailyTarget = h ? habitTarget(h) : 1;
  habitTimed = h ? !!h.timed : false;
  updateFreqUI();
  document.getElementById('habitDeleteBtn').hidden = !h;
  const clearBtn = document.getElementById('habitClearRecordsBtn');
  const hasRecords = !!(h && h.sessions && h.sessions.length);
  clearBtn.hidden = !hasRecords;
  if (hasRecords) clearBtn.textContent = `Clear ${h.sessions.length} record${h.sessions.length === 1 ? '' : 's'}`;
  renderSessionLog();
  openSheet('habitSheet');
}

/* ======================= Practice log =======================
   A timer only captures the practice you happened to do with the phone in
   front of you. Half an hour on the guitar last night, a run without your
   phone, a session you forgot to start — if those can't be entered by hand,
   the records are quietly wrong and the stats stop meaning anything. */
function renderSessionLog() {
  const block = document.getElementById('sessionLogBlock');
  const list = document.getElementById('sessionLogList');
  if (!block || !list) return;
  block.hidden = !activeHabit;
  if (!activeHabit) return;

  const sessions = (activeHabit.sessions || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  list.innerHTML = '';
  if (!sessions.length) {
    list.innerHTML = '<p class="settings-note" style="text-align:left;margin:0 0 8px;">No sessions yet. Time one with the play button, or add one you already did.</p>';
    return;
  }
  sessions.slice(0, 8).forEach(s => {
    const row = document.createElement('div');
    row.className = 'session-row';
    const d = s.date === todayStr() ? 'Today' : s.date;
    row.innerHTML = `<span class="sess-date">${escapeHtml(d)}</span><span class="sess-dur">${fmtMinSec(s.seconds)}</span>
      <button type="button" class="st-del" aria-label="Delete this session">${icon('x', 15)}</button>`;
    row.querySelector('.st-del').addEventListener('click', () => {
      const i = activeHabit.sessions.indexOf(s);
      if (i >= 0) activeHabit.sessions.splice(i, 1);
      saveState('deleting a session');
      renderSessionLog();
      renderAll();
    });
    list.appendChild(row);
  });
  if (sessions.length > 8) {
    const more = document.createElement('p');
    more.className = 'settings-note';
    more.style.cssText = 'text-align:left;margin:2px 0 0;';
    more.textContent = `…and ${sessions.length - 8} older. Stats has the totals.`;
    list.appendChild(more);
  }
}

const SESSION_HOURS = Array.from({ length: 13 }, (_, i) => i);
const SESSION_MINS = Array.from({ length: 60 }, (_, i) => i);
let sessionHourCtrl = null, sessionMinCtrl = null, sessionAlsoCheck = true;

function openSessionSheet() {
  if (!activeHabit) return;
  document.getElementById('sessionDateInput').value = todayStr();
  sessionAlsoCheck = true;
  paintSessionCheckToggle();
  document.getElementById('sessionHabitName').textContent = activeHabit.name;
  openSheet('sessionSheet');                       // visible first, or the wheels can't scroll
  sessionHourCtrl = buildWheelColumn(document.getElementById('sessionHourCol'), SESSION_HOURS, v => String(v), 0);
  sessionMinCtrl = buildWheelColumn(document.getElementById('sessionMinCol'), SESSION_MINS, v => pad2(v), 30);
}

function paintSessionCheckToggle() {
  const b = document.getElementById('sessionCheckToggle');
  if (!b) return;
  b.textContent = sessionAlsoCheck ? 'Yes' : 'No';
  b.classList.toggle('active', sessionAlsoCheck);
}

on('sessionCheckToggle', 'click', () => { sessionAlsoCheck = !sessionAlsoCheck; paintSessionCheckToggle(); });
on('addSessionBtn', 'click', openSessionSheet);

on('sessionSaveBtn', 'click', () => {
  if (!activeHabit) return;
  const h = sessionHourCtrl ? sessionHourCtrl.getValue() : 0;
  const m = sessionMinCtrl ? sessionMinCtrl.getValue() : 0;
  const seconds = h * 3600 + m * 60;
  if (seconds < 60) { toast('Give it at least a minute'); return; }
  const date = document.getElementById('sessionDateInput').value || todayStr();
  if (date > todayStr()) { toast('That day hasn’t happened yet'); return; }

  if (!activeHabit.sessions) activeHabit.sessions = [];
  activeHabit.sessions.push({ date, seconds, manual: true });
  // A logged session implies the habit is one worth timing; turning the timer
  // on keeps the card and the practice stats consistent with the record.
  if (!activeHabit.timed) { activeHabit.timed = true; habitTimed = true; updateFreqUI(); }
  if (sessionAlsoCheck && habitCount(activeHabit, date) < habitTarget(activeHabit)) {
    activeHabit.completions[date] = habitCount(activeHabit, date) + 1;
  }
  saveState('logging a practice session');

  const h2 = activeHabit;                          // closeSheets() clears activeHabit
  const pr = habitPR(h2);
  const isPr = pr === seconds && h2.sessions.length > 1;
  closeSheets();
  openHabitSheet(h2);                              // straight back to the habit, log updated
  renderAll();
  toast(isPr ? `${fmtMinSec(seconds)} logged — that's a new personal best`
             : `${fmtMinSec(seconds)} logged for ${date === todayStr() ? 'today' : date}`, 3500);
});

function updateFreqUI() {
  document.querySelectorAll('#freqOptions .freq-opt').forEach(b => b.classList.toggle('active', b.dataset.freq === habitFreqType));
  const row = document.getElementById('freqCountRow');
  if (row) row.hidden = habitFreqType !== 'weekly';
  const fc = document.getElementById('freqCountLabel');
  if (fc) fc.textContent = habitFreqCount;
  const tl = document.getElementById('targetLabel');
  if (tl) tl.textContent = habitDailyTarget;
  const tt = document.getElementById('habitTimerToggle');
  if (tt) {
    tt.textContent = habitTimed ? 'On' : 'Off';
    tt.classList.toggle('active', habitTimed);
  }
}

on('habitTimerToggle', 'click', () => { habitTimed = !habitTimed; updateFreqUI(); });

on('targetMinus', 'click', () => { habitDailyTarget = Math.max(1, habitDailyTarget - 1); updateFreqUI(); });
on('targetPlus',  'click', () => { habitDailyTarget = Math.min(30, habitDailyTarget + 1); updateFreqUI(); });

document.querySelectorAll('#freqOptions .freq-opt').forEach(btn => {
  btn.addEventListener('click', () => { habitFreqType = btn.dataset.freq; updateFreqUI(); });
});
on('freqMinus', 'click', () => { habitFreqCount = Math.max(1, habitFreqCount - 1); updateFreqUI(); });
on('freqPlus', 'click', () => { habitFreqCount = Math.min(7, habitFreqCount + 1); updateFreqUI(); });

on('habitSaveBtn', 'click', () => {
  const name = document.getElementById('habitNameInput').value.trim();
  if (!name) { toast('Name required'); return; }
  const freq = habitFreqType === 'daily' ? { type: 'daily' } : { type: 'weekly', count: habitFreqCount };
  if (activeHabit) {
    activeHabit.name = name;
    activeHabit.freq = freq;
    activeHabit.dailyTarget = habitDailyTarget;
    activeHabit.timed = habitTimed;
  } else {
    state.habits.push({ id: uid(), name, freq, completions: {}, sessions: [], dailyTarget: habitDailyTarget, timed: habitTimed });
  }
  saveState();
  closeSheets();
  renderAll();
});

on('habitClearRecordsBtn', 'click', () => {
  if (!activeHabit) return;
  activeHabit.sessions = [];
  saveState();
  closeSheets();
  renderAll();
  toast('Records cleared for this habit');
});

/* Archive, not delete. A habit carries months of history that a stray tap
   should not be able to destroy — the archive keeps all of it, and deleting
   for good is available there once you've had a moment to think. */
on('habitDeleteBtn', 'click', () => {
  if (!activeHabit) return;
  activeHabit.archived = true;
  saveState('archiving a habit');
  closeSheets();
  renderAll();
  toast('Archived — its history is kept in Settings › Archive', 4000);
});

/* ======================= Stats ======================= */
function renderStats() {
  const cards = document.getElementById('statCards');
  const now = new Date();

  // completion % over last 7 and 30 days (tasks with a date, scheduled or not)
  const pctFor = (days) => {
    let total = 0, done = 0;
    for (let i = 0; i < days; i++) {
      const ds = dateStr(addDays(now, -i));
      const dayTasks = state.tasks.filter(t => t.date === ds);
      total += dayTasks.length;
      done += dayTasks.filter(t => t.done).length;
    }
    return total ? Math.round((done / total) * 100) : 0;
  };
  const pct7 = pctFor(7), pct30 = pctFor(30);

  const bestStreak = state.habits.reduce((m, h) => Math.max(m, computeStreak(h)), 0);

  // Count what happened, not what didn't. A percentage is a grade; a tally of
  // things finished is evidence, and evidence is what gets forgotten by evening.
  const doneCount = (days) => {
    let n = 0;
    for (let i = 0; i < days; i++) {
      const ds = dateStr(addDays(now, -i));
      n += state.tasks.filter(t => t.date === ds && t.done).length;
      n += state.habits.filter(h => habitDoneOn(h, ds)).length;
    }
    return n;
  };
  const wins7 = doneCount(7), wins30 = doneCount(30);
  const activeDays = (() => {
    let n = 0;
    for (let i = 0; i < 30; i++) {
      const ds = dateStr(addDays(now, -i));
      if (state.tasks.some(t => t.date === ds && t.done) || state.habits.some(h => habitDoneOn(h, ds))) n++;
    }
    return n;
  })();

  cards.innerHTML = `
    <div class="stat-card"><div class="val">${wins7}</div><div class="lbl">Things done this week</div></div>
    <div class="stat-card"><div class="val">${activeDays}</div><div class="lbl">Days you showed up, 30d</div></div>
    <div class="stat-card"><div class="val">${bestStreak}</div><div class="lbl">Best active streak</div></div>
    <div class="stat-card"><div class="val">${wins30}</div><div class="lbl">Things done, 30d</div></div>
  `;

  const line = document.getElementById('statsEncourage');
  if (line) {
    line.textContent = activeDays >= 20
      ? `You've turned up on ${activeDays} of the last 30 days. That's the whole game.`
      : activeDays > 0
        ? `${wins30} thing${wins30 === 1 ? '' : 's'} finished across ${activeDays} day${activeDays === 1 ? '' : 's'}. None of that is nothing.`
        : 'Nothing logged yet. Finish one thing and this page starts working for you.';
  }
  const rate = document.getElementById('statsRate');
  if (rate) rate.textContent = `Of the tasks you dated, you finished ${pct7}% this week and ${pct30}% this month.`;

  // 14-day bar chart of completion counts
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const ds = dateStr(addDays(now, -i));
    const dayTasks = state.tasks.filter(t => t.date === ds);
    const done = dayTasks.filter(t => t.done).length;
    days.push({ ds, total: dayTasks.length, done });
  }
  const max = Math.max(1, ...days.map(d => Math.max(d.total, d.done)));
  const svg = document.getElementById('statsChart');
  const w = 320, h = 120, barW = w / days.length;
  let svgHtml = '';
  days.forEach((d, i) => {
    const x = i * barW + barW * 0.2;
    const bw = barW * 0.6;
    const totalH = (d.total / max) * (h - 20);
    const doneH = (d.done / max) * (h - 20);
    svgHtml += `<rect x="${x}" y="${h - totalH - 14}" width="${bw}" height="${totalH}" fill="var(--border)" rx="2"></rect>`;
    svgHtml += `<rect x="${x}" y="${h - doneH - 14}" width="${bw}" height="${doneH}" fill="var(--accent)" rx="2"></rect>`;
  });
  svg.innerHTML = svgHtml;

  // streak table
  const table = document.getElementById('streakTable');
  table.innerHTML = '';
  state.habits.forEach(h => {
    const row = document.createElement('div');
    row.className = 'streak-row';
    row.innerHTML = `<span>${escapeHtml(h.name)}</span><span class="sv">${showedUpCount(h, 30)}/30 days · streak ${computeStreak(h)} · best ${computeLongestStreak(h)}</span>`;
    table.appendChild(row);
  });

  renderPracticeStats();
}

/* ---------- Practice records (motivating stats for timed habits) ---------- */
function renderPracticeStats() {
  const block = document.getElementById('practiceBlock');
  const timedHabits = state.habits.filter(h => h.sessions && h.sessions.length);
  if (!timedHabits.length) { block.hidden = true; return; }
  block.hidden = false;

  const totalAllTime = timedHabits.reduce((a, h) => a + habitTotalPracticeSeconds(h), 0);
  const totalThisWeek = timedHabits.reduce((a, h) => a + habitSessionsInRange(h, 7).reduce((s, x) => s + x.seconds, 0), 0);
  const sessionsThisWeek = timedHabits.reduce((a, h) => a + habitSessionsInRange(h, 7).length, 0);

  let bestHabit = null, bestSeconds = 0;
  timedHabits.forEach(h => {
    const pr = habitPR(h);
    if (pr > bestSeconds) { bestSeconds = pr; bestHabit = h; }
  });

  const cards = document.getElementById('practiceCards');
  cards.innerHTML = `
    <div class="stat-card"><div class="val">${fmtMinSec(totalAllTime)}</div><div class="lbl">Total practice time</div></div>
    <div class="stat-card"><div class="val">${fmtMinSec(totalThisWeek)}</div><div class="lbl">This week</div></div>
    <div class="stat-card"><div class="val">${bestHabit ? fmtMinSec(bestSeconds) : '—'}</div><div class="lbl">${bestHabit ? `Best session · ${escapeHtml(bestHabit.name)}` : 'Best session'}</div></div>
    <div class="stat-card"><div class="val">${sessionsThisWeek}</div><div class="lbl">Sessions this week</div></div>
  `;

  const table = document.getElementById('practiceTable');
  table.innerHTML = '';
  timedHabits
    .slice()
    .sort((a, b) => habitTotalPracticeSeconds(b) - habitTotalPracticeSeconds(a))
    .forEach(h => {
      const row = document.createElement('div');
      row.className = 'streak-row';
      row.innerHTML = `<span>${escapeHtml(h.name)}</span><span class="sv">PR ${fmtMinSec(habitPR(h))} · avg ${fmtMinSec(habitAvgSession(h))} · ${h.sessions.length} sessions</span>`;
      table.appendChild(row);
    });
}

/* ======================= Lists sheet ======================= */
function renderListsSheet() {
  const wrap = document.getElementById('listsContainer');
  wrap.innerHTML = '';
  const ds = currentTodayDateStr();
  state.lists.forEach(list => {
    const card = document.createElement('div');
    card.className = 'list-card';
    const attachedToday = list.attachedDate === ds;
    card.innerHTML = `<div class="list-card-head">
      <span class="lname">${escapeHtml(list.name)}</span>
      <div class="lactions">
        <button class="attach-toggle ${attachedToday ? 'on' : ''}" data-act="attach">${attachedToday ? 'Attached' : 'Attach to today'}</button>
        <button data-act="delete">Delete</button>
      </div>
    </div>`;
    const itemsWrap = document.createElement('div');
    list.items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'list-item-row';
      row.innerHTML = `<div class="checkbox ${item.done ? 'checked' : ''}">${icon('check', 15, {strokeWidth: 2.6})}</div><div class="lbl ${item.done ? 'done' : ''}">${escapeHtml(item.text)}</div>`;
      row.querySelector('.checkbox').addEventListener('click', (e) => {
        item.done = !item.done;
        e.currentTarget.classList.toggle('checked', item.done);
        row.querySelector('.lbl').classList.toggle('done', item.done);
        saveState();
      });
      itemsWrap.appendChild(row);
    });
    card.appendChild(itemsWrap);
    const addRow = document.createElement('div');
    addRow.className = 'list-add-row';
    addRow.innerHTML = `<input type="text" placeholder="Add item…" maxlength="80"><button type="button">${icon('plus', 17, {strokeWidth:2})}</button>`;
    const input = addRow.querySelector('input');
    const doAdd = () => {
      const v = input.value.trim();
      if (!v) return;
      list.items.push({ id: uid(), text: v, done: false });
      input.value = '';
      saveState();
      renderListsSheet();
    };
    addRow.querySelector('button').addEventListener('click', doAdd);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
    card.appendChild(addRow);

    card.querySelector('[data-act="attach"]').addEventListener('click', () => {
      list.attachedDate = attachedToday ? null : ds;
      saveState();
      renderListsSheet();
      renderAll();
    });
    card.querySelector('[data-act="delete"]').addEventListener('click', () => {
      state.lists = state.lists.filter(x => x.id !== list.id);
      saveState();
      renderListsSheet();
      renderAll();
    });
    wrap.appendChild(card);
  });
}

on('newListBtn', 'click', () => {
  const name = prompt('List name (e.g. "Errands", "Packing list")');
  if (!name || !name.trim()) return;
  state.lists.push({ id: uid(), name: name.trim(), attachedDate: null, items: [] });
  saveState();
  renderListsSheet();
});

on('listsBtn', 'click', () => { renderListsSheet(); openSheet('listsSheet'); });

/* ======================= Routines ======================= */
function fmtMinSec(totalSeconds) {
  const m = Math.floor(totalSeconds / 60), s = totalSeconds % 60;
  return `${m}:${pad2(s)}`;
}
function fmtDuration(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  if (!h) return `${m} min`;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

function routineTotalSeconds(r) { return r.steps.reduce((sum, s) => sum + s.seconds, 0); }

function renderRoutinesView() {
  const wrap = document.getElementById('routinesContainer');
  wrap.innerHTML = '';
  const liveRoutines = state.routines.filter(r => !r.archived);
  document.getElementById('routinesCount').textContent = liveRoutines.length;

  const alarmCard = document.createElement('div');
  alarmCard.className = 'routine-card';
  const stackCount = state.alarmStacks.length;
  alarmCard.innerHTML = `
    <div class="routine-card-head">
      <div>
        <div class="rname">${icon('alarm', 17)}<span>Triple Alarm</span></div>
        <div class="routine-card-meta">${stackCount ? `${stackCount} stack${stackCount === 1 ? '' : 's'} saved` : 'One time → three alarms, 2 min apart'}</div>
      </div>
    </div>
    <div class="routine-card-actions">
      <button class="pill-btn accent" data-act="alarm">Set up</button>
    </div>
  `;
  alarmCard.querySelector('[data-act="alarm"]').addEventListener('click', openAlarmSheet);
  wrap.appendChild(alarmCard);

  liveRoutines.forEach(r => {
    const card = document.createElement('div');
    card.className = 'routine-card';
    card.innerHTML = `
      <div class="routine-card-head">
        <div>
          <div class="rname">${escapeHtml(r.name)}</div>
          <div class="routine-card-meta">${r.steps.length} step${r.steps.length === 1 ? '' : 's'} · ~${fmtMinSec(routineTotalSeconds(r))}${r.remindAt ? ` · reminder ${minToLabel(timeToMin(r.remindAt))}` : ''}</div>
        </div>
      </div>
      <div class="routine-card-actions">
        <button class="pill-btn accent" data-act="start">${icon('play', 16, {fill:true, strokeWidth:0})}<span>Start</span></button>
        <button class="pill-btn" data-act="edit">Edit</button>
      </div>
    `;
    card.querySelector('[data-act="start"]').addEventListener('click', () => {
      if (!r.steps.length) { toast('Add a step first'); return; }
      startRoutine(r);
    });
    card.querySelector('[data-act="edit"]').addEventListener('click', () => openRoutineEditSheet(r));
    wrap.appendChild(card);
  });
}

on('newRoutineBtn', 'click', () => openRoutineEditSheet(null));

let activeRoutine = null;
let workingSteps = [];
let stepDurDraft = 60;

function openRoutineEditSheet(r) {
  activeRoutine = r;
  document.getElementById('routineNameInput').value = r ? r.name : '';
  document.getElementById('routineRemindInput').value = r && r.remindAt ? r.remindAt : '';
  workingSteps = r ? r.steps.map(s => ({ ...s })) : [];
  document.getElementById('routineDeleteBtn').hidden = !r;
  document.getElementById('stepTextInput').value = '';
  stepDurDraft = 60;
  updateStepDurBtn();
  renderWorkingSteps();
  openSheet('routineEditSheet');
}

on('routineRemindClearBtn', 'click', () => {
  document.getElementById('routineRemindInput').value = '';
});

function updateStepDurBtn() { document.getElementById('stepDurBtn').textContent = fmtMinSec(stepDurDraft); }

/* ---------- iOS-style scrollable wheel picker ---------- */
const WHEEL_ROW_H = 40;

function buildWheelColumn(container, values, formatFn, initialValue) {
  container.innerHTML = '';
  values.forEach(v => {
    const item = document.createElement('div');
    item.className = 'wheel-item';
    item.textContent = formatFn(v);
    container.appendChild(item);
  });
  const state = { values, index: Math.max(0, values.indexOf(initialValue)) };

  function applyCenterStyles() {
    const items = container.children;
    for (let i = 0; i < items.length; i++) {
      const dist = Math.abs(i - state.index);
      items[i].classList.toggle('wp-center', i === state.index);
      items[i].style.opacity = i === state.index ? '1' : String(Math.max(0.22, 1 - dist * 0.3));
    }
  }

  let scrollTimer = null;
  container.addEventListener('scroll', () => {
    const idx = Math.round(container.scrollTop / WHEEL_ROW_H);
    state.index = Math.max(0, Math.min(values.length - 1, idx));
    applyCenterStyles();
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      container.scrollTo({ top: state.index * WHEEL_ROW_H, behavior: 'smooth' });
    }, 120);
  }, { passive: true });

  // A hidden element has no layout, so assigning scrollTop is a no-op and the
  // wheel would open parked on the first value. Defer until after paint.
  const seek = () => { container.scrollTop = state.index * WHEEL_ROW_H; };
  seek();
  requestAnimationFrame(() => { seek(); requestAnimationFrame(seek); });
  applyCenterStyles();

  return {
    getValue: () => state.values[state.index],
    setValue: (v) => {
      state.index = Math.max(0, values.indexOf(v));
      seek();
      applyCenterStyles();
    },
  };
}

const MIN_VALUES = Array.from({ length: 31 }, (_, i) => i);   // 0–30 minutes
const SEC_VALUES = Array.from({ length: 60 }, (_, i) => i);   // 0–59 seconds
let wheelMinCtrl = null, wheelSecCtrl = null;

function openDurationPicker() {
  const mins = Math.floor(stepDurDraft / 60);
  const secs = stepDurDraft % 60;
  openSheet('durationPickerSheet');   // must be visible before wheels can scroll
  wheelMinCtrl = buildWheelColumn(document.getElementById('wheelMin'), MIN_VALUES, (v) => String(v), Math.min(mins, 30));
  wheelSecCtrl = buildWheelColumn(document.getElementById('wheelSec'), SEC_VALUES, (v) => pad2(v), secs);
}

on('stepDurBtn', 'click', openDurationPicker);

on('durationSetBtn', 'click', () => {
  const m = wheelMinCtrl ? wheelMinCtrl.getValue() : 0;
  const s = wheelSecCtrl ? wheelSecCtrl.getValue() : 0;
  let total = m * 60 + s;
  if (total < 5) total = 5;
  stepDurDraft = total;
  updateStepDurBtn();
  document.getElementById('durationPickerSheet').hidden = true;
});

function renderWorkingSteps() {
  const list = document.getElementById('routineStepsList');
  list.innerHTML = '';
  workingSteps.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'routine-step-row';
    row.innerHTML = `<span class="rs-idx">${i + 1}</span><span class="rs-text">${escapeHtml(s.text)}</span><span class="rs-dur">${fmtMinSec(s.seconds)}</span><button type="button" class="rs-del" aria-label="Remove">${icon('x', 15)}</button>`;
    row.querySelector('.rs-del').addEventListener('click', () => {
      workingSteps.splice(i, 1);
      renderWorkingSteps();
    });
    list.appendChild(row);
  });
}

on('addStepBtn', 'click', () => {
  const input = document.getElementById('stepTextInput');
  const text = input.value.trim();
  if (!text) return;
  workingSteps.push({ id: uid(), text, seconds: stepDurDraft });
  input.value = '';
  stepDurDraft = 60;
  updateStepDurBtn();
  renderWorkingSteps();
});

on('routineSaveBtn', 'click', () => {
  const name = document.getElementById('routineNameInput').value.trim();
  if (!name) { toast('Name required'); return; }
  if (!workingSteps.length) { toast('Add at least one step'); return; }
  const remindAt = document.getElementById('routineRemindInput').value || null;
  if (activeRoutine) {
    activeRoutine.name = name;
    activeRoutine.steps = workingSteps;
    if (activeRoutine.remindAt !== remindAt) activeRoutine.lastRemindedDate = null;
    activeRoutine.remindAt = remindAt;
  } else {
    state.routines.push({ id: uid(), name, steps: workingSteps, remindAt, lastRemindedDate: null, createdAt: Date.now() });
  }
  saveState();
  closeSheets();
  renderRoutinesView();
});

on('routineDeleteBtn', 'click', () => {
  if (!activeRoutine) return;
  activeRoutine.archived = true;
  saveState('archiving a routine');
  closeSheets();
  renderRoutinesView();
  toast('Archived — restore it from Settings › Archive', 4000);
});

/* ---------- Routine run mode ---------- */
/* Timers are derived from wall-clock deadlines, never from counting interval
   ticks. An interval stops firing the moment iOS suspends the page — lock the
   screen mid-routine and a tick-counting timer silently freezes, so you come
   back to a routine that thinks no time has passed. A deadline is still true
   after a suspension, and catching up is just arithmetic. */
let runRoutine = null, runIndex = 0, runRemaining = 0, runInterval = null;
let runPaused = false, runStartTime = 0, runStepEndsAt = 0, runPausedLeft = 0;
const RING_CIRC = 565.48;

function stepSeconds(step) { return Math.max(1, (step && step.seconds) || 1); }

function startRoutine(r, resume) {
  runRoutine = r;
  runIndex = resume ? resume.index : 0;
  runStartTime = resume ? resume.startTs : Date.now();
  acquireWakeLock();
  document.getElementById('runDone').hidden = true;
  document.getElementById('runBody').hidden = false;
  document.getElementById('routineRunOverlay').hidden = false;
  if (resume) {
    runPaused = false;
    document.getElementById('runPauseBtn').textContent = 'Pause';
    runStepEndsAt = resume.stepEndsAt;
    paintRunStep();
    clearInterval(runInterval);
    runTick();                                   // rolls forward through any steps that elapsed
    runInterval = setInterval(runTick, 250);
    persistRoutineTimer();
  } else {
    loadRunStep();
  }
}

function persistRoutineTimer() {
  if (!runRoutine) return;
  saveLiveTimer({ kind: 'routine', id: runRoutine.id, index: runIndex, stepEndsAt: runStepEndsAt, startTs: runStartTime });
}

function loadRunStep() {
  clearInterval(runInterval);
  runPaused = false;
  document.getElementById('runPauseBtn').textContent = 'Pause';
  const step = runRoutine.steps[runIndex];
  runStepEndsAt = Date.now() + stepSeconds(step) * 1000;
  runRemaining = stepSeconds(step);
  paintRunStep();
  updateRunRing(stepSeconds(step));
  persistRoutineTimer();
  runInterval = setInterval(runTick, 250);
}

// Labels only — split out so a catch-up can repaint without restarting a step.
function paintRunStep() {
  const step = runRoutine.steps[runIndex];
  document.getElementById('runStepTitle').textContent = step.text;
  document.getElementById('runProgress').textContent = `Step ${runIndex + 1} of ${runRoutine.steps.length}`;
  document.getElementById('runPrevBtn').disabled = runIndex === 0;
  document.getElementById('runPrevBtn').style.opacity = runIndex === 0 ? 0.4 : 1;
  const isLast = runIndex === runRoutine.steps.length - 1;
  document.getElementById('runNextBtn').textContent = isLast ? 'Finish ›' : 'Skip ›';
  renderRunDots();
}

function renderRunDots() {
  const wrap = document.getElementById('runDots');
  wrap.innerHTML = '';
  runRoutine.steps.forEach((s, i) => {
    const dot = document.createElement('div');
    dot.className = 'dot' + (i === runIndex ? ' on' : i < runIndex ? ' done' : '');
    wrap.appendChild(dot);
  });
}

function updateRunRing(total) {
  const frac = total > 0 ? Math.max(0, runRemaining) / total : 0;
  document.getElementById('runRingFg').style.strokeDashoffset = RING_CIRC * (1 - frac);
  document.getElementById('runTimerNum').textContent = fmtMinSec(Math.max(0, runRemaining));
}

function runTick() {
  if (!runRoutine || runPaused) return;
  let left = (runStepEndsAt - Date.now()) / 1000;
  // Roll forward through however many steps elapsed while we weren't running,
  // carrying the overflow, so a suspended phone resumes at the right place.
  let skipped = 0;
  while (left <= 0) {
    if (runIndex >= runRoutine.steps.length - 1) { finishRun(); return; }
    runIndex++;
    skipped++;
    runStepEndsAt += stepSeconds(runRoutine.steps[runIndex]) * 1000;
    left = (runStepEndsAt - Date.now()) / 1000;
  }
  if (skipped) {
    persistRoutineTimer();
    paintRunStep();
    if (skipped > 1) toast(`${skipped} steps ran while the screen was off`, 3000);
  }
  runRemaining = Math.ceil(left);
  updateRunRing(stepSeconds(runRoutine.steps[runIndex]));
}

function advanceRunStep() {
  if (runIndex < runRoutine.steps.length - 1) {
    runIndex++;
    loadRunStep();
  } else {
    finishRun();
  }
}

function finishRun() {
  clearInterval(runInterval);
  clearLiveTimer();
  if (!anyTimerRunning()) releaseWakeLock();
  const elapsed = Math.round((Date.now() - runStartTime) / 1000);
  document.getElementById('runBody').hidden = true;
  document.getElementById('runDone').hidden = false;
  document.getElementById('runDoneTime').textContent = `Completed “${escapeHtml(runRoutine.name)}” in ${fmtMinSec(elapsed)}`;
  toast('Routine complete');
}

on('runPauseBtn', 'click', () => {
  runPaused = !runPaused;
  document.getElementById('runPauseBtn').textContent = runPaused ? 'Resume' : 'Pause';
  if (runPaused) {
    runPausedLeft = Math.max(0, runStepEndsAt - Date.now());
  } else {
    runStepEndsAt = Date.now() + runPausedLeft;   // the deadline moves, not the clock
  }
  persistRoutineTimer();
});

on('runPrevBtn', 'click', () => {
  if (runIndex > 0) { runIndex--; loadRunStep(); }
});
on('runNextBtn', 'click', () => {
  clearInterval(runInterval);
  advanceRunStep();
});
on('runCloseBtn', 'click', () => {
  clearInterval(runInterval);
  runRoutine = null;
  clearLiveTimer();
  if (!anyTimerRunning()) releaseWakeLock();
  document.getElementById('routineRunOverlay').hidden = true;
});
on('runFinishBtn', 'click', () => {
  runRoutine = null;
  clearLiveTimer();
  if (!anyTimerRunning()) releaseWakeLock();
  document.getElementById('routineRunOverlay').hidden = true;
});

/* Coming back from a locked screen or another app: repaint every live timer
   immediately rather than waiting up to a full tick for it to look right. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  recapWindowOpen = true;
  setTimeout(() => { recapWindowOpen = false; }, 90000);
  try {
    if (runRoutine) runTick();
    if (typeof taskRun !== 'undefined' && taskRun) taskRunTick();
    if (choreRunning) choreTick();
    if (habitTimerRunning) habitTimerTick();
    renderTimeBar();
    checkReminders();
  } catch (e) { console.warn('[DayFlow] resync failed', e); }
});

/* ======================= Chore timer ======================= */
const CHORE_HISTORY_CAP = 20;

function choreAverage(c) {
  if (!c.sessions.length) return null;
  const recent = c.sessions.slice(-CHORE_HISTORY_CAP);
  return Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
}
function choreLast(c) { return c.sessions.length ? c.sessions[c.sessions.length - 1] : null; }

function renderChoresView() {
  const wrap = document.getElementById('choresContainer');
  wrap.innerHTML = '';
  state.chores.filter(c => !c.archived).forEach(c => {
    const avg = choreAverage(c);
    const last = choreLast(c);
    const card = document.createElement('div');
    card.className = 'chore-card';
    card.innerHTML = `
      <div class="chore-info">
        <div class="chore-name">${escapeHtml(c.name)}</div>
        <div class="chore-meta">${avg != null ? `avg <span class="avg">${fmtMinSec(avg)}</span> · last ${fmtMinSec(last)} · ${c.sessions.length} run${c.sessions.length === 1 ? '' : 's'}` : 'not timed yet'}</div>
      </div>
      <div class="chore-actions">
        <button class="chore-start-btn" data-act="start">${icon('play', 14, {fill:true, strokeWidth:0})}<span>Start</span></button>
        <button class="chore-del-btn" data-act="del" aria-label="Delete">${icon('x', 16)}</button>
      </div>
    `;
    card.querySelector('[data-act="start"]').addEventListener('click', () => startChoreTimer(c));
    card.querySelector('[data-act="del"]').addEventListener('click', () => {
      c.archived = true;                       // keeps the timing history
      saveState('archiving a chore');
      renderChoresView();
      toast('Archived — your timings are kept', 3500);
    });
    wrap.appendChild(card);
  });
}


on('addChoreBtn', 'click', addChoreFromInput);
on('newChoreInput', 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addChoreFromInput(); } });
function addChoreFromInput() {
  const input = document.getElementById('newChoreInput');
  const name = input.value.trim();
  if (!name) return;
  state.chores.push({ id: uid(), name, sessions: [], createdAt: Date.now() });
  input.value = '';
  saveState();
  renderChoresView();
}

let choreRunning = null, choreStartTs = 0, choreInterval = null;

function startChoreTimer(c, resumeTs) {
  choreRunning = c;
  choreStartTs = resumeTs || Date.now();
  saveLiveTimer({ kind: 'chore', id: c.id, startTs: choreStartTs });
  acquireWakeLock();
  document.getElementById('choreRunName').textContent = c.name;
  const avg = choreAverage(c);
  document.getElementById('choreAvgLine').innerHTML = avg != null
    ? `Your average: <span class="avg-val">${fmtMinSec(avg)}</span>`
    : `First time timing this — let's set a baseline`;
  document.getElementById('choreRunOverlay').hidden = false;
  choreTick();
  clearInterval(choreInterval);
  choreInterval = setInterval(choreTick, 1000);
}

function choreTick() {
  const elapsed = Math.round((Date.now() - choreStartTs) / 1000);
  document.getElementById('choreStopwatchNum').textContent = fmtMinSec(elapsed);
}

function stopChoreTimer(save) {
  clearInterval(choreInterval);
  clearLiveTimer();
  const elapsed = Math.round((Date.now() - choreStartTs) / 1000);
  document.getElementById('choreRunOverlay').hidden = true;
  if (save && choreRunning && elapsed >= 3) {
    const prevAvg = choreAverage(choreRunning);
    choreRunning.sessions.push(elapsed);
    if (choreRunning.sessions.length > CHORE_HISTORY_CAP) choreRunning.sessions.shift();
    saveState();
    if (prevAvg != null) {
      const diff = elapsed - prevAvg;
      const cmp = diff <= 0 ? `${fmtMinSec(Math.abs(diff))} faster than your average` : `${fmtMinSec(diff)} slower than your average`;
      toast(`${fmtMinSec(elapsed)} — ${cmp}`);
    } else {
      toast(`Logged ${fmtMinSec(elapsed)} — that's your new baseline`);
    }
  }
  choreRunning = null;
  if (!anyTimerRunning()) releaseWakeLock();
}

on('choreDoneBtn', 'click', () => stopChoreTimer(true));
on('choreCancelBtn', 'click', () => stopChoreTimer(false));
on('choreCloseBtn', 'click', () => stopChoreTimer(false));

/* ======================= Triple alarm stack ======================= */
/* A PWA cannot create alarms in the iOS Clock app — no web API exists for it.
   What it CAN do is emit a standard .ics with VALARM triggers, which iOS hands
   to the Calendar app; those fire as real system alerts even with DayFlow shut.
   In-app reminders are registered too, as a belt-and-braces fallback. */
const ALARM_GAP_MIN = 2;
let alarmHourCtrl = null, alarmMinCtrl = null, alarmApCtrl = null;

const HOUR_VALUES = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTE_VALUES = Array.from({ length: 60 }, (_, i) => i);
const AP_VALUES = ['AM', 'PM'];

function alarmSelectedMin() {
  let h = alarmHourCtrl ? alarmHourCtrl.getValue() : 10;
  const m = alarmMinCtrl ? alarmMinCtrl.getValue() : 0;
  const ap = alarmApCtrl ? alarmApCtrl.getValue() : 'PM';
  if (ap === 'AM' && h === 12) h = 0;
  if (ap === 'PM' && h !== 12) h += 12;
  return h * 60 + m;
}

function renderAlarmPreview() {
  const base = alarmSelectedMin();
  const wrap = document.getElementById('alarmPreview');
  wrap.innerHTML = [0, ALARM_GAP_MIN, ALARM_GAP_MIN * 2]
    .map((off, i) => `<span class="ap-chip${i === 0 ? ' first' : ''}">${minToLabel((base + off) % 1440)}</span>`)
    .join('');
}

function openAlarmSheet() {
  const now = new Date();
  let defMin = 22 * 60;
  const last = state.alarmStacks[state.alarmStacks.length - 1];
  if (last) defMin = last.startMin;
  let h24 = Math.floor(defMin / 60);
  const mm = defMin % 60;
  const ap = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12; if (h12 === 0) h12 = 12;

  document.getElementById('alarmLabelInput').value = '';
  renderAlarmStackList();
  // Open first: the wheels need real layout before they can be scrolled.
  openSheet('alarmSheet');

  alarmHourCtrl = buildWheelColumn(document.getElementById('alarmHourCol'), HOUR_VALUES, v => String(v), h12);
  alarmMinCtrl = buildWheelColumn(document.getElementById('alarmMinCol'), MINUTE_VALUES, v => pad2(v), mm);
  alarmApCtrl = buildWheelColumn(document.getElementById('alarmApCol'), AP_VALUES, v => v, ap);

  [document.getElementById('alarmHourCol'), document.getElementById('alarmMinCol'), document.getElementById('alarmApCol')]
    .forEach(col => {
      if (col._previewBound) return;   // openAlarmSheet can run many times
      col._previewBound = true;
      col.addEventListener('scroll', () => {
        clearTimeout(col._prevT);
        col._prevT = setTimeout(renderAlarmPreview, 160);
      }, { passive: true });
    });

  renderAlarmPreview();
  renderAlarmMethod();
}

function icsStamp(d) {
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;
}
// Floating local time (no Z): the alarm should fire at 10pm wherever you are.
function icsLocal(dateObj, min) {
  const d = new Date(dateObj);
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}00`;
}

function buildAlarmIcs(stack) {
  const now = new Date();
  const stamp = icsStamp(now);
  // First occurrence: today if the time hasn't passed, else tomorrow.
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const firstDay = stack.startMin > nowMin ? now : addDays(now, 1);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DayFlow//Triple Alarm//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  [0, ALARM_GAP_MIN, ALARM_GAP_MIN * 2].forEach((off, i) => {
    const min = (stack.startMin + off) % 1440;
    const dayForThis = (stack.startMin + off) >= 1440 ? addDays(firstDay, 1) : firstDay;
    const title = `${stack.label || 'DayFlow Alarm'} (${i + 1}/3)`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${stack.id}-${i}@dayflow`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsLocal(dayForThis, min)}`,
      'DURATION:PT1M',
      'RRULE:FREQ=DAILY',
      `SUMMARY:${title}`,
      'DESCRIPTION:Created by DayFlow',
      'BEGIN:VALARM',
      'TRIGGER:PT0M',
      'ACTION:DISPLAY',
      `DESCRIPTION:${title}`,
      'END:VALARM',
      'END:VEVENT'
    );
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function downloadAlarmIcs(stack) {
  const ics = buildAlarmIcs(stack);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dayflow-alarms-${minToTimeInput(stack.startMin).replace(':', '')}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}


/* ---------- Delivering the alarms ----------
   iOS gives web pages no way to write to the Clock app — there is no public
   URL scheme or API that creates an alarm, and anything claiming otherwise
   would be guesswork. The one route that genuinely reaches Clock is the
   Shortcuts app: a shortcut the user saves once can call Clock's "Create
   Alarm" action, and a web page is allowed to run a named shortcut by URL.
   So: Clock via Shortcuts (needs one-time setup, real alarms), or a calendar
   file (no setup, but Calendar alerts rather than Clock alarms). */
const SHORTCUT_NAME = 'DayFlow Alarms';

function alarmTimes(stack) {
  return [0, ALARM_GAP_MIN, ALARM_GAP_MIN * 2].map(off => (stack.startMin + off) % 1440);
}
function alarmTimesText(stack) {
  return alarmTimes(stack).map(m => minToTimeInput(m)).join(',');
}

function alarmMethod() { return state.settings.alarmMethod === 'calendar' ? 'calendar' : 'clock'; }

function renderAlarmMethod() {
  const method = alarmMethod();
  document.querySelectorAll('#alarmMethodOptions .freq-opt').forEach(b =>
    b.classList.toggle('active', b.dataset.method === method));
  const note = document.getElementById('alarmMethodNote');
  const clockActions = document.getElementById('alarmClockActions');
  const createBtn = document.getElementById('alarmCreateBtn');
  if (method === 'clock') {
    if (note) note.textContent = `Runs a Shortcut named “${SHORTCUT_NAME}” that creates the alarms in Clock. It needs setting up once — tap Setup guide.`;
    if (clockActions) clockActions.hidden = false;
    if (createBtn) createBtn.innerHTML = icon('alarm', 18) + '<span>Set 3 alarms in Clock</span>';
  } else {
    if (note) note.textContent = 'Downloads a calendar file. No setup, but these fire as Calendar alerts rather than Clock alarms.';
    if (clockActions) clockActions.hidden = true;
    if (createBtn) createBtn.innerHTML = icon('alarm', 18) + '<span>Add 3 alerts to Calendar</span>';
  }
}

document.querySelectorAll('#alarmMethodOptions .freq-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    state.settings.alarmMethod = btn.dataset.method;
    saveState('alarm method');
    renderAlarmMethod();
  });
});

function appReturnUrl(flag) {
  return location.origin + location.pathname + '?alarm=' + flag;
}

/* x-callback-url means Shortcuts reports back. Without it, a missing shortcut
   just dead-ends on an error screen in another app and DayFlow never knows —
   which is exactly how "could not find the shortcut" becomes a mystery. */
function buildShortcutUrl(stack) {
  return 'shortcuts://x-callback-url/run-shortcut' +
         '?name=' + encodeURIComponent(SHORTCUT_NAME) +
         '&input=text&text=' + encodeURIComponent(alarmTimesText(stack)) +
         '&x-success=' + encodeURIComponent(appReturnUrl('ok')) +
         '&x-error=' + encodeURIComponent(appReturnUrl('err')) +
         '&x-cancel=' + encodeURIComponent(appReturnUrl('cancel'));
}

function runAlarmShortcut(stack) {
  const url = buildShortcutUrl(stack);
  // Recorded so the exact hand-off is inspectable if Shortcuts doesn't open.
  document.body.dataset.lastAlarmUrl = url;
  // A synthesised link click is the reliable way to hand a custom scheme to
  // iOS, and — unlike assigning location.href — it leaves the page intact if
  // nothing on the device handles the scheme.
  const a = document.createElement('a');
  a.href = url;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 0);
}

function deliverAlarmStack(stack) {
  if (alarmMethod() === 'clock') {
    runAlarmShortcut(stack);
    toast('Opening Shortcuts…');
  } else {
    downloadAlarmIcs(stack);
    toast('Opening in Calendar…');
  }
}

on('alarmCopyBtn', 'click', async () => {
  const stack = { startMin: alarmSelectedMin() };
  const text = alarmTimes(stack).map(m => minToLabel(m)).join('   ');
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied: ' + text, 4000);
  } catch (e) {
    toast(text, 6000);   // clipboard blocked: at least show them the times
  }
});

const SETUP_STEPS = [
  'Open the <strong>Shortcuts</strong> app and tap <strong>+</strong> to create a new shortcut.',
  'Tap the name at the top and set it to <strong>DayFlow Alarms</strong> — it has to match exactly.',
  'Add the action <strong>Split Text</strong>. Set Text to <strong>Shortcut Input</strong>, and Separator to <strong>Custom</strong> with a comma.',
  'Add <strong>Repeat with Each</strong>, using the Split Text result.',
  'Inside the repeat, add <strong>Create Alarm</strong> and set its time to <strong>Repeat Item</strong>.',
  'Save. DayFlow sends it times like <strong>22:00,22:02,22:04</strong> and Clock gets all three.',
];

function openAlarmSetup() {
  const list = document.getElementById('setupSteps');
  if (list && !list.childElementCount) {
    SETUP_STEPS.forEach(step => {
      const li = document.createElement('li');
      li.innerHTML = step;
      list.appendChild(li);
    });
  }
  openSheet('alarmSetupSheet');
}

on('alarmSetupBtn', 'click', openAlarmSetup);
on('alarmSetupDoneBtn', 'click', closeSheets);

on('copyShortcutNameBtn', 'click', async () => {
  try {
    await navigator.clipboard.writeText(SHORTCUT_NAME);
    toast('Copied “' + SHORTCUT_NAME + '”');
  } catch (e) {
    toast(SHORTCUT_NAME, 5000);
  }
});

function renderAlarmStackList() {
  const wrap = document.getElementById('alarmStackList');
  wrap.innerHTML = '';
  state.alarmStacks.forEach(stack => {
    const card = document.createElement('div');
    card.className = 'alarm-stack-card';
    card.innerHTML = `
      <div class="alarm-stack-info">
        <div class="alarm-stack-time">${minToLabel(stack.startMin)}</div>
        <div class="alarm-stack-meta">${escapeHtml(stack.label || 'DayFlow Alarm')} · +${ALARM_GAP_MIN}m · +${ALARM_GAP_MIN * 2}m</div>
      </div>
      <button class="asc-btn dl" data-act="dl" aria-label="Re-download">${icon('download', 18)}</button>
      <button class="asc-btn" data-act="del" aria-label="Delete">${icon('x', 17)}</button>
    `;
    card.querySelector('[data-act="dl"]').addEventListener('click', () => deliverAlarmStack(stack));
    card.querySelector('[data-act="del"]').addEventListener('click', () => {
      state.alarmStacks = state.alarmStacks.filter(s => s.id !== stack.id);
      saveState();
      renderAlarmStackList();
      toast('Stack removed from DayFlow');
    });
    wrap.appendChild(card);
  });
}

on('alarmCreateBtn', 'click', () => {
  const startMin = alarmSelectedMin();
  const label = document.getElementById('alarmLabelInput').value.trim() || 'DayFlow Alarm';
  const stack = { id: uid(), startMin, label, createdAt: Date.now() };
  state.alarmStacks.push(stack);
  saveState('alarm stack');
  renderAlarmStackList();
  deliverAlarmStack(stack);
});

/* ======================= Habit timer ======================= */
/* ======================= Running timers survive anything =======================
   Locking the screen doesn't pause a timer — it can destroy it. iOS freezes a
   web app in the background and will discard the page entirely to reclaim
   memory, so coming back means a cold start with every in-memory variable
   gone: the overlay vanished and the session was never logged. Elapsed time
   was already derived from a timestamp, which fixed the *display* but not the
   disappearance.

   So a running timer is written to storage the moment it starts, and restored
   on launch. It also asks to keep the screen awake, which stops the whole
   situation arising for a session you're watching. */
const LIVE_TIMER_KEY = 'dayflow.timer';
const LIVE_TIMER_MAX_MS = 6 * 3600 * 1000;   // beyond this it's a forgotten timer, not a session

function saveLiveTimer(obj) {
  try { localStorage.setItem(LIVE_TIMER_KEY, JSON.stringify(obj)); } catch (e) { /* non-fatal */ }
}
function clearLiveTimer() {
  try { localStorage.removeItem(LIVE_TIMER_KEY); } catch (e) { /* non-fatal */ }
}
function readLiveTimer() {
  try { return JSON.parse(localStorage.getItem(LIVE_TIMER_KEY) || 'null'); } catch (e) { return null; }
}

/* Screen Wake Lock: supported in iOS Safari 16.4+ for installed web apps. It
   is a request, not a guarantee — the OS can refuse or drop it — so it is a
   convenience layered on top of the restore logic, never a substitute. */
let wakeLock = null;
async function acquireWakeLock() {
  if (state.settings.keepAwake === false) return;
  if (!('wakeLock' in navigator)) return;
  if (wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) { wakeLock = null; }
}
function releaseWakeLock() {
  try { if (wakeLock) wakeLock.release(); } catch (e) { /* ignore */ }
  wakeLock = null;
}
function anyTimerRunning() {
  return !!(habitTimerRunning || choreRunning || (typeof taskRun !== 'undefined' && taskRun) || runRoutine);
}

let habitTimerRunning = null, habitTimerStartTs = 0, habitTimerInterval = null;

function startHabitTimer(h, resumeTs) {
  habitTimerRunning = h;
  habitTimerStartTs = resumeTs || Date.now();
  saveLiveTimer({ kind: 'habit', id: h.id, startTs: habitTimerStartTs });
  acquireWakeLock();
  document.getElementById('habitRunName').textContent = h.name;
  const pr = habitPR(h);
  document.getElementById('habitAvgLine').innerHTML = pr != null
    ? `Personal best: <span class="avg-val">${fmtMinSec(pr)}</span>`
    : `First timed session — let's set a record`;
  document.getElementById('habitRunOverlay').hidden = false;
  habitTimerTick();
  clearInterval(habitTimerInterval);
  habitTimerInterval = setInterval(habitTimerTick, 1000);
}

function habitTimerTick() {
  const elapsed = Math.round((Date.now() - habitTimerStartTs) / 1000);
  document.getElementById('habitStopwatchNum').textContent = fmtMinSec(elapsed);
}

function stopHabitTimer(save) {
  clearInterval(habitTimerInterval);
  clearLiveTimer();
  const elapsed = Math.round((Date.now() - habitTimerStartTs) / 1000);
  document.getElementById('habitRunOverlay').hidden = true;
  if (save && habitTimerRunning && elapsed >= 3) {
    const h = habitTimerRunning;
    const prevPR = habitPR(h);
    const ds = todayStr();
    h.sessions.push({ date: ds, seconds: elapsed });
    const wasAlreadyDone = habitDoneOn(h, ds);
    bumpHabit(h, ds, 1);
    saveState();

    if (prevPR == null) {
      toast(`First session logged: ${fmtMinSec(elapsed)} — that's your new record`);
    } else if (elapsed > prevPR) {
      toast(`New personal best! ${fmtMinSec(elapsed)} (previous: ${fmtMinSec(prevPR)})`);
    } else {
      toast(`Logged ${fmtMinSec(elapsed)} — PR is still ${fmtMinSec(prevPR)}` + (wasAlreadyDone ? '' : ` · “${h.name}” checked off for today`));
    }
    renderAll();
  }
  habitTimerRunning = null;
  if (!anyTimerRunning()) releaseWakeLock();
}

on('habitDoneRunBtn', 'click', () => stopHabitTimer(true));
on('habitCancelBtn', 'click', () => stopHabitTimer(false));
on('habitRunCloseBtn', 'click', () => stopHabitTimer(false));

/* ======================= Voice dictation =======================
   Web Speech API. Recognition is performed by the OS, not by DayFlow.

   Two hard-won constraints shape this code:

   1. iOS Safari does not support `continuous = true`. Setting it makes
      start() fail silently — no onstart, no onerror, nothing. So we run in
      single-shot mode and re-arm on `onend` ourselves, which gives the same
      keep-listening feel without tripping over the platform.
   2. The API object exists in installed (standalone) PWAs on iOS even where
      it does nothing at all. Feature detection therefore isn't enough: we
      start a watchdog and, if the engine never reports onstart, we declare it
      unavailable and hand off to the keyboard's own dictation key.

   The lit state is driven by engine events, never optimistically, so the
   button can't get stuck on. */
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition = null;
let micState = 'idle';        // idle | starting | listening | unsupported
let wantListening = false;    // user intent, survives single-shot restarts
let stoppedByUser = false;
let dictationBase = '';       // text already in the field when dictation began
let committed = '';           // finalised text across re-armed sessions
let startWatchdog = null;
let listenCap = null;
let listenStartedAt = 0;

const START_TIMEOUT_MS = 3000;
const MAX_LISTEN_MS = 60000;

function voiceSupported() { return !!SpeechRec; }
function isListening() { return micState === 'listening' || micState === 'starting'; }

function setMicUI(state) {
  micState = state;
  const btn = document.getElementById('micBtn');
  const live = state === 'listening' || state === 'starting';
  btn.classList.toggle('listening', live);
  btn.classList.toggle('starting', state === 'starting');
  btn.setAttribute('aria-label', live ? 'Stop dictation' : 'Dictate');
  btn.innerHTML = icon(live ? 'stop' : 'mic', live ? 17 : 19, live ? { fill: true, strokeWidth: 0 } : {});
}

function writeTranscript(current) {
  const input = document.getElementById('quickAddInput');
  const parts = [dictationBase, committed, current].filter(x => x && x.trim());
  input.value = parts.join(' ').replace(/\s+/g, ' ').trim();
}

function initRecognition() {
  if (!voiceSupported() || recognition) return recognition;
  recognition = new SpeechRec();
  // Single-shot: `continuous` is unsupported on iOS and breaks start() there.
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.lang = navigator.language || 'en-US';

  recognition.onstart = () => {
    clearTimeout(startWatchdog);
    setMicUI('listening');
  };

  recognition.onresult = (event) => {
    let text = '';
    for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
    recognition._lastText = text.trim();
    writeTranscript(recognition._lastText);
  };

  recognition.onerror = (e) => {
    clearTimeout(startWatchdog);
    if (e.error === 'no-speech') return;              // onend re-arms us
    if (e.error === 'aborted') return;
    wantListening = false;
    setMicUI('idle');
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      markVoiceUnavailable('Microphone blocked. Allow it in Settings › Safari › Microphone.');
    } else {
      toast('Dictation error: ' + e.error);
    }
  };

  recognition.onend = () => {
    clearTimeout(startWatchdog);
    // Carry finalised text forward before the next single-shot session.
    if (recognition._lastText) {
      committed = [committed, recognition._lastText].filter(Boolean).join(' ');
      recognition._lastText = '';
    }
    const overCap = Date.now() - listenStartedAt > MAX_LISTEN_MS;
    if (wantListening && !stoppedByUser && !overCap) {
      try { recognition.start(); return; } catch (err) { /* fall through to idle */ }
    }
    wantListening = false;
    stoppedByUser = false;
    setMicUI('idle');
  };

  return recognition;
}

function markVoiceUnavailable(message) {
  setMicUI('unsupported');
  wantListening = false;
  document.getElementById('micBtn').classList.remove('listening', 'starting');
  toast(message);
  document.getElementById('quickAddInput').focus();
}

function startListening() {
  const rec = initRecognition();
  if (!rec) {
    markVoiceUnavailable('Voice input is not available here — use the mic key on your keyboard.');
    return;
  }
  stoppedByUser = false;
  wantListening = true;
  committed = '';
  rec._lastText = '';
  dictationBase = document.getElementById('quickAddInput').value.trim();
  listenStartedAt = Date.now();

  setMicUI('starting');
  clearTimeout(listenCap);
  listenCap = setTimeout(() => stopListening(true), MAX_LISTEN_MS);

  // If the engine never reports back, it isn't really implemented here.
  clearTimeout(startWatchdog);
  startWatchdog = setTimeout(() => {
    if (micState === 'starting') {
      try { rec.abort(); } catch (e) { /* nothing running */ }
      markVoiceUnavailable("Voice input isn't supported in this browser — tap the mic on your keyboard instead.");
    }
  }, START_TIMEOUT_MS);

  try {
    rec.start();
  } catch (err) {
    // A previous session never cleanly ended; force it down and retry once.
    try { rec.abort(); } catch (e) { /* nothing to abort */ }
    setTimeout(() => {
      try { rec.start(); }
      catch (e2) {
        clearTimeout(startWatchdog);
        markVoiceUnavailable('Mic is busy — try again in a moment.');
      }
    }, 250);
  }
}

function stopListening(auto) {
  clearTimeout(startWatchdog);
  clearTimeout(listenCap);
  stoppedByUser = !auto;
  wantListening = false;
  setMicUI('idle');
  if (recognition) {
    try { recognition.stop(); }
    catch (e) { try { recognition.abort(); } catch (e2) { /* already down */ } }
  }
}

on('micBtn', 'click', () => {
  if (isListening()) stopListening(false);
  else startListening();
});

// Never leave the mic hot when the app goes to the background.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && isListening()) stopListening(true);
});

/* ======================= Local assistant =======================
   This is NOT a language model. Nothing is downloaded and nothing leaves the
   device. It's an intent matcher over the user's own DayFlow data: it reads
   their tasks, habits, chores and routines, answers questions about them, runs
   commands, and derives a profile of their patterns. Honest about its limits
   when it doesn't understand — see assistantFallback(). */

const CHAT_CAP = 120;

function pushChat(role, text) {
  state.chatLog.push({ role, text, ts: Date.now() });
  if (state.chatLog.length > CHAT_CAP) state.chatLog = state.chatLog.slice(-CHAT_CAP);
  saveState('silent');
}

function renderChat(scroll = true) {
  const log = document.getElementById('chatLog');
  log.innerHTML = '';
  if (!state.chatLog.length) {
    pushChat('bot', assistantGreeting());
  }
  state.chatLog.forEach(m => {
    const row = document.createElement('div');
    row.className = 'chat-msg ' + m.role;
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.innerHTML = formatChatText(m.text);
    row.appendChild(bubble);
    log.appendChild(row);
  });
  renderChatChips();
  if (scroll) requestAnimationFrame(() => {
    const view = document.getElementById('view-chat');
    view.scrollTop = view.scrollHeight;
  });
}

// Minimal, safe formatter: escape everything, then allow **bold** and <n> numbers.
function formatChatText(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\{\{(.+?)\}\}/g, '<span class="num">$1</span>');
}

const CHAT_CHIPS = [
  "What's on today?",
  'How am I doing this week?',
  'What do you know about me?',
  'What should I do next?',
  'Show my records',
];

function renderChatChips() {
  const wrap = document.getElementById('chatChips');
  wrap.innerHTML = '';
  CHAT_CHIPS.forEach(text => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chat-chip';
    chip.textContent = text;
    chip.addEventListener('click', () => handleChatInput(text));
    wrap.appendChild(chip);
  });
}

function assistantGreeting() {
  const h = new Date().getHours();
  const part = h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
  return `${part}. I'm your DayFlow assistant — I run entirely on this phone and can only see the data in this app.\n\nAsk me about your day, your streaks or your records, or just tell me things like "add call the bank" or "start morning routine".`;
}

/* ---------- Derived profile: what the app has "learned" ---------- */
function buildUserProfile() {
  const now = new Date();
  const byWeekday = Array.from({ length: 7 }, () => ({ total: 0, done: 0 }));
  let totalTasks = 0, doneTasks = 0;
  const firstBlockMins = [];

  for (let i = 0; i < 60; i++) {
    const d = addDays(now, -i);
    const ds = dateStr(d);
    const dayTasks = state.tasks.filter(t => t.date === ds);
    if (!dayTasks.length) continue;
    const done = dayTasks.filter(t => t.done).length;
    byWeekday[d.getDay()].total += dayTasks.length;
    byWeekday[d.getDay()].done += done;
    totalTasks += dayTasks.length;
    doneTasks += done;
    const timed = dayTasks.filter(t => t.startMin != null).sort((a, b) => a.startMin - b.startMin);
    if (timed.length) firstBlockMins.push(timed[0].startMin);
  }

  let bestDay = null, bestRate = -1, worstDay = null, worstRate = 2;
  byWeekday.forEach((w, i) => {
    if (w.total < 2) return;
    const rate = w.done / w.total;
    if (rate > bestRate) { bestRate = rate; bestDay = i; }
    if (rate < worstRate) { worstRate = rate; worstDay = i; }
  });

  const avgStart = firstBlockMins.length
    ? Math.round(firstBlockMins.reduce((a, b) => a + b, 0) / firstBlockMins.length) : null;

  const habitsRanked = state.habits
    .map(h => ({ h, streak: computeStreak(h), best: computeLongestStreak(h) }))
    .sort((a, b) => b.streak - a.streak);

  const timedHabits = state.habits.filter(h => h.sessions && h.sessions.length);
  const totalPractice = timedHabits.reduce((a, h) => a + habitTotalPracticeSeconds(h), 0);

  return {
    completionRate: totalTasks ? doneTasks / totalTasks : null,
    totalTasks, doneTasks,
    bestDay, bestRate, worstDay, worstRate,
    avgStart,
    habitsRanked,
    timedHabits,
    totalPractice,
    chores: state.chores.filter(c => c.sessions.length),
    openInbox: state.tasks.filter(t => !t.done && t.startMin == null).length,
  };
}

/* ---------- Intent handling ---------- */
function handleChatInput(raw) {
  const text = (raw || '').trim();
  if (!text) return;
  pushChat('user', text);
  renderChat();
  const reply = assistantRespond(text);
  setTimeout(() => {
    pushChat('bot', reply);
    renderChat();
  }, 220);
}

function assistantRespond(raw) {
  const q = raw.toLowerCase().trim();
  const ds = todayStr();

  // --- Commands that change data ---
  let m = q.match(/^(?:add|new|create)\s+(?:a\s+)?(?:task\s+)?(?:called\s+)?(.+)$/);
  if (m && !/habit|routine|alarm|list/.test(m[1].slice(0, 12))) {
    const title = raw.trim().replace(/^(?:add|new|create)\s+(?:a\s+)?(?:task\s+)?(?:called\s+)?/i, '').trim();
    if (title) {
      const parsed = extractTimeFromTitle(title);
      if (parsed) {
        state.tasks.push({ id: uid(), title: parsed.title, date: ds, startMin: null,
          proposedMin: parsed.startMin, durationMin: 30, done: false, createdAt: Date.now() });
        saveState(); renderAll();
        return `Added **${parsed.title}** to your inbox with ${minToLabel(parsed.startMin)} noted. Tap that time on the row to put it on the schedule.`;
      }
      state.tasks.push({ id: uid(), title, date: ds, startMin: null, durationMin: 30, done: false, createdAt: Date.now() });
      saveState(); renderAll();
      return `Added **${title}** to today's inbox. It's untimed — drag it onto the schedule whenever you want, or leave it there.`;
    }
  }

  m = q.match(/^(?:add|new|create|track)\s+(?:a\s+)?habit\s+(?:called\s+)?(.+)$/);
  if (m) {
    const name = raw.trim().replace(/^(?:add|new|create|track)\s+(?:a\s+)?habit\s+(?:called\s+)?/i, '').trim();
    state.habits.push({ id: uid(), name, freq: { type: 'daily' }, completions: {}, sessions: [], dailyTarget: 1, timed: false });
    saveState(); renderAll();
    return `Tracking **${name}** as a daily habit from today. You can change it to an x-per-week habit by tapping its name on the Habits tab.`;
  }

  m = q.match(/(?:start|run|begin|do)\s+(?:the\s+|my\s+)?(.+?)\s*(?:routine)?$/);
  if (m && /routine|morning|bed|gym/.test(q)) {
    const target = m[1].replace(/\b(the|my|routine)\b/g, '').trim();
    const found = state.routines.find(r => r.name.toLowerCase().includes(target)) ||
                  state.routines.find(r => target.includes(r.name.toLowerCase()));
    if (found) {
      setTimeout(() => startRoutine(found), 400);
      return `Starting **${found.name}** — ${found.steps.length} steps, about ${fmtMinSec(routineTotalSeconds(found))}. Timer's coming up now.`;
    }
    if (state.routines.length) {
      return `I don't have a routine matching that. You've got: ${state.routines.map(r => r.name).join(', ')}.`;
    }
  }

  m = q.match(/^(?:mark|make|set|flag)\s+(.+?)\s+(?:as\s+)?(asap|urgent|today|this week|this month)$/);
  if (m) {
    const needle = m[1].replace(/^(the|my)\s+/, '').trim();
    const key = { asap: 'asap', urgent: 'asap', today: 'today', 'this week': 'week', 'this month': 'month' }[m[2]];
    const hit = state.tasks.find(t => !t.done && t.title.toLowerCase().includes(needle));
    if (hit) {
      hit.urgency = key;
      saveState(); renderAll();
      return `Flagged **${hit.title}** as ${URGENCY_BY_ID[key].label.toLowerCase()}.`;
    }
    return `I couldn't find an open task matching "${needle}".`;
  }

  // --- v21 intents ---
  m = q.match(/^(?:find|search|where.*(?:is|are)|look for)\s+(.+)$/);
  if (m) {
    const needle = m[1].replace(/[?.]$/, '').trim();
    const hits = searchEverything(needle);
    if (!hits.length) return `Nothing matching "${needle}" anywhere — tasks, habits, routines, chores, lists or Someday.`;
    return `**${hits.length} match${hits.length === 1 ? '' : 'es'} for "${needle}"**\n\n` +
      hits.slice(0, 8).map(h => `· ${h.title} — ${h.sub}`).join('\n') +
      (hits.length > 8 ? `\n\n…and ${hits.length - 8} more. The search button in the top bar shows all of them.` : '');
  }

  if (/(repeat|recurring|repeating)/.test(q)) {
    if (!state.recurring.length) return `Nothing repeats yet. Open a task, set **Repeat**, and it'll rebuild itself on the days you pick.`;
    return `**Repeating (${state.recurring.length})**\n\n` +
      state.recurring.map(r => `· ${r.title} — ${repeatLabel(r)}${r.paused ? ' (paused)' : ''}`).join('\n');
  }

  if (/(backup|back up|export|lose my data|safe)/.test(q)) {
    const d = daysSince(state.settings.lastExportAt);
    const where = state.settings.storagePersisted === true ? ' Your browser has marked the data persistent, which helps but is not a guarantee.' : '';
    return d === null
      ? `You have never exported a backup. Everything lives in this browser's storage, so clearing website data would take all of it.${where}\n\nSettings › Export JSON writes a file you can keep somewhere else.`
      : `Last backup was ${d === 0 ? 'today' : d + ' day' + (d === 1 ? '' : 's') + ' ago'}.${where}${d >= 7 ? '\n\nWorth doing another — Settings › Export JSON.' : ''}`;
  }

  if (/(notification|notify|remind me while|background|push)/.test(q)) {
    return state.settings.pushOn
      ? `Background reminders are on, sent by your own server. Alerts should reach you with DayFlow closed.`
      : `Right now reminders only appear while DayFlow is open — iOS gives a web app no way to wake itself up, and a push needs a server to do the sending. Settings › Background reminders has the setup, and server/README.md in the repo has the code for it.`;
  }

  if (/(archive|archived|retired)/.test(q)) {
    const n = archiveCounts();
    return n ? `${n} archived item${n === 1 ? '' : 's'}, with all history intact. Settings › Archive restores any of them.`
             : `Nothing archived. Archiving a habit or chore retires it without destroying its record — better than deleting when you might come back.`;
  }

  if (/(energy|tired|exhausted|can'?t focus|low effort|brain)/.test(q)) {
    const want = energyForHour(new Date().getHours());
    const pool = state.tasks.filter(t => !t.done && !t.someday && t.energy === want);
    if (pool.length) return `For this time of day I'd look at ${energyLabel(want).toLowerCase()} work. You've tagged: ${pool.slice(0, 4).map(t => t.title).join(', ')}.`;
    const any = state.tasks.filter(t => !t.done && !t.someday && t.energy);
    return any.length
      ? `Nothing tagged ${energyLabel(want).toLowerCase()} right now. Tagged elsewhere: ${any.slice(0, 4).map(t => `${t.title} (${energyLabel(t.energy).toLowerCase()})`).join(', ')}.`
      : `You haven't tagged anything by effort yet. Open a task and set **Effort** — then I can stop suggesting deep work at midnight.`;
  }

  if (/(what did i (do|get done)|recap|today counted)/.test(q)) {
    const r = buildRecap(todayStr());
    const n = r.tasksDone.length + r.habitsDone.length;
    if (!n) return `Nothing logged today yet. That's a fact, not a verdict.`;
    return `**${n} thing${n === 1 ? '' : 's'} done today**\n\n` +
      r.tasksDone.map(t => `· ${t.title}`).concat(r.habitsDone.map(h => `· ${h.name}`)).join('\n') +
      (r.left ? `\n\n${r.left} still open — they roll over.` : '');
  }

  if (/(what|show|any).*(asap|urgent)/.test(q)) {
    const asap = state.tasks.filter(t => !t.done && t.urgency === 'asap');
    if (!asap.length) return `Nothing flagged ASAP right now. Tap a task and pick "Do ASAP" if something needs to jump the queue.`;
    return `**Flagged ASAP (${asap.length})**\n\n` + asap.map(t => `· ${t.title}`).join('\n');
  }

  m = q.match(/remember (?:that )?(.+)/);
  if (m) {
    const fact = raw.trim().replace(/^remember\s+(?:that\s+)?/i, '').trim();
    state.aiMemory.facts.push({ id: uid(), text: fact, ts: Date.now() });
    saveState();
    return `Noted: **${fact}**\n\nI'll keep that in mind. Ask "what do you know about me" any time to see everything I'm holding.`;
  }

  if (/^(forget|clear).*(memor|remember|know)/.test(q)) {
    const n = state.aiMemory.facts.length;
    state.aiMemory.facts = [];
    saveState();
    return n ? `Forgotten — cleared ${n} note${n === 1 ? '' : 's'}.` : `I wasn't holding any notes about you.`;
  }

  // --- Questions about the day ---
  if (/(what|whats|what's|show).*(today|schedule|plan|on now|day look)/.test(q) || q === 'today') {
    return describeToday(ds);
  }

  if (/(what|which).*(next|should i do|focus)/.test(q) || /what now/.test(q)) {
    return suggestNext(ds);
  }

  if (/(how|hows|how's).*(week|doing|going|month|progress)/.test(q) || /review/.test(q)) {
    return weekReview();
  }

  if (/streak/.test(q)) {
    return streakReport();
  }

  if (/(record|pr|personal best|practice|longest session)/.test(q)) {
    return recordsReport();
  }

  if (/how long.*(take|does|spend)/.test(q) || /(average|avg).*(chore|time)/.test(q)) {
    return choreReport(q);
  }

  if (/(what do you know|about me|my pattern|insight|learned)/.test(q)) {
    return profileReport();
  }

  if (/(habit|inbox|task).*(list|show|all)|^habits?$|^tasks?$/.test(q)) {
    return listReport(q);
  }

  if (/(what version|which version|build|update)/.test(q)) {
    return `You're running **DayFlow ${APP_VERSION}**, built ${APP_BUILT}.\n\nIf that looks older than you expect, open Settings and tap "Check for update" — it clears the cache and reloads.`;
  }

  if (/(help|what can you do|commands)/.test(q)) {
    return assistantHelp();
  }

  if (/^(hi|hey|hello|yo|sup|good (morning|evening|afternoon))\b/.test(q)) {
    return assistantGreeting();
  }

  if (/(thanks|thank you|ty|nice|cool|awesome)/.test(q)) {
    return `Any time. I'm here whenever you need a nudge.`;
  }

  return assistantFallback(raw);
}

function describeToday(ds) {
  const dayTasks = state.tasks.filter(t => t.date === ds);
  const timed = dayTasks.filter(t => t.startMin != null).sort((a, b) => a.startMin - b.startMin);
  const untimed = dayTasks.filter(t => t.startMin == null && !t.done);
  const done = dayTasks.filter(t => t.done).length;
  const lists = state.lists.filter(l => l.attachedDate === ds);

  if (!dayTasks.length && !lists.length) {
    return `Today's completely clear — nothing scheduled and nothing in the inbox. If that's wrong, tell me what to add.`;
  }

  let out = `**Today**\n`;
  if (timed.length) {
    out += `\nScheduled (${timed.length}):\n`;
    timed.forEach(t => { out += `${t.done ? '✓' : '·'} ${minToLabel(t.startMin)} — ${t.title}\n`; });
  }
  if (untimed.length) {
    out += `\nInbox (${untimed.length}, untimed):\n`;
    untimed.slice(0, 6).forEach(t => { out += `· ${t.title}${t.urgency ? ` [${URGENCY_BY_ID[t.urgency].short}]` : ''}\n`; });
    if (untimed.length > 6) out += `…and ${untimed.length - 6} more\n`;
  }
  lists.forEach(l => {
    const open = l.items.filter(i => !i.done).length;
    if (open) out += `\n${l.name}: {{${open}}} item${open === 1 ? '' : 's'} left\n`;
  });
  if (dayTasks.length) out += `\nDone so far: {{${done}}} of {{${dayTasks.length}}}.`;
  return out.trim();
}

function suggestNext(ds) {
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const dayTasks = state.tasks.filter(t => t.date === ds && !t.done);

  // Anything flagged ASAP jumps the queue, scheduled or not.
  const asap = state.tasks.filter(t => !t.done && t.urgency === 'asap');
  if (asap.length) {
    return `You've flagged **${asap[0].title}** as ASAP${asap.length > 1 ? ` (plus ${asap.length - 1} more)` : ''} — that's the one to do now, before anything on the schedule.`;
  }
  const current = dayTasks.find(t => t.startMin != null && t.startMin <= nowMin && t.startMin + t.durationMin > nowMin);
  if (current) return `Right now you're meant to be on **${current.title}** — it runs until ${minToLabel(current.startMin + current.durationMin)}.`;

  const next = dayTasks.filter(t => t.startMin != null && t.startMin > nowMin).sort((a, b) => a.startMin - b.startMin)[0];
  if (next) {
    const gap = next.startMin - nowMin;
    const untimed = dayTasks.filter(t => t.startMin == null);
    let out = `Next up is **${next.title}** at ${minToLabel(next.startMin)} — that's {{${gap}}} minutes away.`;
    if (untimed.length && gap >= 15) {
      const quick = untimed[0];
      out += `\n\nEnough of a gap to knock out **${quick.title}** from the inbox first, if you want the easy win.`;
    }
    return out;
  }

  const untimed = dayTasks.filter(t => t.startMin == null && !t.someday);
  const undoneHabits = state.habits.filter(h => !h.archived && !habitDoneOn(h, todayStr()));
  if (untimed.length) {
    // Match the suggestion to the hour. Offering deep work at 11pm is how a
    // task gets postponed for the twelfth time.
    const want = energyForHour(new Date().getHours());
    const fit = untimed.find(t => t.energy === want);
    if (fit) {
      const because = want === 'high' ? 'while your head is still fresh'
        : want === 'medium' ? 'a decent middle-of-the-day one'
        : 'and it barely needs any focus, which suits this hour';
      return `Nothing scheduled for the rest of today. **${fit.title}** is tagged ${energyLabel(want).toLowerCase()} — ${because}.`;
    }
    const lowFirst = untimed.slice().sort((a, b) =>
      ((a.durationMin || 30) - (b.durationMin || 30)))[0];
    return `Nothing scheduled for the rest of today. Shortest thing in your inbox is **${lowFirst.title}** (${fmtDuration(lowFirst.durationMin || 30)}) — start there, it's the lowest-friction one.`;
  }
  if (undoneHabits.length) {
    return `Schedule's clear and the inbox is empty. Still open today: ${undoneHabits.map(h => h.name).join(', ')}. Pick whichever feels easiest right now.`;
  }
  return `Nothing left on the board today — schedule clear, inbox empty, habits checked off. You're done. Genuinely.`;
}

function weekReview() {
  const p = buildUserProfile();
  if (p.completionRate == null) return `Not enough history yet to review — once you've been ticking things off for a few days I'll have something useful to say.`;

  const now = new Date();
  let wTotal = 0, wDone = 0;
  for (let i = 0; i < 7; i++) {
    const ds = dateStr(addDays(now, -i));
    const dayTasks = state.tasks.filter(t => t.date === ds);
    wTotal += dayTasks.length;
    wDone += dayTasks.filter(t => t.done).length;
  }
  const pct = wTotal ? Math.round((wDone / wTotal) * 100) : 0;

  let out = `**Last 7 days**\n\nTasks: {{${wDone}}}/{{${wTotal}}} done ({{${pct}%}}).`;
  const top = p.habitsRanked[0];
  if (top && top.streak > 0) out += `\nLongest live streak: **${top.h.name}** at {{${top.streak}}}.`;
  const cold = p.habitsRanked.filter(x => x.streak === 0);
  if (cold.length) out += `\nCold right now: ${cold.map(x => x.h.name).join(', ')}.`;
  if (p.bestDay != null) out += `\n\nYour strongest day tends to be **${WDFULL[p.bestDay]}** ({{${Math.round(p.bestRate * 100)}%}}).`;
  if (p.totalPractice) out += `\nPractice logged: {{${fmtMinSec(p.totalPractice)}}} all-time.`;
  return out;
}

function streakReport() {
  if (!state.habits.length) return `No habits yet. Say "add habit stretch" and I'll start tracking one.`;
  let out = `**Streaks**\n\n`;
  state.habits
    .map(h => ({ h, cur: computeStreak(h), best: computeLongestStreak(h) }))
    .sort((a, b) => b.cur - a.cur)
    .forEach(({ h, cur, best }) => {
      const flame = cur >= 7 ? ' ●' : '';
      const t = habitTarget(h);
      const todayBit = t > 1 ? ` · today {{${habitCount(h, todayStr())}/${t}}}` : '';
      out += `${h.name} — now {{${cur}}}, best {{${best}}}${flame}${todayBit}\n`;
    });
  const atRisk = state.habits.filter(h => computeStreak(h) > 2 && !habitDoneOn(h, todayStr()));
  if (atRisk.length) out += `\nStill unchecked today: **${atRisk.map(h => h.name).join(', ')}** — worth protecting.`;
  return out.trim();
}

function recordsReport() {
  const timed = state.habits.filter(h => h.sessions && h.sessions.length);
  const chores = state.chores.filter(c => c.sessions.length);
  if (!timed.length && !chores.length) {
    return `No timed records yet. Open a habit and switch its **practice timer** on (good for guitar, reading, meditation), then hit play to time a session. The chore timer works the same way.`;
  }
  let out = `**Records**\n`;
  if (timed.length) {
    out += `\nPractice:\n`;
    timed.forEach(h => {
      out += `${h.name} — PR {{${fmtMinSec(habitPR(h))}}}, avg ${fmtMinSec(habitAvgSession(h))}, ${h.sessions.length} sessions\n`;
    });
    const total = timed.reduce((a, h) => a + habitTotalPracticeSeconds(h), 0);
    out += `Total practice: {{${fmtMinSec(total)}}}\n`;
  }
  if (chores.length) {
    out += `\nChores:\n`;
    chores.forEach(c => { out += `${c.name} — usually {{${fmtMinSec(choreAverage(c))}}}\n`; });
  }
  return out.trim();
}

function choreReport(q) {
  const chores = state.chores.filter(c => c.sessions.length);
  if (!chores.length) return `I haven't timed any chores yet. Open the chore timer (⏳ up top), pick one and hit start — after a run or two I'll know your average.`;
  const match = chores.find(c => q.includes(c.name.toLowerCase().split(' ')[0]));
  if (match) {
    const avg = choreAverage(match), last = choreLast(match);
    return `**${match.name}** takes you about {{${fmtMinSec(avg)}}} on average.\n\nLast run was ${fmtMinSec(last)}, across ${match.sessions.length} timed run${match.sessions.length === 1 ? '' : 's'}. Worth remembering next time it feels like an hour-long job.`;
  }
  let out = `Here's how long things actually take you:\n\n`;
  chores.forEach(c => { out += `${c.name} — {{${fmtMinSec(choreAverage(c))}}}\n`; });
  return out.trim();
}

function profileReport() {
  const p = buildUserProfile();
  const facts = state.aiMemory.facts;
  let out = `**What I've picked up**\n`;
  let anything = false;

  if (p.completionRate != null) {
    anything = true;
    out += `\nYou finish about {{${Math.round(p.completionRate * 100)}%}} of what you put on the board.`;
  }
  if (p.bestDay != null && p.worstDay != null && p.bestDay !== p.worstDay) {
    anything = true;
    out += `\n**${WDFULL[p.bestDay]}** is your best day; **${WDFULL[p.worstDay]}** is where things slip.`;
  }
  if (p.avgStart != null) {
    anything = true;
    out += `\nYour first scheduled block usually lands around **${minToLabel(p.avgStart)}**.`;
  }
  const top = p.habitsRanked[0];
  if (top && top.streak > 0) {
    anything = true;
    out += `\nMost consistent habit: **${top.h.name}** ({{${top.streak}}} day streak).`;
  }
  if (p.totalPractice) {
    anything = true;
    out += `\nYou've logged {{${fmtMinSec(p.totalPractice)}}} of timed practice.`;
  }
  if (p.openInbox) {
    anything = true;
    out += `\nRight now there are {{${p.openInbox}}} untimed things sitting in your inbox.`;
  }

  if (facts.length) {
    out += `\n\n**Things you told me:**\n`;
    facts.forEach(f => { out += `· ${f.text}\n`; });
  }

  if (!anything && !facts.length) {
    return `Honestly, not much yet — I only learn from what's in this app, and there isn't enough history to spot patterns. Use it for a week or so and ask again.\n\nYou can also tell me things directly: "remember that I focus best before noon".`;
  }

  out += `\n_All of this is computed on your phone from your own data — nothing is sent anywhere._`;
  return out.trim();
}

function listReport(q) {
  if (/habit/.test(q)) {
    if (!state.habits.length) return `No habits tracked yet.`;
    return `**Habits**\n\n` + state.habits.map(h => `· ${h.name} (${habitFreqLabel(h)}) — streak {{${computeStreak(h)}}}`).join('\n');
  }
  const open = state.tasks.filter(t => !t.done);
  if (!open.length) return `Nothing open. Everything's either done or you haven't added it yet.`;
  return `**Open tasks (${open.length})**\n\n` + open.slice(0, 12).map(t => `· ${t.title}${t.startMin != null ? ` — ${minToLabel(t.startMin)}` : ''}`).join('\n');
}

function assistantHelp() {
  return `**Things I can do**\n\nAsk:\n· What's on today?\n· How am I doing this week?\n· What should I do next?\n· I'm tired, what can I do?\n· Find landlord\n· What did I get done today?\n· What repeats?\n· When did I last back up?\n· How long does washing dishes take?\n· Show my streaks / records\n· What do you know about me?\n\nTell:\n· add call the bank\n· add habit stretch\n· mark call the bank as asap\n· start morning routine\n· remember that I hate mornings\n\nI'm a pattern matcher running entirely on your phone, not a language model — plain phrasing works best, and nothing you type here leaves the device.`;
}

function assistantFallback(raw) {
  const p = buildUserProfile();
  const hint = p.openInbox
    ? `\n\nFor what it's worth, you've got {{${p.openInbox}}} things in the inbox right now if you're looking for somewhere to start.`
    : '';
  return `I didn't catch that one. I'm a small on-device matcher rather than a full language model, so I only understand a fixed set of phrasings.\n\nTry "help" to see exactly what I respond to — or if you meant to capture it, say "add ${raw.slice(0, 40)}".${hint}`;
}

/* ======================= Settings sheet ======================= */
on('settingsBtn', 'click', () => {
  applyTheme();
  renderRemindersToggle();
  renderFlowToggles();
  renderPushRow();
  renderBackupRow();
  renderSupporterRow();
  renderWorkRows();
  const chip = document.getElementById('versionChip');
  if (chip) chip.textContent = APP_VERSION;
  const note = document.getElementById('versionNote');
  if (note) note.innerHTML = `You're on ${APP_VERSION}<span class="built">built ${APP_BUILT}</span>`;
  openSheet('settingsSheet');
});

/* Force a genuinely fresh copy: drop every cache and service worker, then
   reload. Closing and reopening an installed PWA is not always enough. */
on('forceUpdateBtn', 'click', async () => {
  const btn = document.getElementById('forceUpdateBtn');
  const restore = () => { if (btn) { btn.disabled = false; btn.textContent = 'Check for update'; } };
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }

  // Ask the server what version it holds before tearing anything down, so the
  // button can actually answer "is there an update?" instead of silently
  // reloading into the same build.
  const remote = await fetchRemoteVersion();

  if (remote && remote === APP_VERSION) {
    toast(`Already up to date (${APP_VERSION})`, 3500);
    restore();
    return;
  }

  if (btn) btn.textContent = remote ? `Updating to ${remote}…` : 'Updating…';
  toast(remote ? `Update found: ${remote}` : 'Refreshing…');

  try {
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch (e) {
    console.warn('[DayFlow] cache clear failed', e);
  }

  // A plain reload can still be served from the HTTP cache in an installed
  // PWA, so navigate to a one-off URL instead. The marker is stripped on boot.
  const base = location.href.split('?')[0].split('#')[0];
  location.replace(base + '?fresh=' + Date.now());
});

document.querySelectorAll('#themeOptions .freq-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    state.settings.theme = btn.dataset.theme;
    saveState();
    applyTheme();
  });
});

/* ======================= Reminders / notifications ======================= */
/* ======================= Reminders =======================
   The old scheduler fired only on an exact minute match, which meant any
   minute the page was suspended, throttled or simply not running was a minute
   whose reminder never existed. Now the day's due times are computed as a
   list and anything recently passed but undelivered still fires, so a phone
   that was in a pocket for four minutes doesn't silently eat the alert.

   Delivery keys are persisted, so a reload doesn't replay the last quarter
   hour of reminders. They live outside the undo snapshot on purpose —
   "already told you about this" isn't a user action to rewind. */
function renderRemindersToggle() {
  const btn = document.getElementById('remindersToggleBtn');
  const note = document.getElementById('remindersNote');
  if (!btn || !note) return;
  const supported = 'Notification' in window;
  if (!supported) {
    btn.textContent = 'Unsupported';
    btn.disabled = true;
    note.textContent = 'This browser doesn’t support notifications. Reminders will still show as in-app banners while DayFlow is open.';
    return;
  }
  const on = state.settings.remindersEnabled && Notification.permission === 'granted';
  btn.textContent = on ? 'On' : 'Off';
  btn.classList.toggle('active', on);
  if (Notification.permission === 'denied') {
    note.textContent = 'Notifications are blocked for DayFlow in your browser/OS settings. Enable them there, then toggle this back on.';
  } else {
    note.textContent = 'Alerts when a time-blocked task starts, five minutes before it starts and ends, and when a routine is due. These fire while DayFlow is open — see Background reminders below for alerts that arrive when it is closed.';
  }
}

on('remindersToggleBtn', 'click', async () => {
  if (!('Notification' in window)) return;
  if (!state.settings.remindersEnabled) {
    let perm = Notification.permission;
    if (perm === 'default') {
      try { perm = await Notification.requestPermission(); } catch (e) { perm = 'denied'; }
    }
    if (perm === 'granted') {
      state.settings.remindersEnabled = true;
      saveState('silent');
      toast('Reminders on');
    } else {
      toast('Notification permission denied');
    }
  } else {
    state.settings.remindersEnabled = false;
    saveState('silent');
    toast('Reminders off');
  }
  renderRemindersToggle();
});

function fireReminder(title, body) {
  if (state.settings.remindersEnabled && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: 'icons/icon-192.png' }); } catch (e) { /* ignore */ }
  }
  toast(body);
}

const NOTIFIED_KEY = 'dayflow.notified';
const CATCHUP_MIN = 15;      // how stale a reminder may be and still be worth showing

function loadNotified() {
  try {
    const raw = JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '{}');
    if (raw.date === todayStr() && Array.isArray(raw.keys)) return new Set(raw.keys);
  } catch (e) { /* corrupt or absent: start clean */ }
  return new Set();
}
const notifiedTaskKeys = loadNotified();

function persistNotified() {
  try {
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify({ date: todayStr(), keys: [...notifiedTaskKeys] }));
  } catch (e) { /* storage full: reminders simply repeat, which is survivable */ }
}

/* Everything that could be due today, as data. Building the list separately
   from delivering it is what makes catch-up and testing possible at all. */
function todayReminderEvents() {
  const ds = todayStr();
  const events = [];
  const warn = state.settings.transitionWarn !== false;

  state.tasks.forEach(t => {
    if (t.date !== ds || t.startMin == null || t.done || t.someday) return;
    events.push({ min: t.startMin, key: `${ds}_${t.id}`, title: 'Time to start', body: t.title });
    if (!warn) return;
    events.push({ min: t.startMin - 5, key: `${ds}_${t.id}_pre`, title: 'Start wrapping up', body: `${t.title} in 5 minutes` });
    events.push({ min: t.startMin + (t.durationMin || 30) - 5, key: `${ds}_${t.id}_end`, title: '5 minutes left', body: t.title });
  });

  state.routines.forEach(r => {
    if (!r.remindAt || r.archived) return;
    events.push({ min: timeToMin(r.remindAt), key: `${ds}_rt_${r.id}`, title: 'Routine time', body: `Time for your “${r.name}” routine` });
  });

  state.alarmStacks.forEach(stack => {
    [0, ALARM_GAP_MIN, ALARM_GAP_MIN * 2].forEach((off, i) => {
      events.push({
        min: (stack.startMin + off) % 1440,
        key: `${ds}_${stack.id}_${i}`,
        title: `${stack.label} (${i + 1}/3)`,
        body: i === 2 ? 'Last call.' : 'Time to move.',
      });
    });
  });

  return events.filter(e => e.min >= 0 && e.min < 1440);
}

function checkReminders() {
  // The evening recap isn't a notification, so it runs regardless of whether
  // system reminders are switched on.
  try { maybeAutoRecap(); } catch (e) { /* never let the recap break the tick */ }
  try { materialiseRecurring(); } catch (e) { console.warn('[DayFlow] recurring', e); }
  if (!state.settings.remindersEnabled) return;

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let changed = false;

  todayReminderEvents().forEach(ev => {
    if (ev.min > nowMin || notifiedTaskKeys.has(ev.key)) return;
    notifiedTaskKeys.add(ev.key);
    changed = true;
    // Anything older than the catch-up window is marked delivered but stays
    // silent: being told at 4pm that something was due at 9am is just noise.
    if (nowMin - ev.min <= CATCHUP_MIN) fireReminder(ev.title, ev.body);
  });

  if (changed) persistNotified();
}
setInterval(checkReminders, 20000);
// Run once at launch too. Waiting a full interval meant that opening the app
// at the exact moment something was due showed nothing for twenty seconds.
setTimeout(checkReminders, 600);

/* ======================= Push =======================
   Everything below is the client half of real notifications: permission,
   subscription, and handing the subscription somewhere. It works today only
   as far as the browser — the piece that actually sends while DayFlow is shut
   has to run on a server, and this app is otherwise entirely local. Rather
   than pretend, the UI states plainly which half is live. See server/README.md
   for the ~60 lines that complete it. */
const PUSH_ENDPOINT_KEY = 'dayflow.pushEndpoint';

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function pushConfigured() { return !!(state.settings.pushServer && state.settings.pushKey); }

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function subscribeToPush() {
  if (!pushSupported()) { toast('This browser can’t do background notifications'); return false; }
  if (!pushConfigured()) { openPushSetup(); return false; }
  try {
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Notification permission denied'); return false; }

    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub = existing || await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(state.settings.pushKey),
    });

    const res = await fetch(state.settings.pushServer.replace(/\/$/, '') + '/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub, schedule: pushSchedulePayload() }),
    });
    if (!res.ok) throw new Error('server said ' + res.status);
    localStorage.setItem(PUSH_ENDPOINT_KEY, sub.endpoint);
    state.settings.pushOn = true;
    saveState('silent');
    toast('Background reminders on');
    return true;
  } catch (err) {
    console.warn('[DayFlow] push subscribe failed', err);
    toast('Couldn’t reach your reminder server — check the address in Settings', 5000);
    return false;
  }
}

async function unsubscribeFromPush() {
  state.settings.pushOn = false;
  saveState('silent');
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      if (pushConfigured()) {
        fetch(state.settings.pushServer.replace(/\/$/, '') + '/unsubscribe', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
      }
      await sub.unsubscribe();
    }
  } catch (e) { /* already gone */ }
  localStorage.removeItem(PUSH_ENDPOINT_KEY);
  toast('Background reminders off');
}

/* What the server needs in order to fire without the app: the day's due times
   in plain local minutes, refreshed whenever the schedule changes. */
function pushSchedulePayload() {
  return {
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
    date: todayStr(),
    events: todayReminderEvents().map(e => ({ min: e.min, title: e.title, body: e.body, key: e.key })),
  };
}

async function syncPushSchedule() {
  if (!state.settings.pushOn || !pushConfigured()) return;
  const endpoint = localStorage.getItem(PUSH_ENDPOINT_KEY);
  if (!endpoint) return;
  try {
    await fetch(state.settings.pushServer.replace(/\/$/, '') + '/schedule', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, schedule: pushSchedulePayload() }),
    });
  } catch (e) { /* offline: the next sync will carry it */ }
}

function renderPushRow() {
  const btn = document.getElementById('pushToggleBtn');
  const note = document.getElementById('pushNote');
  if (!btn || !note) return;
  if (!pushSupported()) {
    btn.textContent = 'Unsupported';
    btn.disabled = true;
    note.textContent = 'This browser has no Push API. On iPhone, add DayFlow to your Home Screen and open it from there — Safari tabs can’t receive background notifications.';
    return;
  }
  const on = !!state.settings.pushOn;
  btn.disabled = false;
  btn.textContent = on ? 'On' : 'Off';
  btn.classList.toggle('active', on);
  note.textContent = pushConfigured()
    ? (on ? `Reminders are sent by ${state.settings.pushServer} even when DayFlow is closed.`
          : 'Switch on to receive reminders while DayFlow is shut.')
    : 'Not set up yet. Reminders currently only appear while DayFlow is open — iOS gives a web app no way to wake itself. Tap Set up to point DayFlow at a small server that can send them (server/README.md in the repo has the code).';
}

on('pushToggleBtn', 'click', async () => {
  if (state.settings.pushOn) { await unsubscribeFromPush(); }
  else { await subscribeToPush(); }
  renderPushRow();
});

function openPushSetup() {
  document.getElementById('pushServerInput').value = state.settings.pushServer || '';
  document.getElementById('pushKeyInput').value = state.settings.pushKey || '';
  openSheet('pushSetupSheet');
}
on('pushSetupBtn', 'click', openPushSetup);
on('pushSaveBtn', 'click', async () => {
  const server = document.getElementById('pushServerInput').value.trim();
  const key = document.getElementById('pushKeyInput').value.trim();
  state.settings.pushServer = server || null;
  state.settings.pushKey = key || null;
  saveState('silent');
  closeSheets();
  renderPushRow();
  if (server && key) await subscribeToPush();
  renderPushRow();
});

/* ======================= Backup safety =======================
   Everything lives in localStorage, which iOS will evict from a web app you
   haven't opened in a while, and which one "Clear website data" wipes without
   confirmation. A manual export button nobody remembers to press is not a
   backup strategy, so the app asks for durable storage, keeps a second copy
   under its own key, and says out loud how long it has been. */
const BACKUP_KEY = 'dayflow.v1.bak';
const BACKUP_NAG_DAYS = 7;

async function requestPersistentStorage() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (e) { return null; }
}

function writeLocalSnapshot() {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify({ at: Date.now(), state: JSON.parse(lastSnapshot || '{}') }));
    return true;
  } catch (e) { return false; }
}

function localSnapshotInfo() {
  try {
    const raw = JSON.parse(localStorage.getItem(BACKUP_KEY) || 'null');
    if (!raw || !raw.state) return null;
    return { at: raw.at, tasks: (raw.state.tasks || []).length, habits: (raw.state.habits || []).length };
  } catch (e) { return null; }
}

function daysSince(ts) { return ts ? Math.floor((Date.now() - ts) / 86400000) : null; }

function hasRealData() {
  return state.tasks.length + state.habits.length + state.routines.length + state.chores.length > 0;
}

function renderBackupRow() {
  const note = document.getElementById('backupNote');
  if (!note) return;
  const d = daysSince(state.settings.lastExportAt);
  const snap = localSnapshotInfo();
  const persisted = state.settings.storagePersisted;
  const bits = [];
  bits.push(d == null ? 'You have never exported a backup.'
    : d === 0 ? 'Backed up today.'
    : `Last backup ${d} day${d === 1 ? '' : 's'} ago.`);
  if (snap) bits.push(`A local snapshot from ${daysSince(snap.at) === 0 ? 'today' : daysSince(snap.at) + ' days ago'} holds ${snap.tasks} tasks and ${snap.habits} habits.`);
  bits.push(persisted === true
    ? 'Your browser has marked this data as persistent.'
    : 'Note that a local snapshot dies with the website data — an exported file is the only backup that survives clearing Safari.');
  note.textContent = bits.join(' ');
}

function renderBackupBanner() {
  const el = document.getElementById('backupBanner');
  if (!el) return;
  const d = daysSince(state.settings.lastExportAt);
  const stale = hasRealData() && (d === null || d >= BACKUP_NAG_DAYS);
  el.hidden = !stale || state.view.current !== 'today' || !!state.settings.focusMode;
  if (stale) {
    document.getElementById('backupBannerText').textContent = d === null
      ? 'Your data has never been backed up'
      : `Last backup was ${d} days ago`;
  }
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dayflow-backup-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  state.settings.lastExportAt = Date.now();
  saveState('silent');
  writeLocalSnapshot();
  renderBackupRow();
  renderBackupBanner();
  toast('Exported — keep it somewhere that isn’t this phone');
}

on('backupBannerBtn', 'click', exportBackup);
on('backupSnapshotBtn', 'click', () => {
  toast(writeLocalSnapshot() ? 'Local snapshot saved' : 'Could not write a snapshot — storage may be full');
  renderBackupRow();
});
on('backupRestoreBtn', 'click', () => {
  const snap = localSnapshotInfo();
  if (!snap) { toast('No local snapshot to restore'); return; }
  const when = daysSince(snap.at) === 0 ? 'today' : `${daysSince(snap.at)} days ago`;
  if (!confirm(`Restore the local snapshot from ${when}? It holds ${snap.tasks} tasks and ${snap.habits} habits, and will replace what is here now. This is undoable.`)) return;
  try {
    const raw = JSON.parse(localStorage.getItem(BACKUP_KEY));
    const here = { ...state.view };
    state = raw.state;
    state.view = here;
    ensureHabitSessions(state);
    ensureNewCollections(state);
    saveState('restoring a snapshot');
    applyTheme();
    closeSheets();
    renderAll();
    toast('Snapshot restored');
  } catch (e) {
    toast('That snapshot could not be read');
  }
});


on('exportBtn', 'click', exportBackup);

/* ======================= Importing other people's files =======================
   The old importer accepted exactly one shape — a full DayFlow backup — and
   answered everything else with "invalid file". That is a terrible response to
   a perfectly reasonable content calendar, a spreadsheet export, or anything
   an AI wrote for you. It now takes a backup, a bare list of items, or a CSV,
   guesses which columns mean what, shows you what it found, and *adds* rather
   than replacing, so a bad guess costs you nothing. */

// Field names people and tools actually use, in preference order.
const IMPORT_FIELDS = {
  title: ['title', 'name', 'task', 'post', 'topic', 'subject', 'headline', 'summary', 'event', 'item', 'label', 'text', 'content', 'caption', 'description'],
  date: ['date', 'day', 'publishdate', 'publish_date', 'scheduleddate', 'scheduled_date', 'scheduledfor', 'scheduled_for', 'due', 'duedate', 'due_date', 'when', 'start', 'startdate', 'start_date', 'datetime', 'start_time', 'starttime', 'postdate', 'post_date'],
  time: ['time', 'starttime', 'start_time', 'attime', 'at', 'posttime', 'post_time', 'scheduledtime', 'scheduled_time'],
  duration: ['duration', 'durationmin', 'duration_min', 'minutes', 'mins', 'length', 'estimate', 'estimatedminutes'],
  notes: ['notes', 'note', 'description', 'details', 'body', 'copy', 'caption', 'content', 'script', 'hook', 'cta', 'hashtags', 'platform', 'channel', 'format', 'pillar', 'category', 'status'],
  priority: ['priority', 'urgency', 'importance'],
};

function pick(obj, names) {
  const lower = {};
  Object.keys(obj || {}).forEach(k => { lower[k.toLowerCase().replace(/[\s-]/g, '_')] = obj[k]; });
  for (const n of names) {
    const v = lower[n] ?? lower[n.replace(/_/g, '')];
    if (v !== undefined && v !== null && String(v).trim() !== '') return { key: n, value: v };
  }
  return null;
}

// Accepts 2026-08-16, 16/08/2026, "Aug 16", "August 16 2026", ISO datetimes.
function coerceDate(v) {
  if (v == null) return null;
  const str = String(v).trim();
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = str.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})$/);
  if (m) {
    // Day-first unless the first number can't be a day.
    let [, a, b, y] = m;
    if (y.length === 2) y = '20' + y;
    const day = +a > 12 ? +a : +a, mon = +a > 12 ? +b : +b;
    return `${y}-${pad2(mon)}-${pad2(day)}`;
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    // A bare "Aug 16" parses to year 2001 in some engines; assume this year.
    if (d.getFullYear() < 2015) d.setFullYear(new Date().getFullYear());
    return dateStr(d);
  }
  return null;
}

// "14:30", "2:30pm", "2pm", or the time half of an ISO stamp.
function coerceTime(v) {
  if (v == null) return null;
  const str = String(v).trim();
  let m = str.match(/T(\d{2}):(\d{2})/);
  if (m) return (+m[1]) * 60 + (+m[2]);
  m = str.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (m) {
    let h = +m[1];
    const min = +(m[2] || 0);
    const ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    // A bare number with no am/pm and no colon is more likely a duration.
    if (!m[2] && !ap) return null;
    return h * 60 + min;
  }
  return null;
}

function normalizeImportItem(o) {
  if (typeof o === 'string') {
    const t = o.trim();
    return t ? { title: t.slice(0, 140), date: null, startMin: null, durationMin: 30, notes: '' } : null;
  }
  if (!o || typeof o !== 'object') return null;

  const titleHit = pick(o, IMPORT_FIELDS.title);
  if (!titleHit) return null;
  let title = String(titleHit.value).replace(/\s+/g, ' ').trim();
  let overflow = '';
  if (title.length > 90) { overflow = title; title = title.slice(0, 87).trimEnd() + '…'; }

  const dateHit = pick(o, IMPORT_FIELDS.date);
  const date = dateHit ? coerceDate(dateHit.value) : null;

  const timeHit = pick(o, IMPORT_FIELDS.time);
  let startMin = timeHit ? coerceTime(timeHit.value) : null;
  if (startMin == null && dateHit) startMin = coerceTime(dateHit.value);

  const durHit = pick(o, IMPORT_FIELDS.duration);
  const durationMin = durHit ? Math.max(5, Math.round(parseFloat(durHit.value) || 30)) : 30;

  // Everything else worth keeping becomes notes, so nothing is silently lost.
  const noteBits = [];
  if (overflow) noteBits.push(overflow);
  Object.keys(o).forEach(k => {
    const key = k.toLowerCase().replace(/[\s-]/g, '_');
    if (!IMPORT_FIELDS.notes.includes(key)) return;
    if (titleHit && key === titleHit.key) return;
    const v = o[k];
    if (v == null || String(v).trim() === '') return;
    const val = Array.isArray(v) ? v.join(', ') : String(v).trim();
    noteBits.push(`${k}: ${val}`);
  });

  const prioHit = pick(o, IMPORT_FIELDS.priority);
  const prio = prioHit ? String(prioHit.value).toLowerCase() : '';
  const urgency = /urgent|asap|high|p1/.test(prio) ? 'asap'
    : /today/.test(prio) ? 'today'
    : /medium|p2|week/.test(prio) ? 'week'
    : /low|p3|month/.test(prio) ? 'month' : null;

  return { title, date, startMin, durationMin, notes: noteBits.join('\n'), urgency };
}

/* A small CSV reader: quoted fields, embedded commas and newlines, doubled
   quotes. Enough for anything a spreadsheet or an AI hands you. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const src = text.replace(/\r\n/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];

  const headers = rows[0].map(h => h.trim());
  return rows.slice(1)
    .filter(r => r.some(c => c.trim() !== ''))
    .map(r => {
      const o = {};
      headers.forEach((h, i) => { o[h] = (r[i] || '').trim(); });
      return o;
    });
}

/* Finds the list inside whatever wrapper it arrived in — {posts:[…]},
   {data:{items:[…]}}, or a bare array. */
function findItemArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return null;
  const named = ['items', 'posts', 'events', 'tasks', 'entries', 'rows', 'schedule', 'calendar', 'data', 'content'];
  for (const k of named) {
    if (Array.isArray(data[k])) return data[k];
    if (data[k] && typeof data[k] === 'object') {
      const inner = findItemArray(data[k]);
      if (inner) return inner;
    }
  }
  const arrays = Object.values(data).filter(Array.isArray);
  return arrays.length === 1 ? arrays[0] : null;
}

let pendingImport = [];

function renderImportPreview() {
  const wrap = document.getElementById('importPreview');
  const dated = pendingImport.filter(i => i.date).length;
  const timed = pendingImport.filter(i => i.startMin != null).length;
  document.getElementById('importSummary').innerHTML =
    `<strong>${pendingImport.length}</strong> item${pendingImport.length === 1 ? '' : 's'} · ` +
    `${dated} with a date · ${timed} with a time. ` +
    `Anything undated lands in your inbox, and nothing you already have is touched.`;
  wrap.innerHTML = '';
  pendingImport.slice(0, 6).forEach(i => {
    const row = document.createElement('div');
    row.className = 'someday-row';
    const when = i.date ? (i.startMin != null ? `${i.date} · ${minToLabel(i.startMin)}` : i.date) : 'no date — inbox';
    row.innerHTML = `<span class="sd-title">${escapeHtml(i.title)}<span class="rule-sub">${escapeHtml(when)}</span></span>`;
    wrap.appendChild(row);
  });
  if (pendingImport.length > 6) {
    const more = document.createElement('p');
    more.className = 'settings-note';
    more.style.cssText = 'text-align:left;margin:2px 0 0;';
    more.textContent = `…and ${pendingImport.length - 6} more.`;
    wrap.appendChild(more);
  }
  document.getElementById('importAddBtn').textContent = `Add ${pendingImport.length} to DayFlow`;
}

on('importAddBtn', 'click', () => {
  if (!pendingImport.length) return;
  const now = Date.now();
  pendingImport.forEach((i, idx) => {
    state.tasks.push({
      id: uid(),
      title: i.title,
      date: i.date,
      startMin: i.startMin,
      durationMin: i.durationMin || 30,
      urgency: i.urgency || null,
      notes: i.notes || undefined,
      done: false, someday: false, subtasks: [],
      createdAt: now + idx, touchedAt: now,
    });
  });
  const n = pendingImport.length;
  pendingImport = [];
  saveState('importing a file');
  closeSheets();
  renderAll();
  toast(`${n} item${n === 1 ? '' : 's'} added — undo is in the top bar if that went wrong`, 5000);
});
on('importCancelBtn', 'click', () => { pendingImport = []; closeSheets(); });

function restoreBackup(data) {
  state = data;
  if (!state.view) state.view = { current: 'today', todayOffset: 0, weekOffset: 0 };
  if (!state.routines) state.routines = [];
  if (!state.chores) state.chores = [];
  if (!state.settings) state.settings = { theme: 'auto', remindersEnabled: false, colorScheme: 'orange' };
  if (state.settings.remindersEnabled === undefined) state.settings.remindersEnabled = false;
  if (!state.settings.colorScheme) state.settings.colorScheme = 'orange';
  ensureHabitSessions(state);
  ensureNewCollections(state);
  saveState('restoring a backup');
  applyTheme();
  closeSheets();
  renderAll();
  toast('Backup restored');
}

on('importFile', 'change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || '');
    try {
      let raw;
      if (isCsv) {
        raw = parseCsv(text);
      } else {
        raw = JSON.parse(text);
        // A full DayFlow backup replaces everything; anything else is merged.
        if (raw && raw.tasks && raw.habits && raw.settings) {
          if (!confirm('This is a DayFlow backup. Restoring it replaces everything currently in the app. Continue?')) return;
          restoreBackup(raw);
          return;
        }
        const list = findItemArray(raw);
        raw = list || (typeof raw === 'object' ? [raw] : null);
      }

      if (!Array.isArray(raw) || !raw.length) {
        toast('I couldn’t find a list of items in that file. A JSON array, or a CSV with a header row, both work.', 7000);
        return;
      }

      pendingImport = raw.map(normalizeImportItem).filter(Boolean);
      if (!pendingImport.length) {
        toast('Found the list, but no row had anything I could read as a title. Name that column "title".', 7000);
        return;
      }
      renderImportPreview();
      openSheet('importSheet');
    } catch (err) {
      console.warn('[DayFlow] import', err);
      toast(isCsv ? 'That CSV couldn’t be read.' : 'That file isn’t valid JSON — check it opens in a text editor without errors.', 6000);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

function emptyState() {
  const s = blankState();
  s.settings = { ...state.settings };
  s.view = { current: state.view.current, todayOffset: 0, weekOffset: 0 };
  return s;
}


on('clearPracticeBtn', 'click', () => {
  const sessionCount = state.habits.reduce((a, h) => a + (h.sessions || []).length, 0)
    + state.chores.reduce((a, c) => a + (c.sessions || []).length, 0);
  if (!sessionCount) { toast('No practice records to clear'); return; }
  if (!confirm(`Clear all ${sessionCount} timed practice records? Habits, streaks and chores stay — only the recorded times go.`)) return;
  state.habits.forEach(h => { h.sessions = []; });
  state.chores.forEach(c => { c.sessions = []; });
  saveState('clearing records');
  renderAll();
  toast('Practice records cleared');
});

on('clearSampleBtn', 'click', () => {
  if (!confirm('Remove all sample tasks, habits, routines, chores and lists? Your settings stay. This gives you a blank slate.')) return;
  const settings = state.settings;
  const view = state.view;
  const wipeSnap = lastSnapshot;
  state = emptyState();
  state.settings = settings;
  state.view = view;
  lastSnapshot = wipeSnap;      // so the undo entry restores what was wiped
  saveState('removing sample data');
  applyTheme();
  closeSheets();
  renderAll();
  toast('Blank slate — all yours now');
});

on('resetBtn', 'click', () => {
  if (!confirm('Erase everything, including settings? This cannot be undone.')) return;
  const eraseSnap = lastSnapshot;
  state = blankState();
  lastSnapshot = eraseSnap;
  saveState('erasing everything');
  applyTheme();
  closeSheets();
  renderAll();
  toast('Everything erased');
});

/* ======================= Recurring tasks =======================
   Habits track whether you did a thing; they can't carry a time, a duration or
   an inbox row, so "bins out on Tuesday" and "rent on the 1st" had nowhere to
   live but your memory. A rule is stored once and materialises a perfectly
   ordinary task on the days it applies — instances stay editable, deletable
   and unaware they came from a rule. */
const REPEAT_KINDS = [
  { id: 'none', label: 'Never' },
  { id: 'daily', label: 'Every day' },
  { id: 'weekdays', label: 'Weekdays' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
];

function repeatLabel(rule) {
  if (!rule || rule.kind === 'none') return 'Never';
  if (rule.kind === 'daily') return 'Every day';
  if (rule.kind === 'weekdays') return 'Mon–Fri';
  if (rule.kind === 'weekly') return `Every ${WDFULL[rule.weekday != null ? rule.weekday : 1]}`;
  if (rule.kind === 'monthly') return `Day ${rule.monthDay || 1} of each month`;
  return 'Never';
}

function ruleAppliesOn(rule, d) {
  if (!rule || rule.kind === 'none') return false;
  const dow = d.getDay();
  if (rule.kind === 'daily') return true;
  if (rule.kind === 'weekdays') return dow >= 1 && dow <= 5;
  if (rule.kind === 'weekly') return dow === (rule.weekday != null ? rule.weekday : 1);
  if (rule.kind === 'monthly') {
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    // A rule for the 31st should still fire in February, on the last day.
    return d.getDate() === Math.min(rule.monthDay || 1, dim);
  }
  return false;
}

// Only ever materialises today. Filling the calendar forward would create
// hundreds of rows nobody asked for, and today is the only day that can be acted on.
function materialiseRecurring() {
  const d = new Date();
  const ds = todayStr();
  let made = 0;
  (state.recurring || []).forEach(rule => {
    if (rule.paused) return;
    if (!ruleAppliesOn(rule, d)) return;
    const exists = state.tasks.some(t => t.ruleId === rule.id && t.date === ds);
    if (exists) return;
    state.tasks.push({
      id: uid(), title: rule.title, date: ds,
      startMin: rule.startMin != null ? rule.startMin : null,
      durationMin: rule.durationMin || 30,
      urgency: rule.urgency || null,
      energy: rule.energy || null,
      firstStep: rule.firstStep || undefined,
      subtasks: [], done: false, someday: false, ruleId: rule.id,
      createdAt: Date.now(), touchedAt: Date.now(),
    });
    made++;
  });
  if (made) { saveState('silent'); renderAll(); }
  return made;
}

function upsertRuleFromTask(t, kind) {
  if (kind === 'none') {
    if (t.ruleId) {
      state.recurring = state.recurring.filter(r => r.id !== t.ruleId);
      delete t.ruleId;
    }
    return null;
  }
  const base = {
    title: t.title, startMin: t.startMin, durationMin: t.durationMin,
    urgency: t.urgency || null, energy: t.energy || null, firstStep: t.firstStep || null,
    kind, weekday: new Date().getDay(), monthDay: new Date().getDate(), paused: false,
  };
  const existing = state.recurring.find(r => r.id === t.ruleId);
  if (existing) { Object.assign(existing, base); return existing; }
  const rule = Object.assign({ id: uid(), createdAt: Date.now() }, base);
  state.recurring.push(rule);
  t.ruleId = rule.id;
  return rule;
}

function renderRepeatSheet() {
  const wrap = document.getElementById('repeatList');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!state.recurring.length) {
    wrap.innerHTML = '<p class="settings-note" style="text-align:left;">Nothing repeats yet. Open any task, set <strong>Repeat</strong>, and it will appear here.</p>';
    return;
  }
  state.recurring.forEach(rule => {
    const row = document.createElement('div');
    row.className = 'someday-row';
    row.innerHTML = `<span class="sd-title">${escapeHtml(rule.title)}<span class="rule-sub">${repeatLabel(rule)}${rule.startMin != null ? ' · ' + minToLabel(rule.startMin) : ''}</span></span>
      <button type="button" class="pill-btn small" data-act="pause">${rule.paused ? 'Resume' : 'Pause'}</button>
      <button type="button" class="pill-btn small danger" data-act="del" aria-label="Delete rule">${icon('trash', 15)}</button>`;
    row.querySelector('[data-act="pause"]').addEventListener('click', () => {
      rule.paused = !rule.paused;
      saveState(rule.paused ? 'pausing a repeat' : 'resuming a repeat');
      renderRepeatSheet();
    });
    row.querySelector('[data-act="del"]').addEventListener('click', () => {
      state.recurring = state.recurring.filter(r => r.id !== rule.id);
      state.tasks.forEach(t => { if (t.ruleId === rule.id) delete t.ruleId; });
      saveState('deleting a repeat');
      renderRepeatSheet();
    });
    wrap.appendChild(row);
  });
}

on('repeatManageBtn', 'click', () => { closeSheets(); renderRepeatSheet(); openSheet('repeatSheet'); });
on('repeatDoneBtn', 'click', closeSheets);

/* ======================= Search =======================
   Once there are a few hundred rows across seven tabs plus a Someday pile,
   "where did I put that thing about the landlord" has no answer without this. */
function searchEverything(q) {
  const needle = q.toLowerCase().trim();
  if (needle.length < 2) return [];
  const hits = [];
  const match = (s) => (s || '').toLowerCase().includes(needle);

  state.tasks.forEach(t => {
    if (!match(t.title) && !match(t.notes) && !(t.subtasks || []).some(st => match(st.text))) return;
    const where = t.someday ? 'Someday' : t.done ? 'Done' : t.startMin != null ? `Scheduled ${minToLabel(t.startMin)}` : 'Inbox';
    hits.push({ kind: 'task', id: t.id, title: t.title, sub: `${where}${t.date ? ' · ' + t.date : ''}`, obj: t });
  });
  state.habits.forEach(h => { if (match(h.name)) hits.push({ kind: 'habit', id: h.id, title: h.name, sub: h.archived ? 'Habit · archived' : 'Habit', obj: h }); });
  state.routines.forEach(r => {
    const stepHit = (r.steps || []).find(s => match(s.text));
    if (match(r.name) || stepHit) hits.push({ kind: 'routine', id: r.id, title: r.name, sub: stepHit ? `Routine · step “${stepHit.text}”` : 'Routine', obj: r });
  });
  state.chores.forEach(c => { if (match(c.name)) hits.push({ kind: 'chore', id: c.id, title: c.name, sub: 'Chore', obj: c }); });
  state.lists.forEach(l => {
    const itemHit = (l.items || []).find(i => match(i.text));
    if (match(l.name) || itemHit) hits.push({ kind: 'list', id: l.id, title: l.name, sub: itemHit ? `List · “${itemHit.text}”` : 'List', obj: l });
  });
  state.recurring.forEach(r => { if (match(r.title)) hits.push({ kind: 'rule', id: r.id, title: r.title, sub: `Repeats · ${repeatLabel(r)}`, obj: r }); });
  return hits.slice(0, 40);
}

function renderSearchResults() {
  const q = document.getElementById('searchInput').value;
  const wrap = document.getElementById('searchResults');
  const hits = searchEverything(q);
  wrap.innerHTML = '';
  if (q.trim().length < 2) {
    wrap.innerHTML = '<p class="settings-note" style="text-align:left;">Type at least two characters. Searches tasks, subtasks, habits, routines and their steps, chores, lists and repeats — including anything parked in Someday.</p>';
    return;
  }
  if (!hits.length) {
    wrap.innerHTML = `<p class="settings-note" style="text-align:left;">Nothing matches “${escapeHtml(q.trim())}”.</p>`;
    return;
  }
  hits.forEach(hit => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'search-row';
    row.innerHTML = `<span class="sr-title">${escapeHtml(hit.title)}</span><span class="sr-sub">${escapeHtml(hit.sub)}</span>`;
    row.addEventListener('click', () => {
      closeSheets();
      if (hit.kind === 'task') {
        if (hit.obj.date && hit.obj.date !== todayStr()) state.view.todayOffset = 0;
        switchView('today');
        setTimeout(() => openBlockSheet(hit.obj, { forceDate: currentTodayDateStr() }), 120);
      } else if (hit.kind === 'habit') { switchView('habits'); setTimeout(() => openHabitSheet(hit.obj), 120); }
      else if (hit.kind === 'routine') { switchView('routines'); }
      else if (hit.kind === 'chore') { switchView('chores'); }
      else if (hit.kind === 'list') { setTimeout(() => { renderListsSheet(); openSheet('listsSheet'); }, 120); }
      else if (hit.kind === 'rule') { setTimeout(() => { renderRepeatSheet(); openSheet('repeatSheet'); }, 120); }
    });
    wrap.appendChild(row);
  });
}

on('searchBtn', 'click', () => {
  document.getElementById('searchInput').value = '';
  renderSearchResults();
  openSheet('searchSheet');
  setTimeout(() => document.getElementById('searchInput').focus(), 250);
});
on('searchInput', 'input', renderSearchResults);
on('searchForm', 'submit', (e) => { e.preventDefault(); renderSearchResults(); });

/* ======================= Archive =======================
   Deleting a habit used to destroy months of history along with it, which
   makes "I'm done with this one for now" an expensive decision. Archiving
   retires it and keeps every record. */
function archiveCounts() {
  return state.habits.filter(h => h.archived).length
    + state.chores.filter(c => c.archived).length
    + state.routines.filter(r => r.archived).length;
}

function renderArchiveSheet() {
  const wrap = document.getElementById('archiveList');
  if (!wrap) return;
  wrap.innerHTML = '';
  const items = [
    ...state.habits.filter(h => h.archived).map(o => ({ o, kind: 'habit', name: o.name, sub: `${Object.keys(o.completions || {}).length} days logged` })),
    ...state.chores.filter(c => c.archived).map(o => ({ o, kind: 'chore', name: o.name, sub: `${(o.sessions || []).length} timed runs` })),
    ...state.routines.filter(r => r.archived).map(o => ({ o, kind: 'routine', name: o.name, sub: `${(o.steps || []).length} steps` })),
  ];
  if (!items.length) {
    wrap.innerHTML = '<p class="settings-note" style="text-align:left;">Nothing archived. Retiring a habit, chore or routine keeps all of its history — use it instead of deleting when you might come back.</p>';
    return;
  }
  items.forEach(({ o, kind, name, sub }) => {
    const row = document.createElement('div');
    row.className = 'someday-row';
    row.innerHTML = `<span class="sd-title">${escapeHtml(name)}<span class="rule-sub">${kind} · ${sub}</span></span>
      <button type="button" class="pill-btn small" data-act="back">Restore</button>
      <button type="button" class="pill-btn small danger" data-act="del" aria-label="Delete forever">${icon('trash', 15)}</button>`;
    row.querySelector('[data-act="back"]').addEventListener('click', () => {
      o.archived = false;
      saveState('restoring from the archive');
      renderArchiveSheet();
      renderAll();
      toast(`${name} is back`);
    });
    row.querySelector('[data-act="del"]').addEventListener('click', () => {
      if (!confirm(`Delete ${name} and its history for good? The archive keeps it safely if you're unsure.`)) return;
      if (kind === 'habit') state.habits = state.habits.filter(x => x.id !== o.id);
      if (kind === 'chore') state.chores = state.chores.filter(x => x.id !== o.id);
      if (kind === 'routine') state.routines = state.routines.filter(x => x.id !== o.id);
      saveState('deleting from the archive');
      renderArchiveSheet();
      renderAll();
    });
    wrap.appendChild(row);
  });
}

on('archiveBtn', 'click', () => { closeSheets(); renderArchiveSheet(); openSheet('archiveSheet'); });
on('archiveDoneBtn', 'click', closeSheets);

/* ======================= Energy =======================
   Not everything is equally doable at 9am and at 9pm, and pretending otherwise
   is how a task gets moved eleven times. Tagging effort lets the suggestion
   engine stop offering deep work at midnight. */
const ENERGIES = [
  { id: 'high', label: 'Needs focus' },
  { id: 'medium', label: 'Normal' },
  { id: 'low', label: 'Low effort' },
];

function energyForHour(h) {
  if (h < 11) return 'high';
  if (h < 16) return 'medium';
  return 'low';
}

function energyLabel(id) {
  const e = ENERGIES.find(x => x.id === id);
  return e ? e.label : null;
}

let currentEnergy = null;
function renderEnergyOptions() {
  const wrap = document.getElementById('energyOptions');
  if (!wrap) return;
  if (!wrap.childElementCount) {
    [...ENERGIES, { id: 'none', label: 'Unset' }].forEach(e => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'freq-opt energy-opt';
      btn.dataset.energy = e.id;
      btn.textContent = e.label;
      btn.addEventListener('click', () => {
        currentEnergy = (e.id === 'none' || currentEnergy === e.id) ? null : e.id;
        paintEnergyOptions();
      });
      wrap.appendChild(btn);
    });
  }
  paintEnergyOptions();
}
function paintEnergyOptions() {
  document.querySelectorAll('#energyOptions .energy-opt').forEach(el => {
    const id = el.dataset.energy;
    el.classList.toggle('active', id === currentEnergy || (id === 'none' && !currentEnergy));
  });
}

/* ======================= Subtasks =======================
   "First step" lowered the starting line; this handles the tasks that are
   genuinely three things wearing a trenchcoat, without forcing them to become
   three separate inbox rows. */
let currentSubtasks = [];

function renderSubtaskEditor() {
  const wrap = document.getElementById('subtaskList');
  if (!wrap) return;
  wrap.innerHTML = '';
  currentSubtasks.forEach((st, i) => {
    const row = document.createElement('div');
    row.className = 'subtask-row';
    row.innerHTML = `<div class="checkbox ${st.done ? 'checked' : ''}" role="checkbox" aria-checked="${st.done}" tabindex="0">${icon('check', 14, { strokeWidth: 2.6 })}</div>
      <span class="st-text ${st.done ? 'done' : ''}">${escapeHtml(st.text)}</span>
      <button type="button" class="st-del" aria-label="Remove step">${icon('x', 15)}</button>`;
    const box = row.querySelector('.checkbox');
    const toggle = () => {
      st.done = !st.done;
      box.classList.toggle('checked', st.done);
      box.setAttribute('aria-checked', String(st.done));
      row.querySelector('.st-text').classList.toggle('done', st.done);
    };
    box.addEventListener('click', toggle);
    box.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } });
    row.querySelector('.st-del').addEventListener('click', () => {
      currentSubtasks.splice(i, 1);
      renderSubtaskEditor();
    });
    wrap.appendChild(row);
  });
}

function addSubtaskFromInput() {
  const input = document.getElementById('subtaskInput');
  const text = input.value.trim();
  if (!text) return;
  currentSubtasks.push({ id: uid(), text, done: false });
  input.value = '';
  renderSubtaskEditor();
}
on('subtaskAddBtn', 'click', addSubtaskFromInput);
on('subtaskInput', 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSubtaskFromInput(); } });

/* ======================= Calendar sync =======================
   Two calendars, two completely different situations.

   Google publishes a REST API that a browser can talk to directly with OAuth,
   so that half is a real two-way sync: events come in as read-only blocks, and
   DayFlow's own scheduled tasks go out as events it owns and updates.

   Apple has no public API at all. iCloud speaks CalDAV, but iCloud sends no
   CORS headers, so a web page is refused before it can even authenticate —
   this is not a limitation that better code gets around. What iOS does offer
   is the Shortcuts app, which can read and write the local calendar and hand
   text back to a web app through x-callback-url. That, plus .ics files, is the
   honest set of options, and the UI says so rather than implying parity. */
const CAL_DEFAULTS = {
  google: { clientId: null, token: null, tokenExpiry: 0, calendarId: 'primary', pull: true, push: false, lastSync: null },
  apple: { bridge: false, lastSync: null, lastImport: null },
};

function calState() {
  if (!state.calendar) state.calendar = JSON.parse(JSON.stringify(CAL_DEFAULTS));
  if (!state.calendar.google) state.calendar.google = { ...CAL_DEFAULTS.google };
  if (!state.calendar.apple) state.calendar.apple = { ...CAL_DEFAULTS.apple };
  return state.calendar;
}

/* ---------- Shared merge ----------
   Everything — Google, an .ics file, the Shortcuts bridge — funnels through
   here, so there is exactly one idea of what an imported event is and one
   place where duplicates are prevented. */
function externalKey(source, uid) { return `${source}:${uid}`; }

function importExternalEvents(events, source, range) {
  const keep = new Set();
  let added = 0, updated = 0;

  events.forEach(ev => {
    if (!ev || ev.allDay || ev.startMin == null || !ev.date) return;   // all-day events aren't blocks
    const key = externalKey(source, ev.uid);
    keep.add(key);
    const existing = state.tasks.find(t => t.external && externalKey(t.external.source, t.external.uid) === key);
    if (existing) {
      const changed = existing.title !== ev.title || existing.startMin !== ev.startMin
        || existing.durationMin !== ev.durationMin || existing.date !== ev.date;
      if (changed) {
        Object.assign(existing, { title: ev.title, startMin: ev.startMin, durationMin: ev.durationMin, date: ev.date });
        updated++;
      }
    } else {
      state.tasks.push({
        id: uid(), title: ev.title, date: ev.date, startMin: ev.startMin,
        durationMin: ev.durationMin, done: false, someday: false, subtasks: [],
        external: { source, uid: ev.uid },
        createdAt: Date.now(), touchedAt: Date.now(),
      });
      added++;
    }
  });

  // Anything from this source inside the synced window that the calendar no
  // longer has was deleted or moved there — drop it rather than leaving a
  // ghost block on the grid forever.
  let removed = 0;
  if (range) {
    state.tasks = state.tasks.filter(t => {
      if (!t.external || t.external.source !== source) return true;
      if (t.date < range.from || t.date > range.to) return true;
      if (keep.has(externalKey(source, t.external.uid))) return true;
      removed++;
      return false;
    });
  }

  if (added || updated || removed) saveState('syncing your calendar');
  return { added, updated, removed };
}

function externalCount(source) {
  return state.tasks.filter(t => t.external && (!source || t.external.source === source)).length;
}

function forgetExternal(source) {
  const before = state.tasks.length;
  state.tasks = state.tasks.filter(t => !(t.external && (!source || t.external.source === source)));
  const n = before - state.tasks.length;
  if (n) saveState('removing imported events');
  return n;
}

/* ---------- .ics parsing ----------
   Deliberately small. A full RFC 5545 implementation is a project of its own;
   this reads the shape that Apple Calendar, Google and Fantastical actually
   export — unfolded lines, DTSTART/DTEND or DURATION, and floating, UTC or
   TZID-stamped times. Recurring events are expanded only as far as their
   first instance, which is why the Shortcuts bridge is the better path on
   iOS: it asks the calendar what is actually on today. */
function unfoldIcs(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseIcsDate(value, params) {
  // 20260815T093000Z | 20260815T093000 | 20260815
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, , z] = m;
  const allDay = !hh || /VALUE=DATE(?!-TIME)/.test(params || '');
  if (allDay) return { date: `${y}-${mo}-${d}`, startMin: null, allDay: true };
  if (z) {
    // UTC: convert to the device's local time, which is what the grid shows.
    const dt = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, 0));
    return { date: dateStr(dt), startMin: dt.getHours() * 60 + dt.getMinutes(), allDay: false };
  }
  return { date: `${y}-${mo}-${d}`, startMin: (+hh) * 60 + (+mm), allDay: false };
}

function parseIcsDuration(v) {
  const m = (v || '').match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  return (+(m[1] || 0)) * 1440 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}

function parseIcs(text) {
  const out = [];
  let cur = null;
  unfoldIcs(text).forEach(raw => {
    const line = raw.trim();
    if (line === 'BEGIN:VEVENT') { cur = {}; return; }
    if (line === 'END:VEVENT') {
      if (cur && cur.start) {
        const dur = cur.durationMin != null ? cur.durationMin
          : (cur.end && cur.end.startMin != null && cur.start.startMin != null
              ? Math.max(5, (cur.end.startMin - cur.start.startMin + 1440) % 1440 || 60)
              : 60);
        out.push({
          uid: cur.uid || `${cur.start.date}-${cur.start.startMin}-${(cur.title || '').slice(0, 20)}`,
          title: cur.title || 'Busy',
          date: cur.start.date,
          startMin: cur.start.startMin,
          durationMin: cur.start.allDay ? 0 : dur,
          allDay: !!cur.start.allDay,
        });
      }
      cur = null;
      return;
    }
    if (!cur) return;
    const idx = line.indexOf(':');
    if (idx < 0) return;
    const left = line.slice(0, idx), value = line.slice(idx + 1);
    const name = left.split(';')[0].toUpperCase();
    if (name === 'UID') cur.uid = value;
    else if (name === 'SUMMARY') cur.title = value.replace(/\\,/g, ',').replace(/\\n/gi, ' ').replace(/\\;/g, ';').trim();
    else if (name === 'DTSTART') cur.start = parseIcsDate(value, left);
    else if (name === 'DTEND') cur.end = parseIcsDate(value, left);
    else if (name === 'DURATION') cur.durationMin = parseIcsDuration(value);
  });
  return out;
}

/* ---------- .ics building (DayFlow → any calendar) ---------- */
function buildScheduleIcs(days) {
  const now = new Date();
  const stamp = icsStamp(now);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DayFlow//Schedule//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  let n = 0;
  for (let i = 0; i < days; i++) {
    const day = addDays(now, i);
    const ds = dateStr(day);
    state.tasks
      .filter(t => t.date === ds && t.startMin != null && !t.external && !t.done)
      .forEach(t => {
        n++;
        lines.push(
          'BEGIN:VEVENT',
          `UID:${t.id}@dayflow`,
          `DTSTAMP:${stamp}`,
          `DTSTART:${icsLocal(day, t.startMin)}`,
          `DURATION:PT${Math.max(5, t.durationMin || 30)}M`,
          `SUMMARY:${(t.title || 'DayFlow task').replace(/[,;\\]/g, m => '\\' + m)}`,
          'DESCRIPTION:From DayFlow',
          'END:VEVENT'
        );
      });
  }
  lines.push('END:VCALENDAR');
  return { ics: lines.join('\r\n'), count: n };
}

function exportScheduleIcs(days) {
  const { ics, count } = buildScheduleIcs(days);
  if (!count) { toast('Nothing scheduled to export'); return 0; }
  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dayflow-schedule-${todayStr()}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  calState().apple.lastSync = Date.now();
  saveState('silent');
  toast(`${count} event${count === 1 ? '' : 's'} exported — open it to add them to Calendar`, 4000);
  renderCalendarSheet();
  return count;
}

/* ---------- Google ---------- */
const GCAL_BASE = 'https://www.googleapis.com/calendar/v3';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const GCAL_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

function googleConnected() {
  const g = calState().google;
  return !!(g.token && g.tokenExpiry > Date.now());
}

function loadGis() {
  if (window.google && window.google.accounts) return Promise.resolve(true);
  if (loadGis._p) return loadGis._p;
  loadGis._p = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  return loadGis._p;
}

async function googleConnect() {
  const g = calState().google;
  if (!g.clientId) { openCalendarSetup(); return false; }
  const loaded = await loadGis();
  if (!loaded || !window.google || !window.google.accounts) {
    toast('Could not reach Google — check your connection', 4000);
    return false;
  }
  return new Promise((resolve) => {
    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: g.clientId,
        scope: GCAL_SCOPE,
        callback: (resp) => {
          if (!resp || !resp.access_token) { toast('Google sign-in was cancelled'); resolve(false); return; }
          g.token = resp.access_token;
          // Expiry is advisory; knock 60s off so a sync never starts on a
          // token that dies mid-request.
          g.tokenExpiry = Date.now() + ((resp.expires_in || 3600) - 60) * 1000;
          saveState('silent');
          renderCalendarSheet();
          toast('Google Calendar connected');
          syncGoogle().then(() => resolve(true));
        },
      });
      client.requestAccessToken();
    } catch (err) {
      console.warn('[DayFlow] google auth', err);
      toast('Google sign-in failed — check the client ID', 4000);
      resolve(false);
    }
  });
}

function googleDisconnect() {
  const g = calState().google;
  try {
    if (g.token && window.google && window.google.accounts) window.google.accounts.oauth2.revoke(g.token, () => {});
  } catch (e) { /* best effort */ }
  g.token = null;
  g.tokenExpiry = 0;
  const n = forgetExternal('google');
  saveState('disconnecting Google Calendar');
  renderCalendarSheet();
  renderAll();
  toast(n ? `Disconnected — ${n} imported event${n === 1 ? '' : 's'} removed` : 'Disconnected');
}

async function gcalFetch(path, opts = {}) {
  const g = calState().google;
  const res = await fetch(GCAL_BASE + path, {
    ...opts,
    headers: {
      Authorization: 'Bearer ' + g.token,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    g.token = null; g.tokenExpiry = 0;
    saveState('silent');
    throw new Error('Google sign-in expired — connect again');
  }
  if (!res.ok) throw new Error('Google said ' + res.status);
  return res.status === 204 ? null : res.json();
}

function gcalEventToEvent(ev) {
  if (!ev || ev.status === 'cancelled') return null;
  if (ev.start && ev.start.date && !ev.start.dateTime) {
    return { uid: ev.id, title: ev.summary || 'Busy', date: ev.start.date, startMin: null, durationMin: 0, allDay: true };
  }
  if (!ev.start || !ev.start.dateTime) return null;
  const s = new Date(ev.start.dateTime);
  const e = ev.end && ev.end.dateTime ? new Date(ev.end.dateTime) : new Date(s.getTime() + 3600000);
  return {
    uid: ev.id,
    title: ev.summary || 'Busy',
    date: dateStr(s),
    startMin: s.getHours() * 60 + s.getMinutes(),
    durationMin: Math.max(5, Math.round((e - s) / 60000)),
    allDay: false,
  };
}

function taskToGcalEvent(t) {
  const [y, mo, d] = t.date.split('-').map(Number);
  const start = new Date(y, mo - 1, d, Math.floor(t.startMin / 60), t.startMin % 60, 0);
  const end = new Date(start.getTime() + Math.max(5, t.durationMin || 30) * 60000);
  const iso = (x) => `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}T${pad2(x.getHours())}:${pad2(x.getMinutes())}:00`;
  return {
    summary: t.title,
    description: 'Scheduled in DayFlow',
    start: { dateTime: iso(start), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    end: { dateTime: iso(end), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  };
}

const SYNC_DAYS = 7;

async function syncGoogle(opts = {}) {
  const g = calState().google;
  if (!googleConnected()) { if (!opts.quiet) toast('Connect Google Calendar first'); return null; }
  const from = todayStr();
  const to = dateStr(addDays(new Date(), SYNC_DAYS - 1));
  let pulled = { added: 0, updated: 0, removed: 0 }, pushed = 0, failed = 0;

  try {
    if (g.pull) {
      const timeMin = new Date(); timeMin.setHours(0, 0, 0, 0);
      const timeMax = addDays(new Date(), SYNC_DAYS); timeMax.setHours(0, 0, 0, 0);
      const q = `?timeMin=${encodeURIComponent(timeMin.toISOString())}&timeMax=${encodeURIComponent(timeMax.toISOString())}` +
                '&singleEvents=true&orderBy=startTime&maxResults=250';
      const data = await gcalFetch(`/calendars/${encodeURIComponent(g.calendarId || 'primary')}/events${q}`);
      const events = (data.items || [])
        .map(gcalEventToEvent)
        .filter(Boolean)
        // Never re-import an event DayFlow itself created, or the two copies
        // would breed: one as a task, one as an imported block.
        .filter(ev => !state.tasks.some(t => t.gcalId === ev.uid));
      pulled = importExternalEvents(events, 'google', { from, to });
    }

    if (g.push) {
      const mine = state.tasks.filter(t =>
        !t.external && !t.done && t.startMin != null && t.date >= from && t.date <= to);
      for (const t of mine) {
        try {
          const body = JSON.stringify(taskToGcalEvent(t));
          const cal = encodeURIComponent(g.calendarId || 'primary');
          if (t.gcalId) {
            await gcalFetch(`/calendars/${cal}/events/${encodeURIComponent(t.gcalId)}`, { method: 'PATCH', body });
          } else {
            const created = await gcalFetch(`/calendars/${cal}/events`, { method: 'POST', body });
            t.gcalId = created.id;
          }
          pushed++;
        } catch (e) { failed++; }
      }
      if (pushed) saveState('silent');
    }

    g.lastSync = Date.now();
    saveState('silent');
    renderAll();
    renderCalendarSheet();
    if (!opts.quiet) {
      const bits = [];
      if (g.pull) bits.push(`${pulled.added} new, ${pulled.updated} changed${pulled.removed ? `, ${pulled.removed} gone` : ''}`);
      if (g.push) bits.push(`${pushed} sent${failed ? `, ${failed} failed` : ''}`);
      toast(bits.length ? 'Synced · ' + bits.join(' · ') : 'Synced', 4000);
    }
    return { pulled, pushed, failed };
  } catch (err) {
    console.warn('[DayFlow] google sync', err);
    if (!opts.quiet) toast(err.message || 'Google sync failed', 4500);
    renderCalendarSheet();
    return null;
  }
}

/* ---------- Apple, via Shortcuts ----------
   The same x-callback-url trick the triple alarm uses. A shortcut you build
   once reads today's events and hands them back as lines of text, which is
   the only route from the iOS calendar into a web app that exists. */
const CAL_SHORTCUT_NAME = 'DayFlow Calendar';

const CAL_SETUP_STEPS = [
  'Open <strong>Shortcuts</strong> and tap <strong>+</strong> to create a new one.',
  'Add <strong>Find Calendar Events</strong>. Set the filter to <strong>Start Date is Today</strong>, and sort by Start Date.',
  'Add <strong>Repeat with Each</strong> and put a <strong>Text</strong> action inside it containing, on one line: <strong>Start Date|Duration|Title</strong> — insert Start Date (Format: Custom, <strong>HH:mm</strong>), then a bar, then Duration in minutes, then a bar, then Title.',
  'Under the repeat, add <strong>Combine Text</strong> with the Repeat Results, separated by <strong>New Lines</strong>.',
  'Rename the shortcut to exactly <strong>DayFlow Calendar</strong>.',
  'Come back here and tap <strong>Pull today from Calendar</strong>.',
];

function buildCalShortcutUrl() {
  return 'shortcuts://x-callback-url/run-shortcut' +
         '?name=' + encodeURIComponent(CAL_SHORTCUT_NAME) +
         '&x-success=' + encodeURIComponent(location.origin + location.pathname + '?cal=ok') +
         '&x-error=' + encodeURIComponent(location.origin + location.pathname + '?cal=err') +
         '&x-cancel=' + encodeURIComponent(location.origin + location.pathname + '?cal=cancel');
}

function runCalendarShortcut() {
  const url = buildCalShortcutUrl();
  document.body.dataset.lastCalUrl = url;
  // A synthesised link, not location.href: an unhandled custom scheme kills
  // the page outright, which is how the alarm hand-off used to lose state.
  const a = document.createElement('a');
  a.href = url;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 500);
}

/* Shortcuts appends the shortcut's text output to the success URL as
   `result=`. Each line is HH:MM|minutes|Title. */
function parseShortcutCalendar(text) {
  const ds = todayStr();
  return (text || '').split(/[\r\n]+/).map(line => {
    const parts = line.split('|');
    if (parts.length < 3) return null;
    const tm = parts[0].trim().match(/^(\d{1,2}):(\d{2})/);
    if (!tm) return null;
    const title = parts.slice(2).join('|').trim();
    const dur = Math.max(5, parseInt(parts[1], 10) || 60);
    return {
      uid: `${ds}-${parts[0].trim()}-${title.slice(0, 24)}`,
      title: title || 'Busy',
      date: ds,
      startMin: (+tm[1]) * 60 + (+tm[2]),
      durationMin: dur,
      allDay: false,
    };
  }).filter(Boolean);
}

function handleCalendarReturn(flag, result) {
  if (flag === 'err') {
    toast(`No shortcut named “${CAL_SHORTCUT_NAME}” yet — here's how to make it`, 6000);
    openCalendarSetup();
    return;
  }
  if (flag === 'cancel') return;
  const events = parseShortcutCalendar(result);
  if (!events.length) {
    toast('The shortcut ran but returned nothing DayFlow could read — check step 3 of the guide', 6000);
    openCalendarSetup();
    return;
  }
  const res = importExternalEvents(events, 'apple', { from: todayStr(), to: todayStr() });
  calState().apple.bridge = true;
  calState().apple.lastImport = Date.now();
  saveState('silent');
  renderAll();
  toast(`${events.length} event${events.length === 1 ? '' : 's'} from Calendar · ${res.added} new`, 4000);
}

/* ---------- Calendar UI ---------- */
function fmtAgo(ts) {
  if (!ts) return 'never';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

function renderCalendarSheet() {
  const sheet = document.getElementById('calendarSheet');
  if (!sheet || sheet.hidden) return;
  const g = calState().google, a = calState().apple;

  const gBtn = document.getElementById('gcalConnectBtn');
  const connected = googleConnected();
  gBtn.textContent = connected ? 'Disconnect' : (g.clientId ? 'Connect' : 'Set up');
  gBtn.classList.toggle('accent', !connected);
  document.getElementById('gcalSyncBtn').disabled = !connected;
  document.getElementById('gcalStatus').textContent = connected
    ? `Connected · last sync ${fmtAgo(g.lastSync)} · ${externalCount('google')} event${externalCount('google') === 1 ? '' : 's'} showing`
    : g.clientId
      ? 'Not connected. Your client ID is saved — tap Connect to sign in.'
      : 'Needs a Google OAuth client ID of your own. DayFlow has no server and no shared account, so the credential has to be yours — the setup sheet walks through it in about three minutes.';

  document.getElementById('gcalPullBtn').textContent = g.pull ? 'On' : 'Off';
  document.getElementById('gcalPullBtn').classList.toggle('active', !!g.pull);
  document.getElementById('gcalPushBtn').textContent = g.push ? 'On' : 'Off';
  document.getElementById('gcalPushBtn').classList.toggle('active', !!g.push);

  document.getElementById('appleStatus').textContent = a.lastImport
    ? `Shortcut bridge used ${fmtAgo(a.lastImport)} · ${externalCount('apple')} event${externalCount('apple') === 1 ? '' : 's'} showing`
    : 'Apple has no calendar API a web app can call — iCloud refuses browser requests outright. The Shortcuts app can read your calendar and hand the events back, which is the closest thing to a real sync on iOS.';
}

function openCalendar() { openSheet('calendarSheet'); renderCalendarSheet(); }
on('calendarBtn', 'click', () => { closeSheets(); openCalendar(); });
on('calendarDoneBtn', 'click', closeSheets);

function openCalendarSetup() {
  const list = document.getElementById('calSetupSteps');
  if (list) list.innerHTML = CAL_SETUP_STEPS.map(s => `<li>${s}</li>`).join('');
  const input = document.getElementById('gcalClientInput');
  if (input) input.value = calState().google.clientId || '';
  openSheet('calSetupSheet');
}
on('calSetupBtn', 'click', openCalendarSetup);
on('calSetupDoneBtn', 'click', () => { closeSheets(); openCalendar(); });

on('gcalSaveClientBtn', 'click', async () => {
  const v = document.getElementById('gcalClientInput').value.trim();
  calState().google.clientId = v || null;
  saveState('silent');
  toast(v ? 'Client ID saved' : 'Client ID cleared');
  closeSheets();
  openCalendar();
  if (v) await googleConnect();
});

on('gcalConnectBtn', 'click', async () => {
  if (googleConnected()) { googleDisconnect(); return; }
  if (!calState().google.clientId) { openCalendarSetup(); return; }
  await googleConnect();
});
on('gcalSyncBtn', 'click', () => syncGoogle());
on('gcalPullBtn', 'click', () => {
  const g = calState().google;
  g.pull = !g.pull;
  if (!g.pull) forgetExternal('google');
  saveState('silent');
  renderCalendarSheet();
  renderAll();
});
on('gcalPushBtn', 'click', () => {
  const g = calState().google;
  g.push = !g.push;
  saveState('silent');
  renderCalendarSheet();
  if (g.push) toast('DayFlow will add its scheduled tasks to Google on the next sync', 4000);
});

on('appleImportBtn', 'click', runCalendarShortcut);
on('appleExportBtn', 'click', () => exportScheduleIcs(SYNC_DAYS));
on('appleExportTodayBtn', 'click', () => exportScheduleIcs(1));
on('appleSetupBtn', 'click', openCalendarSetup);
on('appleForgetBtn', 'click', () => {
  const n = forgetExternal('apple');
  renderAll();
  renderCalendarSheet();
  toast(n ? `${n} imported event${n === 1 ? '' : 's'} removed` : 'Nothing imported to remove');
});

on('icsImportFile', 'change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const events = parseIcs(String(reader.result));
      if (!events.length) { toast('No events found in that file'); return; }
      const dated = events.map(ev => ev.date).sort();
      const res = importExternalEvents(events, 'apple', { from: dated[0], to: dated[dated.length - 1] });
      calState().apple.lastImport = Date.now();
      saveState('silent');
      renderAll();
      renderCalendarSheet();
      const skipped = events.filter(ev => ev.allDay).length;
      toast(`${res.added} event${res.added === 1 ? '' : 's'} imported${res.updated ? `, ${res.updated} updated` : ''}${skipped ? ` · ${skipped} all-day skipped` : ''}`, 4500);
    } catch (err) {
      console.warn('[DayFlow] ics import', err);
      toast('That file could not be read as a calendar');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ======================= Restoring a timer after a cold start =======================
   The app can be killed between one glance at the screen and the next. When it
   comes back, the timer that was running is picked up mid-flight rather than
   silently forgotten — the elapsed time is real, because it was always
   measured from a stored timestamp rather than counted in memory. */
function restoreLiveTimer() {
  const live = readLiveTimer();
  if (!live || !live.startTs) return false;

  const age = Date.now() - live.startTs;
  if (age > LIVE_TIMER_MAX_MS) {
    // A timer left running overnight is not a session anybody wants logged.
    clearLiveTimer();
    setTimeout(() => toast('A timer had been running for hours — I left it unlogged rather than guess', 6000), 1200);
    return false;
  }

  const secs = Math.round(age / 1000);
  const note = (what) => setTimeout(() =>
    toast(`${what} was still running — ${fmtMinSec(secs)} so far`, 5000), 900);

  if (live.kind === 'habit') {
    const h = state.habits.find(x => x.id === live.id);
    if (!h) { clearLiveTimer(); return false; }
    startHabitTimer(h, live.startTs);
    note(`“${h.name}”`);
    return true;
  }
  if (live.kind === 'chore') {
    const c = state.chores.find(x => x.id === live.id);
    if (!c) { clearLiveTimer(); return false; }
    startChoreTimer(c, live.startTs);
    note(`“${c.name}”`);
    return true;
  }
  if (live.kind === 'task') {
    const t = state.tasks.find(x => x.id === live.id);
    if (!t) { clearLiveTimer(); return false; }
    startTaskTimer(t, Math.round((live.goalSec || 300) / 60), { resumeTs: live.startTs });
    note(`“${t.title}”`);
    return true;
  }
  if (live.kind === 'routine') {
    const r = state.routines.find(x => x.id === live.id);
    if (!r || !r.steps || !r.steps.length) { clearLiveTimer(); return false; }
    const index = Math.min(live.index || 0, r.steps.length - 1);
    startRoutine(r, { index, stepEndsAt: live.stepEndsAt || Date.now(), startTs: live.startTs });
    note(`“${r.name}”`);
    return true;
  }
  clearLiveTimer();
  return false;
}

/* A wake lock is dropped whenever the page is hidden, by design — so it has to
   be taken again every time the app comes back with a timer still going. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && anyTimerRunning()) acquireWakeLock();
});

/* ======================= Supporters =======================
   DayFlow has no server, so a key is a signed note rather than a lock: minted
   offline with a private key, verified here against the public half below.
   Nothing is gated behind it. A planner for people with ADHD that hides the
   timer behind a paywall on the day they finally opened it is a planner they
   delete — so every feature is free, and a key buys a thank-you and the end of
   being asked. See tools/README.md for issuing them. */
const LICENSE_PUBLIC_KEY = { x: 'B9_XOdk87kZnOWxNfWnerBq6y72hRmDZjGLza38_XGM', y: '-feiSWfD-u3ZlbubogeKsO_jIOcU96ymxAUWJsC75B0' };
const SUPPORT_URL = 'https://example.gumroad.com/l/dayflow';   // ← your checkout page
const FEEDBACK_EMAIL = 'you@example.com';                      // ← where feedback should land
const NAG_AFTER_DAYS = 21;

function b64uToBytes(s) {
  const pad = '='.repeat((4 - s.length % 4) % 4);
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from([...bin].map(c => c.charCodeAt(0)));
}

async function verifyLicense(raw) {
  const parts = (raw || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'DF1') return null;
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x: LICENSE_PUBLIC_KEY.x, y: LICENSE_PUBLIC_KEY.y, ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const data = b64uToBytes(parts[1]);
    const sig = b64uToBytes(parts[2]);
    const good = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, data);
    if (!good) return null;
    return JSON.parse(new TextDecoder().decode(data));
  } catch (e) {
    return null;
  }
}

function isSupporter() { return !!(state.settings.license && state.settings.license.n); }

function renderSupporterRow() {
  const status = document.getElementById('supporterStatus');
  const row = document.getElementById('supporterEnterRow');
  const thanks = document.getElementById('supporterThanks');
  if (!status) return;
  if (isSupporter()) {
    const l = state.settings.license;
    status.textContent = `Supporter since ${l.d}. Thank you — genuinely.`;
    if (row) row.hidden = true;
    if (thanks) thanks.hidden = false;
    document.getElementById('supporterName').textContent = l.n;
  } else {
    const days = Math.floor((Date.now() - (state.settings.firstRunAt || Date.now())) / 86400000);
    status.textContent = `DayFlow is free and stays free — every feature, no trial, no account. If it has earned it after ${days} day${days === 1 ? '' : 's'}, you can chip in; a key just turns off the asking.`;
    if (row) row.hidden = false;
    if (thanks) thanks.hidden = true;
  }
  const nag = document.getElementById('supportNag');
  if (nag) nag.hidden = !shouldAskForSupport();
}

function shouldAskForSupport() {
  if (isSupporter()) return false;
  if (state.settings.supportDismissedAt) {
    // Asked and declined: leave it alone for a good long while.
    if (Date.now() - state.settings.supportDismissedAt < 90 * 86400000) return false;
  }
  const age = Date.now() - (state.settings.firstRunAt || Date.now());
  return age > NAG_AFTER_DAYS * 86400000 && hasRealData();
}

on('supporterApplyBtn', 'click', async () => {
  const raw = document.getElementById('supporterKeyInput').value.trim();
  if (!raw) return;
  const lic = await verifyLicense(raw);
  if (!lic) {
    toast('That key didn’t check out — paste the whole thing, including DF1.', 5000);
    return;
  }
  state.settings.license = lic;
  saveState('silent');
  document.getElementById('supporterKeyInput').value = '';
  renderSupporterRow();
  toast(`Thank you, ${lic.n}.`, 5000);
});

on('supportBuyBtn', 'click', () => window.open(SUPPORT_URL, '_blank', 'noopener'));
on('supportNagBuyBtn', 'click', () => window.open(SUPPORT_URL, '_blank', 'noopener'));
on('supportNagHideBtn', 'click', () => {
  state.settings.supportDismissedAt = Date.now();
  saveState('silent');
  renderSupporterRow();
  toast('Fair enough — I won’t bring it up again for a few months');
});

/* ======================= Feedback =======================
   "It broke" with no version number is unactionable, so the report carries the
   build, the platform and a count of what's in the app — never the contents. */
function diagnosticsText() {
  const nav = navigator.userAgent || '';
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  return [
    `DayFlow ${APP_VERSION} (built ${APP_BUILT})`,
    `Installed to Home Screen: ${standalone ? 'yes' : 'no'}`,
    `Screen: ${window.innerWidth}×${window.innerHeight}`,
    `Browser: ${nav}`,
    `Tasks ${state.tasks.length} · habits ${state.habits.length} · routines ${state.routines.length} · chores ${state.chores.length}`,
    `Reminders ${state.settings.remindersEnabled ? 'on' : 'off'} · calendar ${googleConnected() ? 'google' : (externalCount('apple') ? 'apple' : 'none')}`,
  ].join('\n');
}

function feedbackMailto() {
  const body = [
    'What happened:',
    '',
    '',
    'What you expected:',
    '',
    '',
    '--- please leave this bit, it tells me where to look ---',
    diagnosticsText(),
  ].join('\n');
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('DayFlow feedback (' + APP_VERSION + ')')}&body=${encodeURIComponent(body)}`;
}

on('feedbackBtn', 'click', () => {
  const a = document.createElement('a');
  a.href = feedbackMailto();
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 500);
});

on('copyDiagBtn', 'click', async () => {
  const text = diagnosticsText();
  try {
    await navigator.clipboard.writeText(text);
    toast('Details copied — paste them into your message');
  } catch (e) {
    toast(text, 8000);
  }
});

/* ======================= Working hours & the auto-scheduler =======================
   Deciding *when* to do something is a separate act of executive function from
   deciding to do it at all, and it is the one that reliably doesn't happen —
   which is how an inbox of perfectly good intentions turns into a list nobody
   ever converts into a day. So the app will do that part: given hours you work
   and the blocks already on the day, it drops each loose task into the first
   slot it genuinely fits.

   It only ever fills gaps. It never moves, shortens or overlaps anything that
   is already scheduled, and it never touches an event that came from your
   calendar — those are facts about your day, not suggestions. */
const WORK_DEFAULTS = {
  startMin: 9 * 60,
  endMin: 17 * 60,
  days: [1, 2, 3, 4, 5],     // 0 = Sunday
  gapMin: 10,                // breathing room between blocks
  auto: false,               // slot new tasks the moment they're captured
};

function work() {
  if (!state.settings.work) state.settings.work = { ...WORK_DEFAULTS };
  const w = state.settings.work;
  if (typeof w.startMin !== 'number') w.startMin = WORK_DEFAULTS.startMin;
  if (typeof w.endMin !== 'number') w.endMin = WORK_DEFAULTS.endMin;
  if (!Array.isArray(w.days)) w.days = [...WORK_DEFAULTS.days];
  if (typeof w.gapMin !== 'number') w.gapMin = WORK_DEFAULTS.gapMin;
  return w;
}

function isWorkingDay(ds) {
  const [y, m, d] = ds.split('-').map(Number);
  return work().days.includes(new Date(y, m - 1, d).getDay());
}

/* Everything already claiming time on a given day, merged into a tidy list of
   busy intervals. Imported calendar events count — the whole point is not to
   book you against your own dentist. */
function busyIntervals(ds) {
  const gap = Math.max(0, work().gapMin);
  const spans = state.tasks
    .filter(t => t.date === ds && t.startMin != null && !t.done)
    .map(t => ({ from: t.startMin - gap, to: t.startMin + Math.max(5, t.durationMin || 30) + gap }))
    .sort((a, b) => a.from - b.from);

  const merged = [];
  spans.forEach(s => {
    const last = merged[merged.length - 1];
    if (last && s.from <= last.to) last.to = Math.max(last.to, s.to);
    else merged.push({ ...s });
  });
  return merged;
}

/* The first free start time that fits `duration`, at or after `notBefore`. */
function findSlot(ds, durationMin, notBefore) {
  const w = work();
  const dur = Math.max(5, durationMin || 30);
  const busy = busyIntervals(ds);
  let cursor = Math.max(w.startMin, notBefore || 0);

  for (const span of busy) {
    if (cursor + dur <= span.from) return cursor;      // fits before this block
    cursor = Math.max(cursor, span.to);
  }
  return cursor + dur <= w.endMin ? cursor : null;
}

// "Now", rounded up to the next five minutes, so nothing lands in the past.
function earliestToday(ds) {
  if (ds !== todayStr()) return 0;
  const now = new Date();
  return Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 5) * 5;
}

function schedulableTasks(ds) {
  const isToday = ds === todayStr();
  return state.tasks
    .filter(t => !t.done && !t.someday && !t.external && t.startMin == null
                 && (t.date === ds || (isToday && t.date === null)))
    // Urgency first, then heavier work earlier — a "needs focus" task at 4pm
    // is a task that gets moved to tomorrow.
    .sort((a, b) =>
      (urgencyRank(a.urgency) - urgencyRank(b.urgency)) ||
      (energyRank(a.energy) - energyRank(b.energy)) ||
      (a.createdAt - b.createdAt));
}

function energyRank(e) { return e === 'high' ? 0 : e === 'medium' ? 1 : e === 'low' ? 2 : 1.5; }

/* Schedule one task, if there's room. Returns the chosen minute or null. */
function autoPlaceTask(t, ds) {
  const floor = earliestToday(ds);
  // A time the task already suggested wins, provided it's free and not past.
  if (t.proposedMin != null && t.proposedMin >= floor) {
    const clash = busyIntervals(ds).some(s =>
      t.proposedMin < s.to && t.proposedMin + (t.durationMin || 30) > s.from);
    if (!clash && t.proposedMin + (t.durationMin || 30) <= work().endMin) {
      t.date = ds;
      t.startMin = t.proposedMin;
      delete t.proposedMin;
      touchTask(t);
      return t.startMin;
    }
  }
  const slot = findSlot(ds, t.durationMin || 30, floor);
  if (slot == null) return null;
  t.date = ds;
  t.startMin = slot;
  delete t.proposedMin;
  touchTask(t);
  return slot;
}

function autoScheduleDay(ds) {
  const pending = schedulableTasks(ds);
  let placed = 0, skipped = 0, firstMin = null;
  pending.forEach(t => {
    const min = autoPlaceTask(t, ds);
    if (min == null) { skipped++; return; }
    placed++;
    if (firstMin == null || min < firstMin) firstMin = min;
  });
  if (placed) saveState('auto-scheduling your day');
  return { placed, skipped, firstMin };
}

function renderAutoScheduleRow(ds) {
  const row = document.getElementById('autoRow');
  if (!row) return;
  const n = schedulableTasks(ds).length;
  row.hidden = n === 0 || !!state.settings.focusMode;
  if (n) {
    document.getElementById('autoBtn').textContent =
      `Schedule ${n} task${n === 1 ? '' : 's'} into my day`;
  }
}

on('autoBtn', 'click', () => {
  const ds = currentTodayDateStr();
  const res = autoScheduleDay(ds);
  if (!res.placed && !res.skipped) { toast('Nothing waiting to be scheduled'); return; }

  if (res.placed) {
    // Show the result rather than describing it — the point is to see the day.
    state.settings.showSchedule = true;
    saveState('silent');
    renderToday();
    scrollGridToRelevant();
  } else {
    renderToday();
  }

  if (res.placed && res.skipped) {
    toast(`${res.placed} scheduled · ${res.skipped} didn't fit before ${minToLabel(work().endMin)} — still in your inbox`, 6000);
  } else if (res.placed) {
    const dayNote = isWorkingDay(ds) ? '' : ' (not one of your working days, but you asked)';
    toast(`${res.placed} task${res.placed === 1 ? '' : 's'} scheduled from ${minToLabel(res.firstMin)}${dayNote}`, 5000);
  } else {
    toast(`No room left between ${minToLabel(work().startMin)} and ${minToLabel(work().endMin)} — widen your hours in Settings, or shorten a block`, 7000);
  }
});

/* Automatic mode: a task captured with no time is slotted immediately, so the
   inbox never silently becomes a backlog. Off by default — some people want
   the app to plan for them, others find it presumptuous. */
function maybeAutoPlace(t) {
  if (!work().auto) return null;
  const ds = todayStr();
  if (t.date !== ds && t.date !== null) return null;
  if (t.startMin != null || t.done || t.someday) return null;
  if (!isWorkingDay(ds)) return null;
  const min = autoPlaceTask(t, ds);
  if (min != null) saveState('silent');
  return min;
}

/* ---------- Working hours UI ---------- */
function renderWorkRows() {
  const w = work();
  const s = document.getElementById('workStartInput');
  const e = document.getElementById('workEndInput');
  if (s) s.value = minToTimeInput(w.startMin);
  if (e) e.value = minToTimeInput(w.endMin);

  const wrap = document.getElementById('workDays');
  if (wrap) {
    if (!wrap.childElementCount) {
      // Monday-first, which is how almost everyone reads a working week.
      [1, 2, 3, 4, 5, 6, 0].forEach(d => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'day-chip';
        btn.dataset.day = d;
        btn.textContent = WD[d][0];
        btn.setAttribute('aria-label', WDFULL[d]);
        btn.addEventListener('click', () => {
          const days = work().days;
          const i = days.indexOf(d);
          if (i >= 0) days.splice(i, 1); else days.push(d);
          saveState('silent');
          renderWorkRows();
          renderAll();
        });
        wrap.appendChild(btn);
      });
    }
    wrap.querySelectorAll('.day-chip').forEach(el => {
      el.classList.toggle('active', w.days.includes(+el.dataset.day));
      el.setAttribute('aria-pressed', w.days.includes(+el.dataset.day) ? 'true' : 'false');
    });
  }

  const auto = document.getElementById('autoScheduleToggle');
  if (auto) {
    auto.textContent = w.auto ? 'On' : 'Off';
    auto.classList.toggle('active', !!w.auto);
  }
  const gap = document.getElementById('gapBtn');
  if (gap) gap.textContent = w.gapMin ? `${w.gapMin} min` : 'None';

  const note = document.getElementById('workNote');
  if (note) {
    const w2 = work();
    note.textContent = w2.days.length
      ? `Tasks are placed between ${minToLabel(w2.startMin)} and ${minToLabel(w2.endMin)}, ${w2.gapMin ? `with ${w2.gapMin} minutes between them` : 'back to back'}, on your working days only. Nothing already on the day is moved.`
      : 'No working days selected — the button on Today still works if you ask it to.';
  }
}

on('workStartInput', 'change', () => {
  const v = document.getElementById('workStartInput').value;
  if (!v) return;
  const w = work();
  w.startMin = timeToMin(v);
  if (w.startMin >= w.endMin) w.endMin = Math.min(1439, w.startMin + 60);
  saveState('silent');
  renderWorkRows();
});
on('workEndInput', 'change', () => {
  const v = document.getElementById('workEndInput').value;
  if (!v) return;
  const w = work();
  w.endMin = timeToMin(v);
  if (w.endMin <= w.startMin) w.startMin = Math.max(0, w.endMin - 60);
  saveState('silent');
  renderWorkRows();
});
on('autoScheduleToggle', 'click', () => {
  const w = work();
  w.auto = !w.auto;
  saveState('silent');
  renderWorkRows();
  toast(w.auto
    ? 'New tasks will be given a time automatically'
    : 'New tasks will stay in your inbox until you schedule them');
});
const GAP_CHOICES = [0, 5, 10, 15, 30];
on('gapBtn', 'click', () => {
  const w = work();
  w.gapMin = GAP_CHOICES[(GAP_CHOICES.indexOf(w.gapMin) + 1) % GAP_CHOICES.length];
  saveState('silent');
  renderWorkRows();
});

/* ======================= Focus & flow controls ======================= */
on('focusBtn', 'click', () => {
  state.settings.focusMode = !state.settings.focusMode;
  saveState('silent');
  renderToday();
  toast(state.settings.focusMode ? 'Three things. The rest can wait.' : 'Everything back');
});

on('carryBtn', 'click', carryForward);
on('somedayBtn', 'click', openSomeday);
on('somedayDoneBtn', 'click', closeSheets);
on('recapBtn', 'click', openRecap);
on('recapDoneBtn', 'click', closeSheets);
on('openRecapBtn', 'click', () => { closeSheets(); openRecap(); });

/* Toggle rows in Settings. Each one is a genuine preference — some people find
   grace days a cop-out, some find the time bar stressful — so none of it is
   forced, and everything defaults to the more forgiving option. */
const FLOW_TOGGLES = [
  ['graceToggle', 'graceDays'],
  ['transitionToggle', 'transitionWarn'],
  ['momentumToggle', 'momentum'],
  ['timeBarToggle', 'timeBar'],
  ['decayToggle', 'autoDecay'],
  ['keepAwakeToggle', 'keepAwake'],
];

function renderFlowToggles() {
  FLOW_TOGGLES.forEach(([id, key]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const val = state.settings[key] !== false;
    btn.textContent = val ? 'On' : 'Off';
    btn.classList.toggle('active', val);
  });
}

FLOW_TOGGLES.forEach(([id, key]) => {
  on(id, 'click', () => {
    state.settings[key] = state.settings[key] === false;
    saveState('silent');
    if (key === 'keepAwake') {
      if (state.settings.keepAwake && anyTimerRunning()) acquireWakeLock();
      else releaseWakeLock();
    }
    renderFlowToggles();
    renderAll();
  });
});

/* ======================= Tutorial =======================
   Seven cards, skippable from the first frame. It explains the two or three
   ideas that make the app different and then gets out of the way — an
   onboarding flow nobody can finish is worse than none at all. */
const TOUR_SLIDES = [
  {
    icon: 'sparkle',
    title: 'DayFlow',
    body: 'A planner built around one rule: capturing something is always faster than organising it. Seven quick cards and you\'re done.',
  },
  {
    icon: 'plus',
    title: 'Get it out of your head',
    body: 'Type or dictate into the bar at the bottom from anywhere in the app. Paste a whole list and each line becomes its own task. No fields, no categories, no decisions — the magnifier in the top bar finds anything again later.',
  },
  {
    icon: 'bolt',
    title: 'Start before you\'re ready',
    body: 'Every task has a 5m button. One tap starts a five-minute timer — no scheduling first. Add a "first step" like <em>open the laptop</em> and the starting line gets even lower.',
  },
  {
    icon: 'timer',
    title: 'See time instead of counting it',
    body: 'A bar above the tab bar quietly empties as your next block approaches, and the schedule draws a line at the current moment. Timers keep running into overtime rather than shouting at you.',
  },
  {
    icon: 'target',
    title: 'Habits that forgive',
    body: 'One missed day a week won\'t reset your streak, and every habit shows how many of the last 30 days you turned up. A bad Tuesday doesn\'t erase the month.',
  },
  {
    icon: 'trophy',
    title: 'The app learns your real pace',
    body: 'Time a task, chore or practice session and DayFlow remembers how long it actually took, then pre-fills that next time. Estimates stop being wishful thinking.',
  },
  {
    icon: 'crosshair',
    title: 'When it\'s all too much',
    body: 'Tap <strong>Focus</strong> on Today to hide everything but three things. Anything untouched for three weeks steps aside on its own, undo is always one tap away, and DayFlow will nag you to export a backup — everything lives on this phone and nowhere else.',
  },
];

let tourIndex = 0;

function renderTour() {
  const s = TOUR_SLIDES[tourIndex];
  document.getElementById('tourIcon').innerHTML = icon(s.icon, 30, { strokeWidth: 1.6 });
  document.getElementById('tourTitle').textContent = s.title;
  document.getElementById('tourBody').innerHTML = s.body;

  const dots = document.getElementById('tourDots');
  dots.innerHTML = TOUR_SLIDES.map((_, i) =>
    `<span class="tour-dot${i === tourIndex ? ' on' : ''}"></span>`).join('');

  document.getElementById('tourBackBtn').hidden = tourIndex === 0;
  const last = tourIndex === TOUR_SLIDES.length - 1;
  document.getElementById('tourNextBtn').innerHTML = last
    ? 'Get started'
    : `Next ${icon('arrowRight', 16, { strokeWidth: 2 })}`;
  document.getElementById('tourCount').textContent = `${tourIndex + 1} of ${TOUR_SLIDES.length}`;
}

function openTour() {
  tourIndex = 0;
  renderTour();
  document.getElementById('tourOverlay').hidden = false;
}

function closeTour() {
  document.getElementById('tourOverlay').hidden = true;
  state.settings.tutorialSeen = true;
  saveState('silent');
}

on('tourNextBtn', 'click', () => {
  if (tourIndex >= TOUR_SLIDES.length - 1) { closeTour(); toast('You\'re set. Add the first thing on your mind.', 3500); return; }
  tourIndex++;
  renderTour();
});
on('tourBackBtn', 'click', () => { if (tourIndex > 0) { tourIndex--; renderTour(); } });
on('tourSkipBtn', 'click', () => { closeTour(); });
on('showTourBtn', 'click', () => { closeSheets(); openTour(); });

/* ======================= Sheets generic ======================= */
/* Every sheet gets a real close affordance. Relying on a backdrop tap alone
   left tall sheets (Lists, Routine edit, Alarm) with almost no tappable
   backdrop, which reads as being trapped in the sheet. */
function installSheetChrome() {
  document.querySelectorAll('.sheet').forEach(sheet => {
    if (sheet.querySelector('.sheet-close')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sheet-close';
    btn.setAttribute('aria-label', 'Close');
    btn.innerHTML = icon('x', 18);
    btn.addEventListener('click', (e) => { e.stopPropagation(); closeSheets(); });
    sheet.insertBefore(btn, sheet.firstChild);

    makeSheetDismissible(sheet);
  });
}

/* Pull-to-dismiss across the whole sheet, not just the grab handle.
   Rules that keep it from fighting the sheet's own scrolling:
     - only arm when the sheet is already scrolled to the top
     - an upward first move disarms, so scrolling still works
     - controls that scroll themselves (the wheel picker) are excluded
     - the click that follows a drag is swallowed, so releasing over a
       button doesn't also trigger it */
function makeSheetDismissible(sheet) {
  if (sheet._dragBound) return;
  sheet._dragBound = true;

  const DRAG_START = 10;    // px before we treat it as a drag
  const DISMISS_AT = 110;   // px travelled to actually close
  let startY = 0, dy = 0, dragging = false, armed = false;

  const swallowClick = (ev) => { ev.stopPropagation(); ev.preventDefault(); };

  sheet.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a, label, input, textarea, select, .wheel-col, .heatmap')) return;
    if (sheet.scrollTop > 0) return;

    armed = true; dragging = false; startY = e.clientY; dy = 0;

    const move = (ev) => {
      if (!armed) return;
      const d = ev.clientY - startY;
      if (!dragging) {
        if (d < -6) { armed = false; return; }        // moving up: let it scroll
        if (d < DRAG_START) return;
        dragging = true;
        sheet.style.transition = 'none';
      }
      dy = Math.max(0, d);
      sheet.style.transform = `translateY(${dy}px)`;
      if (ev.cancelable) ev.preventDefault();
    };

    const finish = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      if (dragging) {
        sheet.style.transition = '';
        if (dy > DISMISS_AT) closeSheets();
        else sheet.style.transform = '';
        sheet.addEventListener('click', swallowClick, true);
        setTimeout(() => sheet.removeEventListener('click', swallowClick, true), 0);
      }
      armed = false; dragging = false;
    };

    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
  });

  // Safari can begin native scrolling before pointermove is honoured; block it
  // outright while a dismiss drag is in flight.
  sheet.addEventListener('touchmove', (e) => {
    if (dragging && e.cancelable) e.preventDefault();
  }, { passive: false });
}

const STACKING_SHEETS = new Set(['taskDurationSheet', 'durationPickerSheet']);

function openSheet(id) {
  installSheetChrome();
  const backdrop = document.getElementById('overlayBackdrop');
  const sheet = document.getElementById(id);
  if (!sheet) { console.warn('[DayFlow] missing sheet:', id); return; }
  // Only one sheet at a time. Opening a second one over the first left the
  // old one still on top of the stack, so its rows swallowed taps meant for
  // the new sheet — the classic "the button does nothing" bug.
  //
  // The wheel pickers are the exception: they are opened *by* a sheet and
  // dismiss back to it, so they stack instead of replacing.
  if (!STACKING_SHEETS.has(id)) {
    document.querySelectorAll('.sheet').forEach(s => {
      if (s !== sheet) { s.hidden = true; s.style.transform = ''; s.classList.remove('open'); }
    });
  }
  if (backdrop) backdrop.hidden = false;
  sheet.hidden = false;
  sheet.style.transform = '';
  requestAnimationFrame(() => sheet.classList.add('open'));
}
function closeSheets() {
  document.querySelectorAll('.sheet').forEach(s => { s.hidden = true; s.style.transform = ''; });
  document.getElementById('overlayBackdrop').hidden = true;
  activeBlock = null;
  activeHabit = null;
}
on('overlayBackdrop', 'click', closeSheets);

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheets(); });

// A crash used to be invisible; make it visible so it can be reported.
window.addEventListener('error', (e) => {
  console.error('[DayFlow]', e.message);
  try { toast('Something went wrong — try Settings › Check for update'); } catch (_) {}
});

/* ======================= Render all ======================= */
function renderAll() {
  if (state.view.current === 'today') renderToday();
  if (state.view.current === 'week') renderWeek();
  if (state.view.current === 'habits') renderHabits();
  if (state.view.current === 'routines') renderRoutinesView();
  if (state.view.current === 'chores') renderChoresView();
  if (state.view.current === 'chat') renderChat();
  if (state.view.current === 'stats') renderStats();
  if (state.view.current !== 'today') renderTimeBar();   // hides it off Today
}

/* Shortcuts returns here via x-callback-url, so a missing shortcut is reported
   in-app with the fix, instead of leaving the user on an error in another app. */
const ALARM_RESULT = (location.search.match(/[?&]alarm=(ok|err|cancel)/) || [])[1] || null;
if (ALARM_RESULT) {
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* non-fatal */ }
}

/* Shortcuts hands the calendar back the same way it reports alarm results:
   a flag plus the shortcut's text output in `result`. */
const CAL_PARAMS = new URLSearchParams(location.search);
const CAL_RESULT = (location.search.match(/[?&]cal=(ok|err|cancel)/) || [])[1] || null;
const CAL_PAYLOAD = CAL_PARAMS.get('result') || '';
if (CAL_RESULT) {
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* non-fatal */ }
}

/* Drop the ?fresh= marker left by a forced update so it doesn't linger. */
const CAME_FROM_UPDATE = location.search.includes('fresh=');
if (CAME_FROM_UPDATE) {
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* non-fatal */ }
}

/* ======================= Init ======================= */
applyTheme();
// Always open on Today. The stored view was whatever happened to be current at
// the last save — and since the Assistant persists its greeting the moment you
// visit it, that made every relaunch land on the Assistant tab.
state.view.current = 'today';
// A stray day/week offset could persist from a previous session (paging to
// tomorrow then doing anything that saves), which silently hides the now-line
// because you are no longer looking at today.
state.view.todayOffset = 0;
state.view.weekOffset = 0;
// Park anything that has been sitting untouched for weeks before the first
// render, so the inbox you open is the one you can actually act on.
const STALE_MOVED = sweepStaleTasks();
// Rebuild today's repeating tasks before the first paint, so they are simply
// part of the day rather than something that pops in a moment later.
materialiseRecurring();
switchView('today');

// Ask the browser to treat this data as worth keeping. iOS evicts storage from
// web apps that go unopened, and this is the only lever a page has.
requestPersistentStorage().then(res => {
  if (res !== null && state.settings.storagePersisted !== res) {
    state.settings.storagePersisted = res;
    saveState('silent');
  }
});
// A second copy under a different key survives a corrupt write, though not a
// "clear website data" — which is exactly why the export nag exists too.
setTimeout(writeLocalSnapshot, 4000);
setInterval(writeLocalSnapshot, 30 * 60 * 1000);
setInterval(syncPushSchedule, 15 * 60 * 1000);
setTimeout(syncPushSchedule, 6000);
if (STALE_MOVED) {
  setTimeout(() => toast(`${STALE_MOVED} stale task${STALE_MOVED === 1 ? '' : 's'} moved to Someday — still there if you want them`, 5000), 900);
}

// A timer that was running when the app was killed comes back first — before
// the tour or the recap could put a sheet over the top of it.
const TIMER_RESTORED = restoreLiveTimer();

// First run gets the tour. Anything else — an update, a returning user — does
// not, because being re-onboarded by an app you already use is infuriating.
if (!state.settings.tutorialSeen && !ALARM_RESULT && !CAME_FROM_UPDATE && !TIMER_RESTORED) {
  setTimeout(openTour, 350);
}

if (ALARM_RESULT === 'ok') {
  setTimeout(() => toast('Alarms set in Clock', 4000), 500);
} else if (ALARM_RESULT === 'err') {
  setTimeout(() => {
    toast(`No shortcut named “${SHORTCUT_NAME}” yet — here's how to make it`, 6000);
    openAlarmSetup();
  }, 500);
}

// Confirm a forced update actually completed, so it isn't a silent no-op.
if (CAME_FROM_UPDATE) {
  // Don't claim success blindly — the browser may still have served a cached
  // copy of app.js, in which case we are lying to the user about the version.
  setTimeout(async () => {
    const remote = await fetchRemoteVersion();
    if (remote && remote !== APP_VERSION) {
      toast(`Still on ${APP_VERSION} — a cached copy was served. Try once more; if it sticks, reopen in Safari and re-add to your Home Screen.`, 10000);
    } else {
      toast(`Updated — you're on ${APP_VERSION}`, 5000);
    }
  }, 700);
}
setInterval(() => { if (state.view.current === 'today') renderGrid(currentTodayDateStr()); }, 20000);
// The time bar only means anything if it actually moves.
setInterval(renderTimeBar, 15000);
renderTimeBar();

if (CAL_RESULT) setTimeout(() => handleCalendarReturn(CAL_RESULT, CAL_PAYLOAD), 500);

// A quiet refresh on launch and every half hour, so the grid reflects the
// calendar without anyone having to remember to press sync.
if (googleConnected()) {
  setTimeout(() => syncGoogle({ quiet: true }), 2500);
  setInterval(() => { if (googleConnected()) syncGoogle({ quiet: true }); }, 30 * 60 * 1000);
}

/* ======================= Service worker ======================= */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW failed', err));
  });
}

})();
