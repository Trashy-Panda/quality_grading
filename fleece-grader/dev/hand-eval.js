// Handwriting-reader harness. Reads every real sheet with omr.js {hand:true}, runs digits.js on each row's crops and scores the result
// against assets/test/real/hand-truth.json. ?only=sheet02,sheet05 limits sheets. ?net=fold (default) scores each sheet with the net
// trained WITHOUT that sheet (held out by sheet, the honest number); ?net=full scores with the shipped vendor net (trained on all sheets,
// optimistic). ?conf=0.9 overrides both "confident" thresholds (defaults DIGITS.confidentDigit / confidentMargin).
// Prints HANDEVALDONE; the numbers are in window.__hand.
import { readSheet } from '../omr.js';
import { DIGITS, setNet, cnnNet, readDigit, readMarginYield } from '../digits.js';
const out = document.getElementById('out'), q = new URLSearchParams(location.search), only = q.get('only'), mode = q.get('net') || 'fold';
const CD = q.get('conf') != null ? +q.get('conf') : DIGITS.confidentDigit, CM = q.get('conf') != null ? +q.get('conf') : DIGITS.confidentMargin;
const REAL = ['sheet01', 'sheet02', 'sheet03', 'sheet04', 'sheet05', 'sheet06', 'sheet07', 'sheet08', 'sheet09', 'sheet10', 'sheet11', 'sheet13', 'sheet13-flat'];
const FOLDS = [['sheet01', 'sheet05', 'sheet09'], ['sheet02', 'sheet06', 'sheet10'], ['sheet03', 'sheet07', 'sheet11'], ['sheet04', 'sheet08', 'sheet13', 'sheet13-flat']];
const nets = {};
async function netFor(name) {
  const key = mode === 'full' || name === 'scan-full' ? 'full' : String(FOLDS.findIndex(f => f.includes(name))), url = mode === 'full' || name === 'scan-full' ? '../vendor/digits-net.bin' : `hand-nets/net_f${key}.bin`;
  if (!nets[key]) nets[key] = cnnNet(await (await fetch(url)).arrayBuffer());
  return nets[key];
}
const truth = await (await fetch('../assets/test/real/hand-truth.json')).json();
const tot = { digits: { n: 0, ok: 0, cn: 0, cbad: 0 }, margin: { n: 0, ok: 0, cn: 0, cbad: 0, extraN: 0, extraOk: 0 }, msTotal: 0, sheets: 0 };
const results = [], bad = [];
for (const name of REAL) {
  if (only && !only.split(',').includes(name)) continue;
  const res = await readSheet('../assets/test/real/' + name + '.jpg', { hand: true });
  if (!res.ok) { results.push({ name, error: res.error }); continue; }
  setNet(await netFor(name));
  const t0 = performance.now(), reads = res.hand.map(h => ({ tens: readDigit(h.tens), ones: readDigit(h.ones), margin: readMarginYield(h.margin) })), ms = performance.now() - t0;
  const s = { name, ms: Math.round(ms), digits: { n: 0, ok: 0, cn: 0, cbad: 0 }, margin: { n: 0, ok: 0, cn: 0, cbad: 0, extraN: 0, extraOk: 0 } };
  reads.forEach((rd, i) => {
    const t = truth[name][i];
    [['tens', 0], ['ones', 1]].forEach(([k, a]) => {
      const want = t[a]; if (want === '?') return; const r = rd[k], ok = r.digit === want, c = r.digit != null && r.conf >= CD;
      s.digits.n++; if (ok) s.digits.ok++; if (c) { s.digits.cn++; if (!ok) s.digits.cbad++; }
      if (!ok) bad.push(`${name} r${i + 1}${k[0]}: got ${r.digit}(${r.conf.toFixed(2)}) want ${want}`);
    });
    const m = t[2]; if (m === '?' || m == null) return;
    const want = +m.slice(0, 2), r = rd.margin, ok = r.value === want, c = r.value != null && r.conf >= CM;
    s.margin.n++; if (ok) s.margin.ok++; if (c) { s.margin.cn++; if (!ok) s.margin.cbad++; }
    const wantExtra = m.length > 2 ? m.slice(2) : null; if (wantExtra) { s.margin.extraN++; if (r.extra != null && r.extra.replace(/[^0-9-]/g, '') !== '' ) s.margin.extraOk++; }
    if (!ok) bad.push(`${name} r${i + 1}m: got ${r.value}(${r.conf.toFixed(2)}) ${r.extra || ''} want ${m}`);
  });
  for (const k of ['digits', 'margin']) for (const f of Object.keys(s[k])) tot[k][f] += s[k][f];
  tot.msTotal += ms; tot.sheets++; results.push(s);
  out.textContent = JSON.stringify(results.map(r => ({ name: r.name, ms: r.ms, digits: `${r.digits.ok}/${r.digits.n}`, margin: `${r.margin.ok}/${r.margin.n}` })), null, 1);
}
// Extra margin-only test: a graded scan (not in training), official yields read off the right margin by hand. ?scan=0 skips it.
const SCAN = { file: '../assets/test/keys/Scan from 2026-11-18 09_39_02 AM.jpg', yields: [66, 54, 61, 59, 54, 59, 54, 60, 55, 61, 56, 62, 58, 61, 58, 56, 53, 65, 56, 64] };
let scan = null;
if (!only && q.get('scan') !== '0') {
  try {
    const res = await readSheet(SCAN.file, { hand: true });
    if (!res.ok) scan = { error: res.error };
    else {
      setNet(await netFor('scan-full')); const rd = res.hand.map(h => readMarginYield(h.margin)); let ok = 0, cn = 0, cbad = 0; const got = [];
      rd.forEach((r, i) => { const hit = r.value === SCAN.yields[i], c = r.value != null && r.conf >= CM; if (hit) ok++; if (c) { cn++; if (!hit) cbad++; } got.push(r.value == null ? '--' : r.value + (c ? '' : '?')); });
      scan = { n: rd.length, ok, confident: cn, confidentWrong: cbad, got: got.join(' ') };
    }
  } catch (e) { scan = { error: String(e) }; }
}
const pc = (a, b) => b ? +(100 * a / b).toFixed(1) : null;
const summary = {
  mode, confDigit: CD, confMargin: CM, sheets: tot.sheets,
  writtenDigit: { n: tot.digits.n, ok: tot.digits.ok, accPct: pc(tot.digits.ok, tot.digits.n) },
  marginYield: { n: tot.margin.n, ok: tot.margin.ok, accPct: pc(tot.margin.ok, tot.margin.n), deductionSeen: `${tot.margin.extraOk}/${tot.margin.extraN}` },
  confident: { digitReads: tot.digits.cn, digitWrong: tot.digits.cbad, marginReads: tot.margin.cn, marginWrong: tot.margin.cbad,
    errPct: pc(tot.digits.cbad + tot.margin.cbad, tot.digits.cn + tot.margin.cn), coveragePct: pc(tot.digits.cn + tot.margin.cn, tot.digits.n + tot.margin.n) },
  msPerSheet: Math.round(tot.msTotal / Math.max(1, tot.sheets)),
};
window.__hand = { summary, results, bad, scan };
out.textContent = JSON.stringify({ summary, scan, results: results.map(r => ({ name: r.name, ms: r.ms, digits: `${r.digits.ok}/${r.digits.n}`, margin: `${r.margin.ok}/${r.margin.n}` })) }, null, 1);
document.title = 'done'; document.body.insertAdjacentHTML('afterbegin', '<p>HANDEVALDONE</p>');
