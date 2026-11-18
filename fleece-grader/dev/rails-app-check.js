// Dev-only driver for the Rails tab in the real app. Load it from the app page under the dev server:
//   node .claude/tools/cdp-shot.mjs http://localhost:PORT/index.html 390 - --wait 1500 --eval "import('/dev/rails-app-check.js').then(m => m.run())" --eval2 "import('/dev/rails-app-check.js').then(m => m.afterReload())" --reload
//   node .claude/tools/cdp-shot.mjs "http://localhost:PORT/index.html?official=bogus" 390 - --wait 3000 --eval "import('/dev/rails-app-check.js').then(m => m.shared())"
// run(): type a 3-fleece key through the Session UI, scan a synthetic sheet, save the session as a rail, clear the session,
// open the rail, and check the key, the saved answers and the Results score came back. afterReload(): the rail survived a reload.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => document.querySelector(s);
const store = () => JSON.parse(localStorage.getItem('fleece-grader-v1'));
const railsStore = () => JSON.parse(localStorage.getItem('fleece-rails-v1') || '{"rails":[]}').rails;
async function until(fn, ms = 60000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(100); } return false; }
const click = async (el, ms = 80) => { if (!el) throw new Error('missing control'); el.click(); await sleep(ms); };
const tab = (t) => click($(`#tab-${t}`), 150);
const KEY = [{ grade: 2, length: 2, yield: 25 }, { grade: 9, length: 1, yield: 41 }, { grade: 5, length: 0, yield: 60 }];

async function typeKey() {
  await tab('session');
  const sel = (a, r, f, v) => `[data-act="${a}"][data-row="${r}"]${f ? `[data-field="${f}"]` : ''}${v != null ? `[data-val="${v}"]` : ''}`;
  for (let r = 0; r < KEY.length; r++) {
    await click($(sel('key-open', r)));
    await click($(sel('key-tab', r, 'grade'))); await click($(sel('key', r, 'grade', KEY[r].grade)));
    await click($(sel('key-tab', r, 'length'))); await click($(sel('key', r, 'length', KEY[r].length)));
    await click($(sel('key-tab', r, 'yield')));
    const y = $(sel('key-yield', r));
    y.value = String(KEY[r].yield); y.dispatchEvent(new Event('input', { bubbles: true })); await sleep(80);
  }
}
const resultsText = async () => { await tab('results'); return ($('.big') || {}).textContent || ''; };
const snap = () => { const d = store(); return JSON.stringify({ key: d.key, n: d.n, name: d.name, sheets: d.sheets.map((s) => ({ name: s.name, a: s.saved.answers, need: s.saved.flags.need, audit: s.saved.flags.audit })) }); };

export async function run() {
  const fails = [], ok = (c, m) => { if (!c) fails.push(m); };
  await typeKey();
  ok(store().key.slice(0, 3).every((k, i) => k.grade === KEY[i].grade && k.length === KEY[i].length && k.yield === KEY[i].yield), 'key typed: ' + JSON.stringify(store().key.slice(0, 3)));
  // name + 3 fleeces
  const nm = $('#s-name'); nm.value = 'Rails check'; nm.dispatchEvent(new Event('input', { bubbles: true }));
  // scan a fixture sheet through the real upload input
  const blob = await (await fetch('/assets/test/synth1.jpg')).blob(), dt = new DataTransfer();
  dt.items.add(new File([blob], 'synth1.jpg', { type: 'image/jpeg' }));
  const up = $('#f-up'); up.files = dt.files; up.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(500); await until(() => document.getElementById('busy').hidden);
  await until(() => store().sheets.length === 1 && store().sheets[0].saved.answers.some((a) => a.grade != null));
  const before = snap(), scoreBefore = await resultsText();
  ok(store().sheets.length === 1 && /\d/.test(scoreBefore), 'sheet scanned, score: ' + scoreBefore);

  // save as a rail from the Rails tab
  await tab('rails');
  const tabsOk = $('#tab-rails').getAttribute('aria-selected') === 'true' && !$('#view-rails').hidden && $('#view-session').hidden;
  ok(tabsOk, 'rails tab shows');
  await click($('[data-act="save"]'));
  const dlg = $('.rl-dlg'); ok(dlg.open, 'save dialog');
  ok(dlg.querySelector('[name="title"]').value === 'Rails check', 'title prefilled from the session name');
  await click(dlg.querySelector('[data-dlg="ok"]'), 200);
  ok(railsStore().length === 1 && railsStore()[0].title === 'Rails check', 'rail stored');

  // clear the session: remove the sheet (Scan tab), clear the key (Session tab)
  await tab('scan'); await click($('[data-act="remove"]'));
  await tab('session'); await click($('[data-act="clear-key"]'));
  ok(store().sheets.length === 0 && store().key.every((k) => k.grade == null), 'session cleared');
  const emptyRes = await resultsText();
  ok(emptyRes === '', 'no results when cleared');

  // open the rail: confirm only when the session has work (it has none now)
  await tab('rails');
  if (!$('[data-act="open"]')) await click($('.rl-row [data-act="toggle"]'));
  await click($('[data-act="open"]'), 300);
  ok(!dlg.open, 'no confirm on an empty session');
  ok($('#tab-session').getAttribute('aria-selected') === 'true', 'open lands on Session');
  const after = snap();
  ok(after === before, 'session restored. before=' + before.slice(0, 160) + ' after=' + after.slice(0, 160));
  const scoreAfter = await resultsText();
  ok(scoreAfter === scoreBefore, `score restored ${scoreBefore} vs ${scoreAfter}`);

  // opening again over a session with work asks first; cancel keeps it
  await tab('rails'); if (!$('[data-act="open"]')) await click($('.rl-row [data-act="toggle"]'));
  await click($('[data-act="open"]'));
  ok(dlg.open, 'confirm over an existing session');
  await click(dlg.querySelector('[data-dlg="cancel"]'));
  ok(!dlg.open && $('#tab-rails').getAttribute('aria-selected') === 'true', 'cancel stays on Rails');
  return { pass: fails.length === 0, fails, scoreBefore };
}

export async function afterReload() {
  const r = railsStore();
  await tab('rails');
  const names = [...document.querySelectorAll('.rl-row .rl-name')].map((e) => e.textContent);
  const off = await until(() => $('[data-rl="off"]').textContent.trim() !== '', 15000) ? $('[data-rl="off"]').textContent : 'loading';
  return { pass: r.length === 1 && names.join() === 'Rails check', rails: r.length, names, off };
}

export async function shared() {
  await sleep(500);
  const t = document.getElementById('toast');
  const seen = await until(() => !t.hidden && /shared key/.test(t.textContent), 12000);
  return { pass: seen && !/undefined|error/i.test(t.textContent), toast: t.textContent, url: location.search, tab: document.querySelector('.tab[aria-selected="true"]').dataset.tab };
}
