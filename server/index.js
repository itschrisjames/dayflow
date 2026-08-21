/*
 * DayFlow push sender — the missing half of background reminders.
 *
 * The app itself is entirely local: no account, no database, nothing leaves
 * the phone. That works for everything except one thing — a notification that
 * arrives while DayFlow is closed. iOS gives a web app no way to wake itself,
 * so something else has to do the sending, and this is the smallest honest
 * version of that something.
 *
 * It holds two things per device: a push subscription, and the list of times
 * that device wants to be poked today. Once a minute it checks whether any of
 * those times have arrived. That is the entire design.
 *
 *   npm install express web-push
 *   npx web-push generate-vapid-keys          # paste the public key into DayFlow
 *   VAPID_PUBLIC=… VAPID_PRIVATE=… node index.js
 */
const express = require('express');
const webpush = require('web-push');

const PORT = process.env.PORT || 8080;
const PUBLIC = process.env.VAPID_PUBLIC;
const PRIVATE = process.env.VAPID_PRIVATE;
const CONTACT = process.env.VAPID_CONTACT || 'mailto:you@example.com';

if (!PUBLIC || !PRIVATE) {
  console.error('Set VAPID_PUBLIC and VAPID_PRIVATE (npx web-push generate-vapid-keys)');
  process.exit(1);
}
webpush.setVapidDetails(CONTACT, PUBLIC, PRIVATE);

const app = express();
app.use(express.json({ limit: '256kb' }));

// Permissive CORS: the app is served from GitHub Pages, this from elsewhere.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* endpoint -> { subscription, schedule, sent:Set<string> }
   In memory on purpose. Losing it costs each device one re-subscribe, which
   the app does on launch, and it keeps this file free of a database. Swap for
   Redis or SQLite if you want it to survive a restart. */
const devices = new Map();

app.post('/subscribe', (req, res) => {
  const { subscription, schedule } = req.body || {};
  if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'no subscription' });
  devices.set(subscription.endpoint, { subscription, schedule: schedule || null, sent: new Set(), day: null });
  console.log('subscribed', subscription.endpoint.slice(-12), 'total', devices.size);
  res.json({ ok: true });
});

app.post('/schedule', (req, res) => {
  const { endpoint, schedule } = req.body || {};
  const d = devices.get(endpoint);
  if (!d) return res.status(404).json({ error: 'unknown device — resubscribe' });
  d.schedule = schedule;
  if (schedule && schedule.date !== d.day) { d.day = schedule.date; d.sent = new Set(); }
  res.json({ ok: true });
});

app.post('/unsubscribe', (req, res) => {
  devices.delete((req.body || {}).endpoint);
  res.json({ ok: true });
});

/* ---------------------------------------------------------------------------
 * Capture queue
 *
 * iOS will not deep-link into an installed web app, so a Shortcut cannot hand
 * dictated words to DayFlow directly — opening its URL lands in Safari, whose
 * storage is a different partition from the Home Screen app. This is the way
 * round it: the Shortcut posts the words here, and DayFlow collects them the
 * next time it is opened. Nothing to unlock, nothing to look at.
 *
 * The key is a random string DayFlow generates and shows you; it is the only
 * thing tying a queue to a person. Keep it to yourself, and note that anyone
 * holding it could add tasks to your inbox — which is the whole of the damage.
 * -------------------------------------------------------------------------*/
const captures = new Map();          // key -> [{ text, at }]
const CAPTURE_MAX = 50;              // per key; a queue this long means nobody is collecting
const CAPTURE_TTL_MS = 7 * 24 * 3600 * 1000;

function pruneCaptures() {
  const cutoff = Date.now() - CAPTURE_TTL_MS;
  for (const [key, list] of captures) {
    const keep = list.filter(x => x.at >= cutoff);
    if (keep.length) captures.set(key, keep); else captures.delete(key);
  }
}
setInterval(pruneCaptures, 3600 * 1000);

app.post('/capture', (req, res) => {
  const { key, text } = req.body || {};
  if (!key || typeof key !== 'string' || key.length < 8) return res.status(400).json({ error: 'bad key' });
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'no text' });
  const list = captures.get(key) || [];
  list.push({ text: String(text).slice(0, 500), at: Date.now() });
  while (list.length > CAPTURE_MAX) list.shift();
  captures.set(key, list);
  console.log('captured', key.slice(-6), JSON.stringify(text).slice(0, 60));
  // Shortcuts shows whatever comes back, so keep it short and human.
  res.json({ ok: true, queued: list.length, said: text });
});

app.get('/capture', (req, res) => {
  const key = req.query.key;
  if (!key) return res.status(400).json({ error: 'bad key' });
  const list = captures.get(key) || [];
  captures.delete(key);              // handing them over empties the queue
  res.json({ items: list });
});

app.get('/health', (_req, res) => res.json({ ok: true, devices: devices.size, queues: captures.size }));

/* Local minutes-since-midnight in the device's own timezone. Storing the
   offset would go stale across DST; asking Intl each time does not. */
function nowMinIn(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const h = Number(parts.find(p => p.type === 'hour').value);
    const m = Number(parts.find(p => p.type === 'minute').value);
    return h * 60 + m;
  } catch (e) {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }
}

const CATCHUP_MIN = 15;   // matches the app: older than this is noise, not news

async function tick() {
  for (const [endpoint, d] of devices) {
    const sched = d.schedule;
    if (!sched || !Array.isArray(sched.events)) continue;
    const nowMin = nowMinIn(sched.tz);
    for (const ev of sched.events) {
      if (ev.min > nowMin || nowMin - ev.min > CATCHUP_MIN) continue;
      if (d.sent.has(ev.key)) continue;
      d.sent.add(ev.key);
      try {
        await webpush.sendNotification(d.subscription, JSON.stringify({
          title: ev.title, body: ev.body, tag: ev.key, kind: 'reminder',
        }));
      } catch (err) {
        // 404/410 mean the browser threw the subscription away.
        if (err.statusCode === 404 || err.statusCode === 410) {
          devices.delete(endpoint);
          console.log('dropped dead endpoint', endpoint.slice(-12));
        } else {
          console.warn('send failed', err.statusCode || err.message);
        }
      }
    }
  }
}
setInterval(tick, 60 * 1000);

app.listen(PORT, () => console.log(`DayFlow push sender on :${PORT}`));
