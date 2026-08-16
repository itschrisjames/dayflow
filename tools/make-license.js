/*
 * Mint a supporter key for one person.
 *
 *   node tools/make-license.js "ada@example.com"
 *   node tools/make-license.js "Ada Lovelace" --note "Gumroad #1234"
 *
 * Prints a key to paste into the buyer's email. The key is a signed statement
 * that says "this person supported DayFlow on this date" — it is not a
 * password, it unlocks no features, and it works offline forever because the
 * app verifies the signature against the public key baked into it.
 */
const { webcrypto } = require('crypto');
const fs = require('fs');
const path = require('path');

const b64u = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

(async () => {
  const args = process.argv.slice(2);
  const who = args.find(a => !a.startsWith('--'));
  if (!who) {
    console.error('Usage: node tools/make-license.js "name or email" [--note "order ref"]');
    process.exit(1);
  }
  const noteIdx = args.indexOf('--note');
  const note = noteIdx >= 0 ? args[noteIdx + 1] : '';

  const keyPath = path.join(__dirname, 'license-private-key.json');
  if (!fs.existsSync(keyPath)) {
    console.error('No tools/license-private-key.json — run `node tools/keygen.js` first.');
    process.exit(1);
  }
  const jwk = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  const key = await webcrypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  const payload = JSON.stringify({ n: who, d: new Date().toISOString().slice(0, 10), t: 'supporter', r: note || undefined });
  const data = new TextEncoder().encode(payload);
  const sig = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data);

  console.log('\n' + `DF1.${b64u(data)}.${b64u(sig)}` + '\n');
})();
