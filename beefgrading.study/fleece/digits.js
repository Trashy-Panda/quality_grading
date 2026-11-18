// digits.js - offline handwriting reader for the fleece grader (advisory: bubbles still decide).
// Reads (a) the handwritten "Written" digit beside each yield tens/ones column and (b) the official yield written in the
// right margin of a row ("56", sometimes "58-2"). Input = the crops omr.js puts in readSheet(..., {hand:true}).hand[row].
//
// Pipeline (pure JS on grey arrays, so it runs in node too): darkness vs local paper -> erase printed bubbles and rules ->
// threshold -> connected components -> glyph grouping -> MNIST-style 28x28 tensor -> small CNN.
//
// Model: vendor/digits-net.bin, a LeNet-style CNN initialised from the ONNX Model Zoo mnist-12 net (Apache-2.0) and fine-tuned on
// MNIST (LeCun, Cortes, Burges) plus digit crops from this project's own sheets. Licence and attribution: vendor/LICENSE-mnist.txt.
//
// API
//   await initDigits()                         load the classifier (idempotent)
//   readDigit(crop)        -> { digit: 0-9|null, conf: 0..1, alt: { digit, p }|null, empty: bool }
//   readMarginYield(crop)  -> { value: 0-99|null, conf, digits: [{digit, conf, alt}], extra: '-2'|null }
// crop = { canvas | {data,width,height}, vlines?, masks? } or a bare canvas / {data,width,height} (grey or RGBA).

export const DIGITS = {
  closeR: 6,            // paper estimate: grey closing, half window (px); strokes narrower than 2r+1 vanish from it
  lineBand: 3, lineSide: 5, // printed rule removal: pixels within band of a rule are bridged from pixels `side` px away
  hLineFrac: 0.75, hLineDark: 0.14, // a crop row is a printed horizontal rule when this share of it is darker than hLineDark
  emptyPeak: 0.10,      // 99th percentile of darkness below this: nothing written
  thrFrac: 0.40, thrMin: 0.07, // ink = darkness above max(thrMin, thrFrac * peak)
  minGlyphH: 0.30,      // (Written digit) a glyph shorter than this share of the crop height is a stray mark, not a digit
  minMarginH: 0.18,     // same, margin yield (its digits are small and the crop is tall)
  digitRel: 0.45,       // (margin) a glyph shorter than this share of the tallest is not a yield digit
  relArea: 0.08,        // pieces smaller than this share of the biggest piece are specks
  edgeZone: 0.18,       // a horizontal rule this close to the crop's top/bottom is the row boundary
  ruleZone: 0.12, edgeThin: 0.2, // see isPrint
  xOverlapMerge: 0.5,   // pieces overlapping this much in x belong to one glyph
  minArea: 14,          // smaller ink specks are dropped
  splitAspect: 0.8,     // (margin) a lone glyph wider than this x its height is two touching digits
  temp: 1,              // softmax temperature (calibration)
  confidentDigit: 0.90, confidentMargin: 0.99, // a read with conf >= this is "confident": tuned on sheet-held-out reads for <= 2% wrong (hand-eval)
};

// ---------- pure image helpers ----------
// Sliding-window max (or min) over [i-r, i+r], clamped at the ends, along rows or columns: monotone deque, O(1) per pixel.
function runFilter(src, w, h, r, horizontal, isMax) {
  const out = new Float32Array(w * h), n = horizontal ? w : h, m = horizontal ? h : w, step = horizontal ? 1 : w, dq = new Int32Array(n);
  for (let j = 0; j < m; j++) {
    const base = horizontal ? j * w : j; let hd = 0, tl = 0, nxt = 0;
    for (let i = 0; i < n; i++) {
      const hi = Math.min(n - 1, i + r);
      for (; nxt <= hi; nxt++) { const v = src[base + nxt * step]; while (tl > hd && (isMax ? src[base + dq[tl - 1] * step] <= v : src[base + dq[tl - 1] * step] >= v)) tl--; dq[tl++] = nxt; }
      while (dq[hd] < i - r) hd++;
      out[base + i * step] = src[base + dq[hd] * step];
    }
  }
  return out;
}
function closeGray(g, w, h, r) { // dilate then erode with a (2r+1) square: removes dark strokes thinner than the window
  let t = runFilter(g, w, h, r, true, true); t = runFilter(t, w, h, r, false, true);
  t = runFilter(t, w, h, r, true, false); return runFilter(t, w, h, r, false, false);
}

// Grey array of a crop. Accepts a canvas (browser), {data,width,height} with 1 (grey) or 4 (RGBA) channels per pixel, or
// {g, w, h}.
export function greyOf(src) {
  if (src.g && src.w) return { g: Float32Array.from(src.g), w: src.w, h: src.h };
  let c = src.canvas || src;
  let w, h, d;
  if (c.getContext) { w = c.width; h = c.height; d = c.getContext('2d').getImageData(0, 0, w, h).data; }
  else { w = c.width; h = c.height; d = c.data; }
  const g = new Float32Array(w * h);
  if (d.length === w * h) for (let i = 0; i < g.length; i++) g[i] = d[i];
  else for (let i = 0; i < g.length; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return { g, w, h };
}

// Darkness 0..1 of ink against the local paper, with the printed furniture taken out: bubble outlines/fills (masks) and the
// printed rules (vlines = x of vertical rules; horizontal rules are found from the pixels themselves).
export function inkMap(grey, meta = {}, o = DIGITS) {
  const { g, w, h } = grey, bg = closeGray(g, w, h, o.closeR), D = new Float32Array(w * h);
  for (let i = 0; i < D.length; i++) D[i] = Math.max(0, bg[i] - g[i]) / 255;
  // horizontal rules: rows dark across (almost) the whole width. Found before masking so a bubble does not break them.
  const rows = [];
  for (let y = 0; y < h; y++) { let c = 0; for (let x = 0; x < w; x++) if (D[y * w + x] > o.hLineDark) c++; if (c >= o.hLineFrac * w) rows.push(y); }
  // printed bubbles (rings, and the student's fill): erased whole
  for (const m of meta.masks || []) {
    const x0 = Math.max(0, Math.floor(m.x - m.rx)), x1 = Math.min(w - 1, Math.ceil(m.x + m.rx)), y0 = Math.max(0, Math.floor(m.y - m.ry)), y1 = Math.min(h - 1, Math.ceil(m.y + m.ry));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const u = (x - m.x) / m.rx, v = (y - m.y) / m.ry; if (u * u + v * v <= 1) D[y * w + x] = 0; }
  }
  // bridge: a pixel in a rule's band keeps only the darkness that continues on both sides of the rule (a stroke crossing it)
  const cl = (v, n) => Math.max(0, Math.min(n - 1, v));
  for (const vx of meta.vlines || []) {
    const xl = cl(Math.round(vx - o.lineSide), w), xr = cl(Math.round(vx + o.lineSide), w);
    for (let x = cl(Math.round(vx - o.lineBand), w); x <= cl(Math.round(vx + o.lineBand), w); x++) for (let y = 0; y < h; y++) { const i = y * w + x; D[i] = Math.min(D[i], Math.max(D[y * w + xl], D[y * w + xr])); }
  }
  if (rows.length) {
    // group consecutive rows into bands, bridge each band from the rows just above and below
    let a = rows[0], b = a; const bands = [];
    for (let k = 1; k < rows.length; k++) { if (rows[k] <= b + 2) b = rows[k]; else { bands.push([a, b]); a = b = rows[k]; } }
    bands.push([a, b]);
    for (const [ya, yb] of bands) {
      const lo = ya - o.lineBand, hi = yb + o.lineBand, yu = cl(lo - 2, h), yd = cl(hi + 2, h), mid = (ya + yb) / 2;
      // a rule at the crop's top or bottom edge is the row boundary: drop it and everything beyond it
      if (mid < o.edgeZone * h) { for (let y = 0; y <= cl(hi + 1, h); y++) for (let x = 0; x < w; x++) D[y * w + x] = 0; continue; }
      if (mid > (1 - o.edgeZone) * h) { for (let y = cl(lo - 1, h); y < h; y++) for (let x = 0; x < w; x++) D[y * w + x] = 0; continue; }
      for (let y = cl(lo, h); y <= cl(hi, h); y++) for (let x = 0; x < w; x++) { const i = y * w + x; D[i] = Math.min(D[i], Math.max(D[yu * w + x], D[yd * w + x])); }
    }
  }
  return { D, w, h };
}

// Connected-component glyphs. Returns { empty, peak, thr, glyphs: [{x0,y0,x1,y1,area,id}], lab, bin } ; glyphs sorted by x0.
export function segment(ink, o = DIGITS, vlines = []) {
  const { D, w, h } = ink, n = w * h;
  const hist = new Uint32Array(256); for (let i = 0; i < n; i++) hist[Math.min(255, Math.round(D[i] * 255))]++;
  let acc = 0, pk = 0; for (let k = 255; k >= 0; k--) { acc += hist[k]; if (acc >= 0.01 * n) { pk = k / 255; break; } }
  if (pk < o.emptyPeak) return { empty: true, peak: pk, glyphs: [] };
  const thr = Math.max(o.thrMin, o.thrFrac * pk), bin = new Uint8Array(n);
  for (let i = 0; i < n; i++) bin[i] = D[i] >= thr ? 1 : 0;
  const dil = new Uint8Array(n); // 3x3 dilation bridges pencil gaps
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
  let keep = comps.filter(c => c.area >= o.minArea && !isPrint(c, w, h, vlines, o));
  const big = Math.max(0, ...keep.map(c => c.area)); keep = keep.filter(c => c.area >= o.relArea * big);
  return { empty: keep.length === 0, peak: pk, thr, glyphs: groupGlyphs(keep, o), lab, bin, w, h };
}

// Left-overs of the printed grid after masking: pieces wholly inside the top/bottom rule zone, thin pieces hugging a vertical
// rule, and thin pieces on the crop's far edge (the dotted outline of the next bubble column).
export function isPrint(c, w, h, vlines, o = DIGITS) {
  if (c.y1 < o.ruleZone * h || c.y0 > (1 - o.ruleZone) * h) return true;
  const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1;
  for (const vx of vlines) if (c.x0 >= vx - 6 && c.x1 <= vx + 4 && cw <= 10) return true;
  if (c.x1 >= w - 3 && cw <= o.edgeThin * ch) return true;
  if (c.x0 <= 3 && cw <= 0.3 * ch) return true; // the dotted outline on the crop's near edge
  return false;
}

// Pieces of one written character (a "5" with a detached bar, a "4" with an open top) overlap in x; merge them.
export function groupGlyphs(comps, o = DIGITS) {
  const out = [];
  for (const c of [...comps].sort((a, b) => a.x0 - b.x0)) {
    let g = null;
    for (const t of out) {
      const ov = Math.min(c.x1, t.x1) - Math.max(c.x0, t.x0) + 1, nar = Math.min(c.x1 - c.x0 + 1, t.x1 - t.x0 + 1);
      if (ov > 0 && ov >= o.xOverlapMerge * nar) { g = t; break; }
    }
    if (g) { g.x0 = Math.min(g.x0, c.x0); g.x1 = Math.max(g.x1, c.x1); g.y0 = Math.min(g.y0, c.y0); g.y1 = Math.max(g.y1, c.y1); g.area += c.area; g.ids.push(c.id); }
    else out.push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, area: c.area, ids: [c.id] });
  }
  return out.sort((a, b) => a.x0 - b.x0);
}
const gw = g => g.x1 - g.x0 + 1, gh = g => g.y1 - g.y0 + 1;

// Two touching digits (one wide component): cut at the thinnest column in the middle of it. Returns two glyph boxes.
export function splitGlyph(seg, g) {
  const { w, bin, lab } = seg, set = new Set(g.ids), W = gw(g), col = new Array(W).fill(0);
  for (let y = g.y0; y <= g.y1; y++) for (let x = g.x0; x <= g.x1; x++) if (bin[y * w + x] && set.has(lab[y * w + x])) col[x - g.x0]++;
  const lo = Math.floor(W * 0.3), hi = Math.ceil(W * 0.7); let best = lo, bv = 1e9;
  for (let k = lo; k <= hi; k++) { const v = col[k] + 0.5 * ((col[k - 1] ?? 0) + (col[k + 1] ?? 0)); if (v < bv) { bv = v; best = k; } }
  const cut = g.x0 + best, parts = [];
  for (const [a, b] of [[g.x0, cut - 1], [cut, g.x1]]) {
    let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, area = 0;
    for (let y = g.y0; y <= g.y1; y++) for (let x = a; x <= b; x++) if (bin[y * w + x] && set.has(lab[y * w + x])) { area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    parts.push({ x0, y0, x1, y1, area, ids: g.ids, cutX: [a, b] });
  }
  return parts;
}

// 28x28 MNIST-style tensor of one glyph: only its own pixels, intensity scaled to its darkest strokes, longest side 20px,
// centred by centre of mass.
export function glyphTensor(seg, D, g) {
  const { w, lab } = seg, set = new Set(g.ids), gwid = gw(g), ghei = gh(g), vals = new Float32Array(gwid * ghei);
  let mx = 0;
  for (let y = 0; y < ghei; y++) for (let x = 0; x < gwid; x++) {
    const X = g.x0 + x, Y = g.y0 + y, inside = set.has(lab[Y * w + X]) && (!g.cutX || (X >= g.cutX[0] && X <= g.cutX[1]));
    const v = inside ? D[Y * w + X] : 0; vals[y * gwid + x] = v; if (v > mx) mx = v;
  }
  const s = 20 / Math.max(gwid, ghei), tw = Math.max(1, Math.round(gwid * s)), th = Math.max(1, Math.round(ghei * s));
  const patch = new Float32Array(tw * th), cnt = new Float32Array(tw * th);
  // area-average resample
  for (let y = 0; y < ghei; y++) for (let x = 0; x < gwid; x++) {
    const tx = Math.min(tw - 1, Math.floor(x * tw / gwid)), ty = Math.min(th - 1, Math.floor(y * th / ghei));
    patch[ty * tw + tx] += vals[y * gwid + x]; cnt[ty * tw + tx]++;
  }
  const norm = mx > 0 ? 1 / (0.85 * mx) : 0; let sm = 0, sx = 0, sy = 0;
  for (let i = 0; i < patch.length; i++) { patch[i] = Math.min(1, (cnt[i] ? patch[i] / cnt[i] : 0) * norm); const ty = (i / tw) | 0, tx = i % tw; sm += patch[i]; sx += patch[i] * tx; sy += patch[i] * ty; }
  const out = new Float32Array(784), ox = Math.round(14 - (sm ? sx / sm : tw / 2) - 0.5), oy = Math.round(14 - (sm ? sy / sm : th / 2) - 0.5);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { const X = x + ox, Y = y + oy; if (X >= 0 && X < 28 && Y >= 0 && Y < 28) out[Y * 28 + X] = patch[y * tw + x]; }
  return out;
}

// ---------- margin layout and parse (pure: geometry only) ----------
// Glyphs of a margin crop, left to right -> which two are the yield digits and what is left over.
//   glyphs: [{x0,y0,x1,y1}], hh = crop height, vlines = printed rules (pieces wholly left of the last rule are print, not ink)
export function layoutMargin(glyphs, hh, vlines = [], o = DIGITS) {
  const edge = vlines.length ? Math.max(...vlines) + 1 : -1;
  const gs = glyphs.filter(g => g.x1 > edge && (gh(g) >= o.minMarginH * 0.5 * hh || (gw(g) >= 1.4 * gh(g) && gw(g) >= 0.1 * hh))); // short flat glyphs are the deduction's dash
  const tallest = Math.max(0, ...gs.map(gh));
  const tall = gs.filter(g => gh(g) >= o.digitRel * tallest && gh(g) >= o.minMarginH * hh);
  const first = tall.slice(0, 2);
  const tail = first.length ? gs.filter(g => g.x0 > first[first.length - 1].x1 - 0.2 * gw(first[first.length - 1]) && !first.includes(g)) : [];
  const needSplit = first.length === 1 && gw(first[0]) > o.splitAspect * gh(first[0]);
  return { digits: first, tail, needSplit, tallest };
}

// Leftover glyphs after the yield: a dash then digits ("-2"). reads[i] = { digit, conf } for the i-th tail glyph (or null).
export function parseTail(tail, reads) {
  if (!tail.length) return null;
  let s = '';
  tail.forEach((g, i) => {
    const asp = gw(g) / gh(g), rd = reads[i];
    if (asp >= 1.4 && gh(g) < 0.5 * Math.max(...tail.map(gh))) s += '-';
    else s += rd && rd.digit != null ? String(rd.digit) : '?';
  });
  return s;
}

// ---------- classifier ----------
// A LeNet-style CNN (conv5x5x8 - pool2 - conv5x5x16 - pool3 - fc10), the architecture of the ONNX model-zoo MNIST net, run in
// plain JS so it works offline and in node. Weights: vendor/digits-net.bin, 5994 little-endian float32 in the order
// conv1 w(8,1,5,5) b(8), conv2 w(16,8,5,5) b(16), fc w(256,10) b(10). See vendor/LICENSE-mnist.txt.
let NET = null;
export function setNet(fn) { NET = fn; }
export const NET_URL = new URL('./vendor/digits-net.bin', import.meta.url).href;
export function cnnNet(buf) {
  const f = buf instanceof Float32Array ? buf : new Float32Array(buf); let o = 0;
  const take = n => { const a = f.subarray(o, o + n); o += n; return a; };
  const c1w = take(200), c1b = take(8), c2w = take(3200), c2b = take(16), fw = take(2560), fb = take(10);
  const x0 = new Float32Array(32 * 32), a1 = new Float32Array(8 * 784), p1 = new Float32Array(8 * 18 * 18), a2 = new Float32Array(16 * 196), p2 = new Float32Array(256);
  return (x) => {
    x0.fill(0); for (let y = 0; y < 28; y++) for (let xx = 0; xx < 28; xx++) x0[(y + 2) * 32 + xx + 2] = x[y * 28 + xx];
    for (let oc = 0; oc < 8; oc++) { // conv1 5x5 same + relu
      const wk = c1w.subarray(oc * 25, oc * 25 + 25), bb = c1b[oc];
      for (let y = 0; y < 28; y++) for (let xx = 0; xx < 28; xx++) {
        let s = bb;
        for (let i = 0; i < 5; i++) { const r = (y + i) * 32 + xx, k = i * 5; s += wk[k] * x0[r] + wk[k + 1] * x0[r + 1] + wk[k + 2] * x0[r + 2] + wk[k + 3] * x0[r + 3] + wk[k + 4] * x0[r + 4]; }
        a1[oc * 784 + y * 28 + xx] = s > 0 ? s : 0;
      }
    }
    p1.fill(0); // pool2 into a 2-pixel zero border (18x18) for conv2
    for (let c = 0; c < 8; c++) for (let y = 0; y < 14; y++) for (let xx = 0; xx < 14; xx++) { const b = c * 784 + 2 * y * 28 + 2 * xx; p1[c * 324 + (y + 2) * 18 + xx + 2] = Math.max(a1[b], a1[b + 1], a1[b + 28], a1[b + 29]); }
    for (let oc = 0; oc < 16; oc++) { // conv2 5x5x8 same + relu
      const bb = c2b[oc];
      for (let y = 0; y < 14; y++) for (let xx = 0; xx < 14; xx++) {
        let s = bb;
        for (let c = 0; c < 8; c++) { const wo = (oc * 8 + c) * 25, po = c * 324 + y * 18 + xx; for (let i = 0; i < 5; i++) { const r = po + i * 18, k = wo + i * 5; s += c2w[k] * p1[r] + c2w[k + 1] * p1[r + 1] + c2w[k + 2] * p1[r + 2] + c2w[k + 3] * p1[r + 3] + c2w[k + 4] * p1[r + 4]; } }
        a2[oc * 196 + y * 14 + xx] = s > 0 ? s : 0;
      }
    }
    for (let c = 0; c < 16; c++) for (let y = 0; y < 4; y++) for (let xx = 0; xx < 4; xx++) { let m = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m = Math.max(m, a2[c * 196 + (3 * y + i) * 14 + 3 * xx + j]); p2[c * 16 + y * 4 + xx] = m; }
    const z = new Float32Array(10);
    for (let k = 0; k < 10; k++) { let s = fb[k]; for (let i = 0; i < 256; i++) s += p2[i] * fw[i * 10 + k]; z[k] = s; }
    return z;
  };
}
let initP = null;
export function initDigits(opts = {}) {
  if (NET) return Promise.resolve(true);
  if (opts.net) { NET = opts.net; return Promise.resolve(true); }
  return (initP = initP || fetch(opts.url || NET_URL).then(r => { if (!r.ok) throw new Error('digits net ' + r.status); return r.arrayBuffer(); }).then(b => { NET = cnnNet(b); return true; }));
}
export function softmax(z, T = 1) { let m = -1e9; for (const v of z) if (v > m) m = v; const e = Array.from(z, v => Math.exp((v - m) / T)); let s = 0; e.forEach(v => { s += v; }); return e.map(v => v / s); }
function classify(tensor) {
  const p = softmax(NET(tensor), DIGITS.temp); let a = 0, b = -1;
  for (let k = 1; k < 10; k++) if (p[k] > p[a]) a = k;
  for (let k = 0; k < 10; k++) if (k !== a && (b < 0 || p[k] > p[b])) b = k;
  return { digit: a, conf: p[a], alt: { digit: b, p: p[b] }, probs: p };
}

// ---------- readers ----------
export function prepare(crop, o = DIGITS) {
  const meta = { vlines: crop.vlines, masks: crop.masks }, grey = greyOf(crop), ink = inkMap(grey, meta, o);
  return { ink, seg: segment(ink, o, meta.vlines || []), meta };
}

export function readDigit(crop, o = DIGITS) {
  const { ink, seg } = prepare(crop, o);
  const cand = seg.glyphs.filter(g => gh(g) >= o.minGlyphH * ink.h);
  if (seg.empty || !cand.length) return { digit: null, conf: seg.empty ? 1 : 0.5, alt: null, empty: true };
  cand.sort((a, b) => b.area - a.area);
  const g = cand[0], r = classify(glyphTensor(seg, ink.D, g));
  const extra = cand.length > 1 ? Math.min(1, cand[1].area / g.area) : 0; // a second sizeable piece: the crop is not one clean digit
  return { digit: r.digit, conf: r.conf * (1 - 0.5 * extra), alt: r.alt, empty: false, glyph: g, pieces: cand.length };
}

export function readMarginYield(crop, o = DIGITS) {
  const { ink, seg, meta } = prepare(crop, o);
  const none = { value: null, conf: seg.empty ? 1 : 0, digits: [], extra: null, empty: !!seg.empty };
  if (seg.empty) return none;
  const lay = layoutMargin(seg.glyphs, ink.h, meta.vlines || [], o);
  let digs = lay.digits, tail = lay.tail;
  if (lay.needSplit) digs = splitGlyph(seg, digs[0]);
  if (digs.length < 2) return { ...none, empty: false };
  const reads = digs.map(g => { const r = classify(glyphTensor(seg, ink.D, g)); return { digit: r.digit, conf: r.conf, alt: r.alt }; });
  const tr = tail.map(g => (gw(g) / gh(g) >= 1.4 ? null : (() => { const r = classify(glyphTensor(seg, ink.D, g)); return { digit: r.digit, conf: r.conf }; })()));
  const extra = parseTail(tail, tr);
  return { value: reads[0].digit * 10 + reads[1].digit, conf: Math.min(reads[0].conf, reads[1].conf) * (lay.needSplit ? 0.9 : 1), digits: reads, extra, empty: false };
}
