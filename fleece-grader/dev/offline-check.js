// Offline diagnosis for the fleece grader PWA, headless Chrome over CDP (no deps).
//   node fleece-grader/dev/offline-check.js <url> [--timeout SECONDS]
//   live:  node fleece-grader/dev/offline-check.js https://beefgrading.study/fleece/
//   local: node fleece-grader/dev/offline-check.js "http://localhost:8012/?sw=1"
//          (local URL needs ?sw=1 or app.js never registers the service worker)
// Steps: load online, wait for navigator.serviceWorker.ready AND the fleece-* cache to hold every
// PRECACHE and HEAVY entry from sw.js (prints seconds), switch the page AND the service worker target offline,
// reload, then report whether the app booted (tabs render) and whether loadCV() resolves from cache.
// Prints one JSON line; exit 0 only if the offline reload booted and loadCV resolved.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const a = process.argv.slice(2);
const url = a[0];
if (!url) { console.error('usage: offline-check.js <url> [--timeout SECONDS]'); process.exit(2); }
const ti = a.indexOf('--timeout');
const timeoutS = ti >= 0 ? +a[ti + 1] : 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9300 + Math.floor(Math.random() * 600);
const dir = mkdtempSync(join(tmpdir(), 'offcheck-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map(), waiters = [], events = [];
  const c = { ws, events };
  c.send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params }));
  });
  c.once = (method) => new Promise((res) => waiters.push({ method, res }));
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].method === m.method) { waiters[i].res(m.params); waiters.splice(i, 1); }
    events.push(m);
  };
  return new Promise((res, rej) => { ws.onopen = () => res(c); ws.onerror = rej; });
}
const listTargets = async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json());

async function main() {
  let page;
  for (let i = 0; i < 60 && !page; i++) {
    try { page = (await listTargets()).find((t) => t.type === 'page'); } catch {}
    if (!page) await sleep(200);
  }
  if (!page) throw new Error('chrome did not start');
  const cdp = await connect(page.webSocketDebuggerUrl);
  const consoleErrors = [];
  const swServed = []; // responses answered by the service worker during the offline reload
  let recording = false;
  const drain = () => {
    for (const m of cdp.events.splice(0)) {
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map((x) => x.value ?? x.description).join(' '));
      if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (recording && m.method === 'Network.responseReceived') swServed.push({ url: m.params.response.url, status: m.params.response.status, fromSW: !!m.params.response.fromServiceWorker });
      if (recording && m.method === 'Network.loadingFailed' && !m.params.canceled) swServed.push({ failed: m.params.errorText });
    }
  };
  await Promise.all(['Page.enable', 'Runtime.enable', 'Network.enable'].map((m) => cdp.send(m)));
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const evaluate = async (js) => {
    const r = await cdp.send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true });
    return r.exceptionDetails ? { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text } : r.result.value;
  };

  const t0 = Date.now();
  const secs = () => ((Date.now() - t0) / 1000).toFixed(1);
  let loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await loaded;
  console.error(`[${secs()}s] page loaded online`);

  // PRECACHE list straight from the sw.js the server is serving.
  const need = await evaluate(`fetch('sw.js', { cache: 'no-store' }).then(r => r.text()).then(t => {
    const m = t.match(/const PRECACHE = \\[([\\s\\S]*?)\\];/); const hv = (t.match(/const HEAVY = \\[([\\s\\S]*?)\\];/) || [0, ''])[1]; const v = (t.match(/const VERSION = '([^']+)'/) || [])[1];
    return { version: v, urls: [...(m[1] + hv).matchAll(/'([^']+)'/g)].map(x => new URL(x[1], location.href).href) };
  })`);
  if (!need || !need.urls) throw new Error('could not read PRECACHE from sw.js: ' + JSON.stringify(need));

  // Poll until the SW is ready and the cache is complete.
  let ready = false, missing = need.urls, swState = '', cacheName = '';
  let readyAt = null, completeAt = null;
  while ((Date.now() - t0) / 1000 < timeoutS) {
    const st = await evaluate(`(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const w = reg && (reg.installing || reg.waiting || reg.active);
      const keys = await caches.keys(); const out = { states: reg ? [reg.installing && 'installing:' + reg.installing.state, reg.waiting && 'waiting:' + reg.waiting.state, reg.active && 'active:' + reg.active.state].filter(Boolean).join(',') : 'no-registration', caches: keys, have: {} };
      for (const k of keys) { const c = await caches.open(k); out.have[k] = (await c.keys()).map(r => r.url); }
      out.ready = await Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise(r => setTimeout(() => r(false), 50))]);
      return out; })()`);
    if (st && !st.error) {
      swState = st.states; ready = st.ready;
      if (ready && readyAt == null) readyAt = secs();
      const names = Object.keys(st.have).filter((k) => k.startsWith('fleece-'));
      cacheName = names.join(',');
      const have = new Set(names.flatMap((k) => st.have[k]));
      missing = need.urls.filter((u) => !have.has(u));
      if (ready && names.length && !missing.length) { completeAt = secs(); break; }
    }
    await sleep(1000);
  }
  drain();
  console.error(`[${secs()}s] ready=${ready} (at ${readyAt}s) cacheComplete=${completeAt != null} sw=${swState} missing=${missing.length}`);
  const out = { url, swVersion: need.version, precacheCount: need.urls.length, readyAfterS: readyAt, cacheCompleteAfterS: completeAt, swState, cache: cacheName, missing: missing.map((u) => u.replace(/^.*\/fleece\//, '')) };

  // Go offline: page target and every service-worker target (so a cache miss cannot fall through to the network).
  const offline = { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 };
  await cdp.send('Network.emulateNetworkConditions', offline);
  const swTargets = (await listTargets()).filter((t) => t.type === 'service_worker');
  const swConns = [];
  for (const t of swTargets) {
    try { const c = await connect(t.webSocketDebuggerUrl); await c.send('Network.enable'); await c.send('Network.emulateNetworkConditions', offline); swConns.push(c); } catch {}
  }
  out.swTargetsOffline = swConns.length;

  recording = true;
  loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.reload', {});
  const nav = await Promise.race([loaded.then(() => 'loaded'), sleep(20000).then(() => 'timeout')]);
  await sleep(1500);
  drain();
  out.offlineReload = nav;
  const doc = await evaluate(`({ href: location.href, title: document.title, tabs: document.querySelectorAll('.tab').length, controlled: !!navigator.serviceWorker.controller, bodyText: document.body ? document.body.innerText.slice(0, 80) : '' })`);
  out.page = doc;
  out.booted = !!(doc && doc.tabs > 0);
  out.swServedCount = swServed.filter((r) => r.fromSW).length;
  out.notFromSW = swServed.filter((r) => !r.fromSW).map((r) => r.url || r.failed).slice(0, 8);
  out.loadCV = await evaluate(`import('./omr.js').then(m => Promise.race([m.loadCV().then(cv => 'resolved:' + (typeof cv.Mat)), new Promise(r => setTimeout(() => r('timeout 40s'), 40000))])).catch(e => 'rejected:' + e.message)`);
  out.digitsNet = await evaluate(`fetch('vendor/digits-net.bin').then(r => r.status + ' ' + r.headers.get('content-length')).catch(e => 'failed:' + e.message)`);
  drain();
  out.consoleErrors = consoleErrors.slice(0, 5);
  const pass = out.booted && typeof out.loadCV === 'string' && out.loadCV.startsWith('resolved');
  out.verdict = pass ? 'OFFLINE OK' : 'OFFLINE BROKEN';
  console.log(JSON.stringify(out));
  process.exitCode = pass ? 0 : 1;
}

main().catch((e) => { console.error('offline-check failed:', e.message); process.exitCode = 1; })
  .finally(async () => { chrome.kill(); await sleep(500); try { rmSync(dir, { recursive: true, force: true }); } catch {} process.exit(); });
