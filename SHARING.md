# Sending DayFlow to people

Everything here is already in the repo. Three things need your details in them
before you share the link.

## 1. Fill in your own addresses

| Where | What to change |
|---|---|
| `js/app.js` | `SUPPORT_URL` → your checkout page · `FEEDBACK_EMAIL` → where feedback should land |
| `start/index.html` | the URL in the install steps, the `mailto:` in Feedback, the link in Support |
| `tools/` | run `node tools/keygen.js` and paste the public key into `js/app.js` |

Then `./release.sh v24` (or whatever's next), commit, push.

## 2. The link you actually send

```
https://YOURNAME.github.io/dayflow/start/
```

Not the app itself. The landing page explains what it is, shows what it looks
like, and walks through Add to Home Screen — which nobody who hasn't installed
a web app before will work out on their own. It links to the app at the top.

Message that works:

> I built a day planner for ADHD brains — the whole idea is that starting is
> harder than organising, so every task has a five-minute button. It's free and
> everything stays on your phone. Would you try it for a week and tell me what
> you stopped using? <link>

## 3. Getting useful feedback

Ten people you can actually follow up with beats a hundred strangers. After a
week, ask exactly two questions:

- What did you stop using?
- What did you keep using?

First impressions of a planner are worthless — everybody likes it on day one.
Week three is where the truth is.

Settings → Send feedback pre-fills the build number, screen size and whether it
was installed to the Home Screen. Without that, "it broke" is unactionable.

## 4. Money

Read `tools/README.md` for the mechanics. The short version:

- Sell a one-time **Supporter** purchase on Gumroad or a Stripe Payment Link.
- When someone buys, run `node tools/make-license.js "their@email"` and reply
  with the key.
- **Nothing is locked behind it.** The key thanks them by name and turns off the
  single place the app mentions money. A planner for people with ADHD that
  hides the timer behind a paywall on the day they finally opened it is a
  planner they delete.

DayFlow only asks after **21 days of real use**, once, in Settings — never on
Today, never on launch. Decline and it stays quiet for three months.

A realistic view: honour-system pricing converts at low single-digit percent.
Ten testers will not make you money. What they will tell you is whether there
is a product here worth putting in the App Store, which is where money actually
lives — and which needs a native wrapper, $99/year, and the two limitations
below to disappear.

## 5. What to say when people hit the limits

- **"It didn't remind me."** Reminders only fire while DayFlow is open, unless
  the notification server in `server/` is deployed. iOS gives a web app no way
  to wake itself.
- **"The alarm thing asked for a Shortcut."** iOS has no Clock API. Calendar
  alerts need no setup; Clock alarms need the one-time shortcut.
- **"I lost my data."** Clearing Safari's website data wipes it — there is no
  server holding a copy. The export nag exists for this; tell testers to export
  once in week one.

Say these upfront rather than after. People forgive a documented limit and
resent a surprise.

## 6. Things to have ready before you charge anyone

- A support email you'll actually read.
- A one-line refund policy ("email me, I'll refund it, no questions").
- Your own signing key (`node tools/keygen.js`) — the one in the repo is a demo.
- A backup of `tools/license-private-key.json` somewhere that isn't this laptop.
