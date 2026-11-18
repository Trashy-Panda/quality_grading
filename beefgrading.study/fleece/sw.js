// Fleece Grader service worker: precaches the whole app shell so it runs with no signal.
//
// EVERY FLEECE RELEASE MUST BUMP `VERSION`. Files are served cache-first, so a changed
// file under the same version is never picked up by phones that already installed the app.
// Bumping the version installs a fresh cache and deletes the old one on activate.
const VERSION = 'fleece-v4';

const PRECACHE = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'omr.js',
  'grid.js',
  'template.js',
  'scoring.js',
  'consensus.js',
  'digits.js',
  'listkey.js',
  'keycodec.js',
  'rails.js',
  'vendor/digits-net.bin',
  'manifest.webmanifest',
  'vendor/opencv.js',
  'fonts/red-hat-display-latin.woff2',
  'fonts/red-hat-display-latin-ext.woff2',
  'fonts/red-hat-text-latin.woff2',
  'fonts/red-hat-text-latin-ext.woff2',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  'assets/blank-sheet.jpg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fleece-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      // ignoreSearch: /?sw=1 is the same page as /.
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try { return await fetch(req); } catch (e) {
        if (req.mode === 'navigate') { const page = await cache.match('./'); if (page) return page; }
        throw e;
      }
    }),
  );
});
