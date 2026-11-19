// Fleece Grader service worker: precaches the whole app shell so it runs with no signal.
//
// EVERY FLEECE RELEASE MUST BUMP `VERSION`. Files are served cache-first, so a changed
// file under the same version is never picked up by phones that already installed the app.
// Bumping the version installs a fresh cache and deletes the old one on activate.
const VERSION = 'fleece-v5';

// The shell: small, so install finishes in seconds and the app boots offline right after.
const PRECACHE = [
  './',
  'index.html',
  'style.css',
  'rails.css',
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
  'railsview.js',
  'online.js',
  'vendor/digits-net.bin',
  'manifest.webmanifest',
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

// OpenCV is 10 MB. It used to sit inside the all-or-nothing install above, so on a slow link the whole
// install (and every offline feature) waited minutes for it, restarted from zero each time the app was
// closed early, and bypassed the HTTP cache (`cache: 'reload'`). Now it is copied from the previous
// version's cache during install (local, instant, so a release never re-downloads it), and otherwise
// fetched after install and resumed on every later wake-up.
const HEAVY = ['vendor/opencv.js'];
const abs = (u) => new URL(u, self.registration.scope).href;
let heavyP = null;

// Install only: old caches still exist then (activate deletes them), so this cannot race the cleanup.
async function copyHeavyFromOld(cache) {
  for (const u of HEAVY) {
    const url = abs(u);
    if (await cache.match(url)) continue;
    for (const k of await caches.keys()) {
      if (k === VERSION || !k.startsWith('fleece-')) continue;
      const old = await (await caches.open(k)).match(url);
      if (old) { await cache.put(url, old); break; }
    }
  }
}

// Fetches whatever is still missing. Opens only VERSION, never another cache.
async function ensureHeavy() {
  const cache = await caches.open(VERSION);
  let fetched = false;
  for (const u of HEAVY) {
    const url = abs(u);
    if (await cache.match(url)) continue;
    const res = await fetch(url);
    if (!res.ok) throw new Error(url + ' ' + res.status);
    await cache.put(url, res);
    fetched = true;
  }
  if (fetched) for (const c of await self.clients.matchAll()) c.postMessage({ type: 'offline-ready', version: VERSION });
}
// One download at a time; a failure clears the slot so the next wake-up retries.
const warm = () => (heavyP = heavyP || ensureHeavy().catch(() => { heavyP = null; }));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then(async (cache) => {
      await cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })));
      await copyHeavyFromOld(cache);
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fleece-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
  warm(); // not in waitUntil: activation (and fetch handling) must not wait for 10 MB
});

self.addEventListener('message', (event) => { if (event.data === 'warm') event.waitUntil(warm()); });

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.waitUntil(warm()); // keeps the worker alive while OpenCV downloads, and retries after a kill
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      // ignoreSearch: /?sw=1 is the same page as /.
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok && res.status === 200 && HEAVY.some((u) => abs(u) === req.url)) cache.put(req, res.clone());
        return res;
      } catch (e) {
        if (req.mode === 'navigate') { const page = await cache.match('./'); if (page) return page; }
        throw e;
      }
    }),
  );
});
