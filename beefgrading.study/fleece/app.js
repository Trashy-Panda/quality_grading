// Fleece Grader UI. Vanilla ES module; state in memory + localStorage.
// Markup follows docs/DESIGN.md v3 (comp A fleece screens): a stage plus one sheet per screen.
import { loadCV, readSheet, readSheetWithCorners } from './omr.js';
import { scoreSheet, scoreField, fieldFromRead, yieldFromDigits, FIELDS as SCORE_FIELDS } from './scoring.js';
import { initDigits, readDigit, readMarginYield, DIGITS } from './digits.js';
import { readListKey, LIST } from './listkey.js';
import { keyFromScan, detectKeyMode } from './consensus.js';

const LABELS = {
  grade: ['70s', '64s', '62s', '60s', '58s', '56s', '54s', '50s', '48s', '46s'],
  length: ['Staple', 'French', 'Clothing'],
  purity: ['Good', 'Poor'],
  character: ['Good', 'Avg', 'Poor'],
};
// Full names for the key list and pickers; short names for the narrow review cells.
const LONG = { grade: LABELS.grade, length: ['Staple', 'French combing', 'Clothing'], purity: ['Good', 'Poor'], character: ['Good', 'Average', 'Poor'] };
const SHORT = { grade: LABELS.grade, length: ['Staple', 'French', 'Cloth'], purity: ['Good', 'Poor'], character: ['Good', 'Avg', 'Poor'] };
// Average fibre diameter per grade, shown beside each grade in the key picker.
const GRADE_D = ['20.59 µ or finer', '20.60 to 22.04 µ', '22.05 to 23.49 µ', '23.50 to 24.94 µ', '24.95 to 26.39 µ', '26.40 to 27.84 µ', '27.85 to 29.29 µ', '29.30 to 30.99 µ', '31.00 to 32.69 µ', '32.70 to 34.39 µ'];
const FIELD_NAMES = { grade: 'Grade', length: 'Length', yield: 'Yield', purity: 'Purity', character: 'Character' };
const SIMPLE = ['grade', 'length', 'purity', 'character'];
const ORDER = ['grade', 'length', 'yield', 'purity', 'character'];
// Next/Enter walk only these; Purity and Character are autofilled and reached by tapping.
const CORE = ['grade', 'length', 'yield'];
const AUTOF = ['purity', 'character'];
const STORE = 'fleece-grader-v1';

const emptyFleece = () => ({ grade: null, length: null, yield: null, purity: null, character: null });
const emptyAuto = () => ({ purity: false, character: false });
// Where each key value came from (set by Scan official key): keySrc[row][field] = { s: source, low?: true }.
const SRC_WORDS = { slash: "the grader's slash", inferred: "the student's fill, with no grader slash", fill: 'a filled bubble', margin: 'the yield written in the margin', written: 'the Written digits', list: 'the handwritten list' };
const S = {
  tab: 'session', name: '', n: 20,
  key: Array.from({ length: 20 }, emptyFleece),
  sheets: [], cornerId: null, reviewId: null, resultId: null,
  edit: null, onlyFlags: false, nextId: 1,
  kRow: 0, kField: 'grade', adjust: false, detail: false,
  all: { purity: 0, character: 1 }, svZoom: null,
  auto: Array.from({ length: 20 }, emptyAuto), // per key row: purity/character values filled by default, not picked
  keySrc: Array.from({ length: 20 }, () => ({})), ks: null, // ks: the key photo being read (not saved)
};

// ---------- helpers ----------
function escapeHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const $ = (id) => document.getElementById(id);
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
const ic = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const wideMq = window.matchMedia('(min-width: 900px)');
const reduceMq = window.matchMedia('(prefers-reduced-motion: reduce)');
function label(f, v) { return v == null ? '' : f === 'yield' ? String(v) : LABELS[f][v]; }
function longLabel(f, v) { return v == null ? '' : f === 'yield' ? String(v) : LONG[f][v]; }
function keyHas(k) { return !!k && SCORE_FIELDS.some((f) => Number.isInteger(k[f])); }
function sheetKey() { return S.key.map((k, i) => (i < S.n ? k : emptyFleece())); }
let toastTimer = null;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}
function busy(msg, spin) { const b = $('busy'); if (msg) { $('busy-text').textContent = msg; $('busy-spin').hidden = !spin; b.hidden = false; } else b.hidden = true; }
// Re-focus the control that had focus before a re-render (keyboard users keep their place).
function focusKey() {
  const a = document.activeElement;
  if (!a || !a.closest || !a.closest('main') || !a.dataset) return null;
  const d = a.dataset; if (!d.act && !d.tab) return null;
  return ['act', 'row', 'field', 'val', 'id'].filter((k) => d[k] !== undefined).map((k) => `[data-${k}="${d[k]}"]`).join('');
}
function refocus(sel) { if (!sel) return; const el = document.querySelector('main ' + sel); if (el) el.focus({ preventScroll: true }); }
function scrollTo(el, block) { if (el) el.scrollIntoView({ block: block || 'nearest', behavior: reduceMq.matches ? 'auto' : 'smooth' }); }

// ---------- persistence ----------
function save() {
  const sheets = S.sheets.map((s) => ({
    id: s.id, name: s.name, file: s.file, corr: s.corr,
    saved: { answers: answersOf(s), flags: flagsOf(s) },
  }));
  lsSet(STORE, JSON.stringify({ name: S.name, n: S.n, key: S.key, auto: S.auto, keySrc: S.keySrc, sheets, nextId: S.nextId }));
}
function load() {
  const raw = lsGet(STORE); if (!raw) return;
  try {
    const d = JSON.parse(raw);
    if (typeof d.name === 'string') S.name = d.name;
    if (Number.isInteger(d.n) && d.n >= 1 && d.n <= 20) S.n = d.n;
    if (Array.isArray(d.key)) S.key = Array.from({ length: 20 }, (_, i) => ({ ...emptyFleece(), ...(d.key[i] || {}) }));
    S.auto = Array.from({ length: 20 }, (_, i) => {
      const a = Array.isArray(d.auto) && d.auto[i] || {}, k = S.key[i];
      return { purity: a.purity === true && k.purity != null, character: a.character === true && k.character != null };
    });
    S.keySrc = Array.from({ length: 20 }, (_, i) => {
      const src = Array.isArray(d.keySrc) && d.keySrc[i] || {}, out = {};
      for (const f of ORDER) { const v = src[f]; if (v && typeof v.s === 'string' && SRC_WORDS[v.s] && S.key[i][f] != null) out[f] = v.low === true ? { s: v.s, low: true } : { s: v.s }; }
      return out;
    });
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
  let student, status, slash = null, slashBad = false, cands = [];
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
    if (rd && status !== 'ok' && rd.fill) rd.fill.forEach((x, n) => { if (x >= 0.3) cands.push(n); });
  }
  if (slash != null && keyed && slash !== k) slashBad = true;
  const confirmed = corr !== undefined;
  if (confirmed) student = corr;
  return { student, status, confirmed, keyed, key: k, need: keyed && !confirmed && status !== 'ok', audit: slashBad, slash, cands };
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
function flagList(sh) {
  const out = [];
  for (let i = 0; i < S.n; i++) for (const f of ORDER) { const fi = fieldInfo(sh, i, f); if (fi.need || fi.audit) out.push({ row: i, field: f }); }
  return out;
}
function firstFlag(sh) { const l = flagList(sh); return l.length ? l[0] : null; }
function nextFlag(sh, from) {
  const l = flagList(sh).filter((x) => !(x.row === from.row && x.field === from.field));
  if (!l.length) return null;
  const pos = (x) => x.row * 10 + ORDER.indexOf(x.field);
  return l.find((x) => pos(x) > pos(from)) || l[0];
}
function sheetById(id) { return S.sheets.find((s) => s.id === id) || null; }

// ---------- nav ----------
const VIEWS = { session: renderSession, scan: renderScan, review: renderReview, results: renderResults };
function setTab(t) {
  S.tab = t;
  document.querySelectorAll('.tab').forEach((b) => {
    const on = b.dataset.tab === t;
    b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
  });
  for (const k of Object.keys(VIEWS)) $('view-' + k).hidden = k !== t;
  if (t === 'review') {
    const sh = sheetById(S.reviewId) || S.sheets[S.sheets.length - 1];
    if (sh && sh.res && (!S.edit || S.edit.row >= S.n)) S.edit = firstFlag(sh);
  }
  VIEWS[t]();
  window.scrollTo(0, 0);
}
function rerender() { const y = window.scrollY, fk = focusKey(); VIEWS[S.tab](); window.scrollTo(0, y); refocus(fk); }
function openReview(id) { S.reviewId = id; const sh = sheetById(id); S.edit = sh && sh.res ? firstFlag(sh) : null; setTab('review'); }

// ---------- shared template pieces ----------
function ctaHtml(text, state, act, extra) {
  return `<button type="button" class="cta" data-act="${act}"${extra || ''}><span>${escapeHtml(text)}</span><span class="cta-s">${state ? escapeHtml(state) + ' ' : ''}${ic('arrow')}</span></button>`;
}
function emptyView(title, sub, ctaText, act) {
  return `<div class="stage"><header class="k-head"><div class="k-top"><h2 class="h2">${escapeHtml(title)}</h2></div><p class="k-sub">${escapeHtml(sub)}</p></header></div>
    <div class="sheet">${ctaHtml(ctaText, '', act)}</div>`;
}

// ---------- session: the key ----------
function keyDone(k) { return ORDER.every((f) => k[f] != null); }
function keyedCount() { let c = 0; for (let i = 0; i < S.n; i++) if (keyDone(S.key[i])) c++; return c; }
function coreDone(k) { return CORE.every((f) => k[f] != null); }
function firstIncomplete() { for (let i = 0; i < S.n; i++) if (!coreDone(S.key[i])) return i; return 0; }
// First grade/length/yield value on a fleece fills blank Purity and Character with the Set all defaults, marked auto.
function autofillPC(i) {
  const k = S.key[i]; if (!CORE.some((f) => k[f] != null)) return;
  for (const f of AUTOF) if (k[f] == null) { k[f] = S.all[f]; S.auto[i][f] = true; }
}
// Where Next goes: grade -> length -> yield -> next fleece's grade. Purity/Character tabs hand off to the next fleece.
function nextStep() {
  const ci = CORE.indexOf(S.kField);
  if (ci >= 0 && ci < CORE.length - 1) return { row: S.kRow, field: CORE[ci + 1] };
  return S.kRow < S.n - 1 ? { row: S.kRow + 1, field: 'grade' } : null;
}
function lastWith(f, v, i) { for (let j = i - 1; j >= 0; j--) if (S.key[j][f] === v) return j + 1; return 0; }

// The picker for one simple field of the active fleece: choice rows, aria-pressed on each.
function segHtml(f, i, k) {
  const rows = LONG[f].map((l, v) => {
    const on = k[f] === v, prev = lastWith(f, v, i), auto = on && !!S.auto[i][f];
    const mark = `${prev ? '<span>Fleece ' + prev + '</span>' : ''}${on ? (auto ? '<span>Auto</span>' : ic('check')) : ''}`;
    const cls = auto ? ' is-auto' : '';
    if (f === 'grade') return `<button type="button" class="pk${cls}" data-act="key" data-row="${i}" data-field="${f}" data-val="${v}" aria-pressed="${on}"><span class="pk-v">${escapeHtml(l)}</span><span class="pk-d">${escapeHtml(GRADE_D[v])}</span><span class="pk-m">${mark}</span></button>`;
    return `<button type="button" class="pk pk--b${cls}" data-act="key" data-row="${i}" data-field="${f}" data-val="${v}" aria-pressed="${on}"><span class="pk-v">${escapeHtml(l)}</span><span class="pk-m">${mark}</span></button>`;
  }).join('');
  return `<div class="pick pick-fade" role="tabpanel" aria-label="${escapeHtml(FIELD_NAMES[f])} for fleece ${i + 1}">${rows}</div>`;
}
// The margin of a scanned graded sheet, kept in memory only, so a doubtful yield can be checked by eye.
function cropOf(i) { const h = S.ks && S.ks.res && S.ks.res.hand && S.ks.res.hand[i]; return h && h.margin ? h.margin.canvas : null; }
function drawCrops(root) {
  root.querySelectorAll('[data-kcrop]').forEach((el) => {
    const n = Number(el.dataset.kcrop), cv = cropOf(n); if (!cv) return;
    const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; c.getContext('2d').drawImage(cv, 0, 0);
    c.setAttribute('role', 'img'); c.setAttribute('aria-label', `Margin beside fleece ${n + 1}`); el.replaceChildren(c);
  });
}
function lowYieldRows() {
  if (!S.ks || !S.ks.res || S.ks.mode === 'list') return [];
  const out = []; for (let i = 0; i < S.n; i++) if (lowOf(i, 'yield')) out.push(i);
  return out;
}
function renderKsChecks() {
  const slot = $('ks-chk'); if (!slot) return;
  const rows = lowYieldRows(); if (!rows.length) { slot.innerHTML = ''; return; }
  const fk = focusKey();
  slot.innerHTML = `<p class="lab" id="ks-chk-t">Check these yields against the margin</p><ul class="ks-chk" aria-labelledby="ks-chk-t">${rows.map((i) => {
    const v = S.key[i].yield, how = S.keySrc[i].yield.s === 'margin' ? 'Read as' : 'Student bubbles say';
    return `<li><button type="button" class="ks-c" data-act="ks-fix" data-row="${i}" aria-label="Fleece ${i + 1} yield. ${how} ${v}. Open it to fix"><span class="ks-n">${i + 1}</span><span class="ks-cv" data-kcrop="${i}"></span><span class="ks-r">${how} ${v}</span></button></li>`;
  }).join('')}</ul>`;
  drawCrops(slot); refocus(fk);
}
function keyYieldHtml(i, k) {
  const crop = cropOf(i) && lowOf(i, 'yield') ? `<div class="ed-crop"><span class="lab">Written in the margin</span><span data-kcrop="${i}"></span></div>` : '';
  return `<div class="k-yield" role="tabpanel" aria-label="Yield for fleece ${i + 1}"><label class="fld"><span class="lab">Yield for fleece ${i + 1}</span><input type="number" inputmode="numeric" enterkeyhint="next" min="0" max="99" step="1" data-act="key-yield" data-row="${i}" value="${k.yield == null ? '' : k.yield}" aria-label="Yield for fleece ${i + 1}" placeholder="0 to 99"></label><p>A whole number from 0 to 99.</p>${crop}</div>`;
}
function lowOf(i, f) { const v = S.keySrc[i] && S.keySrc[i][f]; return !!(v && v.low && S.key[i][f] != null); }
// A value the user has looked at (or changed) is no longer a guess.
function ackKeySrc(i, f) { const v = S.keySrc[i] && S.keySrc[i][f]; if (v && v.low) { delete v.low; save(); } }
function keyValsHtml(i) {
  const k = S.key[i], on = i === S.kRow;
  return ORDER.map((f) => {
    const empty = k[f] == null;
    const cls = [empty ? 'e' : '', !empty && S.auto[i][f] ? 'auto' : '', lowOf(i, f) ? 'low' : '', on && f === S.kField ? 'cur' : ''].filter(Boolean).join(' ');
    const txt = empty ? FIELD_NAMES[f] : longLabel(f, k[f]);
    return `<span data-kf="${f}"${cls ? ` class="${cls}"` : ''}>${escapeHtml(txt)}</span>`;
  }).join('');
}
function keyRowInner(i) {
  const k = S.key[i], on = i === S.kRow;
  const spoken = ORDER.map((f) => `${FIELD_NAMES[f]} ${k[f] == null ? 'not set' : longLabel(f, k[f]) + (S.auto[i][f] ? ', automatic' : '') + (lowOf(i, f) ? ', check this' : '')}`).join(', ');
  return `<button type="button" class="fl${on ? ' is-on' : ''}" data-act="key-open" data-row="${i}"${on ? ' aria-current="true"' : ''} aria-label="Fleece ${i + 1}. ${escapeHtml(spoken)}"><span class="num">${i + 1}</span><span class="fl-v">${keyValsHtml(i)}</span></button>`;
}
function keyRowHtml(i) { return `<li data-keyrow="${i}">${keyRowInner(i)}</li>`; }
function keySrcHtml(i, f) {
  const v = S.keySrc[i] && S.keySrc[i][f]; if (!v || S.key[i][f] == null) return '';
  if (v.s === 'inferred' && !v.low) return `<p class="k-src">Inferred. No grader slash on this graded row, so the student's fill stands.</p>`;
  return `<p class="k-src${v.low ? ' is-low' : ''}">From ${escapeHtml(SRC_WORDS[v.s] || 'the scan')}.${v.low ? ' Not sure of this one, check it.' : ''}</p>`;
}
function keySheetHtml() {
  const i = S.kRow, f = S.kField, k = S.key[i];
  const tabs = ORDER.map((x) => `<button type="button" role="tab" data-act="key-tab" data-row="${i}" data-field="${x}" aria-selected="${x === f}"${x === f ? '' : ' tabindex="-1"'}>${escapeHtml(FIELD_NAMES[x])}</button>`).join('');
  const panel = f === 'yield' ? keyYieldHtml(i, k) : segHtml(f, i, k);
  const ns = nextStep();
  const text = !ns ? 'Done, scan sheets' : ns.row === i ? 'Next, ' + FIELD_NAMES[ns.field] : 'Next, fleece ' + (ns.row + 1);
  return `<div class="ftabs" role="tablist" aria-label="Fleece ${i + 1} fields">${tabs}</div>${keySrcHtml(i, f)}${panel}${ctaHtml(text, `Fleece ${i + 1} of ${S.n}`, 'key-next')}`;
}
function updateKeyMeta() {
  renderKsChecks();
  const c = keyedCount(), n = S.n;
  const cnt = $('key-count'); if (cnt) cnt.textContent = `${c} of ${n} keyed`;
  updateSetAll();
  const p = $('key-prog'); if (p) { p.setAttribute('aria-label', `${c} of ${n} fleeces keyed`); p.firstElementChild.style.transform = `scaleX(${n ? c / n : 0})`; }
}
function renderKeySheet() {
  const sh = $('key-sheet'); if (!sh) return;
  const old = sh.querySelector('.pick'), top = old ? old.scrollTop : 0, fk = focusKey();
  sh.innerHTML = keySheetHtml(); drawCrops(sh);
  const nu = sh.querySelector('.pick');
  if (nu) {
    nu.scrollTop = top;
    const on = nu.querySelector('[aria-pressed="true"]');
    if (on && top === 0 && on.offsetTop + on.offsetHeight > nu.clientHeight - 24) nu.scrollTop = Math.max(0, Math.floor((on.offsetTop - nu.clientHeight / 3) / on.offsetHeight) * on.offsetHeight);
  }
  refocus(fk);
}
function renderKeyRows() {
  if (S.kRow >= S.n) S.kRow = S.n - 1;
  $('keyrows').innerHTML = Array.from({ length: S.n }, (_, i) => keyRowHtml(i)).join('');
  renderKeySheet(); updateKeyMeta();
}
function refreshKeyRow(i, withSheet = true) {
  const li = document.querySelector(`[data-keyrow="${i}"]`); if (!li) return;
  li.innerHTML = keyRowInner(i);
  updateKeyMeta();
  if (withSheet) renderKeySheet();
}
function setKeyActive(row, field, scroll) {
  const prev = S.kRow;
  S.kRow = row; S.kField = field;
  if (prev !== row) refreshKeyRow(prev, false);
  refreshKeyRow(row, true);
  if (scroll) { const li = document.querySelector(`[data-keyrow="${row}"]`); scrollTo(li && li.firstElementChild, 'nearest'); }
}
// "Set all": one purity and one character for every blank cell, then edit the exceptions.
function setAllHtml() {
  const seg = (f) => `<div class="seg" role="group" aria-label="${FIELD_NAMES[f]} for all fleeces">${LONG[f].map((l, v) => `<button type="button" data-act="all-pick" data-field="${f}" data-val="${v}" aria-pressed="${S.all[f] === v}">${escapeHtml(l)}</button>`).join('')}</div>`;
  return `<section class="k-all" aria-labelledby="k-all-t">
    <h3 class="lab" id="k-all-t">Set all fleeces</h3>
    <div class="k-all-r"><span class="k-all-l">Purity</span>${seg('purity')}</div>
    <div class="k-all-r"><span class="k-all-l">Character</span>${seg('character')}</div>
    <div class="k-all-a"><button type="button" class="k-all-go" id="k-all-go" data-act="all-apply"></button><p id="k-all-note">Fills blanks only. Values you already set stay.</p></div></section>`;
}
function blankAllCount() { let c = 0; for (let i = 0; i < S.n; i++) if (S.key[i].purity == null || S.key[i].character == null) c++; return c; }
function updateSetAll() {
  const b = $('k-all-go'); if (!b) return;
  const c = blankAllCount();
  b.disabled = c === 0;
  b.textContent = c === 0 ? 'Nothing blank to fill' : c === S.n ? `Apply to all ${S.n}` : `Apply to ${c} with blanks`;
}
function applySetAll() {
  let n = 0;
  for (let i = 0; i < S.n; i++) {
    const k = S.key[i]; let hit = false;
    for (const f of ['purity', 'character']) if (k[f] == null) { k[f] = S.all[f]; hit = true; }
    if (hit) { n++; refreshKeyRow(i, false); }
  }
  save(); renderKeySheet(); updateSetAll();
  toast(n ? `Set Purity ${LONG.purity[S.all.purity]} and Character ${LONG.character[S.all.character]} on ${plural(n, 'fleece')}.` : 'Nothing was blank, so nothing changed.');
}
function renderSession() {
  const v = $('view-session');
  v.innerHTML = `
    <div class="stage">
      <header class="k-head">
        <div class="k-top"><h2 class="h2">Session</h2><p class="mut" id="key-count"></p></div>
        <p class="k-sub">Set the official key. Only fleeces with a key are graded.</p>
        <div class="prog" id="key-prog" role="img" aria-label=""><i></i></div>
      </header>
      <div class="k-fields">
        <label class="fld"><span class="lab">Practice name</span><input type="text" id="s-name" value="${escapeHtml(S.name)}" autocomplete="off" placeholder="e.g. Spring practice"></label>
        <div><span class="lab">Number of fleeces</span>
          <div class="step">
            <button type="button" data-act="n-dec" aria-label="Fewer fleeces">${ic('minus')}</button>
            <input type="number" inputmode="numeric" id="s-n" min="1" max="20" value="${S.n}" aria-label="Number of fleeces">
            <button type="button" data-act="n-inc" aria-label="More fleeces">${ic('plus')}</button>
          </div></div>
      </div>
      <div class="k-acts">
        <button type="button" class="tbtn" data-act="scan-key">${ic('corners')}Scan official key</button>
        <button type="button" class="tbtn tbtn--q" data-act="clear-key">Clear key</button>
      </div>
      <div id="key-notice"></div>
      <div id="key-scan"></div>
      ${setAllHtml()}
      <ol id="keyrows" class="k-list"></ol>
    </div>
    <div class="sheet" id="key-sheet"></div>`;
  if (S.kRow >= S.n) S.kRow = 0;
  renderKeyRows(); renderKeyScan();
}
function setN(n) {
  S.n = Math.max(1, Math.min(20, Math.round(Number(n) || 20)));
  const el = $('s-n'); if (el) el.value = S.n;
  save(); renderKeyRows();
}
// ---------- scan the official key ----------
// One photo, three possible readings: a graded sheet (slashes plus margin yields), a bubbled key, or a handwritten list.
const MODE_NAMES = { graded: 'Graded sheet', bubbled: 'Bubbled key', list: 'Handwritten list' };
const MODE_NOTES = {
  graded: "The grader's slashes are the key and the yields come from the margin. A fill with no slash is the student's, so it is marked to check.",
  bubbled: 'The filled bubbles are the key. Written digits fill a yield that is not bubbled clearly.',
  list: 'One fleece per line: grade, length, yield. Values the reader was unsure of are marked to check.',
};
const KEY_MODES = ['graded', 'bubbled', 'list'];
const MAX_KEY_EDGE = 3200; // same cap omr.js uses, so corners stay in one coordinate space
async function fileCanvas(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, MAX_KEY_EDGE / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  return c;
}
// Read the printed table (and the handwriting beside it). Returns true when a table was found.
async function readKeyTable(ks, corners) {
  const res = corners ? await readSheetWithCorners(ks.src, corners, { hand: true }) : await readSheet(ks.src, { hand: true });
  if (res.sourceCanvas) ks.src = res.sourceCanvas; // the reader may have turned the photo
  ks.corners = res.corners || ks.corners || defaultCorners(ks.src);
  ks.res = res.ok ? res : null;
  ks.err = res.ok ? null : (res.warnings && res.warnings[0]) || 'Could not find the grading table.';
  ks.reads = res.ok ? res.hand.map((h) => ({ margin: readMarginYield(h.margin), tens: readDigit(h.tens), ones: readDigit(h.ones) })) : null;
  if (res.ok) ks.detect = detectKeyMode(res.rows, ks.reads.map((r) => r.margin), DIGITS.confidentMargin);
  return res.ok;
}
async function readKeyList(ks) {
  if (ks.list === undefined) ks.list = await readListKey(ks.blob);
  return !!(ks.list && ks.list.ok);
}
function applyKeyScan() {
  const ks = S.ks, table = ks.mode !== 'list';
  const data = table ? { rows: ks.res.rows, margin: ks.reads.map((r) => r.margin), tens: ks.reads.map((r) => r.tens), ones: ks.reads.map((r) => r.ones) } : { list: ks.list };
  const out = keyFromScan(ks.mode, data, { all: S.all, confMargin: DIGITS.confidentMargin, confDigit: DIGITS.confidentDigit, confList: LIST.confident });
  S.key = out.key; S.auto = out.auto; S.keySrc = out.src; ks.stats = out.stats;
  S.kRow = 0; S.kField = 'grade';
  const lowRow = S.keySrc.findIndex((r, i) => ORDER.some((f) => lowOf(i, f)));
  if (lowRow >= 0 && lowRow < S.n) { S.kRow = lowRow; S.kField = ORDER.find((f) => lowOf(lowRow, f)); } else S.kRow = firstIncomplete();
  save();
  if (S.tab === 'session') {
    renderKeyRows(); renderKeyScan();
    const nt = $('key-notice'), st = out.stats, extra = table || !ks.list.warnings.length ? '' : ' ' + ks.list.warnings.join('. ') + '.';
    if (nt) nt.innerHTML = `<p class="k-note">${ic('check')}<span>Key read from the photo for ${plural(st.filled, 'fleece')}. ${st.low ? `${plural(st.low, 'value')} highlighted to check. Tap one to open it and clear the mark.` : 'Nothing looked doubtful, but check every row.'}${escapeHtml(extra)}</span></p>`;
  }
}
async function scanKey(file) {
  busy('Loading OpenCV'); await tick();
  try {
    await loadCV(); await initDigits(); busy('Reading key photo'); await tick();
    const ks = { name: 'official key', file: file.name, blob: file, src: await fileCanvas(file), corners: null, res: null, reads: null, err: null, list: undefined, mode: null, manual: false, adjust: false, detect: null, stats: null };
    S.ks = ks;
    if (await readKeyTable(ks, null)) { ks.mode = ks.detect.mode; applyKeyScan(); }
    else {
      busy('Looking for a handwritten list'); await tick();
      if (await readKeyList(ks)) { ks.mode = 'list'; applyKeyScan(); }
      else { renderKeyScan(); toast('Could not read a key from that photo. No grading table or handwritten list was found. Adjust the corners and re-read, or tap the key in below.'); }
    }
  } catch (e) { toast('Key scan failed: ' + e.message); } finally { busy(); }
}
async function ksMode(m) {
  const ks = S.ks; if (!ks || !KEY_MODES.includes(m) || ks.mode === m) return;
  busy('Reading the key again'); await tick();
  try {
    if (m === 'list') { if (!(await readKeyList(ks))) { toast('No handwritten list found in that photo.'); return; } }
    else if (!ks.res) { toast('No grading table found in that photo. Adjust the corners and re-read.'); return; }
    ks.mode = m; ks.manual = true; applyKeyScan();
  } catch (e) { toast('Key scan failed: ' + e.message); } finally { busy(); }
}
async function ksReread() {
  const ks = S.ks; if (!ks) return;
  busy('Re-reading key photo'); await tick();
  try {
    if (await readKeyTable(ks, ks.corners)) {
      if (!(ks.manual && ks.mode !== 'list')) { ks.mode = ks.detect.mode; ks.manual = false; }
      ks.adjust = false; applyKeyScan(); toast('Re-read done.');
    } else { renderKeyScan(); toast(ks.err); }
  } catch (e) { toast('Key scan failed: ' + e.message); } finally { busy(); }
}
function renderKeyScan() {
  const slot = $('key-scan'); if (!slot) return;
  const ks = S.ks; if (!ks) { slot.innerHTML = ''; return; }
  const fk = focusKey();
  const seg = KEY_MODES.map((m) => `<button type="button" data-act="ks-mode" data-val="${m}" aria-pressed="${ks.mode === m}">${MODE_NAMES[m]}</button>`).join('');
  const det = ks.mode ? `${ks.manual ? 'Reading it as a' : 'Looks like a'} ${MODE_NAMES[ks.mode].toLowerCase()}. ${MODE_NOTES[ks.mode]}` : 'No key found in this photo yet. Adjust the corners onto the table and re-read, or tap the key in below.';
  slot.innerHTML = `<section class="ks" aria-labelledby="ks-t">
    <div class="ks-h"><h3 class="lab" id="ks-t">Key photo</h3><button type="button" class="tbtn tbtn--q" data-act="ks-close">Close photo</button></div>
    <div id="ks-slot"></div>
    <div id="ks-chk"></div>
    <p class="ks-det" role="status">${escapeHtml(det)}</p>
    <div class="seg" role="group" aria-label="Read this photo as">${seg}</div>
    <div class="ks-acts"><button type="button" class="tbtn tbtn--q" data-act="ks-corners">${ks.adjust ? 'Hide corners' : 'Adjust corners'}</button>${ks.adjust ? '<button type="button" class="ibtn go" data-act="ks-reread">Re-read</button>' : ''}</div></section>`;
  const list = ks.mode === 'list';
  mountCorners($('ks-slot'), ks, { adjust: ks.adjust, plain: list, right: ks.mode ? MODE_NAMES[ks.mode] : '', hint: '', tag: list ? `<p class="vf-tag">${ic('check')}Handwritten list read</p>` : '' });
  renderKsChecks(); refocus(fk);
}

// ---------- scan ----------
function defaultCorners(src) {
  const w = src.width, h = src.height, mx = w * 0.1, my = h * 0.1;
  return [{ x: mx, y: my }, { x: w - mx, y: my }, { x: w - mx, y: h - my }, { x: mx, y: h - my }];
}
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
  busy(); S.cornerId = lastId; S.adjust = false; save();
  if (S.tab !== 'scan') setTab('scan'); else rerender();
}
function statusText(sh) {
  if (sh.err) return { t: sh.err, err: true };
  if (!sh.res) return { t: 'Saved scores only, the photo is not kept.', err: false };
  const fl = flagsOf(sh);
  return { t: `Read. ${fl.need} to confirm, ${plural(fl.audit, 'grading check')}.`, err: false };
}
function scanSel() { return sheetById(S.cornerId) || S.sheets[S.sheets.length - 1] || null; }
function thumbOf(sh) {
  if (!sh.src) return '';
  if (!sh.thumb) {
    const s = 128 / Math.max(sh.src.width, sh.src.height), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sh.src.width * s)); c.height = Math.max(1, Math.round(sh.src.height * s));
    c.getContext('2d').drawImage(sh.src, 0, 0, c.width, c.height);
    sh.thumb = c.toDataURL('image/jpeg', 0.6);
  }
  return sh.thumb;
}
function emptyFinder(sel) {
  const msg = sel ? ['Photo not kept', 'Scores are saved. Scan this sheet again to review it.'] : ['No sheets yet', 'Take a photo or upload photos, one per sheet.'];
  return `<div class="vf vf--empty">
    <svg class="vf-guide" viewBox="0 0 100 130" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="M0 22V0h22M78 0h22v22M100 108v22H78M22 130H0v-22"/></svg>
    <p class="vf-msg">${escapeHtml(msg[0])}<span>${escapeHtml(msg[1])}</span></p>
    <p class="vf-hint">One photo per sheet, flat, with the whole table in frame.</p></div>`;
}
function renderScan() {
  const v = $('view-scan'), sel = scanSel();
  if (sel) S.cornerId = sel.id;
  if (!sel || !sel.src) S.adjust = false;
  const stack = S.sheets.length ? `<div class="stack" role="list" aria-label="Scan stack">${S.sheets.map((s, n) => {
    const th = thumbOf(s);
    return `<button type="button" class="stk${sel && s.id === sel.id ? ' is-on' : ''}" role="listitem" data-act="select-sheet" data-sheet="${s.id}" data-id="${s.id}" aria-label="${escapeHtml(s.name)}${sel && s.id === sel.id ? ', selected' : ''}">${th ? `<img src="${escapeHtml(th)}" alt="">` : '<span class="ph0"></span>'}<b>${n + 1}</b></button>`;
  }).join('')}</div>` : '';
  let info = '', acts = '';
  if (sel) {
    const st = statusText(sel);
    info = `<div class="s-info">
      <label class="fld"><span class="lab">Student name</span><input type="text" data-act="name" data-id="${sel.id}" value="${escapeHtml(sel.name)}" autocomplete="off"></label>
      <p class="s-st${st.err ? ' is-err' : ''}">${st.err ? '' : ic('check')}<span>${escapeHtml(st.t)}</span></p></div>`;
    acts = `<div class="s-acts">
      ${sel.src ? `<button type="button" class="tbtn tbtn--q" data-act="corners" data-id="${sel.id}">${S.adjust ? 'Hide corners' : 'Adjust corners'}</button>` : ''}
      ${S.adjust ? `<button type="button" class="ibtn go" data-act="reread" data-id="${sel.id}">Re-read</button>` : `<button type="button" class="tbtn tbtn--q" data-act="remove" data-id="${sel.id}">Remove</button>${sel.res ? `<button type="button" class="tbtn go" data-act="review" data-id="${sel.id}">Review${ic('arrow')}</button>` : ''}`}
    </div>`;
  }
  v.innerHTML = `
    <div class="stage"><div id="corner-slot"></div></div>
    <div class="sheet">
      ${stack}${info}${acts}
      <div class="cap">
        <button type="button" class="tbtn tbtn--q" data-act="pick-up">${ic('up')}Upload photos</button>
        <button type="button" class="shutter" data-act="pick-cam" aria-label="Take photo"><span></span></button>
        <span class="sp" aria-hidden="true"></span>
      </div>
    </div>`;
  if (sel && sel.src) mountCorners($('corner-slot'), sel); else $('corner-slot').innerHTML = emptyFinder(sel);
}
// The corner finder. Used by the Scan tab (a student sheet) and by the key photo on the Session tab.
// o: { adjust, tag (html), right (text), hint (text), plain (no frame, for a photo with no table) }.
function mountCorners(slot, sh, o = {}) {
  const src = sh.src, scale = Math.min(1, 1400 / src.width), W = src.width, H = src.height;
  const adjust = o.adjust === undefined ? S.adjust : o.adjust;
  const found = !sh.err;
  const tag = o.tag && !adjust ? o.tag : adjust ? `<p class="vf-tag">${ic('corners')}Drag each corner onto the table</p>` : found ? `<p class="vf-tag">${ic('check')}Table found, hold steady</p>` : `<p class="vf-tag vf-tag--warn">${ic('corners')}Table not found, adjust the corners</p>`;
  const right = o.right === undefined ? `${S.sheets.length} in stack` : o.right;
  const hint = o.hint === undefined ? (adjust ? 'Then tap Re-read.' : 'One photo per sheet, flat, with the whole table in frame.') : (adjust ? 'Then tap Re-read.' : o.hint);
  slot.innerHTML = `<div class="vf"><div class="vf-box" style="--ar:${(W / H).toFixed(4)}"></div>
    <div class="vf-top">${tag}${right ? `<p class="vf-tag">${escapeHtml(right)}</p>` : ''}</div>
    ${hint ? `<p class="vf-hint">${escapeHtml(hint)}</p>` : ''}</div>`;
  const box = slot.querySelector('.vf-box');
  const c = document.createElement('canvas');
  c.width = Math.round(W * scale); c.height = Math.round(H * scale);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  c.setAttribute('role', 'img'); c.setAttribute('aria-label', 'Photo of ' + sh.name);
  box.appendChild(c);
  if (o.plain && !adjust) return;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
  const mk = (cls) => { const e = document.createElementNS(ns, cls === 'vf-poly' ? 'polygon' : 'path'); e.setAttribute('class', cls); svg.appendChild(e); return e; };
  const poly = mk('vf-poly'), halo = mk('br-halo'), br = mk('br');
  box.appendChild(svg);
  const place = () => {
    const P = sh.corners;
    poly.setAttribute('points', P.map((p) => `${p.x},${p.y}`).join(' '));
    let d = '';
    for (let n = 0; n < 4; n++) {
      const a = P[(n + 3) % 4], b = P[n], z = P[(n + 1) % 4];
      const la = Math.hypot(a.x - b.x, a.y - b.y) || 1, lz = Math.hypot(z.x - b.x, z.y - b.y) || 1, L = 0.12 * Math.min(la, lz);
      d += `M${b.x + (a.x - b.x) / la * L} ${b.y + (a.y - b.y) / la * L}L${b.x} ${b.y}L${b.x + (z.x - b.x) / lz * L} ${b.y + (z.y - b.y) / lz * L}`;
    }
    halo.setAttribute('d', d); br.setAttribute('d', d);
    if (hs) hs.forEach((h, idx) => { h.style.left = (P[idx].x / W * 100) + '%'; h.style.top = (P[idx].y / H * 100) + '%'; });
  };
  let hs = null;
  if (adjust) {
    const names = ['top left', 'top right', 'bottom right', 'bottom left'];
    hs = sh.corners.map((p, idx) => {
      const h = document.createElement('div'); h.className = 'h'; h.tabIndex = 0; h.setAttribute('role', 'slider'); h.setAttribute('aria-label', 'Corner ' + names[idx]);
      box.appendChild(h); return h;
    });
  }
  place();
  if (!hs) return;
  hs.forEach((h, idx) => {
    let drag = false;
    h.addEventListener('pointerdown', (e) => { drag = true; h.setPointerCapture(e.pointerId); e.preventDefault(); });
    h.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const r = box.getBoundingClientRect();
      sh.corners[idx] = { x: Math.max(0, Math.min(W, (e.clientX - r.left) / r.width * W)), y: Math.max(0, Math.min(H, (e.clientY - r.top) / r.height * H)) };
      place();
    });
    const end = () => { drag = false; };
    h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
    h.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]; if (!d) return;
      e.preventDefault(); const st = e.shiftKey ? 20 : 4;
      sh.corners[idx] = { x: Math.max(0, Math.min(W, sh.corners[idx].x + d[0] * st)), y: Math.max(0, Math.min(H, sh.corners[idx].y + d[1] * st)) };
      place();
    });
  });
}
async function reread(sh) {
  busy('Re-reading sheet'); await tick();
  try {
    const res = await readSheetWithCorners(sh.src, sh.corners, { marginCrops: true });
    if (res.ok) {
      sh.res = res; sh.photoUrl = null; sh.sheetUrl = null; sh.err = null; sh.warnings = res.warnings || [];
      S.adjust = false;
      toast('Re-read done.');
    }
    else { sh.err = (res.warnings && res.warnings[0]) || 'Read failed. Adjust corners.'; }
  } catch (e) { sh.err = 'Read failed: ' + e.message; }
  busy(); save(); rerender();
}

// ---------- review ----------
function chipHtml(sh, i, f, rs) {
  const fi = fieldInfo(sh, i, f), res = rs.fleeces[i];
  const graded = !!(res && res.graded);
  const off = graded && res.fields[f] ? res.fields[f].off : 0;
  const on = !!(S.edit && S.edit.row === i && S.edit.field === f);
  let main, sub = '', cls = 'cell', state;
  if (fi.student != null) main = f === 'yield' ? String(fi.student) : SHORT[f][fi.student];
  else if (fi.need) main = fi.status === 'blank' ? 'Blank' : 'Unsure';
  else main = fi.confirmed || fi.keyed ? 'Blank' : '-';
  if (fi.need) { cls += ' is-need'; sub = 'confirm'; state = 'needs a look'; }
  else if (fi.audit) { cls += ' is-audit'; sub = 'slash ' + label(f, fi.slash); state = 'grader slash disagrees with the key'; }
  else if (graded && fi.keyed && off > 0) { cls += ' is-miss'; sub = 'key ' + label(f, fi.key); state = `${off} points off, key ${longLabel(f, fi.key)}`; }
  else if (!fi.keyed) { cls += ' is-off'; state = 'no key'; }
  else state = 'matches the key';
  if (on) cls += ' is-on';
  const said = fi.student != null ? longLabel(f, fi.student) : main;
  return `<button type="button" class="${cls}" data-act="edit" data-row="${i}" data-field="${f}"${on ? ' aria-current="true"' : ''} aria-label="Fleece ${i + 1} ${escapeHtml(FIELD_NAMES[f])}, ${escapeHtml(said)}, ${escapeHtml(state)}">${escapeHtml(main)}${sub ? `<i>${escapeHtml(sub)}</i>` : ''}</button>`;
}
function edStatus(fi, f) {
  if (fi.need) return fi.status === 'multiple' ? 'Two marks read' : fi.status === 'unsure' ? 'Faint read' : 'No mark read';
  if (fi.audit) return `Grader slash says ${label(f, fi.slash)}`;
  if (fi.confirmed) return 'Confirmed';
  return fi.student == null ? 'Blank' : 'Read cleanly';
}
function optRow(sh, i, f, v, fi) {
  const isS = fi.student === v, isK = fi.keyed && fi.key === v;
  const off = fi.keyed ? scoreField(f, v, fi.key).off : 0;
  let m = '';
  if (isK) m = `Official key, 0 points${ic('check')}`;
  else if (isS) m = `${fi.keyed ? '-' + off + ' points' : 'Selected'}${ic('check')}`;
  else if (fi.cands.includes(v)) m = 'Scan saw a mark';
  return `<button type="button" class="pk pk--b${isK ? ' is-key' : ''}" data-act="set" data-row="${i}" data-field="${f}" data-val="${v}" aria-pressed="${isS}"><span class="pk-v">${escapeHtml(longLabel(f, v))}</span><span class="pk-m">${m}</span></button>`;
}
function editorHtml(sh, i, f) {
  const fi = fieldInfo(sh, i, f), flags = flagList(sh);
  let body;
  if (f === 'yield') {
    body = `<div class="ed-y"><label class="fld"><span class="lab">${fi.keyed ? 'Yield, official key ' + escapeHtml(fi.key) : 'Yield, 0 to 99'}</span><input type="number" inputmode="numeric" min="0" max="99" step="1" id="ed-yield" value="${fi.student == null ? '' : fi.student}"></label>
      <button type="button" class="ibtn" data-act="set-yield" data-row="${i}">Set yield</button></div>
      ${sh.res.marginCrops ? `<div class="ed-crop"><span class="lab">Written on the sheet</span><span data-crop="${i}"></span></div>` : ''}`;
  } else {
    const blankOn = fi.confirmed && fi.student == null;
    const bOff = fi.keyed ? scoreField(f, null, fi.key).off : 0;
    body = `<div class="pick pick-fade" role="group" aria-label="Correct ${escapeHtml(FIELD_NAMES[f])} for fleece ${i + 1}">${LONG[f].map((_, v) => optRow(sh, i, f, v, fi)).join('')}
      <button type="button" class="pk pk--b" data-act="set" data-row="${i}" data-field="${f}" data-val="blank" aria-pressed="${blankOn}"><span class="pk-v">Blank</span><span class="pk-m">${blankOn ? `${fi.keyed ? '-' + bOff + ' points' : 'Selected'}${ic('check')}` : ''}</span></button></div>`;
  }
  const hasCorr = corrOf(sh, i, f) !== undefined;
  const links = `<div class="links">${f === 'yield' ? `<button type="button" data-act="set" data-row="${i}" data-field="yield" data-val="blank">Blank</button>` : ''}${hasCorr ? `<button type="button" data-act="unset" data-row="${i}" data-field="${f}">Use scan read</button>` : ''}<button type="button" data-act="close-edit">Close</button></div>`;
  const cta = flags.length ? ctaHtml(fi.need ? 'Confirm, next flag' : 'Next flag', `${flags.length} flagged`, 'confirm-next') : ctaHtml('See results', '', 'goto-results');
  return `<div class="ed-h"><b>Fleece ${i + 1}, ${escapeHtml(FIELD_NAMES[f])}</b><span>${escapeHtml(edStatus(fi, f))}</span></div>${body}${cta}${links}`;
}
function reviewSheetHtml(sh) {
  if (S.edit && S.edit.row < S.n) return editorHtml(sh, S.edit.row, S.edit.field);
  const flags = flagList(sh);
  return `<div class="ed-h"><b>${flags.length ? 'Check your sheet' : 'Nothing flagged'}</b><span>${escapeHtml(plural(flags.length, 'flag') + ' to check')}</span></div>
    <p class="empty">${flags.length ? 'Tap a mark on the photo or a row in the list to check it.' : 'Every mark read cleanly. Tap any row to change an answer.'}</p>
    ${flags.length ? ctaHtml('Next flag', `${flags.length} flagged`, 'next-flag') : ctaHtml('See results', '', 'goto-results')}`;
}

// The photo is a window onto the rows around the active fleece, in the columns of the active field.
const GROUPS = [['grade', 'grade'], ['length', 'length'], ['yieldTens', 'yield'], ['yieldOnes', 'yield'], ['purity', 'purity'], ['character', 'character']];
function photoUrl(sh) {
  if (!sh.photoUrl) {
    const v = sh.res.view, c = document.createElement('canvas');
    c.width = Math.round(v.x1 - v.x0); c.height = Math.round(v.y1 - v.y0);
    c.getContext('2d').drawImage(sh.res.warpedCanvas, -v.x0, -v.y0);
    sh.photoUrl = c.toDataURL('image/jpeg', 0.85);
  }
  return sh.photoUrl;
}
function effIdx(sh, r, gname) {
  if (gname === 'yieldTens' || gname === 'yieldOnes') {
    const fi = fieldInfo(sh, r, 'yield');
    if (fi.confirmed) return fi.student == null ? null : gname === 'yieldTens' ? Math.floor(fi.student / 10) : fi.student % 10;
    const rd = readOf(sh, r, gname);
    return rd && rd.status === 'ok' && Number.isInteger(rd.value) ? rd.value : null;
  }
  return fieldInfo(sh, r, gname).student;
}
function keyIdx(r, gname) {
  if (r >= S.n) return null;
  const k = S.key[r];
  if (gname === 'yieldTens' || gname === 'yieldOnes') return Number.isInteger(k.yield) ? (gname === 'yieldTens' ? Math.floor(k.yield / 10) : k.yield % 10) : null;
  return Number.isInteger(k[gname]) ? k[gname] : null;
}
function markShapes(sh, r, gn, f, bs) {
  const rd = readOf(sh, r, gn), fi = fieldInfo(sh, r, f), si = effIdx(sh, r, gn), ki = keyIdx(r, gn);
  const el = (cls, b, pad, k = 1) => `<ellipse class="${cls}" cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" rx="${(b.rx * k + pad).toFixed(1)}" ry="${(b.ry * k + pad).toFixed(1)}"/>`;
  let out = '';
  if (ki != null && bs[ki]) out += el(ki === si ? 'ph-ring ph-ring--ok' : 'ph-ring ph-ring--key', bs[ki], 4);
  if (si != null && bs[si]) out += el('ph-dot', bs[si], 0, 0.7);
  if (rd && !fi.confirmed && rd.status !== 'ok' && fi.keyed) rd.fill.forEach((x, n) => { if (x >= 0.3 && bs[n]) out += el('ph-unsure', bs[n], 2); });
  return out;
}
function photoHtml(sh) {
  const res = sh.res, g = res.geometry, vw = res.view;
  let row = 0, field = 'grade';
  if (S.edit && S.edit.row < S.n) { row = S.edit.row; field = S.edit.field; } else { const ff = firstFlag(sh); if (ff) { row = ff.row; field = ff.field; } }
  const zone = field === 'yield' ? 'B' : field === 'purity' || field === 'character' ? 'C' : 'A';
  const ext = (gn) => { let lo = Infinity, hi = -Infinity; for (let r = 0; r < 20; r++) for (const b of g[r][gn]) { lo = Math.min(lo, b.x - b.rx); hi = Math.max(hi, b.x + b.rx); } return [lo, hi]; };
  let x0, x1;
  if (zone === 'A') { x0 = vw.x0; x1 = ext('length')[1] + 34; }
  else if (zone === 'B') { x0 = ext('yieldTens')[0] - 36; x1 = ext('yieldOnes')[1] + 36; }
  else { x0 = ext('yieldOnes')[0] - 12; x1 = vw.x1; }
  x0 = Math.max(vw.x0, x0); x1 = Math.min(vw.x1, x1);
  const rowY = (r) => { let s = 0, n = 0; for (const gn of ['grade', 'length', 'purity', 'character']) for (const b of g[r][gn]) { s += b.y; n++; } return s / n; };
  const pitch = (rowY(19) - rowY(0)) / 19;
  const top = (r) => rowY(r) - 0.8 * pitch, bot = (r) => rowY(r) + 0.24 * pitch;
  const N = wideMq.matches ? 7 : 5;
  const r0 = Math.max(0, Math.min(20 - N, row - (N >> 1))), r1 = r0 + N - 1;
  const y0 = top(r0), y1 = bot(r1), w = x1 - x0, h = y1 - y0;
  const px = (x) => ((x - x0) / w * 100).toFixed(3), py = (y) => ((y - y0) / h * 100).toFixed(3);
  const inX = (b) => b.x >= x0 && b.x <= x1;
  let shapes = `<image href="${escapeHtml(photoUrl(sh))}" x="${vw.x0}" y="${vw.y0}" width="${vw.x1 - vw.x0}" height="${vw.y1 - vw.y0}" preserveAspectRatio="none"/>`;
  let html = '', nums = '', tags = '';
  const tagFor = (cx, ymin, text, cls, r, f) => {
    const tw = Math.max(44, Math.round(text.length * 7.4 + 20));
    return `<button type="button" class="ph-tag${cls}" data-act="edit" data-row="${r}" data-field="${f}" style="left:clamp(calc(${tw}px / 2 + ${zone === 'A' ? 0 : 34}px), ${px(cx)}%, calc(100% - ${tw}px / 2));top:max(calc(${py(ymin)}% - 4px), 44px)"><span>${escapeHtml(text)}</span></button>`;
  };
  for (let r = r0; r <= r1; r++) {
    if (S.edit && S.edit.row === r) shapes += `<rect class="ph-band" x="${x0}" y="${top(r)}" width="${w}" height="${pitch}"/>`;
    const fieldsSeen = {};
    for (const [gn, f] of GROUPS) {
      const bs = g[r][gn];
      if (!bs.length || !bs.some(inX)) continue;
      const fi = fieldInfo(sh, r, f), ki = keyIdx(r, gn);
      shapes += markShapes(sh, r, gn, f, bs);
      const fs = fieldsSeen[f] = fieldsSeen[f] || { fi, xs: [], ymin: Infinity, ki: [], si: [], bs: [] };
      for (const b of bs) if (inX(b)) { fs.xs.push(b.x); fs.ymin = Math.min(fs.ymin, b.y - b.ry); }
      if (ki != null && bs[ki]) fs.ki.push(bs[ki]);
    }
    for (const f of Object.keys(fieldsSeen)) {
      const fs = fieldsSeen[f], fi = fs.fi, cx = fs.xs.reduce((a, b) => a + b, 0) / fs.xs.length;
      if (fi.need) tags += tagFor(cx, fs.ymin, fi.status === 'blank' ? 'Blank, tap to fix' : 'Unsure, tap to fix', '', r, f);
      else if (fi.audit) tags += tagFor(cx, fs.ymin, 'Slash differs, tap', '', r, f);
      else if (fi.keyed && fi.student != null && fi.student !== fi.key) tags += tagFor(fs.ki.length ? fs.ki[0].x : cx, fs.ymin, 'key ' + label(f, fi.key), ' ph-tag--key', r, f);
    }
    html += `<button type="button" class="ph-hit${S.edit && S.edit.row === r ? ' is-on' : ''}" data-act="focus-row" data-row="${r}" style="top:${py(top(r))}%;height:${(pitch / h * 100).toFixed(3)}%" aria-label="Fleece ${r + 1}"></button>`;
    if (zone !== 'A') nums += `<span class="ph-n" style="top:${py(rowY(r) - 0.3 * pitch)}%">${r + 1}</span>`;
  }
  const where = zone === 'A' ? 'grade and length' : zone === 'B' ? 'yield' : 'yield ones, purity and character';
  const cap = `Fleeces ${r0 + 1} to ${r1 + 1}, ${where}`;
  return { html: `<div id="ovslot" class="ph" style="--ar:${(w / h).toFixed(4)}" role="group" aria-label="Scan photo. ${escapeHtml(cap)}"><svg viewBox="${x0.toFixed(1)} ${y0.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}" preserveAspectRatio="none" aria-hidden="true" focusable="false">${shapes}</svg>${html}${nums}${tags}<button type="button" class="ph-full" data-act="sheet-view">${ic('corners')}Whole sheet</button></div>`, cap };
}
const legendHtml = (cap) => `<div class="legend" aria-hidden="true">
  <span class="lg-cap">${escapeHtml(cap)}</span>
  <span><svg viewBox="0 0 18 14"><ellipse class="lg-dot" cx="9" cy="7" rx="6" ry="4.5"/></svg>Scan read</span>
  <span><svg viewBox="0 0 18 14"><ellipse class="lg-key" cx="9" cy="7" rx="7.5" ry="5.5"/></svg>Official key</span>
  <span><svg viewBox="0 0 18 14"><ellipse class="lg-ok" cx="9" cy="7" rx="7.5" ry="5.5"/></svg>Matches key</span>
  <span><svg viewBox="0 0 18 14"><rect class="lg-warn" x="1" y="2" width="16" height="10" rx="2"/></svg>Needs a look</span></div>`;
// The whole scanned page with every read mark on it, in a full-screen view you can zoom and pan.
const ZOOMS = [1, 1.6, 2.5, 4];
function sheetUrl(sh) {
  if (!sh.sheetUrl) sh.sheetUrl = sh.res.warpedCanvas.toDataURL('image/jpeg', 0.8);
  return sh.sheetUrl;
}
function sheetViewHtml(sh) {
  const g = sh.res.geometry, W = sh.res.warpedCanvas.width, H = sh.res.warpedCanvas.height;
  const rowY = (r) => { let s = 0, n = 0; for (const gn of ['grade', 'length', 'purity', 'character']) for (const b of g[r][gn]) { s += b.y; n++; } return s / n; };
  const pitch = (rowY(19) - rowY(0)) / 19;
  let shapes = `<image href="${escapeHtml(sheetUrl(sh))}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>`, flags = '', nflag = 0;
  for (let r = 0; r < 20; r++) {
    if (S.edit && S.edit.row === r) shapes += `<rect class="ph-band" x="0" y="${(rowY(r) - 0.5 * pitch).toFixed(1)}" width="${W}" height="${pitch.toFixed(1)}"/>`;
    const box = {};
    for (const [gn, f] of GROUPS) {
      const bs = g[r][gn]; if (!bs.length) continue;
      shapes += markShapes(sh, r, gn, f, bs);
      const q = box[f] = box[f] || [Infinity, Infinity, -Infinity, -Infinity];
      for (const b of bs) { q[0] = Math.min(q[0], b.x - b.rx); q[1] = Math.min(q[1], b.y - b.ry); q[2] = Math.max(q[2], b.x + b.rx); q[3] = Math.max(q[3], b.y + b.ry); }
    }
    for (const f of Object.keys(box)) {
      const fi = fieldInfo(sh, r, f); if (!fi.need && !fi.audit) continue;
      const q = box[f], pad = 5; nflag++;
      const why = fi.need ? (fi.status === 'blank' ? 'blank' : 'unsure') : 'slash differs';
      flags += `<button type="button" class="sv-flag" data-act="sv-edit" data-row="${r}" data-field="${f}" aria-label="Fleece ${r + 1} ${escapeHtml(FIELD_NAMES[f])}, ${why}. Fix it" style="left:${((q[0] - pad) / W * 100).toFixed(3)}%;top:${((q[1] - pad) / H * 100).toFixed(3)}%;width:${((q[2] - q[0] + 2 * pad) / W * 100).toFixed(3)}%;height:${((q[3] - q[1] + 2 * pad) / H * 100).toFixed(3)}%"></button>`;
    }
  }
  const z = ZOOMS[S.svZoom];
  const hint = nflag ? `${plural(nflag, 'mark')} to check. Tap an amber box to fix it.` : 'Every mark read cleanly.';
  return `<div class="sv-bar"><div class="sv-h"><h2 class="sv-t" id="sv-t">Whole sheet</h2><p class="mut">${escapeHtml(sh.name)}. ${hint}</p></div>
    <div class="sv-z" role="group" aria-label="Zoom"><button type="button" data-act="sv-zoom" data-d="-1" aria-label="Zoom out"${S.svZoom === 0 ? ' disabled' : ''}>${ic('minus')}</button><button type="button" data-act="sv-zoom" data-d="1" aria-label="Zoom in"${S.svZoom === ZOOMS.length - 1 ? ' disabled' : ''}>${ic('plus')}</button></div>
    <button type="button" class="sv-x" data-act="sv-close" aria-label="Close whole sheet">${ic('x')}</button></div>
    <div class="sv-scroll" id="sv-scroll" tabindex="0" role="group" aria-label="Scanned sheet with read marks. Scroll to pan."><div class="sv-pan" id="sv-pan" style="--ar:${(W / H).toFixed(4)};--z:${z}"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">${shapes}</svg>${flags}</div></div>
    ${legendHtml('Dot is what the scan read')}`;
}
function openSheetView() {
  const sh = sheetById(S.reviewId), dlg = $('sv'); if (!sh || !sh.res || !dlg) return;
  if (!Number.isInteger(S.svZoom)) S.svZoom = wideMq.matches ? 0 : 1;
  dlg.innerHTML = sheetViewHtml(sh);
  if (!dlg.open) dlg.showModal();
  const sc = $('sv-scroll'), pan = $('sv-pan');
  if (S.edit && S.edit.row < S.n && sc && pan) {
    const y = (S.edit.row + 0.5) / 20 * pan.offsetHeight;
    sc.scrollTop = Math.max(0, y - sc.clientHeight / 2);
  }
}
function svZoom(d) {
  const sc = $('sv-scroll'), pan = $('sv-pan'); if (!sc || !pan) return;
  const next = Math.max(0, Math.min(ZOOMS.length - 1, S.svZoom + d)); if (next === S.svZoom) return;
  const fx = (sc.scrollLeft + sc.clientWidth / 2) / sc.scrollWidth, fy = (sc.scrollTop + sc.clientHeight / 2) / sc.scrollHeight;
  S.svZoom = next; pan.style.setProperty('--z', ZOOMS[next]);
  sc.scrollLeft = fx * sc.scrollWidth - sc.clientWidth / 2; sc.scrollTop = fy * sc.scrollHeight - sc.clientHeight / 2;
  document.querySelectorAll('#sv [data-act="sv-zoom"]').forEach((b) => { b.disabled = (Number(b.dataset.d) < 0 && next === 0) || (Number(b.dataset.d) > 0 && next === ZOOMS.length - 1); });
}
function onSheetViewClick(e) {
  const t = e.target.closest('[data-act]'); if (!t) return;
  if (t.dataset.act === 'sv-close') $('sv').close();
  else if (t.dataset.act === 'sv-zoom') svZoom(Number(t.dataset.d));
  else if (t.dataset.act === 'sv-edit') { S.edit = { row: Number(t.dataset.row), field: t.dataset.field }; $('sv').close(); rerender(); focusPhoto(); }
}
function renderReview() {
  const v = $('view-review'); v.className = 'view';
  if (!S.sheets.length) { v.innerHTML = emptyView('Review', 'No sheets scanned yet.', 'Scan a sheet', 'goto-scan'); return; }
  let sh = sheetById(S.reviewId); if (!sh) { sh = S.sheets[S.sheets.length - 1]; S.reviewId = sh.id; }
  const opts = S.sheets.map((s) => `<option value="${s.id}"${s.id === sh.id ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
  const sel = `<label class="rv-sel"><span class="sr">Sheet</span><select id="rv-sel">${opts}</select>${ic('down')}</label>`;
  if (!sh.res) {
    v.innerHTML = `<div class="stage"><header class="rv-head"><div><h2 class="h2">Review</h2><p class="mut">The photo for ${escapeHtml(sh.name)} is not in memory.</p></div>${sel}</header>
      <p class="empty">Scores are kept. Scan the sheet again to check its marks.</p></div>
      <div class="sheet">${ctaHtml('Scan again', '', 'goto-scan')}</div>`;
    return;
  }
  const rs = resultOf(sh), fl = flagsOf(sh), ph = photoHtml(sh);
  let rows = '';
  for (let i = 0; i < S.n; i++) {
    const infos = ORDER.map((f) => fieldInfo(sh, i, f));
    const need = infos.some((x) => x.need), audit = infos.some((x) => x.audit);
    if (S.onlyFlags && !need && !audit) continue;
    const fr = rs.fleeces[i], keyed = fr && fr.graded;
    rows += `<li class="rw${S.edit && S.edit.row === i ? ' is-on' : ''}" data-fl="${i}" data-act="focus-row" data-row="${i}"><span class="num">${i + 1}</span><span class="rw-c">${ORDER.map((f) => chipHtml(sh, i, f, rs)).join('')}</span><span class="rw-p">${keyed ? `${fr.score}/${fr.max}` : '<small>no key</small>'}</span></li>`;
  }
  v.className = 'view rv';
  v.innerHTML = `
    <div class="rv-main">
      <div class="ph-wrap">${ph.html}${legendHtml(ph.cap)}</div>
      <div class="sheet" id="rv-sheet">${reviewSheetHtml(sh)}</div>
    </div>
    <div class="rv-side">
      <header class="rv-head"><div><h2 class="h2">Review</h2><p class="mut">${rs.score} / ${rs.total}. ${fl.need} to confirm, ${plural(fl.audit, 'grading check')}.</p></div>${sel}</header>
      <div class="rv-bar">
        <button type="button" class="sw" role="switch" data-act="only-flags" aria-checked="${S.onlyFlags}"><span class="sw-t" aria-hidden="true"><i></i></span><span>Show flagged only</span></button>
        <button type="button" class="tbtn" data-act="goto-results">Results${ic('arrow')}</button>
      </div>
      ${(sh.warnings || []).map((w) => `<p class="rv-note">${escapeHtml(w)}</p>`).join('')}
      <ol id="rows" class="rows">${rows || '<li class="empty">Nothing flagged.</li>'}</ol>
    </div>`;
  v.querySelectorAll('[data-crop]').forEach((el) => {
    const cv = sh.res.marginCrops && sh.res.marginCrops[Number(el.dataset.crop)];
    if (cv) { const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; c.getContext('2d').drawImage(cv, 0, 0); c.setAttribute('role', 'img'); c.setAttribute('aria-label', 'Handwritten yield, fleece ' + (Number(el.dataset.crop) + 1)); el.appendChild(c); }
  });
  const on = v.querySelector('#rv-sheet .pick [aria-pressed="true"]'), pk = on && on.parentElement;
  if (pk && on.offsetTop + on.offsetHeight > pk.clientHeight - 24) pk.scrollTop = Math.max(0, Math.floor((on.offsetTop - pk.clientHeight / 3) / on.offsetHeight) * on.offsetHeight);
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
  if (!S.sheets.length) { v.innerHTML = emptyView('Results', 'No sheets scanned yet.', 'Scan a sheet', 'goto-scan'); return; }
  const sh = sheetById(S.resultId) || S.sheets[S.sheets.length - 1]; S.resultId = sh.id;
  const rs = resultOf(sh), fl = flagsOf(sh);
  const keyed = sheetKey().filter(keyHas).length;
  const offs = Array.from({ length: S.n }, (_, i) => (rs.fleeces[i] && rs.fleeces[i].graded ? rs.fleeces[i].off : null));
  const most = Math.max(0, ...offs.map((x) => x || 0));
  const worst = offs.map((x, i) => (x === most && most > 0 ? i + 1 : 0)).filter(Boolean);
  const barsLabel = most ? `Points off by fleece. Fleece ${worst.join(', ')} lost ${plural(most, 'point')}${worst.length > 1 ? ' each' : ''}.` : 'Points off by fleece. No points lost.';
  const bars = offs.map((x) => `<i class="${x === null ? 'n' : x === 0 ? 'z' : ''}" style="--off:${most ? ((x || 0) / most).toFixed(3) : 0}"></i>`).join('');
  const sheetRows = S.sheets.map((s) => {
    const r = resultOf(s), f = flagsOf(s);
    const flags = !f.need && !f.audit ? 'none' : [f.need ? f.need + ' confirm' : '', f.audit ? f.audit + ' check' : ''].filter(Boolean).join(', ');
    return `<li><button type="button" class="sh${s.id === sh.id ? ' is-on' : ''}" data-sheet="${s.id}"${s.id === sh.id ? ' aria-current="true"' : ''}><span class="sh-n">${escapeHtml(s.name)}</span><span class="sh-f">Flags: ${escapeHtml(flags)}</span><span class="sh-s">${r.score} / ${r.total}<small>${r.off} off</small></span></button></li>`;
  }).join('');
  const detail = !S.detail ? '' : `<div class="dtw"><table><thead><tr><th>Fleece</th>${ORDER.map((f) => `<th>${escapeHtml(FIELD_NAMES[f])}</th>`).join('')}<th>Points</th></tr></thead><tbody>${Array.from({ length: S.n }, (_, i) => {
    const fr = rs.fleeces[i];
    if (!fr || !fr.graded) return `<tr><td>${i + 1}</td><td class="m" colspan="6">Not graded</td></tr>`;
    const cell = (f) => (fr.fields[f] && fr.fields[f].max ? (fr.fields[f].off ? '-' + fr.fields[f].off : '0') : '');
    return `<tr><td>${i + 1}</td>${ORDER.map((f) => `<td>${cell(f)}</td>`).join('')}<td>${fr.score}/${fr.max}</td></tr>`;
  }).join('')}</tbody></table></div>`;
  v.innerHTML = `
    <div class="stage">
      <div class="res-stage">
        <p class="who">${escapeHtml(S.name || 'Untitled session')}, ${plural(keyed, 'fleece')} keyed. ${escapeHtml(sh.name)}</p>
        <p class="big num">${rs.score}<small> / ${rs.total}</small></p>
        <p class="offs">${plural(rs.off, 'point')} off</p>
        <p class="bars-l"><span>Points off, fleece 1 to ${S.n}</span><span>Most off: ${most}</span></p>
        <div class="bars" role="img" aria-label="${escapeHtml(barsLabel)}">${bars}</div>
      </div>
      <button type="button" class="dt" data-act="toggle-detail" aria-expanded="${S.detail}">Fleece by fleece${ic('down')}</button>
      ${detail}
      ${keyed ? '' : '<button type="button" class="nt" data-act="goto-session"><span class="nt-r"><span>No official key entered. Set the key in Session.</span><b>Session</b></span></button>'}
      ${fl.need ? `<button type="button" class="nt" data-act="review" data-id="${sh.id}"><span class="nt-r"><span>${plural(fl.need, 'answer')} still need confirming in Review. Unconfirmed reads count as blank.</span><b>Review</b></span></button>` : ''}
      ${fl.audit ? `<p class="nt">${plural(fl.audit, 'field')} where the grader slash disagrees with the key.</p>` : ''}
    </div>
    <div class="sheet">
      <p class="rs-h">All sheets</p>
      <ol>${sheetRows}</ol>
      <div id="csv-slot"></div>
    </div>`;
  if (csvUrl) { try { URL.revokeObjectURL(csvUrl); } catch (e) { /* ignore */ } }
  csvUrl = URL.createObjectURL(new Blob([buildCsv()], { type: 'text/csv' }));
  const a = document.createElement('a'); a.className = 'cta'; a.href = csvUrl;
  a.download = (S.name || 'fleece-grader').replace(/[^\w-]+/g, '_') + '.csv';
  a.innerHTML = `<span>Download CSV</span><span class="cta-s">${escapeHtml(plural(S.sheets.length, 'sheet'))} ${ic('arrow')}</span>`;
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
function focusPhoto() { if (!wideMq.matches) scrollTo($('ovslot'), 'nearest'); }
function setCorr(sh, row, field, val) { sh.corr[row] = sh.corr[row] || {}; sh.corr[row][field] = val; }

function onClick(e) {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act, row = Number(t.dataset.row), f = t.dataset.field;
  switch (act) {
    case 'key': {
      const val = Number(t.dataset.val), k = S.key[row];
      // Tapping an auto value confirms it instead of clearing it.
      const confirmAuto = AUTOF.includes(f) && S.auto[row][f] && k[f] === val;
      if (lowOf(row, f) && k[f] === val) { ackKeySrc(row, f); refreshKeyRow(row); break; } // same for a scanned guess
      k[f] = k[f] === val && !confirmAuto ? null : val;
      delete S.keySrc[row][f];
      if (AUTOF.includes(f)) S.auto[row][f] = false; else if (k[f] != null) autofillPC(row);
      refreshKeyRow(row); save(); break;
    }
    case 'key-open': {
      const k = S.key[row], first = CORE.find((x) => k[x] == null), kf = e.target.closest('[data-kf]'), tf = kf ? kf.dataset.kf : null;
      if (tf) ackKeySrc(row, tf); // tapping a value itself opens that field and clears its check mark
      setKeyActive(row, tf || (row === S.kRow ? S.kField : (first || 'grade')), true); break;
    }
    case 'all-pick': S.all[f] = Number(t.dataset.val); t.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === t))); break;
    case 'all-apply': applySetAll(); break;
    case 'key-tab': ackKeySrc(row, f); setKeyActive(row, f, false); break;
    case 'ks-mode': ksMode(t.dataset.val); break;
    case 'ks-corners': if (S.ks) { S.ks.adjust = !S.ks.adjust; renderKeyScan(); } break;
    case 'ks-reread': ksReread(); break;
    case 'ks-fix': setKeyActive(row, 'yield', true); break;
    case 'ks-close': S.ks = null; renderKeyScan(); break;
    case 'key-next': {
      const ns = nextStep();
      if (ns) setKeyActive(ns.row, ns.field, ns.row !== S.kRow); else setTab('scan');
      break;
    }
    case 'n-dec': setN(S.n - 1); break;
    case 'n-inc': setN(S.n + 1); break;
    case 'scan-key': inputs['f-key'].click(); break;
    case 'clear-key': S.key = Array.from({ length: 20 }, emptyFleece); S.auto = Array.from({ length: 20 }, emptyAuto); S.keySrc = Array.from({ length: 20 }, () => ({})); S.ks = null; S.kRow = 0; S.kField = 'grade'; save(); renderSession(); break;
    case 'goto-scan': setTab('scan'); break;
    case 'goto-results': setTab('results'); break;
    case 'goto-session': setTab('session'); break;
    case 'pick-cam': inputs['f-cam'].click(); break;
    case 'pick-up': inputs['f-up'].click(); break;
    case 'select-sheet': S.cornerId = Number(t.dataset.id); S.adjust = false; rerender(); break;
    case 'corners': S.cornerId = Number(t.dataset.id); S.adjust = !S.adjust; rerender(); break;
    case 'reread': { const sh = sheetById(Number(t.dataset.id)); if (sh && sh.src) reread(sh); break; }
    case 'review': openReview(Number(t.dataset.id)); break;
    case 'remove': {
      const id = Number(t.dataset.id); S.sheets = S.sheets.filter((s) => s.id !== id);
      if (S.cornerId === id) { S.cornerId = null; S.adjust = false; }
      if (S.reviewId === id) S.reviewId = null;
      save(); rerender(); break;
    }
    case 'only-flags': S.onlyFlags = !S.onlyFlags; rerender(); break;
    case 'edit': S.edit = { row, field: f }; rerender(); focusPhoto(); break;
    case 'focus-row': {
      const sh = sheetById(S.reviewId); if (!sh) break;
      const hit = ORDER.find((x) => { const fi = fieldInfo(sh, row, x); return fi.need || fi.audit; });
      const cur = S.edit && S.edit.row === row ? S.edit.field : null;
      S.edit = { row, field: cur || hit || (S.edit ? S.edit.field : 'grade') }; rerender(); focusPhoto(); break;
    }
    case 'close-edit': S.edit = null; rerender(); break;
    case 'next-flag': case 'confirm-next': {
      const sh = sheetById(S.reviewId); if (!sh) break;
      const cur = S.edit;
      if (act === 'confirm-next' && cur) {
        const fi = fieldInfo(sh, cur.row, cur.field);
        if (fi.need) setCorr(sh, cur.row, cur.field, fi.student);
        save();
      }
      const nx = cur ? nextFlag(sh, cur) : firstFlag(sh);
      if (nx) S.edit = nx;
      rerender(); focusPhoto(); break;
    }
    case 'set': case 'unset': case 'set-yield': {
      const sh = sheetById(S.reviewId); if (!sh) break;
      const field = act === 'set-yield' ? 'yield' : f;
      if (act === 'unset') { if (sh.corr[row]) delete sh.corr[row][field]; }
      else if (act === 'set-yield') {
        const raw = $('ed-yield').value.trim(), n = Number(raw);
        if (raw === '' || !Number.isInteger(n) || n < 0 || n > 99) { toast('Enter a whole number 0-99, or tap Blank.'); break; }
        setCorr(sh, row, 'yield', n);
      } else setCorr(sh, row, field, t.dataset.val === 'blank' ? null : Number(t.dataset.val));
      S.edit = { row, field }; save(); rerender(); break;
    }
    case 'sheet-view': openSheetView(); break;
    case 'toggle-detail': S.detail = !S.detail; rerender(); break;
    default: break;
  }
}
function tabKeys(e) {
  const t = e.target.closest && e.target.closest('[role="tab"]'); if (!t) return;
  const tabs = Array.from(t.parentElement.querySelectorAll('[role="tab"]')); let i = tabs.indexOf(t);
  if (e.key === 'ArrowRight') i = (i + 1) % tabs.length; else if (e.key === 'ArrowLeft') i = (i + tabs.length - 1) % tabs.length;
  else if (e.key === 'Home') i = 0; else if (e.key === 'End') i = tabs.length - 1; else return;
  e.preventDefault(); tabs[i].click();
  const again = t.parentElement.querySelector('[role="tab"][aria-selected="true"]'); if (again) again.focus();
}

// ---------- install hint and offline worker ----------
const A2HS_KEY = 'fg-a2hs-v1';
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIosSafari = () => {
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua);
};
function setupInstall() {
  const box = $('a2hs'), sub = $('a2hs-s'), go = $('a2hs-install'), no = $('a2hs-no');
  if (!box || isStandalone() || lsGet(A2HS_KEY)) return;
  let deferred = null;
  const hide = (remember) => { box.hidden = true; deferred = null; if (remember) lsSet(A2HS_KEY, 'done'); };
  no.addEventListener('click', () => hide(true));
  go.addEventListener('click', async () => {
    if (!deferred) return;
    const ev = deferred; deferred = null;
    try { ev.prompt(); await ev.userChoice; } catch (e) { /* ignore */ }
    hide(true);
  });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferred = e;
    sub.textContent = 'Opens like an app and works with no signal.';
    go.hidden = false; box.hidden = false;
  });
  window.addEventListener('appinstalled', () => hide(true));
  if (isIosSafari()) {
    sub.textContent = 'Tap the Share button in Safari, then choose Add to Home Screen. It then works with no signal.';
    go.hidden = true; box.hidden = false;
  }
}
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (local && new URLSearchParams(location.search).get('sw') !== '1') return;
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => { /* offline mode is optional */ }); });
}

function init() {
  load();
  S.kRow = firstIncomplete();
  makeInput('f-cam', true, false); makeInput('f-up', false, true); makeInput('f-key', false, false);
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) setTab(b.dataset.tab); });
  $('tabs').addEventListener('keydown', tabKeys);
  const main = $('main');
  main.addEventListener('click', (e) => {
    const tr = e.target.closest('[data-sheet]');
    if (tr && S.tab === 'results') { S.resultId = Number(tr.dataset.sheet); rerender(); return; }
    onClick(e);
  });
  main.addEventListener('keydown', (e) => {
    tabKeys(e);
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.act === 'key-yield') { e.preventDefault(); onClick({ target: $('key-sheet').querySelector('[data-act="key-next"]') }); }
  });
  main.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 's-name') { S.name = t.value; save(); }
    else if (t.dataset.act === 'key-yield') {
      const raw = t.value.trim(), n = Number(raw), row = Number(t.dataset.row);
      S.key[row].yield = raw !== '' && Number.isInteger(n) && n >= 0 && n <= 99 ? n : null;
      delete S.keySrc[row].yield;
      if (S.key[row].yield != null) autofillPC(row);
      save(); refreshKeyRow(row, false);
    } else if (t.dataset.act === 'name') { const sh = sheetById(Number(t.dataset.id)); if (sh) { sh.name = t.value; save(); } }
  });
  main.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 's-n') setN(t.value);
    else if (t.id === 'rv-sel') { const sh = sheetById(Number(t.value)); S.reviewId = Number(t.value); S.edit = sh && sh.res ? firstFlag(sh) : null; rerender(); }
  });
  $('sv').addEventListener('click', onSheetViewClick);
  wideMq.addEventListener('change', () => { if (S.tab === 'review') rerender(); });
  setTab('session');
  setupInstall();
  registerSW();
}
init();
