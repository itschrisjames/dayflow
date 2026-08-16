/*
 * Make your own signing keypair.
 *
 *   node tools/keygen.js
 *
 * Writes tools/license-private-key.json (git-ignored — keep it off GitHub and
 * out of any zip you send anyone) and prints the public half to paste into
 * js/app.js. Run this before you sell a single key: the pair DayFlow ships
 * with is a demo, and its private key is in this folder, so anyone who reads
 * the repo could mint "supporter" keys with it. Nothing is locked behind a
 * key, so that costs you nothing but a fake badge — still, use your own.
 */
const { webcrypto } = require('crypto');
const fs = require('fs');
const path = require('path');

(async () => {
  const kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = await webcrypto.subtle.exportKey('jwk', kp.publicKey);
  const priv = await webcrypto.subtle.exportKey('jwk', kp.privateKey);

  const out = path.join(__dirname, 'license-private-key.json');
  fs.writeFileSync(out, JSON.stringify(priv, null, 2));
  fs.chmodSync(out, 0o600);

  console.log('\nPrivate key written to tools/license-private-key.json — never commit it.\n');
  console.log('Now paste this into js/app.js, replacing LICENSE_PUBLIC_KEY:\n');
  console.log(`const LICENSE_PUBLIC_KEY = { x: '${pub.x}', y: '${pub.y}' };\n`);
})();
