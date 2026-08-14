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
    settings: { theme: 'auto' },
    view: { current: 'today', todayOffset: 0, weekOffset: 0 },
  };
}

function seedHabits() {
  const habits = [
    { id: uid(), name: 'Drink water', freq: { type: 'daily' }, completions: {} },
    { id: uid(), name: 'Read', freq: { type: 'daily' }, completions: {} },
    { id: uid(), name: 'Workout', freq: { type: 'weekly', count: 3 }, completions: {} },
    { id: uid(), name: 'Meditate', freq: { type: 'daily' }, completions: {} },
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
  return habits;
}

/* ======================= State ======================= */
let state = loadState();
if (!state.view) state.view = { current: 'today', todayOffset: 0, weekOffset: 0 };

/* ======================= Theme ======================= */
function applyTheme() {
  const t = state.settings?.theme || 'auto';
  document.documentElement.classList.remove('theme-light', 'theme-dark');
  if (t === 'light') document.documentElement.classList.add('theme-light');
  if (t === 'dark') document.documentElement.classList.add('theme-dark');
  document.querySelectorAll('#themeOptions .freq-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === t);
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
  el.innerHTML = `<span class="grip">⠿</span><span class="title">${escapeHtml(t.title)}</span><span class="place-hint">tap to place</span>`;
  el.addEventListener('click', (e) => {
    if (el._wasDragged) { el._wasDragged = false; return; }
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
  el.innerHTML = `<div class="block-title">${escapeHtml(t.title)}</div><div class="block-time">${minToLabel(t.startMin)} · ${t.durationMin}m</div>`;
  makeBlockDraggable(el, t);
  el.addEventListener('click', (e) => {
    if (el._wasDragged) { el._wasDragged = false; return; }
    openBlockSheet(t);
  });
  return el;
}

let pendingPlace = null;

/* ---------- Drag: inbox item -> grid ---------- */
function makeInboxDraggable(el, t) {
  let dragging = false, startY = 0, ghost = null, moved = false;
  el.addEventListener('pointerdown', (e) => {
    startY = e.clientY;
    moved = false;
    const onMove = (ev) => {
      if (!dragging && Math.abs(ev.clientY - startY) > 8) {
        dragging = true;
        moved = true;
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
        ghost.style.left = (e.clientX - 60) + 'px' || '';
        ghost.style.left = (ev.clientX - ghost.offsetWidth / 2) + 'px';
        ghost.style.top = (ev.clientY - 20) + 'px';
        highlightDropTarget(ev.clientX, ev.clientY);
      }
    };
    const onUp = (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      el.classList.remove('dragging');
      clearDropHighlights();
      if (dragging) {
        el._wasDragged = true;
        if (ghost) ghost.remove();
        const target = document.elementFromPoint(ev.clientX, ev.clientY);
        const row = target && target.closest('.hour-row');
        if (row) {
          const rect = row.getBoundingClientRect();
          const offsetY = ev.clientY - rect.top;
          const min = gridYToMin((Number(row.dataset.min) - GRID_START_MIN) * PX_PER_MIN + offsetY);
          placeTask(t, currentTodayDateStr(), min);
          toast('Placed on grid');
        }
      }
      dragging = false;
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
  let dragging = false, startY = 0, origTop = 0, moved = false;
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    startY = e.clientY;
    origTop = parseFloat(el.style.top);
    moved = false;
    const onMove = (ev) => {
      const dy = ev.clientY - startY;
      if (!dragging && Math.abs(dy) > 6) { dragging = true; moved = true; el.classList.add('dragging'); }
      if (dragging) {
        let newTop = origTop + dy;
        newTop = Math.max(0, newTop);
        el.style.top = newTop + 'px';
      }
    };
    const onUp = (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (dragging) {
        el._wasDragged = true;
        el.classList.remove('dragging');
        const newTop = parseFloat(el.style.top);
        const min = gridYToMin(newTop);
        t.startMin = min;
        saveState();
        renderAll();
      }
      dragging = false;
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
document.getElementById('quickAddForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('quickAddInput');
  const title = input.value.trim();
  if (!title) return;
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
    card.innerHTML = `
      <div class="habit-top">
        <div class="habit-check ${done ? 'checked' : ''}">${done ? '✓' : ''}</div>
        <div class="habit-info">
          <div class="habit-name">${escapeHtml(h.name)}</div>
          <div class="habit-freq">${habitFreqLabel(h)}</div>
        </div>
        <div class="habit-streak">
          <div class="n">${streak}</div>
          <div class="lbl">streak</div>
        </div>
      </div>
      <div class="heatmap" data-id="${h.id}"></div>
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
    state.habits.push({ id: uid(), name, freq, completions: {} });
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

/* ======================= Settings sheet ======================= */
document.getElementById('settingsBtn').addEventListener('click', () => { applyTheme(); openSheet('settingsSheet'); });

document.querySelectorAll('#themeOptions .freq-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    state.settings.theme = btn.dataset.theme;
    saveState();
    applyTheme();
  });
});

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
