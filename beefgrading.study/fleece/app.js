// Fleece Grader UI. Vanilla ES module; state in memory + localStorage.
import { loadCV, readSheet, readSheetWithCorners, drawOverlay } from './omr.js';
import { scoreSheet, fieldFromRead, yieldFromDigits, FIELDS as SCORE_FIELDS } from './scoring.js';

const LABELS = {
  grade: ['70s', '64s', '62s', '60s', '58s', '56s', '54s', '50s', '48s', '46s'],
  length: ['Staple', 'French', 'Clothing'],
  purity: ['Good', 'Poor'],
  character: ['Good', 'Avg', 'Poor'],
};
const FIELD_NAMES = { grade: 'Grade', length: 'Length', yield: 'Yield', purity: 'Purity', character: 'Character' };
const SIMPLE = ['grade', 'length', 'purity', 'character'];
const ORDER = ['grade', 'length', 'yield', 'purity', 'character'];
const STORE = 'fleece-grader-v1';

const emptyFleece = () => ({ grade: null, length: null, yield: null, purity: null, character: null });
const S = {
  tab: 'session', name: '', n: 20,
  key: Array.from({ length: 20 }, emptyFleece),
  sheets: [], cornerId: null, reviewId: null, resultId: null,
  edit: null, onlyFlags: false, nextId: 1,
};

// ---------- helpers ----------
function escapeHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const $ = (id) => document.getElementById(id);
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
function label(f, v) { return v == null ? '' : f === 'yield' ? String(v) : LABELS[f][v]; }
function keyHas(k) { return !!k && SCORE_FIELDS.some((f) => Number.isInteger(k[f])); }
function sheetKey() { return S.key.map((k, i) => (i < S.n ? k : emptyFleece())); }
let toastTimer = null;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}
function busy(msg, spin) { const b = $('busy'); if (msg) { $('busy-text').textContent = msg; $('busy-spin').hidden = !spin; b.hidden = false; } else b.hidden = true; }

// ---------- persistence ----------
function save() {
  const sheets = S.sheets.map((s) => ({
    id: s.id, name: s.name, file: s.file, corr: s.corr,
    saved: { answers: answersOf(s), flags: flagsOf(s) },
  }));
  lsSet(STORE, JSON.stringify({ name: S.name, n: S.n, key: S.key, sheets, nextId: S.nextId }));
}
function load() {
  const raw = lsGet(STORE); if (!raw) return;
  try {
    const d = JSON.parse(raw);
    if (typeof d.name === 'string') S.name = d.name;
    if (Number.isInteger(d.n) && d.n >= 1 && d.n <= 20) S.n = d.n;
    if (Array.isArray(d.key)) S.key = Array.from({ length: 20 }, (_, i) => ({ ...emptyFleece(), ...(d.key[i] || {}) }));
    if (Array.isArray(d.sheets)) S.sheets = d.sheets.map((s) => ({ id: s.id, name: String(s.name || ''), file: s.file || '', corr: s.corr || {}, saved: s.saved || null, res: null, src: null }));
    S.nextId = d.nextId || S.sheets.length + 1;
  } catch (e) { /* ignore corrupt */ }
}

// ---------- answers, flags ----------
function readOf(sh, i, f) { return sh.res && sh.res.rows[i] ? sh.res.rows[i][f] : null; }
function corrOf(sh, i, f) { const c = sh.corr[i]; return c && Object.prototype.hasOwnProperty.call(c, f) ? c[f] : undefined; }

// info for one field of one row: student value, whether it needs confirm, audit, status
function fieldInfo(sh, i, f) {
  const k = S.key[i] ? S.key[i][f] : null;
  const keyed = Number.isInteger(k) && i < S.n;
  const corr = corrOf(sh, i, f);
  let student, status, slash = null, slashBad = false;
  if (f === 'yield') {
    const t = readOf(sh, i, 'yieldTens'), o = readOf(sh, i, 'yieldOnes');
    const sts = [t && t.status, o && o.status];
    status = sts.every((s) => s === 'ok') ? 'ok' : sts.includes('multiple') ? 'multiple' : sts.includes('unsure') ? 'unsure' : 'blank';
    student = yieldFromDigits(fieldFromRead(t), fieldFromRead(o));
    if (t && o && t.slashStatus === 'ok' && o.slashStatus === 'ok' && Number.isInteger(t.slash) && Number.isInteger(o.slash)) slash = t.slash * 10 + o.slash;
  } else {
    const rd = readOf(sh, i, f);
    status = rd ? rd.status : 'blank';
    student = fieldFromRead(rd);
    if (rd && rd.slashStatus === 'ok' && Number.isInteger(rd.slash)) slash = rd.slash;
  }
  if (slash != null && keyed && slash !== k) slashBad = true;
  const confirmed = corr !== undefined;
  if (confirmed) student = corr;
  return { student, status, confirmed, keyed, key: k, need: keyed && !confirmed && status !== 'ok', audit: slashBad, slash };
}
function answersOf(sh) {
  if (!sh.res) return (sh.saved && sh.saved.answers) || [];
  return Array.from({ length: 20 }, (_, i) => {
    const a = {};
    for (const f of ORDER) a[f] = fieldInfo(sh, i, f).student;
    return a;
  });
}
function flagsOf(sh) {
  if (!sh.res) return (sh.saved && sh.saved.flags) || { need: 0, audit: 0 };
  let need = 0, audit = 0;
  for (let i = 0; i < S.n; i++) for (const f of ORDER) { const fi = fieldInfo(sh, i, f); if (fi.need) need++; if (fi.audit) audit++; }
  return { need, audit };
}
function resultOf(sh) { return scoreSheet(answersOf(sh), sheetKey()); }

// ---------- nav ----------
const VIEWS = { session: renderSession, scan: renderScan, review: renderReview, results: renderResults };
function setTab(t) {
  S.tab = t;
  document.querySelectorAll('.tab').forEach((b) => { if (b.dataset.tab === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  for (const k of Object.keys(VIEWS)) $('view-' + k).hidden = k !== t;
  VIEWS[t]();
  window.scrollTo(0, 0);
}
function rerender() { const y = window.scrollY; VIEWS[S.tab](); window.scrollTo(0, y); }

// ---------- session ----------
function segHtml(f, i, k) {
  const cls = f === 'grade' ? 'c5' : f === 'purity' ? 'c2' : 'c3';
  const labs = f === 'length' ? ['Staple', 'French', 'Cloth'] : LABELS[f];
  return `<div class="seg ${cls}" role="group" aria-label="${escapeHtml(FIELD_NAMES[f])} for fleece ${i + 1}">` +
    labs.map((l, v) => `<button type="button" data-act="key" data-row="${i}" data-field="${f}" data-val="${v}" aria-pressed="${k[f] === v}">${escapeHtml(l)}</button>`).join('') + '</div>';
}
function keyRowHtml(i) {
  const k = S.key[i];
  return `<div class="card keyrow" data-keyrow="${i}">
    <div class="keyhead"><span class="num">${i + 1}</span><span class="muted">Fleece ${i + 1}</span></div>
    <div class="keygrid">
      <div><span class="lab">Grade</span>${segHtml('grade', i, k)}</div>
      <div><span class="lab">Length</span>${segHtml('length', i, k)}</div>
      <div><span class="lab">Yield</span><input type="number" inputmode="numeric" min="0" max="99" step="1" data-act="key-yield" data-row="${i}" value="${k.yield == null ? '' : k.yield}" aria-label="Yield for fleece ${i + 1}" placeholder="0-99"></div>
      <div><span class="lab">Purity</span>${segHtml('purity', i, k)}</div>
      <div><span class="lab">Character</span>${segHtml('character', i, k)}</div>
    </div></div>`;
}
function renderKeyRows() {
  $('keyrows').innerHTML = Array.from({ length: S.n }, (_, i) => keyRowHtml(i)).join('');
}
function renderSession() {
  const v = $('view-session');
  v.innerHTML = `
    <div><h2>Session</h2><p class="muted">Set the official key. Only fleeces with a key are graded.</p></div>
    <div class="card">
      <label class="fld">Practice name<input type="text" id="s-name" value="${escapeHtml(S.name)}" autocomplete="off" placeholder="e.g. Spring practice"></label>
      <label class="fld">Number of fleeces<input type="number" inputmode="numeric" id="s-n" min="1" max="20" value="${S.n}"></label>
      <div class="row">
        <button type="button" class="btn" data-act="scan-key">Scan official key sheet</button>
        <button type="button" class="btn ghost" data-act="clear-key">Clear key</button>
        <button type="button" class="btn primary" data-act="goto-scan">Next: scan sheets</button>
      </div>
      <div id="key-notice"></div>
    </div>
    <div id="keyrows" class="view" style="display:flex;flex-direction:column;gap:8px"></div>`;
  renderKeyRows();
}
function refreshKeyRow(i) {
  const row = document.querySelector(`[data-keyrow="${i}"]`); if (!row) return;
  const k = S.key[i];
  row.querySelectorAll('button[data-act="key"]').forEach((b) => b.setAttribute('aria-pressed', String(k[b.dataset.field] === Number(b.dataset.val))));
}
async function scanKey(file) {
  busy('Loading OpenCV'); await tick();
  try {
    await loadCV(); busy('Reading key sheet'); await tick();
    const res = await readSheet(file, { marginCrops: false });
    if (!res.ok) { toast('Could not read the key sheet: ' + (res.error || 'unknown')); return; }
    let filled = 0;
    for (let i = 0; i < 20; i++) {
      const r = res.rows[i], k = emptyFleece();
      for (const f of SIMPLE) k[f] = fieldFromRead(r[f]);
      k.yield = yieldFromDigits(fieldFromRead(r.yieldTens), fieldFromRead(r.yieldOnes));
      if (keyHas(k)) filled++;
      S.key[i] = k;
    }
    save(); if (S.tab === 'session') { renderKeyRows(); }
    $('key-notice').innerHTML = `<div class="notice">Key loaded from the scan for ${filled} fleeces. Check every row, then fix anything the scan missed.</div>`;
  } catch (e) { toast('Key scan failed: ' + e.message); } finally { busy(); }
}

// ---------- scan ----------
function defaultCorners(src) {
  const w = src.width, h = src.height, mx = w * 0.1, my = h * 0.1;
  return [{ x: mx, y: my }, { x: w - mx, y: my }, { x: w - mx, y: h - my }, { x: mx, y: h - my }];
}
function sheetById(id) { return S.sheets.find((s) => s.id === id) || null; }
async function addFiles(files) {
  const list = Array.from(files || []); if (!list.length) return;
  busy('Loading OpenCV'); await tick();
  try { await loadCV(); } catch (e) { busy(); toast('OpenCV failed to load. Check your connection once, then it works offline.'); return; }
  let lastId = null;
  for (let n = 0; n < list.length; n++) {
    const f = list[n];
    const sh = { id: S.nextId++, name: 'Student ' + (S.sheets.length + 1), file: f.name, corr: {}, res: null, src: null, saved: null, err: null };
    S.sheets.push(sh); lastId = sh.id;
    busy(`Reading sheet ${n + 1} of ${list.length}`); await tick();
    try {
      const res = await readSheet(f, { marginCrops: true });
      sh.src = res.sourceCanvas || null;
      if (res.ok) {
        sh.res = res; sh.corners = res.corners; sh.warnings = res.warnings || [];
      }
      else { sh.err = (res.warnings && res.warnings[0]) || 'Could not find the grading table. Drag the corners and re-read.'; if (sh.src) sh.corners = defaultCorners(sh.src); }
    } catch (e) { sh.err = 'Read failed: ' + e.message; }
  }
  busy(); S.cornerId = lastId; save();
  if (S.tab !== 'scan') setTab('scan'); else rerender();
}
function statusText(sh) {
  if (sh.err) return { t: sh.err, err: true };
  if (!sh.res) return { t: 'Saved scores only (image not kept)', err: false };
  const fl = flagsOf(sh);
  return { t: `Read. ${fl.need} to confirm, ${fl.audit} grading checks.`, err: false };
}
function renderScan() {
  const v = $('view-scan');
  const cards = S.sheets.map((sh) => {
    const st = statusText(sh);
    return `<div class="card sheetcard" data-sheet="${sh.id}">
      <h3><span>${escapeHtml(sh.file || 'Sheet')}</span><span class="status${st.err ? ' err' : ''}">${escapeHtml(st.t)}</span></h3>
      <label class="fld">Student name<input type="text" data-act="name" data-id="${sh.id}" value="${escapeHtml(sh.name)}" autocomplete="off"></label>
      <div class="row">
        ${sh.src ? `<button type="button" class="btn small" data-act="corners" data-id="${sh.id}">${S.cornerId === sh.id ? 'Hide corners' : 'Adjust corners'}</button>` : ''}
        ${sh.res ? `<button type="button" class="btn small primary" data-act="review" data-id="${sh.id}">Review</button>` : ''}
        <button type="button" class="btn small ghost" data-act="remove" data-id="${sh.id}">Remove</button>
      </div></div>`;
  }).join('');
  v.innerHTML = `
    <div><h2>Scan sheets</h2><p class="muted">One photo per sheet, flat, with the whole table in frame.</p></div>
    <div class="card">
      <div class="row">
        <button type="button" class="btn primary grow" data-act="pick-cam">Take photo</button>
        <button type="button" class="btn grow" data-act="pick-up">Upload photos</button>
      </div>
      ${S.sheets.length ? '' : '<p class="muted">No sheets yet.</p>'}
    </div>
    ${cards}
    <div id="corner-slot"></div>`;
  const csh = sheetById(S.cornerId);
  if (csh && csh.src) mountCorners($('corner-slot'), csh);
}
function mountCorners(slot, sh) {
  const src = sh.src, scale = Math.min(1, 1400 / src.width);
  slot.innerHTML = `<div class="card"><h3>Table corners: ${escapeHtml(sh.name)}</h3>
    <p class="muted">Drag the four handles onto the outer corners of the table border, then re-read.</p>
    <div class="cornerbox" id="cbox"></div>
    <button type="button" class="btn primary block" data-act="reread" data-id="${sh.id}">Re-read</button></div>`;
  const box = $('cbox');
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * scale); c.height = Math.round(src.height * scale);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  box.appendChild(c);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none');
  const poly = document.createElementNS(ns, 'polygon');
  poly.setAttribute('fill', 'rgba(200,16,46,0.12)'); poly.setAttribute('stroke', '#c8102e'); poly.setAttribute('stroke-width', '2'); poly.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.appendChild(poly); box.appendChild(svg);
  const names = ['top left', 'top right', 'bottom right', 'bottom left'];
  const hs = sh.corners.map((p, idx) => {
    const h = document.createElement('div'); h.className = 'h'; h.tabIndex = 0; h.setAttribute('role', 'slider'); h.setAttribute('aria-label', 'Corner ' + names[idx]);
    box.appendChild(h); return h;
  });
  const place = () => {
    poly.setAttribute('points', sh.corners.map((p) => `${p.x / src.width * 100},${p.y / src.height * 100}`).join(' '));
    hs.forEach((h, idx) => { h.style.left = (sh.corners[idx].x / src.width * 100) + '%'; h.style.top = (sh.corners[idx].y / src.height * 100) + '%'; });
  };
  place();
  hs.forEach((h, idx) => {
    let drag = false;
    h.addEventListener('pointerdown', (e) => { drag = true; h.setPointerCapture(e.pointerId); e.preventDefault(); });
    h.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const r = box.getBoundingClientRect();
      sh.corners[idx] = { x: Math.max(0, Math.min(src.width, (e.clientX - r.left) / r.width * src.width)), y: Math.max(0, Math.min(src.height, (e.clientY - r.top) / r.height * src.height)) };
      place();
    });
    const end = () => { drag = false; };
    h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
    h.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]; if (!d) return;
      e.preventDefault(); const st = e.shiftKey ? 20 : 4;
      sh.corners[idx] = { x: Math.max(0, Math.min(src.width, sh.corners[idx].x + d[0] * st)), y: Math.max(0, Math.min(src.height, sh.corners[idx].y + d[1] * st)) };
      place();
    });
  });
}
async function reread(sh) {
  busy('Re-reading sheet'); await tick();
  try {
    const res = await readSheetWithCorners(sh.src, sh.corners, { marginCrops: true });
    if (res.ok) {
      sh.res = res; sh.ov = null; sh.err = null; sh.warnings = res.warnings || [];
      toast('Re-read done.');
    }
    else { sh.err = (res.warnings && res.warnings[0]) || 'Read failed. Adjust corners.'; }
  } catch (e) { sh.err = 'Read failed: ' + e.message; }
  busy(); save(); rerender();
}

// ---------- review ----------
function chipHtml(sh, i, f, rs) {
  const fi = fieldInfo(sh, i, f), res = rs.fleeces[i];
  const off = res && res.graded && res.fields[f] ? res.fields[f].off : 0;
  let txt;
  if (fi.student != null) txt = label(f, fi.student);
  else if (fi.confirmed) txt = 'blank (confirmed)';
  else txt = fi.status === 'multiple' ? 'multiple marks' : fi.status === 'unsure' ? 'unsure' : 'blank';
  let cls = 'chip';
  if (fi.need) cls += ' need'; else if (fi.audit) cls += ' audit'; else if (fi.keyed && off > 0) cls += ' wrong'; else if (fi.keyed) cls += ' ok';
  const keyTxt = fi.keyed ? `key ${label(f, fi.key)}` : 'no key';
  const extra = fi.audit ? ` | grader slash ${label(f, fi.slash)}` : '';
  const pts = fi.keyed ? (off ? ` | -${off}` : ' | 0') : '';
  return `<button type="button" class="${cls}" data-act="edit" data-row="${i}" data-field="${f}" aria-expanded="${!!(S.edit && S.edit.row === i && S.edit.field === f)}"><b>${escapeHtml(FIELD_NAMES[f])}</b>${escapeHtml(txt)}<span class="k"> ${escapeHtml(keyTxt + pts + extra)}</span></button>`;
}
function editorHtml(sh, i, f) {
  const cur = fieldInfo(sh, i, f);
  let body;
  if (f === 'yield') {
    body = `<label class="fld">Yield (0-99)<input type="number" inputmode="numeric" min="0" max="99" step="1" id="ed-yield" value="${cur.student == null ? '' : cur.student}"></label>
      <div class="row"><button type="button" class="btn small primary" data-act="set-yield" data-row="${i}">Set yield</button></div>`;
  } else {
    const cls = f === 'grade' ? 'c5' : f === 'purity' ? 'c2' : 'c3';
    body = `<div class="seg ${cls}">` + LABELS[f].map((l, v) => `<button type="button" data-act="set" data-row="${i}" data-field="${f}" data-val="${v}" aria-pressed="${cur.student === v}">${escapeHtml(l)}</button>`).join('') + '</div>';
  }
  const hasCorr = corrOf(sh, i, f) !== undefined;
  return `<div class="editor"><span class="lab">Correct ${escapeHtml(FIELD_NAMES[f])} for fleece ${i + 1}</span>${body}
    <div class="row"><button type="button" class="btn small" data-act="set" data-row="${i}" data-field="${f}" data-val="blank">Blank</button>
    ${hasCorr ? `<button type="button" class="btn small ghost" data-act="unset" data-row="${i}" data-field="${f}">Use scan read</button>` : ''}
    <button type="button" class="btn small ghost" data-act="close-edit">Close</button></div></div>`;
}
function renderReview() {
  const v = $('view-review');
  if (!S.sheets.length) { v.innerHTML = '<div><h2>Review</h2></div><div class="card"><p>No sheets scanned yet.</p><button type="button" class="btn primary" data-act="goto-scan">Go to scan</button></div>'; return; }
  let sh = sheetById(S.reviewId); if (!sh) { sh = S.sheets[S.sheets.length - 1]; S.reviewId = sh.id; }
  const opts = S.sheets.map((s) => `<option value="${s.id}"${s.id === sh.id ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
  if (!sh.res) {
    v.innerHTML = `<div><h2>Review</h2></div><div class="card"><label class="fld">Sheet<select id="rv-sel">${opts}</select></label><p>The scan for this sheet is not in memory. Scores are kept; scan it again to review.</p></div>`;
    return;
  }
  const rs = resultOf(sh), fl = flagsOf(sh);
  let rows = '';
  for (let i = 0; i < S.n; i++) {
    const infos = ORDER.map((f) => fieldInfo(sh, i, f));
    const need = infos.some((x) => x.need), audit = infos.some((x) => x.audit);
    if (S.onlyFlags && !need && !audit) continue;
    const fr = rs.fleeces[i];
    const keyed = fr && fr.graded;
    const ed = S.edit && S.edit.row === i ? editorHtml(sh, i, S.edit.field) : '';
    const yk = S.key[i].yield;
    rows += `<div class="card fl${need ? ' flag' : audit ? ' flag-audit' : ''}" data-fl="${i}">
      <div class="flhead"><span class="num">${i + 1}</span>
        ${need ? '<span class="tag red">confirm</span>' : ''}${audit ? '<span class="tag amber">grading check</span>' : ''}${keyed ? '' : '<span class="tag">not graded</span>'}
        <span class="pts">${keyed ? `${fr.score}/${fr.max}` : ''}</span></div>
      <div class="chips">${ORDER.map((f) => chipHtml(sh, i, f, rs)).join('')}</div>
      ${sh.res.marginCrops ? `<div class="ycrop"><span class="lab">Written yield${yk != null ? ' (key ' + escapeHtml(yk) + ')' : ''}</span><span data-crop="${i}"></span></div>` : ''}
      ${ed}</div>`;
  }
  v.innerHTML = `
    <div><h2>Review</h2></div>
    <div class="card">
      <label class="fld">Sheet<select id="rv-sel">${opts}</select></label>
      <p class="sub">${rs.score} / ${rs.total}</p>
      <p class="muted">${fl.need} to confirm, ${fl.audit} grading checks. Tap any field to correct it.</p>
      <div class="row"><button type="button" class="btn small ${S.onlyFlags ? 'primary' : ''}" data-act="only-flags" aria-pressed="${S.onlyFlags}">${S.onlyFlags ? 'Showing flagged only' : 'Show flagged only'}</button>
      <button type="button" class="btn small" data-act="goto-results">Results</button></div>
      ${(sh.warnings || []).map((w) => `<div class="notice">${escapeHtml(w)}</div>`).join('')}
    </div>
    <div class="ovwrap" id="ovslot"></div>
    <div id="rows" style="display:flex;flex-direction:column;gap:8px">${rows || '<div class="card"><p>Nothing flagged.</p></div>'}</div>`;
  if (!sh.ov) sh.ov = drawOverlay(sh.res);
  $('ovslot').appendChild(sh.ov);
  v.querySelectorAll('[data-crop]').forEach((el) => {
    const cv = sh.res.marginCrops && sh.res.marginCrops[Number(el.dataset.crop)];
    if (cv) { const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; c.getContext('2d').drawImage(cv, 0, 0); c.setAttribute('role', 'img'); c.setAttribute('aria-label', 'Handwritten yield, fleece ' + (Number(el.dataset.crop) + 1)); el.appendChild(c); }
  });
}

// ---------- results ----------
let csvUrl = null;
function csvEscape(v) { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function buildCsv() {
  const head = ['Name', 'Score', 'Total', 'Points off', 'To confirm', 'Grading checks'];
  for (let i = 1; i <= S.n; i++) head.push('F' + i + ' off');
  const lines = [head.join(',')];
  for (const sh of S.sheets) {
    const r = resultOf(sh), fl = flagsOf(sh);
    const row = [sh.name, r.score, r.total, r.off, fl.need, fl.audit];
    for (let i = 0; i < S.n; i++) row.push(r.fleeces[i] && r.fleeces[i].graded ? r.fleeces[i].off : '');
    lines.push(row.map(csvEscape).join(','));
  }
  return lines.join('\n');
}
function renderResults() {
  const v = $('view-results');
  if (!S.sheets.length) { v.innerHTML = '<div><h2>Results</h2></div><div class="card"><p>No sheets scanned yet.</p></div>'; return; }
  let sh = sheetById(S.resultId) || S.sheets[S.sheets.length - 1]; S.resultId = sh.id;
  const rs = resultOf(sh), fl = flagsOf(sh);
  const keyed = sheetKey().filter(keyHas).length;
  const rowsTbl = S.sheets.map((s) => {
    const r = resultOf(s), f = flagsOf(s);
    return `<tr data-sheet="${s.id}" class="${s.id === sh.id ? 'pick' : ''}"><td>${escapeHtml(s.name)}</td><td class="n">${r.score} / ${r.total}</td><td class="n">${r.off}</td><td class="n">${f.need ? f.need + ' confirm' : ''}${f.need && f.audit ? ', ' : ''}${f.audit ? f.audit + ' check' : ''}${!f.need && !f.audit ? 'none' : ''}</td></tr>`;
  }).join('');
  const detail = Array.from({ length: S.n }, (_, i) => {
    const fr = rs.fleeces[i];
    if (!fr || !fr.graded) return `<tr><td class="n">${i + 1}</td><td colspan="6" class="muted">not graded</td></tr>`;
    const cell = (f) => (fr.fields[f] && fr.fields[f].max ? (fr.fields[f].off ? '-' + fr.fields[f].off : '0') : '');
    return `<tr><td class="n">${i + 1}</td>${ORDER.map((f) => `<td class="n">${cell(f)}</td>`).join('')}<td class="n">${fr.score}/${fr.max}</td></tr>`;
  }).join('');
  v.innerHTML = `
    <div><h2>Results</h2><p class="muted">${escapeHtml(S.name || 'Untitled session')} · ${keyed} fleeces keyed</p></div>
    ${keyed ? '' : '<div class="notice bad">No official key entered. Go to Session and set the key.</div>'}
    <div class="card">
      <p class="muted">${escapeHtml(sh.name)}</p>
      <div class="big">${rs.score}<small> / ${rs.total}</small></div>
      <p class="sub">${rs.off} points off</p>
      ${fl.need ? `<div class="notice bad">${fl.need} answers still need confirming in Review. Unconfirmed reads count as blank.</div>` : ''}
      ${fl.audit ? `<div class="notice">${fl.audit} fields where the grader slash disagrees with the key.</div>` : ''}
    </div>
    <div class="card"><h3>Per fleece</h3><div class="tablewrap"><table>
      <thead><tr><th class="n">#</th>${ORDER.map((f) => `<th class="n">${escapeHtml(FIELD_NAMES[f].slice(0, 5))}</th>`).join('')}<th class="n">Pts</th></tr></thead><tbody>${detail}</tbody></table></div></div>
    <div class="card"><h3>All sheets</h3><div class="tablewrap"><table>
      <thead><tr><th>Name</th><th class="n">Score</th><th class="n">Off</th><th class="n">Flags</th></tr></thead><tbody>${rowsTbl}</tbody></table></div>
      <div class="row" id="csv-slot"></div></div>`;
  if (csvUrl) { try { URL.revokeObjectURL(csvUrl); } catch (e) { /* ignore */ } }
  csvUrl = URL.createObjectURL(new Blob([buildCsv()], { type: 'text/csv' }));
  const a = document.createElement('a'); a.className = 'btn primary'; a.href = csvUrl;
  a.download = (S.name || 'fleece-grader').replace(/[^\w-]+/g, '_') + '.csv'; a.textContent = 'Download CSV';
  $('csv-slot').appendChild(a);
}

// ---------- events ----------
const inputs = {};
function makeInput(id, capture, multiple) {
  const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.hidden = true; i.id = id;
  if (capture) i.setAttribute('capture', 'environment'); if (multiple) i.multiple = true;
  i.addEventListener('change', () => { const f = Array.from(i.files); i.value = ''; if (id === 'f-key') { if (f[0]) scanKey(f[0]); } else addFiles(f); });
  document.body.appendChild(i); inputs[id] = i;
}

function onClick(e) {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act, row = Number(t.dataset.row), f = t.dataset.field;
  switch (act) {
    case 'key': {
      const val = Number(t.dataset.val), k = S.key[row];
      k[f] = k[f] === val ? null : val; refreshKeyRow(row); save(); break;
    }
    case 'scan-key': inputs['f-key'].click(); break;
    case 'clear-key': S.key = Array.from({ length: 20 }, emptyFleece); save(); renderSession(); break;
    case 'goto-scan': setTab('scan'); break;
    case 'goto-results': setTab('results'); break;
    case 'pick-cam': inputs['f-cam'].click(); break;
    case 'pick-up': inputs['f-up'].click(); break;
    case 'corners': S.cornerId = S.cornerId === Number(t.dataset.id) ? null : Number(t.dataset.id); rerender(); break;
    case 'reread': { const sh = sheetById(Number(t.dataset.id)); if (sh && sh.src) reread(sh); break; }
    case 'review': S.reviewId = Number(t.dataset.id); S.edit = null; setTab('review'); break;
    case 'remove': {
      const id = Number(t.dataset.id); S.sheets = S.sheets.filter((s) => s.id !== id);
      if (S.cornerId === id) S.cornerId = null; save(); rerender(); break;
    }
    case 'only-flags': S.onlyFlags = !S.onlyFlags; rerender(); break;
    case 'edit': {
      const same = S.edit && S.edit.row === row && S.edit.field === f;
      S.edit = same ? null : { row, field: f }; rerender(); break;
    }
    case 'close-edit': S.edit = null; rerender(); break;
    case 'set': case 'unset': case 'set-yield': {
      const sh = sheetById(S.reviewId); if (!sh) break;
      const field = act === 'set-yield' ? 'yield' : f;
      sh.corr[row] = sh.corr[row] || {};
      if (act === 'unset') delete sh.corr[row][field];
      else if (act === 'set-yield') {
        const raw = $('ed-yield').value.trim(), n = Number(raw);
        if (raw === '' || !Number.isInteger(n) || n < 0 || n > 99) { toast('Enter a whole number 0-99, or tap Blank.'); break; }
        sh.corr[row].yield = n;
      } else sh.corr[row][field] = t.dataset.val === 'blank' ? null : Number(t.dataset.val);
      S.edit = null; sh.ov = sh.ov; save(); rerender(); break;
    }
    default: break;
  }
}

function init() {
  load();
  makeInput('f-cam', true, false); makeInput('f-up', false, true); makeInput('f-key', false, false);
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) setTab(b.dataset.tab); });
  const main = $('main');
  main.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-sheet]');
    if (tr && S.tab === 'results') { S.resultId = Number(tr.dataset.sheet); rerender(); return; }
    onClick(e);
  });
  main.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 's-name') { S.name = t.value; save(); }
    else if (t.dataset.act === 'key-yield') {
      const raw = t.value.trim(), n = Number(raw);
      S.key[Number(t.dataset.row)].yield = raw !== '' && Number.isInteger(n) && n >= 0 && n <= 99 ? n : null; save();
    } else if (t.dataset.act === 'name') { const sh = sheetById(Number(t.dataset.id)); if (sh) { sh.name = t.value; save(); } }
  });
  main.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 's-n') { const n = Math.max(1, Math.min(20, Math.round(Number(t.value) || 20))); S.n = n; t.value = n; save(); renderKeyRows(); }
    else if (t.id === 'rv-sel') { S.reviewId = Number(t.value); S.edit = null; rerender(); }
  });
  setTab('session');
}
init();
