// Dev-only driver for the Scan official key flow. Load it from the app page under the dev server:
//   node .claude/tools/cdp-shot.mjs http://localhost:8015/index.html 1440 - --eval "import('/dev/keyscan-check.js').then(m => m.graded())"
// It feeds a private fixture photo into the real #f-key input, waits for the flow, and scores the saved key against the truth.
const GRADES = [70, 64, 62, 60, 58, 56, 54, 50, 48, 46];
const TRUTH = '50 St 66/62 S 54/54 S 61/58 S 59/64 S 54/50 S 59/64 S 54/54 S 60/70 F 55/50 S 61/70 S 56/54 S 62/56 C 58/50 S 61/58 S 58/70 S 56/64 S 53/54 C 65/70 S 56/46 S 64'
  .split('/').map((s) => { const [g, l, y] = s.split(' '); return { grade: GRADES.indexOf(+g), length: { S: 0, St: 0, F: 1, C: 2 }[l], yield: +y }; });
const GRADED = 'Scan from 2026-11-18 09_39_02 AM.jpg', LIST = 'Scan from 2026-11-18 12_13_16 PM.jpg';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = () => JSON.parse(localStorage.getItem('fleece-grader-v1'));
const mode = () => { const b = document.querySelector('[data-act="ks-mode"][aria-pressed="true"]'); return b ? b.textContent : null; };
async function until(fn, ms = 120000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(150); } return false; }
const busyDone = () => document.getElementById('busy').hidden;

export async function feed(name) {
  const blob = await (await fetch('/assets/test/keys/' + encodeURIComponent(name))).blob();
  const input = document.getElementById('f-key'), dt = new DataTransfer();
  dt.items.add(new File([blob], name, { type: 'image/jpeg' })); input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(300); await until(busyDone);
}
export function score() {
  const d = store(), res = { mode: mode(), n: 0, grade: 0, length: 0, yield: 0, bad: [], low: 0, auto: 0 };
  TRUTH.forEach((t, i) => {
    const k = d.key[i], src = d.keySrc[i];
    for (const f of ['grade', 'length', 'yield']) {
      const ok = k[f] === t[f]; if (ok) res[f]++;
      else res.bad.push(`r${i + 1} ${f}: got ${k[f] == null ? '-' : f === 'grade' ? GRADES[k[f]] : k[f]} want ${f === 'grade' ? GRADES[t[f]] : t[f]} src=${src[f] ? src[f].s : '-'} highlighted=${!!(src[f] && src[f].low)}`);
    }
    for (const f of ['grade', 'length', 'yield']) if (src[f] && src[f].low) res.low++;
    if (d.auto[i].purity && d.auto[i].character && k.purity === 0 && k.character === 1) res.auto++;
  });
  res.n = d.key.filter((k) => k.grade != null || k.yield != null).length;
  res.notice = document.getElementById('key-notice').textContent.slice(0, 80);
  return res;
}
const brief = (r) => `mode=${r.mode} filled=${r.n} grade=${r.grade}/20 length=${r.length}/20 yield=${r.yield}/20 lowFields=${r.low} PCauto=${r.auto}/20`;

// Check 2
export async function graded() {
  await feed(GRADED); const r = score();
  return { summary: brief(r), mismatches: r.bad, notice: r.notice };
}
// Check 3
export async function list() {
  await feed(LIST); const r = score();
  return { summary: brief(r), mismatches: r.bad, notice: r.notice };
}
// Check 4: switch the reading, then Adjust corners and re-read, on the graded photo.
export async function switching() {
  const out = {}; await feed(GRADED);
  const a = score(); out.start = brief(a);
  const click = (act, val) => document.querySelector(`[data-act="${act}"]${val ? `[data-val="${val}"]` : ''}`).click();
  click('ks-mode', 'bubbled'); await sleep(300); await until(busyDone);
  const b = score(); out.bubbled = brief(b); out.switchedToBubbled = b.mode === 'Bubbled key' && b.yield !== a.yield;
  click('ks-mode', 'list'); await sleep(300); await until(busyDone);
  out.listOnGraded = mode() + ' (a table photo has no list, mode should stay Bubbled key) toast=' + document.getElementById('toast').textContent;
  click('ks-mode', 'graded'); await sleep(300); await until(busyDone);
  const c = score(); out.backToGraded = brief(c); out.switchedBack = c.mode === 'Graded sheet' && c.yield === a.yield && c.grade === a.grade;
  click('ks-corners'); await sleep(200);
  const hs = document.querySelectorAll('#ks-slot .h'); out.handles = hs.length;
  const before = hs[0].style.left + ',' + hs[0].style.top;
  hs[0].focus(); for (let i = 0; i < 2; i++) hs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  out.nudged = (hs[0].style.left + ',' + hs[0].style.top) !== before;
  click('ks-reread'); await sleep(300); await until(busyDone);
  const d = score(); out.afterReread = brief(d); out.toast = document.getElementById('toast').textContent;
  out.handlesGone = document.querySelectorAll('#ks-slot .h').length === 0;
  out.pass = out.switchedToBubbled && out.switchedBack && out.handles === 4 && out.nudged && out.handlesGone && d.grade >= 15 && d.yield >= 10;
  return out;
}
