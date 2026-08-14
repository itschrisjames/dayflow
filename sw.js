const CACHE_NAME = 'dayflow-cache-v16';
const ASSETS = [
  './',
  './index.html',
  './css/style.css?v=16',
  './js/app.js?v=16',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon-180-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for the app's own files, so a new deploy is picked up the
// next time the device has connectivity — falling back to the cached copy
// only when offline.
//
// `cache: 'reload'` is the important part. A service worker's own fetch()
// still consults the browser's HTTP cache, so with GitHub Pages sending
// max-age=600 the worker was faithfully "fetching from the network" and
// getting a ten-minute-old app.js back. That is what made an installed PWA
// report a successful update while still running the previous build.
const APP_SHELL = /\.(?:html|js|css|json)$/;

// Network-first for the app's own files, so a new deploy is picked up the next
// time the device has connectivity — falling back to the cached copy offline.
//
// The subtlety that caused real trouble: a service worker's own fetch() still
// consults the browser's HTTP cache. GitHub Pages sends max-age=600, so the
// worker would dutifully "go to the network" and be handed a ten-minute-old
// app.js — which is how an installed PWA could report a successful update
// while still running the previous build. Requesting shell assets at a URL
// carrying a unique parameter makes an HTTP cache hit impossible. The response
// is still stored under the original request, so offline lookups match.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isShell = event.request.mode === 'navigate' || APP_SHELL.test(url.pathname);

  event.respondWith((async () => {
    try {
      let res;
      if (isShell) {
        const bust = new URL(url.href);
        bust.searchParams.set('_sw', Date.now().toString(36));
        res = await fetch(bust.toString(), { cache: 'no-store', credentials: 'same-origin' });
      } else {
        res = await fetch(event.request);
      }
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return res;
    } catch (err) {
      const cached = await caches.match(event.request);
      return cached || (await caches.match('./index.html')) || Response.error();
    }
  })());
});
