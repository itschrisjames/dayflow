# DayFlow push sender

DayFlow keeps everything on your phone. There is one thing that arrangement
cannot do: raise a notification while the app is closed.

That is not a gap in the code. iOS gives a web app no way to wake itself, and
the Web Push standard works by having *someone else* send a message to the
browser's push service, which then wakes your service worker. So a reminder
that reaches you with DayFlow shut needs something running that isn't DayFlow.

This directory is that something, in about 120 lines. It stores a push
subscription and the times you want to be poked, and pokes you. It holds no
task titles beyond the reminder text you'd see on the lock screen anyway, and
it has no accounts, no database, and no interest in your data.

**You do not need this.** Without it DayFlow still shows reminders while it is
open, which for many people is enough. The app says so plainly in Settings
rather than pretending otherwise.

## Setting it up

```bash
cd server
npm install
npx web-push generate-vapid-keys
```

That prints a public and a private key. Then run it:

```bash
VAPID_PUBLIC=<public key> \
VAPID_PRIVATE=<private key> \
VAPID_CONTACT=mailto:you@example.com \
node index.js
```

Deploy it anywhere that stays awake — Render, Fly.io, Railway, a Raspberry Pi
on your desk. Free tiers are plenty; it is idle almost all the time. Set the
same three environment variables there, and optionally `ALLOW_ORIGIN` to your
GitHub Pages URL to stop other sites talking to it.

Then in DayFlow: **Settings → Set up push server**, paste the server's address
and the *public* key, and switch **Background reminders** on. The private key
never leaves your server.

## What it does

- `POST /subscribe` — a device registers its push subscription and today's times
- `POST /schedule` — the app re-sends its times when the day's plan changes
- `POST /unsubscribe` — forget a device
- `GET /health` — how many devices are registered

Once a minute it checks each device's list against the current time *in that
device's own timezone*, and sends anything newly due. Reminders more than
fifteen minutes stale are skipped rather than delivered late, matching the
app's own behaviour — being told at 4pm about a 9am task is noise, not news.

## Caveats worth knowing

- Subscriptions live in memory. Restarting the server forgets them; DayFlow
  re-subscribes on its next launch. Swap the `Map` for Redis or SQLite if that
  bothers you.
- The app pushes its schedule roughly every fifteen minutes and on launch, so
  a task added and scheduled within the same hour may not reach the server
  before it is due. Opening DayFlow forces a sync.
- iOS only delivers web push to a PWA that has been **added to the Home
  Screen** and opened at least once from there. A Safari tab will never get
  these, no matter what the server does.
- Notification permission has to be granted from a real tap, which is why the
  toggle asks rather than the app asking on launch.
