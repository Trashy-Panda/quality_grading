// Slash consensus across a stack of sheets, plus grading-error audit. See SPEC.md.
// Also the official-key scan: what kind of key photo it is and which reading fills each field.
// Fleece indexes are 0-based.

import { fieldFromRead, yieldFromDigits } from './scoring.js';

const SIMPLE = ['grade', 'length', 'purity', 'character'];
const FIELDS = ['grade', 'length', 'yield', 'purity', 'character'];

function slashOf(read) {
  if (!read || read.slashStatus !== 'ok') return null;
  return Number.isInteger(read.slash) ? read.slash : null;
}

// Plurality vote; a tie for first place gives value null and tie true.
function vote(values) {
  const counts = new Map();
  for (const v of values) if (v != null) counts.set(v, (counts.get(v) || 0) + 1);
  const votes = values.filter((v) => v != null).length;
  if (!votes) return { value: null, votes: 0, agreeing: 0, tie: false };
  const top = Math.max(...counts.values());
  const winners = [...counts.keys()].filter((v) => counts.get(v) === top);
  if (winners.length > 1) return { value: null, votes, agreeing: top, tie: true };
  return { value: winners[0], votes, agreeing: top, tie: false };
}

export function buildKeyFromSlashes(sheetReads) {
  const sheets = sheetReads || [];
  const n = sheets.reduce((m, s) => Math.max(m, s.length), 0) || 20;
  const key = [], confidence = [], missing = [], disagreements = [];

  for (let i = 0; i < n; i++) {
    const kf = {}, cf = {};
    const col = (field) => sheets.map((s) => slashOf(s[i] && s[i][field]));

    for (const f of SIMPLE) {
      const v = vote(col(f));
      kf[f] = v.value;
      cf[f] = { votes: v.votes, agreeing: v.agreeing, tie: v.tie };
      if (!v.votes) missing.push({ fleece: i, field: f });
    }

    const tens = vote(col('yieldTens'));
    const ones = vote(col('yieldOnes'));
    kf.yield = tens.value == null || ones.value == null ? null : tens.value * 10 + ones.value;
    cf.yield = {
      votes: Math.min(tens.votes, ones.votes),
      agreeing: Math.min(tens.agreeing, ones.agreeing),
      tie: tens.tie || ones.tie,
      tens: { votes: tens.votes, agreeing: tens.agreeing, tie: tens.tie },
      ones: { votes: ones.votes, agreeing: ones.agreeing, tie: ones.tie },
    };
    if (!tens.votes || !ones.votes) missing.push({ fleece: i, field: 'yield' });

    // Audit: a sheet whose slash differs from a settled consensus.
    sheets.forEach((s, sheetIndex) => {
      for (const f of SIMPLE) {
        const sl = slashOf(s[i] && s[i][f]);
        if (sl != null && kf[f] != null && sl !== kf[f]) {
          disagreements.push({ sheetIndex, fleece: i, field: f, slashed: sl, consensus: kf[f] });
        }
      }
      const t = slashOf(s[i] && s[i].yieldTens);
      const o = slashOf(s[i] && s[i].yieldOnes);
      if (t != null && o != null && kf.yield != null && t * 10 + o !== kf.yield) {
        disagreements.push({ sheetIndex, fleece: i, field: 'yield', slashed: t * 10 + o, consensus: kf.yield });
      }
    });

    key.push(kf);
    confidence.push(cf);
  }
  return { key, confidence, missing, disagreements };
}

// Manual answers win where non-null; consensus fills the rest.
export function mergeKey(manualKey, consensusKey) {
  const m = manualKey || [], c = consensusKey || [];
  const n = Math.max(m.length, c.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const f = {};
    for (const field of FIELDS) {
      const mv = m[i] ? m[i][field] : null;
      const cv = c[i] ? c[i][field] : null;
      f[field] = mv != null ? mv : cv != null ? cv : null;
    }
    out.push(f);
  }
  return out;
}

// ---------- official-key scan ----------
// One photo of the official key can be a graded student sheet (grader slashes, official yield written in the margin),
// a bubbled key (the official answers filled in) or a handwritten list. These are pure: the browser reads the photo
// (omr.js, digits.js, listkey.js) and hands the reads here.

export const KEY_MODES = ['graded', 'bubbled', 'list'];
const AUTO_FIELDS = ['purity', 'character'];

// A clean grader slash on a bubble, or null.
function cleanSlash(read) {
  return read && read.slashStatus === 'ok' && Number.isInteger(read.slash) ? read.slash : null;
}
function slashedYield(row) {
  const t = cleanSlash(row.yieldTens), o = cleanSlash(row.yieldOnes);
  return t != null && o != null ? t * 10 + o : null;
}

// graded when the table has several slashed rows or several confident margin yields; otherwise it is a bubbled key.
// rows: omr rows; margin: [{value, conf}] per row; confMargin: the confident threshold for a margin read.
export function detectKeyMode(rows, margin, confMargin, min = 3) {
  let slashRows = 0, confMargins = 0;
  (rows || []).forEach((r, i) => {
    if (r && (cleanSlash(r.grade) != null || cleanSlash(r.length) != null)) slashRows++;
    const m = margin && margin[i];
    if (m && m.value != null && m.conf >= confMargin) confMargins++;
  });
  return { mode: slashRows >= min || confMargins >= min ? 'graded' : 'bubbled', slashRows, confMargins };
}

// Build the 20-row key for one reading.
//   data: { rows, margin, tens, ones } for graded/bubbled (margin/tens/ones: per-row digits.js reads), { list } for list.
//   opts: { all: {purity, character} defaults, confMargin, confDigit, confList }.
// Returns { key: [{grade,length,yield,purity,character}], src: [{field: {s, low?}}], auto: [{purity, character}], stats }.
// s = where a value came from: slash | inferred (student's fill, no slash) | fill | margin | written | list.
// low = the value is a guess the user should look at.
export function keyFromScan(mode, data, opts) {
  const o = { all: { purity: 0, character: 1 }, confMargin: 0.99, confDigit: 0.9, confList: 0.5, ...opts };
  const key = [], src = [], auto = [], stats = { filled: 0, low: 0, auto: 0, slash: 0, inferred: 0, margin: 0, written: 0, list: 0, fill: 0 };
  for (let i = 0; i < 20; i++) {
    const k = { grade: null, length: null, yield: null, purity: null, character: null }, s = {}, a = { purity: false, character: false };
    const set = (f, v, from, low) => {
      if (v == null) return;
      k[f] = v; s[f] = low ? { s: from, low: true } : { s: from };
      stats[from]++; if (low) stats.low++;
    };
    const r = (data.rows && data.rows[i]) || {};
    if (mode === 'graded') {
      const m = data.margin && data.margin[i], sy = slashedYield(r);
      // Graders skip the slash when the student is right. So on a row the grader clearly marked (a slash anywhere, or a readable
      // margin yield), a clear student fill with no slash stands quietly ("inferred"). A row with no grader mark at all gives
      // no evidence either way, so its fills are low.
      const marked = ['grade', 'length', 'purity', 'character'].some((f) => cleanSlash(r[f]) != null) || sy != null || !!(m && m.value != null);
      for (const f of ['grade', 'length']) {
        const sl = cleanSlash(r[f]);
        if (sl != null) { set(f, sl, 'slash'); continue; }
        if (r[f] && r[f].slashStatus === 'unsure' && Number.isInteger(r[f].slash)) { set(f, r[f].slash, 'slash', true); continue; } // a faint slash
        const clear = fieldFromRead(r[f]);
        if (clear != null) set(f, clear, 'inferred', !marked || (r[f] && r[f].slashStatus === 'multiple'));
        else if (r[f] && r[f].status === 'unsure' && Number.isInteger(r[f].value)) set(f, r[f].value, 'inferred', true); // the fill itself is unclear
      }
      if (m && m.value != null && m.conf >= o.confMargin) set('yield', m.value, 'margin');
      else if (sy != null) set('yield', sy, 'slash');
      else if (m && m.value != null) set('yield', m.value, 'margin', true);
      else set('yield', yieldFromDigits(fieldFromRead(r.yieldTens), fieldFromRead(r.yieldOnes)), 'inferred', true); // a student's yield is rarely the official one
      for (const f of AUTO_FIELDS) { const sl = cleanSlash(r[f]); if (sl != null) set(f, sl, 'slash'); }
    } else if (mode === 'bubbled') {
      for (const f of ['grade', 'length', 'purity', 'character']) set(f, fieldFromRead(r[f]), 'fill');
      const y = yieldFromDigits(fieldFromRead(r.yieldTens), fieldFromRead(r.yieldOnes));
      if (y != null) set('yield', y, 'fill');
      else {
        const t = data.tens && data.tens[i], n = data.ones && data.ones[i];
        if (t && n && t.digit != null && n.digit != null) set('yield', t.digit * 10 + n.digit, 'written', !(t.conf >= o.confDigit && n.conf >= o.confDigit));
      }
    } else if (mode === 'list') {
      const lr = data.list && data.list.rows && data.list.rows[i];
      if (lr) for (const f of ['grade', 'length', 'yield']) set(f, lr[f], 'list', !(lr.conf && lr.conf[f] >= o.confList));
    }
    if (['grade', 'length', 'yield'].some((f) => k[f] != null)) {
      stats.filled++;
      for (const f of AUTO_FIELDS) if (k[f] == null) { k[f] = o.all[f]; a[f] = true; stats.auto++; }
    }
    key.push(k); src.push(s); auto.push(a);
  }
  return { key, src, auto, stats };
}
