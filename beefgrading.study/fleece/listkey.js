// listkey.js - read a free-form handwritten official key (a plain-paper list, one fleece per line:
// "grade  length  yield", e.g. "62  S  54") into answers, offline. Pure JS on grey arrays (runs in node too); the browser
// only decodes the photo. Digits come from the small CNN in digits.js (imported, not modified).
//
// Pipeline: darkness vs local paper (digits.inkMap) -> threshold -> connected components -> lines (vertical clustering) ->
// tokens (x gaps) -> digit pairs through the CNN / length letter by shape features -> constraints:
//   * column decides digit vs letter (cols 1 and 3 digits, col 2 a letter), so a handwritten "5" that looks like "S" is a digit;
//   * grade = best VALID wool-count pair (70 64 62 60 58 56 54 50 48 46) by joint digit probability.
//
// API
//   await initListKey(opts?)                      load the digit net (idempotent; opts.net = a cnnNet function, opts.url)
//   await readListKey(source, opts?) ->
//       { ok:true, n, rows:[{ grade:0-9, length:0-2, yield:0-99, conf:{grade,length,yield}, rect:{x,y,w,h}, rects:{grade,length,yield},
//                             text:{grade:'62', length:'S', yield:'54'} }], lines, warnings:[...], ms }
//     | { ok:false, error:'nolist', lines, warnings, ms }
//   source = url string | Blob | <img>/<canvas>/ImageBitmap | { g, w, h } (grey) | { data, width, height } (grey or RGBA).
//   rect/rects are in the source image's pixel space. grade/length are the app's indexes (GRADES 0..9, Staple/French/Clothing).
import { DIGITS, greyOf, inkMap, groupGlyphs, splitGlyph, glyphTensor, cnnNet, softmax, NET_URL } from './digits.js';

export const LIST = {
  maxEdge: 1800,          // the photo is scaled so its longest edge is at most this (never enlarged)
  minArea: 25,            // components with fewer ink pixels than this are specks
  minHFrac: 0.30,         // a component shorter than this share of the median glyph height is a stray mark
  maxHFrac: 3.2, maxWFrac: 6, // taller / wider than this x the median glyph: a frame line or the photo edge, not writing
  lineFrac: 0.60,         // a component starts a new line when its centre is this x glyph height below the line's mean centre
  gapFrac: 0.70,          // a horizontal gap wider than this x glyph height separates tokens (columns)
  minLines: 3,            // fewer usable lines than this: not a list
  splitAspect: 0.95,      // a lone glyph in a digit token wider than this x its height is two touching digits
  confident: 0.5,         // conf at or above this is "confident" (see list-eval)
  expectRows: 20,         // an official key has 20 fleeces; another count only warns
  plausible: 0.2,         // a row whose grade and yield conf are both at least this (and has a letter) counts as a real list row
  minShare: 0.5,          // plausible rows must be at least this share of the substantial lines (>= 4 glyphs): a printed table is not a list
};
export const GRADE_COUNTS = [70, 64, 62, 60, 58, 56, 54, 50, 48, 46]; // index 0..9 (omr GRADES order)
const GRADE_PAIRS = GRADE_COUNTS.map((v, i) => ({ i, a: Math.floor(v / 10), b: v % 10 }));

// ---------- pure constraint logic (unit-tested) ----------
// Best valid grade pair for two digit distributions p1 (tens) and p2 (ones). Returns { grade: 0-9, conf, count, alt }.
//   conf = joint probability of the pick (so a doubtful digit lowers it); alt = runner-up valid pair or null.
export function bestGrade(p1, p2) {
  const sc = GRADE_PAIRS.map(g => ({ i: g.i, s: (p1[g.a] || 0) * (p2[g.b] || 0) })).sort((x, y) => y.s - x.s);
  return { grade: sc[0].i, conf: sc[0].s, count: GRADE_COUNTS[sc[0].i], alt: sc[1].s > 0 ? { grade: sc[1].i, s: sc[1].s } : null };
}
// Yield from two digit distributions: argmax each, conf = joint probability. `range` = [loTens, hiTens] limits the tens digit
// (real fleece yields sit around 40-79).
export function bestYield(p1, p2, range = [3, 8]) {
  let a = -1, b = 0;
  for (let k = range[0]; k <= range[1]; k++) if (a < 0 || p1[k] > p1[a]) a = k;
  for (let k = 1; k < 10; k++) if (p2[k] > p2[b]) b = k;
  return { value: a * 10 + b, conf: (p1[a] || 0) * (p2[b] || 0) };
}
// Length letter -> index. S and St = Staple 0, F = French combing 1, C = Clothing 2.
export function lengthIndex(letter) { return { S: 0, ST: 0, F: 1, C: 2 }[String(letter).toUpperCase()] ?? null; }

// A row is plausible when all three fields were read with some confidence; the list is real when enough plausible rows exist
// and they are most of the substantial lines (a printed table gives many lines of which few read as a clean "grade letter yield").
export function isPlausibleRow(r, o = LIST) { return r.length != null && r.conf.grade >= o.plausible && r.conf.yield >= o.plausible; }
export function listLooksReal(good, substantial, o = LIST) { return good >= o.minLines && good >= o.minShare * substantial; }

// Cluster boxes into text lines by vertical centre. boxes: [{x0,y0,x1,y1}] -> arrays of boxes, top to bottom, each sorted by x0.
export function groupLines(boxes, hMed, o = LIST) {
  const bs = boxes.map(b => ({ b, cy: (b.y0 + b.y1) / 2 })).sort((p, q) => p.cy - q.cy), lines = [];
  for (const p of bs) {
    const L = lines[lines.length - 1];
    if (L && p.cy - L.sum / L.items.length <= o.lineFrac * hMed) { L.items.push(p.b); L.sum += p.cy; } else lines.push({ items: [p.b], sum: p.cy });
  }
  return lines.map(L => L.items.sort((a, b) => a.x0 - b.x0));
}
// Split a line's x-sorted glyph boxes into tokens at gaps wider than gapFrac x hMed; then, if there are more than `want`
// tokens, merge the narrowest gaps until there are `want` (returns null when the line is hopeless: > want+2 tokens).
export function groupTokens(glyphs, hMed, o = LIST, want = 3) {
  const toks = [];
  for (const g of glyphs) {
    const t = toks[toks.length - 1];
    if (t && g.x0 - t.x1 - 1 <= o.gapFrac * hMed) { t.glyphs.push(g); t.x1 = Math.max(t.x1, g.x1); t.x0 = Math.min(t.x0, g.x0); t.y0 = Math.min(t.y0, g.y0); t.y1 = Math.max(t.y1, g.y1); }
    else toks.push({ glyphs: [g], x0: g.x0, x1: g.x1, y0: g.y0, y1: g.y1 });
  }
  if (toks.length > want + 2) return null;
  while (toks.length > want) {
    let k = 0, best = 1e9;
    for (let i = 0; i + 1 < toks.length; i++) { const gp = toks[i + 1].x0 - toks[i].x1; if (gp < best) { best = gp; k = i; } }
    const a = toks[k], b = toks[k + 1];
    a.glyphs.push(...b.glyphs); a.x1 = Math.max(a.x1, b.x1); a.y0 = Math.min(a.y0, b.y0); a.y1 = Math.max(a.y1, b.y1); toks.splice(k + 1, 1);
  }
  return toks;
}

// Shape features of one letter from its mask (Uint8Array w*h, 1 = ink, tight to the glyph's box).
export function letterFeatures(m, w, h) {
  const rowAny = (y, x0, x1) => { for (let x = x0; x < x1; x++) if (m[y * w + x]) return true; return false; };
  const q = Math.max(1, Math.round(0.25 * w));
  let leftRows = 0; for (let y = 0; y < h; y++) if (rowAny(y, 0, q)) leftRows++;
  const span = (ya, yb) => { let lo = w, hi = -1; for (let y = ya; y < yb; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) { if (x < lo) lo = x; if (x > hi) hi = x; } return hi < 0 ? 0 : (hi - lo + 1) / w; };
  const band = Math.max(1, Math.round(0.14 * h));
  // middle band: the longest horizontal run of ink on any row there, and how far right the ink reaches
  let run = 0, reach = 0; const y0 = Math.round(0.38 * h), y1 = Math.round(0.62 * h) + 1;
  for (let y = y0; y < Math.min(h, y1); y++) { let c = 0; for (let x = 0; x < w; x++) { if (m[y * w + x]) { c++; if (c > run) run = c; if (x + 1 > reach) reach = x + 1; } else c = 0; } }
  let cen = 0, cn = 0; const cx0 = Math.round(0.3 * w), cx1 = Math.round(0.7 * w), cy0 = Math.round(0.35 * h), cy1 = Math.round(0.65 * h);
  for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) { cn++; if (m[y * w + x]) cen++; }
  let ink = 0; for (let i = 0; i < m.length; i++) ink += m[i];
  return { leftCover: leftRows / h, topSpan: span(0, band), botSpan: span(h - band, h), midRun: run / w, midReach: reach / w, center: cn ? cen / cn : 0, fill: ink / (w * h), aspect: w / h };
}
// S / F / C from the features: { letter, conf, scores }. conf = share of the winning score.
export function classifyLetter(f) {
  const lin = (v, a, b) => Math.max(0, Math.min(1, (v - a) / (b - a)));      // 0 at a, 1 at b
  // F: a straight stem down the left edge, a bar across the middle, a bottom that is only the stem
  const sF = lin(f.leftCover, 0.80, 0.97) * lin(0.55 - f.botSpan, 0, 0.3) * (0.4 + 0.6 * lin(f.midRun, 0.35, 0.65));
  // C: open on the right, nothing in the middle
  const sC = lin(0.25 - f.center, 0, 0.2) * lin(0.55 - f.midReach, 0, 0.35) * lin(f.botSpan, 0.45, 0.7) * lin(f.topSpan, 0.35, 0.6);
  // S: ink through the centre, both ends wide
  const sS = (0.15 + lin(f.center, 0.12, 0.4)) * lin(f.botSpan, 0.4, 0.7) * lin(f.topSpan, 0.4, 0.7) * (1 - 0.7 * sF);
  const scores = { S: sS + 0.02, F: sF + 0.001, C: sC + 0.001 }, tot = scores.S + scores.F + scores.C;
  const letter = Object.keys(scores).sort((a, b) => scores[b] - scores[a])[0];
  return { letter, conf: scores[letter] / tot, scores };
}

// ---------- image side ----------
let NET = null, initP = null;
export function initListKey(opts = {}) {
  if (NET) return Promise.resolve(true);
  if (opts.net) { NET = opts.net; return Promise.resolve(true); }
  return (initP = initP || fetch(opts.url || NET_URL).then(r => { if (!r.ok) throw new Error('digits net ' + r.status); return r.arrayBuffer(); }).then(b => { NET = cnnNet(b); return true; }));
}
const probsOf = t => softmax(NET(t), DIGITS.temp);

async function loadGrey(src, o) {
  if (src && (src.g || src.data) && !src.getContext) { const g = greyOf(src); return { ...g, k: 1 }; }
  // A Blob goes through an <img> like a url does: an ImageBitmap decode resamples a little differently and lost the last line of the key photo.
  const isBlob = typeof Blob !== 'undefined' && src instanceof Blob, blobUrl = isBlob ? URL.createObjectURL(src) : null;
  if (typeof src === 'string' || isBlob) {
    try { src = await new Promise((res, rej) => { const i = new Image(); i.addEventListener('load', () => res(i)); i.addEventListener('error', () => rej(new Error('image load failed'))); i.src = blobUrl || src; }); } finally { if (blobUrl) URL.revokeObjectURL(blobUrl); }
  }
  const W = src.naturalWidth || src.videoWidth || src.width, H = src.naturalHeight || src.videoHeight || src.height, k = Math.min(1, o.maxEdge / Math.max(W, H));
  const c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k);
  const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, c.width, c.height);
  return { ...greyOf(c), k: W / c.width };
}

// Connected components (8-neighbour, on the ink mask dilated 1px so pencil gaps bridge), area counted on the undilated mask.
function components(D, w, h, o) {
  const n = w * h, hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[Math.min(255, Math.round(D[i] * 255))]++;
  let acc = 0, pk = 0; for (let k = 255; k >= 0; k--) { acc += hist[k]; if (acc >= 0.01 * n) { pk = k / 255; break; } }
  if (pk < DIGITS.emptyPeak) return { empty: true, comps: [], peak: pk };
  const thr = Math.max(DIGITS.thrMin, DIGITS.thrFrac * pk), bin = new Uint8Array(n), dil = new Uint8Array(n);
  for (let i = 0; i < n; i++) bin[i] = D[i] >= thr ? 1 : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (bin[y * w + x]) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h) dil[yy * w + xx] = 1; }
  const lab = new Int32Array(n), comps = [], stack = [];
  for (let s = 0; s < n; s++) {
    if (!dil[s] || lab[s]) continue;
    const id = comps.length + 1; let x0 = w, y0 = h, x1 = -1, y1 = -1, area = 0;
    lab[s] = id; stack.push(s);
    while (stack.length) {
      const p = stack.pop(), px = p % w, py = (p / w) | 0;
      if (bin[p]) area++;
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = px + dx, yy = py + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = yy * w + xx; if (dil[q] && !lab[q]) { lab[q] = id; stack.push(q); }
      }
    }
    comps.push({ id, x0, y0, x1, y1, area });
  }
  return { empty: false, comps, peak: pk, thr, bin, lab, w, h };
}

const gwid = g => g.x1 - g.x0 + 1, ghei = g => g.y1 - g.y0 + 1;
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const unionBox = gs => ({ x0: Math.min(...gs.map(g => g.x0)), y0: Math.min(...gs.map(g => g.y0)), x1: Math.max(...gs.map(g => g.x1)), y1: Math.max(...gs.map(g => g.y1)) });

// The two digit glyphs of a token (merging by x overlap already done): [glyph, glyph] or null.
function digitGlyphs(seg, tok, o, hMed) {
  let gs = tok.glyphs.filter(g => g.area >= 0.12 * Math.max(...tok.glyphs.map(q => q.area)));
  if (gs.length === 1 && gwid(gs[0]) >= o.splitAspect * ghei(gs[0])) return { glyphs: splitGlyph(seg, gs[0]), split: true };
  if (gs.length > 2) { gs = [...gs].sort((a, b) => b.area - a.area).slice(0, 2).sort((a, b) => a.x0 - b.x0); }
  return gs.length === 2 ? { glyphs: gs, split: false } : null;
}

// Mask of one glyph, tight to its box.
function glyphMask(seg, g) {
  const set = new Set(g.ids), w = gwid(g), h = ghei(g), m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (g.y0 + y) * seg.w + g.x0 + x; if (seg.bin[i] && set.has(seg.lab[i])) m[y * w + x] = 1; }
  return { m, w, h };
}

export async function readListKey(source, opts = {}) {
  const o = { ...LIST, ...opts }, t0 = performance.now(), warnings = [], dbg = [];
  const done = res => ({ lines: dbg.length, warnings, ...res, ms: Math.round(performance.now() - t0) });
  await initListKey(opts);
  const grey = await loadGrey(source, o), { w, h, k } = grey, ink = inkMap(grey, {}, DIGITS), cc = components(ink.D, w, h, o);
  if (cc.empty) return done({ ok: false, error: 'nolist' });
  const seg = { w, bin: cc.bin, lab: cc.lab };
  // keep writing-sized components
  const big = cc.comps.filter(c => c.area >= o.minArea), hMed = median(big.map(ghei));
  if (!hMed) return done({ ok: false, error: 'nolist' });
  const keep = big.filter(c => ghei(c) >= o.minHFrac * hMed && ghei(c) <= o.maxHFrac * hMed && gwid(c) <= o.maxWFrac * hMed);
  const lines = groupLines(keep, hMed, o), rows = [], substantial = lines.filter(L => L.length >= 4).length;
  for (const L of lines) {
    const gl = groupGlyphs(L, DIGITS), toks = groupTokens(gl, hMed, o, 3);
    if (!toks || toks.length < 2 || toks.length > 3) { dbg.push({ skip: toks ? toks.length : 'many', y: Math.round(unionBox(L).y0 * k) }); continue; }
    dbg.push({ tokens: toks.length });
    const box = unionBox(L), isFull = toks.length === 3, tg = toks[0], ty = toks[toks.length - 1], tl = isFull ? toks[1] : null;
    const dg = digitGlyphs(seg, tg, o, hMed), dy = digitGlyphs(seg, ty, o, hMed);
    if (!dg || !dy) { dbg[dbg.length - 1].bad = true; continue; }
    const pg = dg.glyphs.map(g => probsOf(glyphTensor(seg, ink.D, g))), py = dy.glyphs.map(g => probsOf(glyphTensor(seg, ink.D, g)));
    const G = bestGrade(pg[0], pg[1]), Y = bestYield(py[0], py[1]);
    let len = null, lc = 0, letter = null;
    if (tl) {
      const main = [...tl.glyphs].sort((a, b) => b.area - a.area)[0], { m, w: mw, h: mh } = glyphMask(seg, main), f = letterFeatures(m, mw, mh), r = classifyLetter(f);
      letter = r.letter; len = lengthIndex(letter); lc = r.conf; dbg[dbg.length - 1].f = f;
    }
    const r2 = b => ({ x: Math.round(b.x0 * k), y: Math.round(b.y0 * k), w: Math.round((b.x1 - b.x0 + 1) * k), h: Math.round((b.y1 - b.y0 + 1) * k) });
    rows.push({ grade: G.grade, length: len, yield: Y.value, conf: { grade: G.conf, length: lc, yield: Y.conf }, rect: r2(box),
      rects: { grade: r2(tg), length: tl ? r2(tl) : null, yield: r2(ty) }, text: { grade: String(G.count), length: letter, yield: String(Y.value) } });
  }
  const full = rows.filter(r => r.length != null).length, good = rows.filter(r => isPlausibleRow(r, o)).length;
  if (!listLooksReal(good, substantial, o)) return done({ ok: false, error: 'nolist', rows, plausible: good, substantial });
  if (rows.length !== o.expectRows) warnings.push(`found ${rows.length} lines, expected ${o.expectRows}`);
  if (full < rows.length) warnings.push(`${rows.length - full} lines have no length letter`);
  return done({ ok: true, n: rows.length, rows });
}
