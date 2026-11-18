// Dev-only driver for the Written-digits suggestions in Review. Load it from the app page under the dev server:
//   node .claude/tools/cdp-shot.mjs http://localhost:8031/index.html 1440 - --wait 1500 --eval "import('/dev/hand-review-check.js').then(m => m.timing())"
//   node .claude/tools/cdp-shot.mjs http://localhost:8031/index.html 1440 - --wait 1500 --eval "import('/dev/hand-review-check.js').then(m => m.run())"
// run(): per real sheet, key the yield column from the hand-labelled margin truth, feed the photo into the real Scan input, wait for
// the background handwriting read, then score what the app persisted (saved answers, flags, hand reads) against hand-truth.json.
// timing(): omr.js read time with and without the hand crops, plus the digit net time, per sheet (median added scan time).
const REAL = ['sheet01', 'sheet02', 'sheet03', 'sheet04', 'sheet05', 'sheet06', 'sheet07', 'sheet08', 'sheet09', 'sheet10', 'sheet11', 'sheet13', 'sheet13-flat'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = () => JSON.parse(localStorage.getItem('fleece-grader-v1'));
const med = (a) => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
async function until(fn, ms = 120000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(100); } return false; }
const busyDone = () => document.getElementById('busy').hidden;
const photo = async (name) => (await fetch('/assets/test/real/' + name + '.jpg')).blob();
const j = async (u) => (await fetch(u)).json();

export async function timing(only) {
  const { readSheet } = await import('/omr.js');
  const { initDigits, readDigit, readMarginYield } = await import('/digits.js');
  await initDigits();
  await readSheet(await photo('sheet02'), { marginCrops: true }); // warm up OpenCV
  const out = [], digitMs = [];
  for (const name of REAL) {
    if (only && !only.includes(name)) continue;
    const blob = await photo(name), a = [], b = [];
    for (let k = 0; k < 3; k++) {
      let t = performance.now(); await readSheet(blob, { marginCrops: true }); a.push(performance.now() - t);
      t = performance.now(); const res = await readSheet(blob, { hand: true }); b.push(performance.now() - t);
      if (k === 2 && res.ok) { t = performance.now(); res.hand.forEach((h) => { readDigit(h.tens); readDigit(h.ones); readMarginYield(h.margin); }); digitMs.push(performance.now() - t); }
    }
    out.push({ name, base: Math.round(Math.min(...a)), withHand: Math.round(Math.min(...b)), added: Math.round(Math.min(...b) - Math.min(...a)) });
  }
  return { perSheet: out.map((o) => `${o.name} ${o.base}->${o.withHand} (+${o.added})`).join(' | '), medianBaseMs: med(out.map((o) => o.base)), medianAddedBlockingMs: med(out.map((o) => o.added)), medianDigitNetMs: Math.round(med(digitMs)) };
}

function setKeyYields(truthRows) {
  const click = (sel) => document.querySelector(sel).click();
  document.querySelector('[data-tab="session"]').click();
  for (let i = 0; i < 20; i++) {
    const m = truthRows[i][2]; if (m == null || m === '?') continue;
    click(`[data-act="key-open"][data-row="${i}"]`); click(`[data-act="key-tab"][data-row="${i}"][data-field="yield"]`);
    const el = document.querySelector('[data-act="key-yield"]'); el.value = String(+m.slice(0, 2)); el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
async function feed(name) {
  const input = document.getElementById('f-up'), dt = new DataTransfer();
  dt.items.add(new File([await photo(name)], name + '.jpg', { type: 'image/jpeg' })); input.files = dt.files;
  const n = store().sheets.length; input.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(300); await until(busyDone);
  const t0 = Date.now();
  await until(() => { const s = store().sheets; return s.length > n && s[s.length - 1].saved && Array.isArray(s[s.length - 1].saved.hand); }, 60000);
  return Date.now() - t0;
}

export async function run(only) {
  const hand = await j('/assets/test/real/hand-truth.json'), bub = await j('/assets/test/real/truth.json');
  const out = { sheets: {}, shown: 0, offers: 0, offersRight: 0, offersWrong: [], wd: [], notes: [] };
  for (const name of REAL) {
    if (only && !only.includes(name)) continue;
    document.querySelector('[data-tab="session"]').click();
    document.querySelector('[data-act="clear-key"]').click(); // a fresh key per sheet (each practice has its own official yields)
    setKeyYields(hand[name]);
    const waited = await feed(name);
    const d = store(), sh = d.sheets[d.sheets.length - 1], hr = sh.saved.hand, ans = sh.saved.answers;
    const s = out.sheets[name] = { waitedHandMs: waited, flags: sh.saved.flags, shown: 0, offers: 0, offersRight: 0, wd: 0, wdReal: 0, wdFalse: 0, writtenWrong: 0 };
    for (let i = 0; i < 20; i++) {
      const t = hand[name][i], r = hr && hr[i]; if (!r) continue;
      const ok = (x) => Number.isInteger(x.d) && x.c >= 0.9;
      const written = ok(r.t) && ok(r.o) ? r.t.d * 10 + r.o.d : null;
      const truthW = Number.isInteger(t[0]) && Number.isInteger(t[1]) ? t[0] * 10 + t[1] : null;
      const bubble = ans[i].yield; // null when the bubble is blank / multiple / unsure
      if (written != null) { s.shown++; if (truthW != null && written !== truthW) s.writtenWrong++; }
      if (written != null && bubble == null) { s.offers++; if (written === truthW) s.offersRight++; else out.offersWrong.push(`${name} r${i + 1} written ${written} truth ${truthW}`); }
      if (written != null && bubble != null && bubble !== written) {
        s.wd++;
        const bt = bub[name] && Number.isInteger(bub[name][i][2]) && Number.isInteger(bub[name][i][3]) ? bub[name][i][2] * 10 + bub[name][i][3] : null;
        const real = written === truthW; // the handwriting read is what the student wrote
        let kind = real ? 'real' : 'FALSE';
        if (real) kind += bt == null ? ' (bubble truth not labelled)' : bt === bubble ? ' student bubbled differently from written' : ` reader misread bubbles (truth ${bt})`;
        if (real) s.wdReal++; else s.wdFalse++;
        out.wd.push(`${name} r${i + 1}: bubbles ${bubble}, written read ${written}, written truth ${truthW} -> ${kind}`);
      }
    }
    out.shown += s.shown; out.offers += s.offers; out.offersRight += s.offersRight;
  }
  out.summary = `shown=${out.shown} offers=${out.offers} offersRight=${out.offersRight} wd=${out.wd.length} real=${out.wd.filter((x) => x.includes('-> real')).length} false=${out.wd.filter((x) => x.includes('FALSE')).length}`;
  out.sheets = Object.entries(out.sheets).map(([k, v]) => `${k} shown=${v.shown} wrong=${v.writtenWrong} offers=${v.offers}/${v.offersRight} wd=${v.wd} flags=${JSON.stringify(v.flags)} waited=${v.waitedHandMs}ms`);
  return out;
}

// UI check: key the yields, scan one real sheet, open Review on a row's yield (and optionally the whole-sheet dialog) for a screenshot.
export async function review(name, row, dialog) {
  const hand = await j('/assets/test/real/hand-truth.json');
  document.querySelector('[data-tab="session"]').click(); setKeyYields(hand[name]);
  await feed(name);
  document.querySelector('[data-act="review"]').click(); await sleep(300);
  document.querySelector(`[data-act="edit"][data-row="${row}"][data-field="yield"]`).click(); await sleep(300);
  if (dialog) { document.querySelector('[data-act="sheet-view"]').click(); await sleep(500); }
  const ed = document.querySelector('#rv-sheet') || document.body;
  return { head: document.querySelector('#rv-sheet .ed-h') && document.querySelector('#rv-sheet .ed-h').textContent, hw: document.querySelector('.hw') ? document.querySelector('.hw').textContent.replace(/\s+/g, ' ') : null, crops: document.querySelectorAll('.hw canvas').length, toConfirm: document.querySelector('.rv-head .mut').textContent, dialog: !!document.querySelector('dialog.sv[open]'), edLen: ed.textContent.length };
}
