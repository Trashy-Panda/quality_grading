// Run inside rails-demo.html (served by the fleece dev server):
//   node .claude/tools/cdp-shot.mjs http://localhost:PORT/dev/rails-demo.html 390 - --wait 1200 --eval "$(cat fleece-grader/dev/rails-demo-test.js)"
// One async expression; resolves { pass, fails, ... }.
(async () => {
  const fails = [], sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (c, m) => { if (!c) fails.push(m); };
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  const dlg = $('.rl-dlg');
  const rows = () => $$('.rl-row');
  const names = () => rows().map((r) => r.querySelector('.rl-name').textContent);
  const click = async (el, ms = 60) => { el.click(); await sleep(ms); };
  const act = (a, id) => $(`[data-act="${a}"]${id ? `[data-id="${id}"]` : ''}`);
  const idOf = (title) => rows().find((r) => r.querySelector('.rl-name').textContent === title).querySelector('[data-act="toggle"]').dataset.id;
  const expand = async (id) => { if (!$(`#rl-d-${id}`)) await click(act('toggle', id)); };
  const submit = async (vals = {}) => {
    for (const [k, v] of Object.entries(vals)) dlg.querySelector(`[name="${k}"]`).value = v;
    await click(dlg.querySelector('[data-dlg="ok"]'));
  };
  const cancel = async () => click(dlg.querySelector('[data-dlg="cancel"]'));
  const saveRail = async (title, tag, notes) => {
    await click(act('save'));
    ok(dlg.open, 'save dialog opens');
    await submit({ title, tag, notes, date: '2026-03-04' });
  };

  for (let i = 0; i < 40 && !$('[data-rl="off"]').textContent.trim(); i++) await sleep(250); // wait for the officials call to settle
  // online section: offline or denied, quiet
  const offTxt = $('[data-rl="off"]').textContent;
  ok(/need a connection|not available yet|No officials posted|Could not load/.test(offTxt), 'online section state: ' + offTxt);
  ok($('.rl-empty') && /No saved rails yet/.test($('.rl-empty').textContent), 'empty state');
  const d0 = demo.session;

  // save 3 rails
  await saveRail('Alpha Class', 'FFA', 'notes <b>one</b>');
  ok(names().join() === 'Alpha Class', 'saved Alpha: ' + names());
  ok(!$('.rl-notes b') && /<b>one<\/b>/.test($('.rl-notes').textContent), 'notes are escaped');
  demo.session = { ...d0, name: 'Bravo Class', sheets: d0.sheets.slice(0, 1) };
  railsView.refresh();
  await saveRail('Bravo Class', '4-H', '');
  demo.session = { ...d0, name: 'Charlie', sheets: [] };
  railsView.refresh();
  await saveRail('Charlie', 'FFA', '');
  ok(rows().length === 3, '3 rails: ' + names());
  ok(/3 rails/.test($('[data-rl="count"]').textContent), 'count');
  const meta = rows().map((r) => r.textContent).join('|');
  ok(/3 sheets/.test(meta) && /1 sheet\b/.test(meta) && /0 sheets/.test(meta) && /3 keyed/.test(meta), 'sheet/keyed counts: ' + meta);
  ok($$('.rl-score').length === 2, 'avg shown for rails with sheets');

  // search + tag filter
  const q = $('[data-rl="q"]');
  q.value = 'bravo'; q.dispatchEvent(new Event('input', { bubbles: true })); await sleep(40);
  ok(names().join() === 'Bravo Class', 'search bravo: ' + names());
  q.value = 'zzz'; q.dispatchEvent(new Event('input', { bubbles: true })); await sleep(40);
  ok(rows().length === 0 && $('[data-act="clear"]'), 'no match state');
  await click($('[data-act="clear"]'));
  ok(rows().length === 3 && q.value === '', 'clear filters');
  await click($('[data-act="tag"][data-tag="FFA"]'));
  ok(rows().length === 2 && !names().includes('Bravo Class'), 'tag FFA: ' + names());
  ok($('[data-act="tag"][data-tag="FFA"]').getAttribute('aria-pressed') === 'true', 'chip pressed');
  await click($('[data-act="tag"][data-tag=""]'));
  ok(rows().length === 3, 'tag All');

  // rename
  const bravo = idOf('Bravo Class');
  await expand(bravo);
  await click(act('edit', bravo));
  await submit({ title: 'Bravo Renamed' });
  ok(names().includes('Bravo Renamed') && !names().includes('Bravo Class'), 'rename: ' + names());

  // duplicate
  await expand(bravo);
  await click(act('dup', bravo));
  ok(rows().length === 4 && names().some((n) => /Bravo Renamed \(copy\)/.test(n)), 'duplicate: ' + names());

  // delete: cancel keeps, confirm removes
  const copyId = idOf(names().find((n) => /\(copy\)/.test(n)));
  await expand(copyId);
  await click(act('del', copyId));
  ok(dlg.open && dlg.getAttribute('role') === 'alertdialog', 'delete confirm is an alertdialog');
  ok(document.activeElement === dlg.querySelector('[data-dlg="cancel"]'), 'confirm focuses Cancel');
  await cancel();
  ok(!dlg.open && rows().length === 4, 'cancel keeps rail');
  await click(act('del', copyId));
  await click(dlg.querySelector('[data-dlg="ok"]'));
  ok(rows().length === 3 && !names().some((n) => /\(copy\)/.test(n)), 'delete confirmed: ' + names());

  // open: session has sheets -> confirm; cancel does nothing; ok calls host.loadSession with the saved session
  const alpha = idOf('Alpha Class');
  await expand(alpha);
  await click(act('open', alpha));
  ok(dlg.open, 'open asks to replace');
  await cancel();
  ok(!demo.calls.some((c) => c.fn === 'loadSession'), 'cancel does not load');
  await click(act('open', alpha));
  await click(dlg.querySelector('[data-dlg="ok"]'));
  const call = demo.calls.find((c) => c.fn === 'loadSession');
  ok(call && call.arg.name === 'Alpha Class' && call.arg.n === 3 && call.arg.sheets.length === 3, 'loadSession payload: ' + JSON.stringify(call && [call.arg.name, call.arg.n, call.arg.sheets && call.arg.sheets.length]));
  ok(call && call.arg.sheets[0].saved.answers.length === 20 && call.arg.key.length === 20, 'session shape');
  // empty session: opens without a confirm
  demo.session = demo.emptySession(); railsView.refresh();
  demo.calls.length = 0;
  const bid = idOf('Bravo Renamed');
  await expand(bid);
  await click(act('open', bid));
  ok(!dlg.open && demo.calls.length === 1, 'no confirm when session is empty');

  // CSV: capture the blob and the file name
  const blobs = [], origCreate = URL.createObjectURL, origClick = HTMLAnchorElement.prototype.click;
  let dl = null;
  URL.createObjectURL = (b) => { blobs.push(b); return 'blob:test'; };
  HTMLAnchorElement.prototype.click = function () { dl = this.download; };
  await expand(alpha);
  await click(act('csv', alpha));
  URL.createObjectURL = origCreate; HTMLAnchorElement.prototype.click = origClick;
  ok(dl === 'alpha-class-2026-03-04.csv', 'csv file name: ' + dl);
  const csv = blobs[0] ? await blobs[0].text() : '';
  ok(/^Name,Score,Total,Points off,To confirm,Grading checks,F1 off,F2 off,F3 off\n/.test(csv) && /^Ann,60,60,0,0,1,0,0,0$/m.test(csv) && /"'=Evil, ""Name"""/.test(csv), 'csv content: ' + JSON.stringify(csv.slice(0, 200)));

  // post: quiet toast when offline or denied, and the rail is unchanged
  await expand(alpha);
  const before = demo.toasts.length;
  await click(act('post', alpha));
  if (dlg.open) await click(dlg.querySelector('[data-dlg="ok"]'), 4000);
  const lastToast = demo.toasts.slice(before).join(' | ');
  ok(/Needs a connection|Not available yet|Sign in did not finish|Try again/.test(lastToast), 'post failure toast: ' + lastToast);
  ok(!!act('post', alpha), 'rail not marked posted after failure');

  return { pass: fails.length === 0, fails, offTxt, lastToast };
})()
