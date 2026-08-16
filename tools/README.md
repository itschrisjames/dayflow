# Selling supporter keys

DayFlow has no server, no accounts and no way to phone home, so a "licence"
here is a signed note rather than a lock. You sign it with a private key on
your machine; the app checks the signature against the public key baked into
`js/app.js`. It works offline, forever, and reveals nothing about the buyer to
anyone.

**Nothing in DayFlow is gated behind a key.** Every feature works for
everybody. What a key does is mark the person as a supporter, thank them by
name, and stop the app ever asking again. That is a deliberate choice: a
planner for people with ADHD that hides the timer behind a paywall on the day
they finally opened it is a planner they delete.

## One-time setup

```bash
node tools/keygen.js
```

Writes `tools/license-private-key.json` (already git-ignored) and prints the
public half. Paste that into `js/app.js`, replacing `LICENSE_PUBLIC_KEY`, then
commit and push. Do this before selling anything — the pair the repo ships with
is a demo whose private key is right here in this folder.

Back the private key up somewhere safe. Lose it and every key you have already
issued keeps working, but you can't issue more without rotating the public key,
which invalidates the old ones.

## For each sale

```bash
node tools/make-license.js "buyer@example.com" --note "Gumroad #1234"
```

Paste the printed key into your delivery email. In DayFlow: Settings →
Supporter → paste → done.

## Wiring it to a payment page

The lightest setup that actually works:

1. **Gumroad** or a **Stripe Payment Link** for a one-time "Supporter" purchase.
   Both give you a checkout page and handle tax; neither needs a server.
2. On purchase you get an email. Run `make-license.js` and reply with the key.
   Manual, and completely fine up to a few sales a day.
3. If it gets busy, Gumroad can auto-deliver a generic thank-you and you batch
   the keys once a day — the app never checks anything online, so a key arriving
   an hour later costs nobody anything.

Set `SUPPORT_URL` in `js/app.js` to your checkout page so the in-app button
goes somewhere.

## What this does not do

It does not stop copying. Anyone can share a key, and anyone who reads this
repo can mint their own. At a small one-time price that is the correct
trade-off — the alternative is a login server, an account system, and a
privacy policy that explains why a local-only app now has your email address.
