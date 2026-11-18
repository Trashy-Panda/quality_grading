// Saved rails (one wool-judging class each): title, date, official key, scored student sheets.
// Pure data layer, no DOM. Local officials are just rails; one store. Storage is injected
// (default localStorage) so tests can use a fake. Reads are sanitized: stored text is user text.
// A rail record stores key and student answers via keycodec (120 chars each), so 20 sheets stay small.
import { encodeKey, decodeKey, blankFleece, isKeyString, FLEECES } from './keycodec.js';
import { scoreSheet } from './scoring.js';

export const RAILS_STORE = 'fleece-rails-v1';
const MAX_RAILS = 500;
const MAX_SHEETS = 500;
const LIM = { title: 80, tag: 30, notes: 2000, sheetName: 60 };
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const BLANK_KEY = encodeKey([], FLEECES);

// ---------- sanitizers ----------
const text = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const notesText = (v) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, LIM.notes);
const int = (v, lo, hi, dflt) => (Number.isInteger(v) && v >= lo && v <= hi ? v : dflt);
const stamp = (v, dflt) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : dflt);

function todayStr(ms) {
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function dateStr(v, dflt) {
  const m = DATE_RE.exec(typeof v === 'string' ? v : '');
  if (!m) return dflt;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? v : dflt;
}
const idOrNull = (v) => (typeof v === 'string' && ID_RE.test(v) ? v : null);

// auto: 20 chars '0'-'3'; bit 1 = purity autofilled, bit 2 = character autofilled.
function encodeAuto(auto, n) {
  let s = '';
  for (let i = 0; i < FLEECES; i++) {
    const a = i < n && Array.isArray(auto) && auto[i] ? auto[i] : {};
    s += (a.purity === true ? 1 : 0) + (a.character === true ? 2 : 0);
  }
  return s;
}
const cleanAuto = (s) => (typeof s === 'string' && /^[0-3]{20}$/.test(s) ? s : '0'.repeat(FLEECES));
const keyStr = (s) => (isKeyString(s) ? s : BLANK_KEY);
const cleanFlags = (f) => ({ need: int(f && f.need, 0, 99999, 0), audit: int(f && f.audit, 0, 99999, 0) });

function summarize(n, key, sheets) {
  const keyRows = decodeKey(key).slice(0, n);
  const base = scoreSheet([], keyRows);
  const out = { sheets: sheets.length, keyed: base.gradedCount, avg: null, top: null, total: base.total };
  if (!base.gradedCount || !sheets.length) return out;
  let sum = 0;
  for (const sh of sheets) {
    const sc = scoreSheet(decodeKey(sh.a), keyRows).score;
    sum += sc;
    out.top = out.top == null ? sc : Math.max(out.top, sc);
  }
  out.avg = Math.round((sum / sheets.length) * 10) / 10;
  return out;
}

// Rebuild a clean record from anything. Returns null when there is no usable id.
function cleanRec(r, nowMs) {
  if (!r || typeof r !== 'object') return null;
  const id = idOrNull(r.id);
  if (!id) return null;
  const n = int(r.n, 1, FLEECES, FLEECES);
  const key = keyStr(r.key);
  const sheets = (Array.isArray(r.sheets) ? r.sheets : []).slice(0, MAX_SHEETS).map((s) => ({
    name: text(s && s.name, LIM.sheetName),
    a: keyStr(s && s.a),
    flags: cleanFlags(s && s.flags),
  }));
  const createdAt = stamp(r.createdAt, nowMs);
  return {
    id, v: 1,
    title: text(r.title, LIM.title) || 'Untitled class',
    date: dateStr(r.date, todayStr(createdAt)),
    tag: text(r.tag, LIM.tag),
    notes: notesText(r.notes),
    createdAt, updatedAt: stamp(r.updatedAt, createdAt),
    n, key, auto: cleanAuto(r.auto), sheets,
    summary: summarize(n, key, sheets),
    postedId: idOrNull(r.postedId),
  };
}

const lite = (r) => ({
  id: r.id, title: r.title, date: r.date, tag: r.tag, notes: r.notes,
  createdAt: r.createdAt, updatedAt: r.updatedAt, n: r.n,
  summary: r.summary, postedId: r.postedId,
});

function defaultStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; }
}

export function createRails(storage, opts = {}) {
  const store = storage === undefined ? defaultStorage() : storage;
  const clock = typeof opts.now === 'function' ? opts.now : () => Date.now();
  let seq = 0;
  const newId = () => 'r' + clock().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);

  function readAll() {
    if (!store) return [];
    let raw = null;
    try { raw = store.getItem(RAILS_STORE); } catch (e) { return []; }
    if (!raw) return [];
    let d;
    try { d = JSON.parse(raw); } catch (e) { return []; }
    const arr = d && Array.isArray(d.rails) ? d.rails : [];
    const seen = new Set(), out = [];
    for (const r of arr.slice(0, MAX_RAILS)) {
      const c = cleanRec(r, clock());
      if (c && !seen.has(c.id)) { seen.add(c.id); out.push(c); }
    }
    return out;
  }
  function writeAll(list) {
    if (!store) return { ok: false, error: 'storage' };
    try { store.setItem(RAILS_STORE, JSON.stringify({ v: 1, rails: list })); } catch (e) { return { ok: false, error: 'quota' }; }
    return { ok: true };
  }

  function list({ q = '', tag = '', sort = 'new' } = {}) {
    let rows = readAll();
    const t = text(tag, LIM.tag).toLowerCase();
    if (t) rows = rows.filter((r) => r.tag.toLowerCase() === t);
    const needle = text(q, 200).toLowerCase();
    if (needle) {
      rows = rows.filter((r) => [r.title, r.tag, r.notes, r.date].some((s) => s.toLowerCase().includes(needle))
        || r.sheets.some((s) => s.name.toLowerCase().includes(needle)));
    }
    // 'new'/'old' order by class date, ties by creation time.
    const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt);
    if (sort === 'old') rows.sort(byDate);
    else if (sort === 'title') rows.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || byDate(b, a));
    else rows.sort((a, b) => byDate(b, a));
    return rows.map(lite);
  }

  const get = (id) => readAll().find((r) => r.id === id) || null;

  // session: the app.js persisted shape. meta: {title, date, tag, notes, id}. meta.id overwrites that rail.
  function saveFromSession(session, meta = {}) {
    const s = session && typeof session === 'object' ? session : {};
    const m = meta && typeof meta === 'object' ? meta : {};
    const now = clock();
    const n = int(s.n, 1, FLEECES, FLEECES);
    const all = readAll();
    const prev = m.id ? all.find((r) => r.id === m.id) : null;
    const rec = cleanRec({
      id: prev ? prev.id : newId(),
      title: m.title != null ? m.title : (s.name || prev && prev.title),
      date: m.date != null ? m.date : prev && prev.date,
      tag: m.tag != null ? m.tag : prev && prev.tag,
      notes: m.notes != null ? m.notes : prev && prev.notes,
      createdAt: prev ? prev.createdAt : now, updatedAt: now,
      n, key: encodeKey(s.key, n), auto: encodeAuto(s.auto, n),
      sheets: (Array.isArray(s.sheets) ? s.sheets : []).map((sh) => {
        const sv = (sh && sh.saved) || {};
        return { name: sh && sh.name, a: encodeKey(sv.answers || (sh && sh.answers), FLEECES), flags: sv.flags || (sh && sh.flags) };
      }),
      postedId: prev ? prev.postedId : null,
    }, now);
    const next = prev ? all.map((r) => (r.id === prev.id ? rec : r)) : [rec, ...all].slice(0, MAX_RAILS);
    const w = writeAll(next);
    return w.ok ? { ok: true, id: rec.id, rail: rec } : w;
  }

  // patch: title, date, tag, notes, postedId. Anything else is ignored.
  function update(id, patch = {}) {
    const all = readAll();
    const cur = all.find((r) => r.id === id);
    if (!cur) return { ok: false, error: 'notfound' };
    const p = patch && typeof patch === 'object' ? patch : {};
    const rec = cleanRec({
      ...cur,
      title: 'title' in p ? p.title : cur.title,
      date: 'date' in p ? dateStr(p.date, cur.date) : cur.date,
      tag: 'tag' in p ? p.tag : cur.tag,
      notes: 'notes' in p ? p.notes : cur.notes,
      postedId: 'postedId' in p ? p.postedId : cur.postedId,
      updatedAt: clock(),
    }, clock());
    const w = writeAll(all.map((r) => (r.id === id ? rec : r)));
    return w.ok ? { ok: true, id, rail: rec } : w;
  }

  function duplicate(id) {
    const all = readAll();
    const cur = all.find((r) => r.id === id);
    if (!cur) return { ok: false, error: 'notfound' };
    const now = clock();
    const rec = cleanRec({
      ...cur, id: newId(),
      title: text(text(cur.title, LIM.title - 7) + ' (copy)', LIM.title),
      createdAt: now, updatedAt: now, postedId: null,
    }, now);
    const w = writeAll([rec, ...all].slice(0, MAX_RAILS));
    return w.ok ? { ok: true, id: rec.id, rail: rec } : w;
  }

  function remove(id) {
    const all = readAll();
    if (!all.some((r) => r.id === id)) return { ok: false, error: 'notfound' };
    return writeAll(all.filter((r) => r.id !== id));
  }

  // Sorted unique tags in use (case-insensitive, first spelling wins).
  function tags() {
    const seen = new Map();
    for (const r of readAll()) if (r.tag && !seen.has(r.tag.toLowerCase())) seen.set(r.tag.toLowerCase(), r.tag);
    return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  // The app.js session shape, sanitized the way app.js load() does it.
  function toSession(id) {
    const r = get(id);
    if (!r) return null;
    const keyRows = decodeKey(r.key) || [];
    const key = Array.from({ length: FLEECES }, (_, i) => ({ ...blankFleece(), ...(keyRows[i] || {}) }));
    const auto = Array.from({ length: FLEECES }, (_, i) => {
      const bits = Number(r.auto[i]);
      const k = key[i];
      return { purity: (bits & 1) === 1 && k.purity != null, character: (bits & 2) === 2 && k.character != null };
    });
    const sheets = r.sheets.map((s, i) => ({
      id: i + 1, name: s.name, file: '', corr: {},
      saved: { answers: decodeKey(s.a) || [], flags: { need: s.flags.need, audit: s.flags.audit } },
    }));
    return { name: r.title, n: r.n, key, auto, sheets, nextId: sheets.length + 1 };
  }

  return { list, get, saveFromSession, update, duplicate, remove, tags, toSession };
}
