(() => {
'use strict';

/* ======================= Storage ======================= */
const STORE_KEY = 'dayflow.v1';
const THEME_KEY = 'dayflow.theme';

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.warn('load failed', e); }
  return seedState();
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

const GRID_START_MIN = 6 * 60;   // 6:00 AM
const GRID_END_MIN = 23 * 60;    // 11:00 PM
const PX_PER_MIN = 56 / 60;

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 1800);
}

/* ======================= Seed data ======================= */
function seedState() {
  const today = todayStr();
  const yest = dateStr(addDays(new Date(), -1));
  const tmr = dateStr(addDays(new Date(), 1));
  return {
    tasks: [
      { id: uid(), title: 'Morning pages', date: today, startMin: 7 * 60, durationMin: 30, done: true, createdAt: Date.now() - 90000 },
      { id: uid(), title: 'Team standup', date: today, startMin: 9 * 60, durationMin: 15, done: false, createdAt: Date.now() - 80000 },
      { id: uid(), title: 'Deep work: proposal draft', date: today, startMin: 9 * 60 + 30, durationMin: 90, done: false, createdAt: Date.now() - 70000 },
      { id: uid(), title: 'Lunch + walk', date: today, startMin: 12 * 60 + 30, durationMin: 45, done: false, createdAt: Date.now() - 60000 },
      { id: uid(), title: 'Call mom', date: today, startMin: null, durationMin: 20, done: false, createdAt: Date.now() - 50000 },
      { id: uid(), title: 'Pick up dry cleaning', date: today, startMin: null, durationMin: 20, done: false, createdAt: Date.now() - 40000 },
      { id: uid(), title: 'Review PR feedback', date: today, startMin: 15 * 60, durationMin: 45, done: false, createdAt: Date.now() - 30000 },
      { id: uid(), title: 'Gym — legs day', date: today, startMin: 18 * 60, durationMin: 60, done: false, createdAt: Date.now() - 20000 },
      { id: uid(), title: 'Book dentist appointment', date: null, startMin: null, durationMin: 20, done: false, createdAt: Date.now() - 15000 },
      { id: uid(), title: 'Plan weekend trip', date: tmr, startMin: 10 * 60, durationMin: 60, done: false, createdAt: Date.now() - 10000 },
      { id: uid(), title: 'Grocery run', date: tmr, startMin: 17 * 60, durationMin: 40, done: false, createdAt: Date.now() - 5000 },
      { id: uid(), title: 'Read 20 pages', date: yest, startMin: 21 * 60, durationMin: 25, done: true, createdAt: Date.now() - 200000 },
    ],
    habits: seedHabits(),
    routines: [
      {
        id: uid(), name: 'Morning', createdAt: Date.now() - 50000,
        steps: [
          { id: uid(), text: 'Drink a glass of water', seconds: 30 },
          { id: uid(), text: 'Stretch', seconds: 90 },
          { id: uid(), text: 'Make the bed', seconds: 60 },
          { id: uid(), text: 'Review today’s plan', seconds: 60 },
        ]
      },
      {
        id: uid(), name: 'Before Bed', createdAt: Date.now() - 40000,
        steps: [
          { id: uid(), text: 'Lay out clothes for tomorrow', seconds: 60 },
          { id: uid(), text: 'Brush teeth', seconds: 120 },
          { id: uid(), text: 'Phone on charger, out of reach', seconds: 30 },
          { id: uid(), text: 'Lights out', seconds: 15 },
        ]
      },
      {
        id: uid(), name: 'Going to the Gym', createdAt: Date.now() - 30000,
        steps: [
          { id: uid(), text: 'Pack gym bag', seconds: 90 },
          { id: uid(), text: 'Fill water bottle', seconds: 30 },
          { id: uid(), text: 'Grab headphones + keys', seconds: 20 },
          { id: uid(), text: 'Head out', seconds: 15 },
        ]
      },
    ],
    chores: [
      { id: uid(), name: 'Washing dishes', sessions: [612, 540, 585, 498, 570, 525], createdAt: Date.now() - 90000 },
      { id: uid(), name: 'Folding laundry', sessions: [900, 780, 840], createdAt: Date.now() - 70000 },
      { id: uid(), name: 'Tidying desk', sessions: [300, 360, 270, 330], createdAt: Date.now() - 60000 },
    ],
    lists: [
      {
        id: uid(), name: 'Errands', attachedDate: today,
        items: [
          { id: uid(), text: 'Post office — mail package', done: false },
          { id: uid(), text: 'Pharmacy pickup', done: true },
          { id: uid(), text: 'Return Amazon package', done: false },
        ]
      },
      {
        id: uid(), name: 'Weekend Packing', attachedDate: null,
        items: [
          { id: uid(), text: 'Phone charger', done: false },
          { id: uid(), text: 'Hiking boots', done: false },
          { id: uid(), text: 'Rain jacket', done: false },
          { id: uid(), text: 'Water bottle', done: false },
        ]
      },
      {
        id: uid(), name: 'Home Reset (Sunday)', attachedDate: null,
        items: [
          { id: uid(), text: 'Laundry', done: false },
          { id: uid(), text: 'Clean kitchen surfaces', done: false },
          { id: uid(), text: 'Meal prep', done: false },
          { id: uid(), text: 'Water plants', done: false },
        ]
      },
    ],
    settings: { theme: 'auto', remindersEnabled: false, colorScheme: 'orange' },
    view: { current: 'today', todayOffset: 0, weekOffset: 0 },
  };
}

function seedHabits() {
  const habits = [
    { id: uid(), name: 'Drink water', freq: { type: 'daily' }, completions: {}, sessions: [] },
    { id: uid(), name: 'Read', freq: { type: 'daily' }, completions: {}, sessions: [] },
    { id: uid(), name: 'Workout', freq: { type: 'weekly', count: 3 }, completions: {}, sessions: [] },
    { id: uid(), name: 'Meditate', freq: { type: 'daily' }, completions: {}, sessions: [] },
  ];
  // backfill some plausible history over last 60 days
  const now = new Date();
  for (const h of habits) {
    for (let i = 1; i <= 60; i++) {
      const d = addDays(now, -i);
      const ds = dateStr(d);
      let chance = h.freq.type === 'daily' ? 0.78 : 0.42;
      if (i <= 6) chance = h.freq.type === 'daily' ? 0.95 : 0.7; // recent streak looks good
      if (Math.random() < chance) h.completions[ds] = true;
    }
  }
  // seed practice sessions for the two habits that make sense to time
  const readHabit = habits.find(h => h.name === 'Read');
  const meditateHabit = habits.find(h => h.name === 'Meditate');
  Object.keys(readHabit.completions).forEach(ds => {
    if (Math.random() < 0.7) readHabit.sessions.push({ date: ds, seconds: 600 + Math.round(Math.random() * 900) });
  });
  Object.keys(meditateHabit.completions).forEach(ds => {
    if (Math.random() < 0.8) meditateHabit.sessions.push({ date: ds, seconds: 300 + Math.round(Math.random() * 600) });
  });
  readHabit.sessions.sort((a, b) => a.date.localeCompare(b.date));
  meditateHabit.sessions.sort((a, b) => a.date.localeCompare(b.date));
  return habits;
}

/* ======================= State ======================= */
function ensureHabitSessions(s) {
  (s.habits || []).forEach(h => { if (!h.sessions) h.sessions = []; });
}

let state = loadState();
if (!state.view) state.view = { current: 'today', todayOffset: 0, weekOffset: 0 };
if (!state.routines) state.routines = [];
if (!state.chores) state.chores = [];
if (!state.settings) state.settings = { theme: 'auto', remindersEnabled: false, colorScheme: 'orange' };
if (state.settings.remindersEnabled === undefined) state.settings.remindersEnabled = false;
if (!state.settings.colorScheme) state.settings.colorScheme = 'orange';
ensureHabitSessions(state);

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
      btn.innerHTML = `<span class="cs-check" style="color:${contrastTextFor(s.hex)}">✓</span>`;
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
const views = ['today', 'week', 'habits', 'stats'];
const titles = { today: 'Today', week: 'Week', habits: 'Habits', stats: 'Stats' };

function switchView(name) {
  state.view.current = name;
  views.forEach(v => document.getElementById('view-' + v).classList.toggle('active', v === name));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  document.getElementById('viewTitle').textContent = titles[name];
  renderAll();
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
  const inboxTasks = [...untimed, ...backlog].sort((a, b) => a.createdAt - b.createdAt);

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
      const head = document.createElement('div');
      head.className = 'list-card-head';
      head.innerHTML = `<span class="lname">${escapeHtml(list.name)}</span>`;
      card.appendChild(head);
      list.items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'checklist-today-list-item';
        row.innerHTML = `<div class="checkbox ${item.done ? 'checked' : ''}">${item.done ? '✓' : ''}</div><div class="lbl ${item.done ? 'done' : ''}">${escapeHtml(item.text)}</div>`;
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

  renderGrid(ds);
}

function renderInboxItem(t) {
  const el = document.createElement('div');
  el.className = 'inbox-item';
  el.dataset.id = t.id;
  el.innerHTML = `
    <div class="swipe-content"><span class="grip">⠿</span><span class="title">${escapeHtml(t.title)}</span><span class="place-hint">tap to place</span></div>
    <button type="button" class="swipe-delete-btn" aria-label="Delete task">Delete</button>
  `;
  el.querySelector('.swipe-delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteTaskById(t.id);
  });
  el.addEventListener('click', (e) => {
    if (el._wasDragged) { el._wasDragged = false; return; }
    if (el._swipeOpen) { closeAnyOpenSwipe(); return; }
    openBlockSheet(t, { forceDate: currentTodayDateStr() });
  });
  makeInboxDraggable(el, t);
  return el;
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
    <button type="button" class="swipe-delete-btn" aria-label="Delete task">🗑</button>
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
  if (!t.durationMin) t.durationMin = 30;
  saveState();
  renderAll();
}

/* ======================= Block sheet ======================= */
let activeBlock = null;
function openBlockSheet(t, opts = {}) {
  activeBlock = t;
  document.getElementById('blockTitleInput').value = t.title;
  document.getElementById('blockStartInput').value = minToTimeInput(t.startMin != null ? t.startMin : 9 * 60);
  currentDuration = t.durationMin || 30;
  updateDurLabel();
  document.getElementById('blockDoneBtn').textContent = t.done ? 'Mark not done' : 'Mark done';
  document.getElementById('blockUnscheduleBtn').style.display = t.startMin == null ? 'none' : 'flex';
  activeBlockOpts = opts;
  openSheet('blockSheet');
}
let activeBlockOpts = {};
let currentDuration = 30;
function updateDurLabel() { document.getElementById('durLabel').textContent = currentDuration + ' min'; }

document.getElementById('durMinus').addEventListener('click', () => { currentDuration = Math.max(5, currentDuration - 5); updateDurLabel(); });
document.getElementById('durPlus').addEventListener('click', () => { currentDuration = Math.min(480, currentDuration + 5); updateDurLabel(); });

document.getElementById('blockSaveBtn').addEventListener('click', () => {
  if (!activeBlock) return;
  const title = document.getElementById('blockTitleInput').value.trim();
  if (title) activeBlock.title = title;
  const timeVal = document.getElementById('blockStartInput').value;
  if (timeVal) {
    activeBlock.startMin = timeToMin(timeVal);
    if (!activeBlock.date) activeBlock.date = activeBlockOpts.forceDate || currentTodayDateStr();
  }
  activeBlock.durationMin = currentDuration;
  saveState();
  closeSheets();
  renderAll();
});

document.getElementById('blockDoneBtn').addEventListener('click', () => {
  if (!activeBlock) return;
  activeBlock.done = !activeBlock.done;
  saveState();
  closeSheets();
  renderAll();
});

document.getElementById('blockUnscheduleBtn').addEventListener('click', () => {
  if (!activeBlock) return;
  activeBlock.startMin = null;
  saveState();
  closeSheets();
  renderAll();
});

document.getElementById('blockDeleteBtn').addEventListener('click', () => {
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
    btn.textContent = '◍';
    btn.classList.add('habit-mode');
    input.placeholder = 'New daily habit…';
  } else {
    btn.textContent = '✓';
    btn.classList.remove('habit-mode');
    input.placeholder = 'Add a task…';
  }
}

document.getElementById('quickAddModeBtn').addEventListener('click', () => {
  setQuickAddMode(quickAddMode === 'task' ? 'habit' : 'task');
});

document.getElementById('quickAddForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('quickAddInput');
  const title = input.value.trim();
  if (!title) return;

  if (quickAddMode === 'habit') {
    state.habits.push({ id: uid(), name: title, freq: { type: 'daily' }, completions: {}, sessions: [] });
    saveState();
    input.value = '';
    setQuickAddMode('task');
    renderAll();
    toast('Habit added — tracking starts today');
    return;
  }

  const dateForNew = state.view.current === 'today' ? currentTodayDateStr() : null;
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

document.getElementById('todayPrev').addEventListener('click', () => { state.view.todayOffset--; renderAll(); });
document.getElementById('todayNext').addEventListener('click', () => { state.view.todayOffset++; renderAll(); });
document.getElementById('weekPrev').addEventListener('click', () => { state.view.weekOffset--; renderAll(); });
document.getElementById('weekNext').addEventListener('click', () => { state.view.weekOffset++; renderAll(); });

/* ======================= Habits ======================= */
function habitFreqLabel(h) {
  return h.freq.type === 'daily' ? 'Daily' : `${h.freq.count}× / week`;
}

function habitDoneOn(h, ds) { return !!h.completions[ds]; }

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
        <div class="habit-check ${done ? 'checked' : ''}">${done ? '✓' : ''}</div>
        <div class="habit-info">
          <div class="habit-name">${escapeHtml(h.name)}</div>
          <div class="habit-freq">${habitFreqLabel(h)}</div>
        </div>
        <button type="button" class="habit-practice-btn" aria-label="Time a practice session">▶</button>
        <div class="habit-streak">
          <div class="n">${streak}</div>
          <div class="lbl">streak</div>
        </div>
      </div>
      <div class="heatmap" data-id="${h.id}"></div>
      ${pr != null ? `<div class="habit-practice-meta">🏆 PR <span class="pr">${fmtMinSec(pr)}</span> · avg ${fmtMinSec(avg)} · total ${fmtMinSec(habitTotalPracticeSeconds(h))}</div>` : ''}
    `;
    const checkEl = card.querySelector('.habit-check');
    checkEl.addEventListener('click', () => {
      h.completions[ds] = !h.completions[ds];
      if (!h.completions[ds]) delete h.completions[ds];
      saveState();
      checkEl.classList.toggle('checked', !!h.completions[ds]);
      checkEl.textContent = h.completions[ds] ? '✓' : '';
      const nEl = card.querySelector('.n');
      nEl.textContent = computeStreak(h);
      nEl.classList.add('tick');
      setTimeout(() => nEl.classList.remove('tick'), 320);
      renderHeatmap(card.querySelector('.heatmap'), h);
    });
    card.querySelector('.habit-name').addEventListener('click', () => openHabitSheet(h));
    card.querySelector('.habit-practice-btn').addEventListener('click', () => startHabitTimer(h));
    list.appendChild(card);
    renderHeatmap(card.querySelector('.heatmap'), h);
  });
}

function renderHeatmap(container, h) {
  container.innerHTML = '';
  const weeks = 12;
  const today = new Date();
  const start = addDays(startOfWeek(today), -(weeks - 1) * 7);
  for (let w = 0; w < weeks; w++) {
    const col = document.createElement('div');
    col.className = 'heatmap-col';
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, w * 7 + d);
      if (day > today) { const cell = document.createElement('div'); cell.className = 'heatmap-cell'; cell.style.visibility = 'hidden'; col.appendChild(cell); continue; }
      const cell = document.createElement('div');
      cell.className = 'heatmap-cell' + (habitDoneOn(h, dateStr(day)) ? ' on' : '');
      col.appendChild(cell);
    }
    container.appendChild(col);
  }
}

document.getElementById('addHabitBtn').addEventListener('click', () => openHabitSheet(null));

let activeHabit = null;
let habitFreqType = 'daily';
let habitFreqCount = 3;

function openHabitSheet(h) {
  activeHabit = h;
  document.getElementById('habitNameInput').value = h ? h.name : '';
  habitFreqType = h ? h.freq.type : 'daily';
  habitFreqCount = h && h.freq.type === 'weekly' ? h.freq.count : 3;
  updateFreqUI();
  document.getElementById('habitDeleteBtn').hidden = !h;
  openSheet('habitSheet');
}

function updateFreqUI() {
  document.querySelectorAll('#freqOptions .freq-opt').forEach(b => b.classList.toggle('active', b.dataset.freq === habitFreqType));
  document.getElementById('freqCountRow').hidden = habitFreqType !== 'weekly';
  document.getElementById('freqCountLabel').textContent = habitFreqCount;
}

document.querySelectorAll('#freqOptions .freq-opt').forEach(btn => {
  btn.addEventListener('click', () => { habitFreqType = btn.dataset.freq; updateFreqUI(); });
});
document.getElementById('freqMinus').addEventListener('click', () => { habitFreqCount = Math.max(1, habitFreqCount - 1); updateFreqUI(); });
document.getElementById('freqPlus').addEventListener('click', () => { habitFreqCount = Math.min(7, habitFreqCount + 1); updateFreqUI(); });

document.getElementById('habitSaveBtn').addEventListener('click', () => {
  const name = document.getElementById('habitNameInput').value.trim();
  if (!name) { toast('Name required'); return; }
  const freq = habitFreqType === 'daily' ? { type: 'daily' } : { type: 'weekly', count: habitFreqCount };
  if (activeHabit) {
    activeHabit.name = name;
    activeHabit.freq = freq;
  } else {
    state.habits.push({ id: uid(), name, freq, completions: {}, sessions: [] });
  }
  saveState();
  closeSheets();
  renderAll();
});

document.getElementById('habitDeleteBtn').addEventListener('click', () => {
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
      row.innerHTML = `<div class="checkbox ${item.done ? 'checked' : ''}">${item.done ? '✓' : ''}</div><div class="lbl ${item.done ? 'done' : ''}">${escapeHtml(item.text)}</div>`;
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
    addRow.innerHTML = `<input type="text" placeholder="Add item…" maxlength="80"><button type="button">＋</button>`;
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

document.getElementById('newListBtn').addEventListener('click', () => {
  const name = prompt('List name (e.g. "Errands", "Packing list")');
  if (!name || !name.trim()) return;
  state.lists.push({ id: uid(), name: name.trim(), attachedDate: null, items: [] });
  saveState();
  renderListsSheet();
});

document.getElementById('listsBtn').addEventListener('click', () => { renderListsSheet(); openSheet('listsSheet'); });

/* ======================= Routines ======================= */
function fmtMinSec(totalSeconds) {
  const m = Math.floor(totalSeconds / 60), s = totalSeconds % 60;
  return `${m}:${pad2(s)}`;
}
function routineTotalSeconds(r) { return r.steps.reduce((sum, s) => sum + s.seconds, 0); }

function renderRoutinesSheet() {
  const wrap = document.getElementById('routinesContainer');
  wrap.innerHTML = '';
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
        <button class="pill-btn accent" data-act="start">▶ Start</button>
        <button class="pill-btn" data-act="edit">Edit</button>
      </div>
    `;
    card.querySelector('[data-act="start"]').addEventListener('click', () => {
      if (!r.steps.length) { toast('Add a step first'); return; }
      closeSheets();
      startRoutine(r);
    });
    card.querySelector('[data-act="edit"]').addEventListener('click', () => openRoutineEditSheet(r));
    wrap.appendChild(card);
  });
}

document.getElementById('routinesBtn').addEventListener('click', () => { renderRoutinesSheet(); openSheet('routinesSheet'); });
document.getElementById('newRoutineBtn').addEventListener('click', () => openRoutineEditSheet(null));

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

document.getElementById('routineRemindClearBtn').addEventListener('click', () => {
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

  container.scrollTop = state.index * WHEEL_ROW_H;
  applyCenterStyles();

  return {
    getValue: () => state.values[state.index],
    setValue: (v) => {
      state.index = Math.max(0, values.indexOf(v));
      container.scrollTop = state.index * WHEEL_ROW_H;
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
  wheelMinCtrl = buildWheelColumn(document.getElementById('wheelMin'), MIN_VALUES, (v) => String(v), Math.min(mins, 30));
  wheelSecCtrl = buildWheelColumn(document.getElementById('wheelSec'), SEC_VALUES, (v) => pad2(v), secs);
  openSheet('durationPickerSheet');
}

document.getElementById('stepDurBtn').addEventListener('click', openDurationPicker);

document.getElementById('durationSetBtn').addEventListener('click', () => {
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
    row.innerHTML = `<span class="rs-idx">${i + 1}</span><span class="rs-text">${escapeHtml(s.text)}</span><span class="rs-dur">${fmtMinSec(s.seconds)}</span><button type="button" class="rs-del" aria-label="Remove">✕</button>`;
    row.querySelector('.rs-del').addEventListener('click', () => {
      workingSteps.splice(i, 1);
      renderWorkingSteps();
    });
    list.appendChild(row);
  });
}

document.getElementById('addStepBtn').addEventListener('click', () => {
  const input = document.getElementById('stepTextInput');
  const text = input.value.trim();
  if (!text) return;
  workingSteps.push({ id: uid(), text, seconds: stepDurDraft });
  input.value = '';
  stepDurDraft = 60;
  updateStepDurBtn();
  renderWorkingSteps();
});

document.getElementById('routineSaveBtn').addEventListener('click', () => {
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
  renderRoutinesSheet();
  openSheet('routinesSheet');
});

document.getElementById('routineDeleteBtn').addEventListener('click', () => {
  if (!activeRoutine) return;
  state.routines = state.routines.filter(x => x.id !== activeRoutine.id);
  saveState();
  closeSheets();
  renderRoutinesSheet();
  openSheet('routinesSheet');
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

document.getElementById('runPauseBtn').addEventListener('click', () => {
  runPaused = !runPaused;
  document.getElementById('runPauseBtn').textContent = runPaused ? 'Resume' : 'Pause';
  if (runPaused) clearInterval(runInterval);
  else runInterval = setInterval(runTick, 1000);
});

document.getElementById('runPrevBtn').addEventListener('click', () => {
  if (runIndex > 0) { runIndex--; loadRunStep(); }
});
document.getElementById('runNextBtn').addEventListener('click', () => {
  clearInterval(runInterval);
  advanceRunStep();
});
document.getElementById('runCloseBtn').addEventListener('click', () => {
  clearInterval(runInterval);
  document.getElementById('routineRunOverlay').hidden = true;
});
document.getElementById('runFinishBtn').addEventListener('click', () => {
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

function renderChoresSheet() {
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
        <button class="chore-start-btn" data-act="start">▶ Start</button>
        <button class="chore-del-btn" data-act="del" aria-label="Delete">✕</button>
      </div>
    `;
    card.querySelector('[data-act="start"]').addEventListener('click', () => {
      closeSheets();
      startChoreTimer(c);
    });
    card.querySelector('[data-act="del"]').addEventListener('click', () => {
      state.chores = state.chores.filter(x => x.id !== c.id);
      saveState();
      renderChoresSheet();
    });
    wrap.appendChild(card);
  });
}

document.getElementById('choresBtn').addEventListener('click', () => { renderChoresSheet(); openSheet('choresSheet'); });

document.getElementById('addChoreBtn').addEventListener('click', addChoreFromInput);
document.getElementById('newChoreInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addChoreFromInput(); } });
function addChoreFromInput() {
  const input = document.getElementById('newChoreInput');
  const name = input.value.trim();
  if (!name) return;
  state.chores.push({ id: uid(), name, sessions: [], createdAt: Date.now() });
  input.value = '';
  saveState();
  renderChoresSheet();
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

document.getElementById('choreDoneBtn').addEventListener('click', () => stopChoreTimer(true));
document.getElementById('choreCancelBtn').addEventListener('click', () => stopChoreTimer(false));
document.getElementById('choreCloseBtn').addEventListener('click', () => stopChoreTimer(false));

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
    h.completions[ds] = true;
    saveState();

    if (prevPR == null) {
      toast(`🏆 First session logged: ${fmtMinSec(elapsed)} — that's your new record`);
    } else if (elapsed > prevPR) {
      toast(`🏆 New personal best! ${fmtMinSec(elapsed)} (previous: ${fmtMinSec(prevPR)})`);
    } else {
      toast(`Logged ${fmtMinSec(elapsed)} — PR is still ${fmtMinSec(prevPR)}` + (wasAlreadyDone ? '' : ` · “${h.name}” checked off for today`));
    }
    renderAll();
  }
  habitTimerRunning = null;
}

document.getElementById('habitDoneRunBtn').addEventListener('click', () => stopHabitTimer(true));
document.getElementById('habitCancelBtn').addEventListener('click', () => stopHabitTimer(false));
document.getElementById('habitRunCloseBtn').addEventListener('click', () => stopHabitTimer(false));

/* ======================= Settings sheet ======================= */
document.getElementById('settingsBtn').addEventListener('click', () => { applyTheme(); renderRemindersToggle(); openSheet('settingsSheet'); });

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

document.getElementById('remindersToggleBtn').addEventListener('click', async () => {
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
}
setInterval(checkReminders, 20000);

document.getElementById('exportBtn').addEventListener('click', () => {
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

document.getElementById('importFile').addEventListener('change', (e) => {
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

document.getElementById('resetBtn').addEventListener('click', () => {
  if (!confirm('Erase all DayFlow data on this device? This cannot be undone.')) return;
  state = seedState();
  saveState();
  applyTheme();
  closeSheets();
  renderAll();
  toast('Data reset');
});

/* ======================= Sheets generic ======================= */
function openSheet(id) {
  document.getElementById('overlayBackdrop').hidden = false;
  document.getElementById(id).hidden = false;
  requestAnimationFrame(() => document.getElementById(id).classList.add('open'));
}
function closeSheets() {
  document.querySelectorAll('.sheet').forEach(s => s.hidden = true);
  document.getElementById('overlayBackdrop').hidden = true;
  activeBlock = null;
  activeHabit = null;
}
document.getElementById('overlayBackdrop').addEventListener('click', closeSheets);

/* ======================= Render all ======================= */
function renderAll() {
  if (state.view.current === 'today') renderToday();
  if (state.view.current === 'week') renderWeek();
  if (state.view.current === 'habits') renderHabits();
  if (state.view.current === 'stats') renderStats();
}

/* ======================= Init ======================= */
applyTheme();
switchView(state.view.current || 'today');
setInterval(() => { if (state.view.current === 'today') renderGrid(currentTodayDateStr()); }, 60000);

/* ======================= Service worker ======================= */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW failed', err));
  });
}

})();
