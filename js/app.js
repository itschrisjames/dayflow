(() => {
'use strict';

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
const APP_VERSION = 'v13';
const APP_BUILT = '2026-08-14';

/* ======================= Storage ======================= */
const STORE_KEY = 'dayflow.v1';
const THEME_KEY = 'dayflow.theme';

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.warn('load failed', e); }
  return blankState();
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
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
};

function icon(name, size = 20, opts = {}) {
  const p = ICON_PATHS[name];
  if (!p) return '';
  const fill = opts.fill ? 'currentColor' : 'none';
  const sw = opts.strokeWidth || 1.75;
  return `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" fill="${fill}" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

const GRID_START_MIN = 6 * 60;   // 6:00 AM
const GRID_END_MIN = 23 * 60;    // 11:00 PM
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
    settings: { theme: 'auto', remindersEnabled: false, colorScheme: 'orange', showSchedule: false },
    view: { current: 'today', todayOffset: 0, weekOffset: 0 },
  };
}

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
  // Existing installs seeded the day list as "Errands"; it's the To Do List now.
  (s.lists || []).forEach(l => { if (l.name === 'Errands') l.name = 'To Do List'; });
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
saveState();

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
  state.view.current = name;
  views.forEach(v => document.getElementById('view-' + v).classList.toggle('active', v === name));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  document.getElementById('viewTitle').textContent = titles[name];
  updateInputBarMode();
  renderAll();
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
  const untimed = dayTasks.filter(t => t.startMin == null && !t.done);
  const backlog = isToday ? state.tasks.filter(t => t.date === null && !t.done) : [];
  const inboxTasks = [...untimed, ...backlog]
    .sort((a, b) => (urgencyRank(a.urgency) - urgencyRank(b.urgency)) || (a.createdAt - b.createdAt));

  const inboxList = document.getElementById('inboxList');
  inboxList.innerHTML = '';
  inboxTasks.forEach(t => inboxList.appendChild(renderInboxItem(t)));
  document.getElementById('inboxCount').textContent = inboxTasks.length;

  // checklist-today (lists attached to this date)
  const attached = state.lists.filter(l => l.attachedDate === ds);
  const section = document.getElementById('checklistTodaySection');
  const wrap = document.getElementById('checklistTodayList');
  wrap.innerHTML = '';
  if (attached.length === 0) {
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
}

function renderInboxItem(t) {
  const el = document.createElement('div');
  el.className = 'inbox-item';
  el.dataset.id = t.id;
  el.innerHTML = `
    <div class="swipe-content"><span class="grip">${icon('grip', 16)}</span><span class="title">${escapeHtml(t.title)}</span>${t.urgency ? `<span class="u-tag ${t.urgency}">${URGENCY_BY_ID[t.urgency].short}</span>` : ''}${t.proposedMin != null ? `<button type="button" class="time-chip">${minToLabel(t.proposedMin)}</button>` : (t.urgency ? '' : '<span class="place-hint">tap to place</span>')}</div>
    <button type="button" class="swipe-delete-btn" aria-label="Delete task">${icon('trash', 18)}<span>Delete</span></button>
  `;
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

  const blocks = state.tasks
    .filter(t => t.date === ds && t.startMin != null)
    .sort((a, b) => a.startMin - b.startMin);
  const summaryEl = document.getElementById('scheduleSummary');
  if (open) { summaryEl.textContent = ''; return; }
  if (!blocks.length) { summaryEl.textContent = 'nothing scheduled'; return; }

  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const isToday = ds === todayStr();
  const upcoming = isToday ? blocks.find(b => !b.done && b.startMin + b.durationMin > nowMin) : blocks.find(b => !b.done);
  const n = `${blocks.length} block${blocks.length === 1 ? '' : 's'}`;
  const unfinished = blocks.filter(b => !b.done).length;
  if (upcoming) {
    summaryEl.textContent = `${n} · next ${upcoming.title} at ${minToLabel(upcoming.startMin)}`;
  } else if (unfinished) {
    // Past their slot but never ticked off — "all done" would be a lie.
    summaryEl.textContent = `${n} · ${unfinished} unfinished`;
  } else {
    summaryEl.textContent = `${n} · all done`;
  }
}

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

  // now line
  const nowLine = document.getElementById('nowLine');
  const isToday = ds === todayStr();
  if (isToday) {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    if (nowMin >= GRID_START_MIN && nowMin <= GRID_END_MIN) {
      nowLine.style.display = 'block';
      nowLine.style.top = ((nowMin - GRID_START_MIN) * PX_PER_MIN) + 'px';
    } else nowLine.style.display = 'none';
  } else nowLine.style.display = 'none';

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
  el.className = 'block' + (t.done ? ' done' : '');
  el.dataset.id = t.id;
  const top = (t.startMin - GRID_START_MIN) * PX_PER_MIN;
  const height = Math.max(22, t.durationMin * PX_PER_MIN);
  el.style.top = top + 'px';
  el.style.height = height + 'px';
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
}
function openSwipeRowObj(el, content, width) {
  if (openSwipeRow && openSwipeRow.el !== el) closeSwipeRowObj(openSwipeRow);
  content.style.transition = '';
  content.style.transform = `translateX(-${width}px)`;
  el._swipeOpen = true;
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
  saveState();
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
  saveState();
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
  currentDuration = t.durationMin || 30;
  updateDurLabel();
  currentUrgency = t.urgency || null;
  renderUrgencyOptions();
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
  }
  activeBlock.durationMin = currentDuration;
  activeBlock.urgency = currentUrgency;
  saveState();
  closeSheets();
  renderAll();
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
  saveState();
  closeSheets();
  renderAll();
});

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

  const parsed = extractTimeFromTitle(title);
  const dateForNew = state.view.current === 'today' ? currentTodayDateStr() : null;

  if (parsed) {
    // Capture stays capture: a stated time is remembered as a suggestion, but
    // the task still lands in the inbox so nothing is scheduled behind your back.
    state.tasks.push({ id: uid(), title: parsed.title, date: dateForNew || todayStr(),
      startMin: null, proposedMin: parsed.startMin, durationMin: 30, done: false, createdAt: Date.now() });
    input.value = '';
    saveState();
    renderAll();
    toast(`In your inbox — tap ${minToLabel(parsed.startMin)} to schedule it`, 3000);
    return;
  }

  state.tasks.push({ id: uid(), title, date: dateForNew, startMin: null, durationMin: 30, done: false, createdAt: Date.now() });
  input.value = '';
  saveState();
  renderAll();
  toast('Added to inbox');
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

function computeStreak(h) {
  // current streak: consecutive qualifying periods up to today with completion
  let streak = 0;
  if (h.freq.type === 'daily') {
    let d = new Date();
    // if today not done yet, streak counts up to yesterday
    if (!habitDoneOn(h, todayStr())) d = addDays(d, -1);
    while (habitDoneOn(h, dateStr(d))) { streak++; d = addDays(d, -1); }
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

function renderHabits() {
  const list = document.getElementById('habitsList');
  list.innerHTML = '';
  document.getElementById('habitsCount').textContent = state.habits.length;
  const ds = todayStr();
  state.habits.forEach(h => {
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
      ? `<span class="chain">chain of ${streak} — don't break it</span>`
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
  openSheet('habitSheet');
}

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

on('habitDeleteBtn', 'click', () => {
  if (!activeHabit) return;
  state.habits = state.habits.filter(x => x.id !== activeHabit.id);
  saveState();
  closeSheets();
  renderAll();
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
  const totalHabits = state.habits.length;

  cards.innerHTML = `
    <div class="stat-card"><div class="val">${pct7}%</div><div class="lbl">Tasks done, 7d</div></div>
    <div class="stat-card"><div class="val">${pct30}%</div><div class="lbl">Tasks done, 30d</div></div>
    <div class="stat-card"><div class="val">${bestStreak}</div><div class="lbl">Best active streak</div></div>
    <div class="stat-card"><div class="val">${totalHabits}</div><div class="lbl">Habits tracked</div></div>
  `;

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
    row.innerHTML = `<span>${escapeHtml(h.name)}</span><span class="sv">current ${computeStreak(h)} · best ${computeLongestStreak(h)}</span>`;
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
  document.getElementById('routinesCount').textContent = state.routines.length;

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

  state.routines.forEach(r => {
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
  state.routines = state.routines.filter(x => x.id !== activeRoutine.id);
  saveState();
  closeSheets();
  renderRoutinesView();
});

/* ---------- Routine run mode ---------- */
let runRoutine = null, runIndex = 0, runRemaining = 0, runInterval = null, runPaused = false, runStartTime = 0;
const RING_CIRC = 565.48;

function startRoutine(r) {
  runRoutine = r;
  runIndex = 0;
  runStartTime = Date.now();
  document.getElementById('runDone').hidden = true;
  document.getElementById('runBody').hidden = false;
  document.getElementById('routineRunOverlay').hidden = false;
  loadRunStep();
}

function loadRunStep() {
  clearInterval(runInterval);
  runPaused = false;
  document.getElementById('runPauseBtn').textContent = 'Pause';
  const step = runRoutine.steps[runIndex];
  runRemaining = step.seconds;
  document.getElementById('runStepTitle').textContent = step.text;
  document.getElementById('runProgress').textContent = `Step ${runIndex + 1} of ${runRoutine.steps.length}`;
  document.getElementById('runPrevBtn').disabled = runIndex === 0;
  document.getElementById('runPrevBtn').style.opacity = runIndex === 0 ? 0.4 : 1;
  const isLast = runIndex === runRoutine.steps.length - 1;
  document.getElementById('runNextBtn').textContent = isLast ? 'Finish ›' : 'Skip ›';
  renderRunDots();
  updateRunRing(step.seconds);
  runInterval = setInterval(runTick, 1000);
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
  const frac = total > 0 ? runRemaining / total : 0;
  document.getElementById('runRingFg').style.strokeDashoffset = RING_CIRC * (1 - frac);
  document.getElementById('runTimerNum').textContent = fmtMinSec(runRemaining);
}

function runTick() {
  runRemaining--;
  const step = runRoutine.steps[runIndex];
  updateRunRing(step.seconds);
  if (runRemaining <= 0) {
    clearInterval(runInterval);
    advanceRunStep();
  }
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
  const elapsed = Math.round((Date.now() - runStartTime) / 1000);
  document.getElementById('runBody').hidden = true;
  document.getElementById('runDone').hidden = false;
  document.getElementById('runDoneTime').textContent = `Completed “${escapeHtml(runRoutine.name)}” in ${fmtMinSec(elapsed)}`;
  toast('Routine complete');
}

on('runPauseBtn', 'click', () => {
  runPaused = !runPaused;
  document.getElementById('runPauseBtn').textContent = runPaused ? 'Resume' : 'Pause';
  if (runPaused) clearInterval(runInterval);
  else runInterval = setInterval(runTick, 1000);
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
  document.getElementById('routineRunOverlay').hidden = true;
});
on('runFinishBtn', 'click', () => {
  document.getElementById('routineRunOverlay').hidden = true;
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
  state.chores.forEach(c => {
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
      state.chores = state.chores.filter(x => x.id !== c.id);
      saveState();
      renderChoresView();
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

function startChoreTimer(c) {
  choreRunning = c;
  choreStartTs = Date.now();
  document.getElementById('choreRunName').textContent = c.name;
  const avg = choreAverage(c);
  document.getElementById('choreAvgLine').innerHTML = avg != null
    ? `Your average: <span class="avg-val">${fmtMinSec(avg)}</span>`
    : `First time timing this — let's set a baseline`;
  document.getElementById('choreStopwatchNum').textContent = '0:00';
  document.getElementById('choreRunOverlay').hidden = false;
  clearInterval(choreInterval);
  choreInterval = setInterval(choreTick, 1000);
}

function choreTick() {
  const elapsed = Math.round((Date.now() - choreStartTs) / 1000);
  document.getElementById('choreStopwatchNum').textContent = fmtMinSec(elapsed);
}

function stopChoreTimer(save) {
  clearInterval(choreInterval);
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
    card.querySelector('[data-act="dl"]').addEventListener('click', () => {
      downloadAlarmIcs(stack);
      toast('Opening in Calendar…');
    });
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
  saveState();
  downloadAlarmIcs(stack);
  renderAlarmStackList();
  toast('3 alarms created — add them in Calendar');
});

/* ======================= Habit timer ======================= */
let habitTimerRunning = null, habitTimerStartTs = 0, habitTimerInterval = null;

function startHabitTimer(h) {
  habitTimerRunning = h;
  habitTimerStartTs = Date.now();
  document.getElementById('habitRunName').textContent = h.name;
  const pr = habitPR(h);
  document.getElementById('habitAvgLine').innerHTML = pr != null
    ? `Personal best: <span class="avg-val">${fmtMinSec(pr)}</span>`
    : `First timed session — let's set a record`;
  document.getElementById('habitStopwatchNum').textContent = '0:00';
  document.getElementById('habitRunOverlay').hidden = false;
  clearInterval(habitTimerInterval);
  habitTimerInterval = setInterval(habitTimerTick, 1000);
}

function habitTimerTick() {
  const elapsed = Math.round((Date.now() - habitTimerStartTs) / 1000);
  document.getElementById('habitStopwatchNum').textContent = fmtMinSec(elapsed);
}

function stopHabitTimer(save) {
  clearInterval(habitTimerInterval);
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
  saveState();
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

  const untimed = dayTasks.filter(t => t.startMin == null);
  const undoneHabits = state.habits.filter(h => !habitDoneOn(h, todayStr()));
  if (untimed.length) {
    return `Nothing scheduled for the rest of today. Smallest thing in your inbox is **${untimed[0].title}** — start there, it's the lowest-friction one.`;
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
  return `**Things I can do**\n\nAsk:\n· What's on today?\n· How am I doing this week?\n· What should I do next?\n· How long does washing dishes take?\n· Show my streaks / records\n· What do you know about me?\n\nTell:\n· add call the bank\n· add habit stretch\n· mark call the bank as asap\n· start morning routine\n· remember that I hate mornings\n\nI'm a simple matcher, not a chatbot with a language model — plain phrasing works best.`;
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
  let remote = null;
  try {
    const res = await fetch('js/app.js?cb=' + Date.now(), { cache: 'no-store' });
    if (res.ok) {
      const txt = await res.text();
      const m = txt.match(/APP_VERSION\s*=\s*'([^']+)'/);
      if (m) remote = m[1];
    }
  } catch (e) {
    console.warn('[DayFlow] version check failed', e);
  }

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
const notifiedTaskKeys = new Set();

function renderRemindersToggle() {
  const btn = document.getElementById('remindersToggleBtn');
  const note = document.getElementById('remindersNote');
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
    note.textContent = 'Get notified when a time-blocked task starts, or when a routine’s reminder time hits. Works best when DayFlow is installed to your Home Screen and open in the background.';
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
      saveState();
      toast('Reminders on');
    } else {
      toast('Notification permission denied');
    }
  } else {
    state.settings.remindersEnabled = false;
    saveState();
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

function checkReminders() {
  if (!state.settings.remindersEnabled) return;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const ds = todayStr();

  state.tasks.forEach(t => {
    if (t.date !== ds || t.startMin == null || t.done) return;
    const key = ds + '_' + t.id;
    if (t.startMin === nowMin && !notifiedTaskKeys.has(key)) {
      notifiedTaskKeys.add(key);
      fireReminder('Time to start', t.title);
    }
  });

  state.routines.forEach(r => {
    if (!r.remindAt) return;
    if (r.lastRemindedDate === ds) return;
    if (timeToMin(r.remindAt) === nowMin) {
      r.lastRemindedDate = ds;
      saveState();
      fireReminder('Routine time', `Time for your “${r.name}” routine`);
    }
  });

  // In-app echo of the alarm stacks (the .ics in Calendar is the real alarm).
  state.alarmStacks.forEach(stack => {
    [0, ALARM_GAP_MIN, ALARM_GAP_MIN * 2].forEach((off, i) => {
      const min = (stack.startMin + off) % 1440;
      const key = `${ds}_${stack.id}_${i}`;
      if (min === nowMin && !notifiedTaskKeys.has(key)) {
        notifiedTaskKeys.add(key);
        fireReminder(`${stack.label} (${i + 1}/3)`, i === 2 ? 'Last call.' : 'Time to move.');
      }
    });
  });
}
setInterval(checkReminders, 20000);

on('exportBtn', 'click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dayflow-backup-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Exported');
});

on('importFile', 'change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.tasks || !data.habits) throw new Error('bad format');
      state = data;
      if (!state.view) state.view = { current: 'today', todayOffset: 0, weekOffset: 0 };
      if (!state.routines) state.routines = [];
      if (!state.chores) state.chores = [];
      if (!state.settings) state.settings = { theme: 'auto', remindersEnabled: false, colorScheme: 'orange' };
      if (state.settings.remindersEnabled === undefined) state.settings.remindersEnabled = false;
      if (!state.settings.colorScheme) state.settings.colorScheme = 'orange';
      ensureHabitSessions(state);
      ensureNewCollections(state);
      saveState();
      applyTheme();
      renderAll();
      toast('Imported');
    } catch (err) {
      toast('Import failed — invalid file');
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
  saveState();
  renderAll();
  toast('Practice records cleared');
});

on('clearSampleBtn', 'click', () => {
  if (!confirm('Remove all sample tasks, habits, routines, chores and lists? Your settings stay. This gives you a blank slate.')) return;
  const settings = state.settings;
  const view = state.view;
  state = emptyState();
  state.settings = settings;
  state.view = view;
  saveState();
  applyTheme();
  closeSheets();
  renderAll();
  toast('Blank slate — all yours now');
});

on('resetBtn', 'click', () => {
  if (!confirm('Erase everything, including settings? This cannot be undone.')) return;
  state = blankState();
  saveState();
  applyTheme();
  closeSheets();
  renderAll();
  toast('Everything erased');
});

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

function openSheet(id) {
  installSheetChrome();
  const backdrop = document.getElementById('overlayBackdrop');
  const sheet = document.getElementById(id);
  if (!sheet) { console.warn('[DayFlow] missing sheet:', id); return; }
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
switchView('today');

// Confirm a forced update actually completed, so it isn't a silent no-op.
if (CAME_FROM_UPDATE) {
  setTimeout(() => toast(`Updated — you're on ${APP_VERSION}`, 5000), 700);
}
setInterval(() => { if (state.view.current === 'today') renderGrid(currentTodayDateStr()); }, 60000);

/* ======================= Service worker ======================= */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW failed', err));
  });
}

})();
