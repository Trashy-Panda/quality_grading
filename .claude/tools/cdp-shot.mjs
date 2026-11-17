// Headless Chrome over CDP: screenshot + console/network errors + optional eval.
// Use when the Playwright MCP is locked. Plain headless Chrome cannot go below
// ~500px wide; this uses Emulation.setDeviceMetricsOverride so 390 works.
//
// usage: node .claude/tools/cdp-shot.mjs <url> <width> <out.png|-> [options]
//   --height N      viewport height (default 844 when width <= 500, else 900)
//   --full          capture the full page height
//   --wait MS       wait after load before eval/screenshot (default 800)
//   --eval "JS"     expression run after load (may return a Promise); result printed
//   --eval2 "JS"    second expression, run after --eval and another --wait
//   --offline       set the network offline after the first load, then reload
// Prints one JSON line: { consoleErrors, failedRequests, overflowX, evalResult, eval2Result }.
// Pass "-" as out to skip the screenshot.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const a = process.argv.slice(2);
const [url, widthArg, out] = a;
if (!url || !widthArg || !out) { console.error('usage: cdp-shot.mjs <url> <width> <out.png|-> [--height N] [--full] [--wait MS] [--eval JS] [--eval2 JS] [--offline]'); process.exit(2); }
const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const width = +widthArg;
const height = +opt('--height', width <= 500 ? 844 : 900);
const wait = +opt('--wait', 800);
const evalJs = opt('--eval', null);
const eval2Js = opt('--eval2', null);
const full = a.includes('--full');
const offline = a.includes('--offline');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const port = 9300 + Math.floor(Math.random() * 600);
const dir = mkdtempSync(join(tmpdir(), 'cdp-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });

let ws, seq = 0;
const pending = new Map(), waiters = [];
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params }));
});
const once = method => new Promise(res => waiters.push({ method, res }));
const consoleErrors = [], failedRequests = [];

async function main() {
  let wsUrl;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); wsUrl = j.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
    if (!wsUrl) await sleep(200);
  }
  if (!wsUrl) throw new Error('chrome did not start');
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].method === m.method) { waiters[i].res(m.params); waiters.splice(i, 1); }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map(x => x.value ?? x.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErrors.push(m.params.entry.text + ' ' + (m.params.entry.url || ''));
    if (m.method === 'Network.loadingFailed' && !m.params.canceled) failedRequests.push(m.params.errorText + ' ' + (reqUrls.get(m.params.requestId) || ''));
    if (m.method === 'Network.requestWillBeSent') reqUrls.set(m.params.requestId, m.params.request.url);
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) failedRequests.push(m.params.response.status + ' ' + m.params.response.url);
  };
  const reqUrls = new Map();
  await Promise.all(['Page.enable', 'Runtime.enable', 'Log.enable', 'Network.enable'].map(m => send(m)));
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 500 });
  if (width <= 500) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const evaluate = async js => {
    const r = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true });
    return r.exceptionDetails ? { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text } : r.result.value;
  };
  let loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url });
  await loaded; await sleep(wait);
  if (offline) {
    await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    loaded = once('Page.loadEventFired');
    await send('Page.reload', {});
    await Promise.race([loaded, sleep(10000)]); await sleep(wait);
  }
  const result = { consoleErrors, failedRequests };
  if (evalJs) { result.evalResult = await evaluate(evalJs); await sleep(wait); }
  if (eval2Js) { result.eval2Result = await evaluate(eval2Js); await sleep(wait); }
  result.overflowX = await evaluate('document.documentElement.scrollWidth > window.innerWidth');
  if (out !== '-') {
    const p = { format: 'png' };
    if (full) {
      const m = await send('Page.getLayoutMetrics');
      const h = Math.ceil((m.cssContentSize || m.contentSize).height);
      Object.assign(p, { captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: h, scale: 1 } });
    }
    writeFileSync(out, Buffer.from((await send('Page.captureScreenshot', p)).data, 'base64'));
  }
  console.log(JSON.stringify(result));
}

main().catch(e => { console.error('cdp-shot failed:', e.message); process.exitCode = 1; })
  .finally(async () => { try { ws?.close(); } catch {} chrome.kill(); await sleep(300); try { rmSync(dir, { recursive: true, force: true }); } catch {} });
