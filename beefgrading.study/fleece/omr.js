// omr.js - in-browser reader for the wool grading sheet. Requires OpenCV.js (loaded lazily from a pinned CDN).
// v2: the sheet is registered on its ruled table lines (grid.js), not on the faint bubble outlines. See SPEC.md.
import { GRID } from './template.js';
import { findLattice, bubbles, mapPoint } from './grid.js';

export const FIELDS = ['grade', 'length', 'yieldTens', 'yieldOnes', 'purity', 'character'];
export const OPENCV_URL = new URL('./vendor/opencv.js', import.meta.url).href; // self-hosted copy of @techstark/opencv-js 4.10.0-release.1
const TEMPLATE = { aspect: 0.75, paperFallback: { l: 0.13, t: 0.155, r: 0.14, b: 0.055 } }; // only for the rough table search
const WORK_EDGE = 2000, MAX_SRC_EDGE = 3200;

let cvPromise = null;
export function loadCV() {
  if (cvPromise) return cvPromise;
  cvPromise = new Promise((resolve, reject) => {
    const done = () => {
      const c = window.cv;
      if (!c) return reject(new Error('cv missing'));
      if (c.Mat) { try { c.then = undefined; } catch (e) {} return resolve({ cvModule: c }); }
      if (typeof c.then === 'function') {
        // never resolve a promise with the module itself (it has a .then -> infinite loop)
        c.then(m => { const mod = m || c; try { mod.then = undefined; } catch (e) {} resolve({ cvModule: mod }); });
      } else c.onRuntimeInitialized = () => resolve({ cvModule: c });
    };
    if (window.cv) return done();
    const s = document.createElement('script');
    s.src = OPENCV_URL; s.async = true;
    s.addEventListener('load', done);
    s.addEventListener('error', () => reject(new Error('OpenCV.js failed to load')));
    document.head.appendChild(s);
  });
  cvPromise = cvPromise.then(r => r.cvModule || r);
  return cvPromise;
}

// One decoder for every photo path (student sheets, key scan, handwritten list). A Blob or url goes through an <img>
// (every browser applies the EXIF turn when it draws one, and iOS Safari opens big HEIC/JPEG photos this way), with
// createImageBitmap only as a fallback. The result is drawn at most maxEdge on its long side, which also keeps it far
// under the iOS canvas limit (about 16.7M pixels). Returns { canvas, w, h } (w, h = the decoded photo before the downscale).
export class PhotoOpenError extends Error { constructor(why) { super('photo could not be opened' + (why ? ': ' + why : '')); this.name = 'PhotoOpenError'; this.code = 'decode'; } }
export const PHOTO_OPEN_MSG = "That photo couldn't be opened. Try taking it again, choose a different photo, or take a screenshot of it and add that.";
const loadImg = url => new Promise((res, rej) => { const i = new Image(); i.addEventListener('load', () => res(i)); i.addEventListener('error', () => rej(new Error('image load failed'))); i.src = url; });
export async function decodeImage(src, maxEdge = MAX_SRC_EDGE, ctxOpts) {
  const isBlob = typeof Blob !== 'undefined' && src instanceof Blob, url = isBlob ? URL.createObjectURL(src) : null;
  let bmp = null;
  try {
    if (typeof src === 'string' || isBlob) {
      try { src = await loadImg(url || src); }
      catch (e) {
        if (isBlob && typeof createImageBitmap === 'function') { try { src = bmp = await createImageBitmap(src); } catch (e2) { /* falls through */ } }
        if (!bmp) throw new PhotoOpenError(e.message);
      }
    }
    const w = src.naturalWidth || src.videoWidth || src.width, h = src.naturalHeight || src.videoHeight || src.height;
    if (!w || !h) throw new PhotoOpenError('empty image');
    for (let edge = maxEdge, tries = 0; tries < 3; tries++, edge = Math.round(edge * 0.7)) {
      const k = Math.min(1, edge / Math.max(w, h)), c = document.createElement('canvas'); // a 12MP photo is more than the reader can use
      c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
      const g = c.getContext('2d', ctxOpts); if (!g) continue; // iOS hands back no context when it is short of canvas memory: try smaller
      g.imageSmoothingQuality = 'high';
      try { g.drawImage(src, 0, 0, c.width, c.height); } catch (e) { continue; }
      return { canvas: c, w, h };
    }
    throw new PhotoOpenError('no canvas');
  } finally { if (url) URL.revokeObjectURL(url); if (bmp && bmp.close) bmp.close(); }
}
const toCanvas = async src => (await decodeImage(src)).canvas;

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function orderCorners(pts) {
  const s = pts.map(p => p.x + p.y), d = pts.map(p => p.x - p.y);
  const tl = pts[s.indexOf(Math.min(...s))], br = pts[s.indexOf(Math.max(...s))];
  const tr = pts[d.indexOf(Math.max(...d))], bl = pts[d.indexOf(Math.min(...d))];
  return [tl, tr, br, bl];
}
function quadArea(q) { let a = 0; for (let i = 0; i < 4; i++) { const p = q[i], n = q[(i + 1) % 4]; a += p.x * n.y - n.x * p.y; } return Math.abs(a) / 2; }

function largestHullCorners(cv, mask) {
  const contours = new cv.MatVector(), hier = new cv.Mat();
  cv.findContours(mask, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  let best = -1, bestA = 0;
  for (let i = 0; i < contours.size(); i++) { const a = cv.contourArea(contours.get(i)); if (a > bestA) { bestA = a; best = i; } }
  let out = null;
  if (best >= 0) {
    const hull = new cv.Mat(); cv.convexHull(contours.get(best), hull);
    const pts = []; for (let i = 0; i < hull.rows; i++) pts.push({ x: hull.data32S[i * 2], y: hull.data32S[i * 2 + 1] });
    hull.delete();
    out = { corners: orderCorners(pts), area: bestA };
  }
  contours.delete(); hier.delete();
  return out;
}

// Returns corners (TL,TR,BR,BL) in coordinates of the given canvas (any size).
async function findCornersCore(srcCanvas, dbg) {
  const cv = await loadCV();
  const scale = WORK_EDGE / Math.max(srcCanvas.width, srcCanvas.height);
  const w = Math.round(srcCanvas.width * scale), h = Math.round(srcCanvas.height * scale);
  const full = cv.imread(srcCanvas), small = new cv.Mat();
  cv.resize(full, small, new cv.Size(w, h), 0, 0, cv.INTER_AREA);
  const gray = new cv.Mat(); cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
  const mats = [full, small, gray];
  let result = null, method = '';
  try {
    // paper mask: bright blob
    const blur = new cv.Mat(); cv.GaussianBlur(gray, blur, new cv.Size(21, 21), 0); mats.push(blur);
    const pm = new cv.Mat(); cv.threshold(blur, pm, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU); mats.push(pm);
    const k9 = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(9, 9)); mats.push(k9);
    cv.morphologyEx(pm, pm, cv.MORPH_OPEN, k9);
    const paper = largestHullCorners(cv, pm.clone());
    // filled paper mask (hull-filled) for restricting ink search
    let paperQ = null;
    if (paper) {
      paperQ = paper.corners;
      const filled = cv.Mat.zeros(h, w, cv.CV_8U); mats.push(filled);
      const pv = cv.matFromArray(4, 1, cv.CV_32SC2, paperQ.flatMap(p => [p.x, p.y])); mats.push(pv);
      const mv = new cv.MatVector(); mv.push_back(pv); cv.fillPoly(filled, mv, new cv.Scalar(255)); mv.delete();
      const ke = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(41, 41)); mats.push(ke);
      cv.erode(filled, filled, ke);
      // ink: black-hat within paper
      const bh = new cv.Mat(), kb = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(13, 13)); mats.push(bh, kb);
      cv.morphologyEx(gray, bh, cv.MORPH_BLACKHAT, kb);
      cv.GaussianBlur(bh, bh, new cv.Size(3, 3), 0);
      const ink = new cv.Mat(); mats.push(ink);
      cv.threshold(bh, ink, 14, 255, cv.THRESH_BINARY);
      cv.bitwise_and(ink, filled, ink);
      const kc = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(31, 31)); mats.push(kc);
      cv.morphologyEx(ink, ink, cv.MORPH_CLOSE, kc);
      const kr = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9)); mats.push(kr);
      cv.morphologyEx(ink, ink, cv.MORPH_OPEN, kr);
      if (dbg) dbg.ink = ink.clone();
      const t = largestHullCorners(cv, ink);
      if (t) {
        const asp = (dist(t.corners[0], t.corners[1]) + dist(t.corners[3], t.corners[2])) / (dist(t.corners[0], t.corners[3]) + dist(t.corners[1], t.corners[2]));
        const frac = quadArea(t.corners) / (w * h);
        if (Math.abs(asp / TEMPLATE.aspect - 1) < 0.2 && frac > 0.15) { result = t.corners; method = 'table'; }
      }
    }
    if (!result && paperQ) {
      // fallback: paper quad, shrink to the table using the known table margins on the printed sheet
      const m = TEMPLATE.paperFallback; // {l,t,r,b} fractions of paper quad
      const P = paperQ; const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      const tp = (u, v) => { const top = lerp(P[0], P[1], u), bot = lerp(P[3], P[2], u); return lerp(top, bot, v); };
      result = [tp(m.l, m.t), tp(1 - m.r, m.t), tp(1 - m.r, 1 - m.b), tp(m.l, 1 - m.b)]; method = 'paper';
    }
  } finally { mats.forEach(m => m.delete && m.delete()); }
  if (!result) return null;
  const corners = result.map(p => ({ x: p.x / scale, y: p.y / scale }));
  return { corners, method };
}


// Table corners in the coordinates of srcCanvas (full native resolution). When the table is small in the frame (or only the paper
// outline was found) a second pass crops around the sheet and upsamples it so the dotted border is at the scale the detector expects.
export async function findCorners(srcCanvas, dbg) {
  const first = await findCornersCore(srcCanvas, dbg);
  const tableW = first ? (dist(first.corners[0], first.corners[1]) + dist(first.corners[3], first.corners[2])) / 2 : 0;
  const maxEdge = Math.max(srcCanvas.width, srcCanvas.height);
  if (first && first.method === 'table' && tableW > 0.35 * maxEdge) { first.tableWidth = tableW; return first; }
  if (!first) return null;
  // crop around the estimate, generous margin (the estimate may be the paper-based guess)
  const xs = first.corners.map(p => p.x), ys = first.corners.map(p => p.y);
  const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys), mg = 0.3;
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - bw * mg)), y0 = Math.max(0, Math.floor(Math.min(...ys) - bh * mg));
  const x1 = Math.min(srcCanvas.width, Math.ceil(Math.max(...xs) + bw * mg)), y1 = Math.min(srcCanvas.height, Math.ceil(Math.max(...ys) + bh * mg));
  const crop = document.createElement('canvas'); const up = Math.min(3, Math.max(1, 1900 / Math.max(x1 - x0, y1 - y0)));
  crop.width = Math.round((x1 - x0) * up); crop.height = Math.round((y1 - y0) * up);
  const g = crop.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(srcCanvas, x0, y0, x1 - x0, y1 - y0, 0, 0, crop.width, crop.height);
  const second = await findCornersCore(crop, dbg);
  let best = first;
  if (second && second.method === 'table') {
    best = { method: 'table', corners: second.corners.map(p => ({ x: x0 + p.x / up, y: y0 + p.y / up })) };
  }
  best.tableWidth = (dist(best.corners[0], best.corners[1]) + dist(best.corners[3], best.corners[2])) / 2;
  return best;
}

// Coarse warp: the rough quad, grown by GRID.grow, drawn at CW x CH. The lattice fit does the precise work afterwards.
export async function coarseWarp(srcCanvas, corners) {
  const cv = await loadCV(); const [TL, TR, BR, BL] = corners, g = GRID.grow;
  const at = (u, v) => ({ x: (TL.x * (1 - u) + TR.x * u) * (1 - v) + (BL.x * (1 - u) + BR.x * u) * v, y: (TL.y * (1 - u) + TR.y * u) * (1 - v) + (BL.y * (1 - u) + BR.y * u) * v });
  const q = [at(-g.l, -g.t), at(1 + g.r, -g.t), at(1 + g.r, 1 + g.b), at(-g.l, 1 + g.b)];
  const src = cv.imread(srcCanvas), dst = new cv.Mat();
  const s = cv.matFromArray(4, 1, cv.CV_32FC2, q.flatMap(p => [p.x, p.y])), d = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, GRID.CW, 0, GRID.CW, GRID.CH, 0, GRID.CH]);
  const M = cv.getPerspectiveTransform(s, d);
  cv.warpPerspective(src, dst, M, new cv.Size(GRID.CW, GRID.CH), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
  const canvas = document.createElement('canvas'); canvas.width = GRID.CW; canvas.height = GRID.CH; cv.imshow(canvas, dst);
  [src, dst, s, d, M].forEach(m => m.delete());
  return canvas;
}

// ---------- analysis maps on the warped canvas ----------
// D: darkness 0..1 relative to local paper (Float32Array, W*H). Dsm: lightly blurred copy.
// C: chroma 0..255 (Uint8Array) of colour-balanced image (0 for grayscale photos). grayPhoto: bool.
export async function analyse(canvas) {
  const cv = await loadCV();
  const W = canvas.width, H = canvas.height;
  const rgba = cv.imread(canvas), rgb = new cv.Mat();
  cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
  const gray = new cv.Mat(); cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
  const ker = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(17, 17));
  // paper-brightness estimate at 1/4 resolution (closing removes marks up to ~64px), then upsampled
  const bgOf = (m) => {
    const sm = new cv.Mat(), b = new cv.Mat(); cv.resize(m, sm, new cv.Size(W >> 2, H >> 2), 0, 0, cv.INTER_AREA);
    cv.morphologyEx(sm, sm, cv.MORPH_CLOSE, ker); cv.GaussianBlur(sm, sm, new cv.Size(11, 11), 0);
    cv.resize(sm, b, new cv.Size(W, H), 0, 0, cv.INTER_LINEAR); sm.delete(); return b;
  };
  const bg = bgOf(gray);
  const rat = new cv.Mat(); cv.divide(gray, bg, rat, 255, cv.CV_8U);
  const d8 = new cv.Mat(); cv.bitwise_not(rat, d8);
  const sm = new cv.Mat(); cv.GaussianBlur(d8, sm, new cv.Size(0, 0), 1.2);
  const D = new Float32Array(W * H), Dsm = new Float32Array(W * H);
  { const dd = d8.data, sd = sm.data, N = W * H; for (let i = 0; i < N; i++) { D[i] = dd[i] / 255; Dsm[i] = sd[i] / 255; } }
  // chroma on balanced channels
  const ch = new cv.MatVector(); cv.split(rgb, ch);
  const bal = [];
  for (let c = 0; c < 3; c++) {
    const b = bgOf(ch.get(c)), o = new cv.Mat();
    cv.divide(ch.get(c), b, o, 255, cv.CV_8U); bal.push(o); b.delete();
  }
  const C = new Uint8Array(W * H); let hist = 0;
  const r = bal[0].data, g = bal[1].data, b = bal[2].data;
  for (let i = 0; i < W * H; i++) {
    const mx = Math.max(r[i], g[i], b[i]), mn = Math.min(r[i], g[i], b[i]);
    // only count pixels that are noticeably darker than paper (ink), chroma = spread
    C[i] = (mx < 235 || true) ? mx - mn : 0;
    if (C[i] > 40) hist++;
  }
  const grayPhoto = hist < W * H * 0.0003;
  [rgba, rgb, gray, ker, bg, rat, d8, sm, ch, ...bal].forEach(m => m.delete && m.delete());
  return { W, H, D, Dsm, C, grayPhoto };
}

// ring score: mean darkness on a superellipse ring minus mean on a ring just outside it (used by dev/lab calibration)
const RING_CACHE = {};
function ringTable(n) {
  if (RING_CACHE[n]) return RING_CACHE[n];
  const N = 28, t = [], e = 2 / n;
  for (let k = 0; k < N; k++) { const a = (k / N) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a); t.push([Math.sign(c) * Math.pow(Math.abs(c), e), Math.sign(sn) * Math.pow(Math.abs(sn), e)]); }
  return (RING_CACHE[n] = t);
}
export function ringScore(A, cx, cy, rx, ry, n = 2) {
  const { W, H, Dsm } = A; const tab = ringTable(n); let on = 0, off = 0, cnt = 0;
  for (let k = 0; k < tab.length; k++) {
    const ex = tab[k][0], ey = tab[k][1];
    for (let f = 0; f < 2; f++) {
      const m = f ? 1.28 : 1;
      const x = Math.round(cx + ex * rx * m), y = Math.round(cy + ey * ry * m);
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
      const i = y * W + x;
      let v = Dsm[i]; const q = [Dsm[i - 1], Dsm[i + 1], Dsm[i - W], Dsm[i + W], Dsm[i - W - 1], Dsm[i - W + 1], Dsm[i + W - 1], Dsm[i + W + 1]];
      for (let j = 0; j < 8; j++) if (q[j] > v) v = q[j];
      if (f) off += v; else { on += v; cnt++; }
    }
  }
  return cnt ? (on - off) / cnt : -1;
}

// ---------- tunables ----------
export const OPTS = {
  inner: 0.72,            // part of the bubble (radius fraction) whose darkness counts as fill
  minScale: 0.16,         // smallest paper-to-pencil darkness step the sheet may be normalised by
  blankMax: 0.22,         // best bubble below this: the group is blank
  markMin: 0.5,           // a mark must be at least this dark (relative to the sheet's own pencil) to be read without review
  loneRatio: 0.5,         // runner-up must stay below this share of the winner for a clean read
  multiRatio: 0.75,       // runner-up at or above this share of the winner (and itself a mark): two answers
  coverFull: 0.55,        // a real fill darkens at least this share of the bubble; less than that scales the reading down
  centerMax: 0.8,         // mark centroid further than this (in bubble radii) from the bubble centre: flag
  colorChroma: 26, colorMinPx: 30, colorRatio: 0.45,
  shapeMin: 0.24, shapeInner: 0.14, shapeTail: 0.08, shapeRatio: 0.6,
};

function bil(D, W, H, x, y) {
  if (x < 0 || y < 0 || x >= W - 1 || y >= H - 1) return 0;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * W + x0;
  return D[i] * (1 - fx) * (1 - fy) + D[i + 1] * fx * (1 - fy) + D[i + W] * (1 - fx) * fy + D[i + W + 1] * fx * fy;
}

// Mean darkness inside the bubble, and how far the dark mass sits from the bubble centre (in radii).
function measureFill(A, b) {
  const { W, H, D } = A, k = OPTS.inner; let sum = 0, n = 0;
  for (let y = Math.floor(b.y - b.ry * k); y <= Math.ceil(b.y + b.ry * k); y++) for (let x = Math.floor(b.x - b.rx * k); x <= Math.ceil(b.x + b.rx * k); x++) {
    const u = (x - b.x) / (b.rx * k), v = (y - b.y) / (b.ry * k);
    if (u * u + v * v > 1 || x < 0 || y < 0 || x >= W || y >= H) continue;
    sum += D[y * W + x]; n++;
  }
  let sw = 0, sx = 0, sy = 0;
  for (let y = Math.floor(b.y - b.ry * 1.3); y <= Math.ceil(b.y + b.ry * 1.3); y++) for (let x = Math.floor(b.x - b.rx * 1.3); x <= Math.ceil(b.x + b.rx * 1.3); x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue; const u = (x - b.x) / (b.rx * 1.3), v = (y - b.y) / (b.ry * 1.3); if (u * u + v * v > 1) continue;
    const w = Math.max(0, D[y * W + x] - 0.25); sw += w; sx += w * x; sy += w * y;
  }
  return { v: n ? sum / n : 0, off: sw > 4 ? Math.hypot((sx / sw - b.x) / b.rx, (sy / sw - b.y) / b.ry) : 0 };
}

// Share of the bubble's inner area that is darker than thr.
function coverage(A, b, thr) {
  const { W, H, D } = A, k = OPTS.inner; let on = 0, n = 0;
  for (let y = Math.floor(b.y - b.ry * k); y <= Math.ceil(b.y + b.ry * k); y++) for (let x = Math.floor(b.x - b.rx * k); x <= Math.ceil(b.x + b.rx * k); x++) {
    const u = (x - b.x) / (b.rx * k), v = (y - b.y) / (b.ry * k);
    if (u * u + v * v > 1 || x < 0 || y < 0 || x >= W || y >= H) continue;
    n++; if (D[y * W + x] > thr) on++;
  }
  return n ? on / n : 0;
}

const pct = (a, p) => { const s = Float64Array.from(a).sort(); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : 0; };

// Sheet-wide normalisation. Blank level per bubble kind (empty boxes, and each printed digit 0-9 separately because the
// digit itself darkens its circle); pencil level from the darkest bubbles on this sheet. fill = 0 blank .. 1 this sheet's pencil.
function fillLevels(raw) {
  const box = [], dig = Array.from({ length: 10 }, () => []);
  for (const row of raw) for (const f of FIELDS) row[f].forEach((m, i) => { if (GRID.fields[f].two) dig[i].push(m.v); else box.push(m.v); });
  const topMean = (a) => { const t = Float64Array.from(a).sort().slice(Math.floor(a.length * 0.93)); let d = 0; t.forEach(v => { d += v; }); return d / (t.length || 1); };
  const baseBox = pct(box, 0.25), pencilBox = topMean(box) - baseBox, scaleBox = Math.max(OPTS.minScale, pencilBox);
  // A digit's blank level comes only from circles that are clearly not filled (most students mark the same tens digit,
  // so a plain percentile would learn "filled" as the blank level). Too few empty ones: borrow from the other digits.
  const empty = dig.map(d => d.filter(v => v < baseBox + 0.4 * scaleBox));
  const own = empty.map(e => (e.length >= 4 ? pct(e, 0.5) : null)), known = own.filter(v => v != null);
  const fallback = known.length ? pct(known, 0.5) : baseBox, baseDig = own.map(v => (v == null ? fallback : v));
  // the yield circles are smaller than the boxes and fill lighter, so they get their own pencil level
  const pencilDig = topMean(dig.flatMap((d, i) => d.map(v => v - baseDig[i]))), scaleDig = Math.max(OPTS.minScale * 0.75, pencilDig);
  const two = (f) => GRID.fields[f].two;
  return { base: (f, i) => (two(f) ? baseDig[i] : baseBox), scale: (f) => (two(f) ? scaleDig : scaleBox), pencil: +pencilBox.toFixed(3), pencilDigits: +pencilDig.toFixed(3) };
}

function decideFill(fill, offs) {
  const idx = fill.map((f, i) => i).sort((a, b) => fill[b] - fill[a]);
  const f1 = fill[idx[0]], f2 = fill[idx[1]];
  if (f1 < OPTS.blankMax) return { value: null, status: 'blank' };
  if (f1 >= OPTS.markMin && f2 >= OPTS.markMin && f2 >= OPTS.multiRatio * f1) return { value: null, status: 'multiple' };
  if (f1 >= OPTS.markMin && f2 < OPTS.loneRatio * f1 && offs[idx[0]] <= OPTS.centerMax) return { value: idx[0], status: 'ok' };
  return { value: idx[0], status: 'unsure' };
}

// ---- grader slash: colour mode ----
function colorSlash(A, bs) {
  const { W, H, C, D } = A; const counts = bs.map(b => {
    let c = 0; const x0 = Math.floor(b.x - b.rx * 1.2), x1 = Math.ceil(b.x + b.rx * 1.2), y0 = Math.floor(b.y - b.ry * 1.2), y1 = Math.ceil(b.y + b.ry * 1.2);
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
      const u = (x - b.x) / (b.rx * 1.2), v = (y - b.y) / (b.ry * 1.2); if (u * u + v * v > 1) continue;
      const i = y * W + x; if (C[i] > OPTS.colorChroma && D[i] > 0.07) c++;
    }
    return c;
  });
  return pickBest(counts, OPTS.colorMinPx, OPTS.colorRatio, A.grayPhoto);
}
function pickBest(scores, minV, ratio, unavailable) {
  const idx = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]);
  const s1 = scores[idx[0]], s2 = scores[idx[1]] ?? 0;
  let status = 'none', slash = null;
  if (s1 >= minV) { if (s2 >= minV && s2 >= ratio * s1) status = 'multiple'; else { status = 'ok'; slash = idx[0]; } }
  else if (s1 >= minV * 0.85) { status = 'unsure'; slash = idx[0]; }
  if (unavailable) { status = 'none'; slash = null; }
  return { slash, status, scores };
}

// ---- grader slash: shape mode (thin diagonal stroke through the bubble, extending past the outline) ----
const ANGLES = [Math.PI / 2, -Math.PI / 2]; for (let a = 25; a <= 80; a += 11) { ANGLES.push(a * Math.PI / 180); ANGLES.push(-a * Math.PI / 180); }
function lineStat(Dsm, W, H, cx, cy, dx, dy, nx, ny, lo, hi) {
  let s = 0, c = 0;
  for (let t = lo; t <= hi; t += 1.5) {
    const x = cx + dx * t, y = cy + dy * t;
    s += Math.max(bil(Dsm, W, H, x, y), bil(Dsm, W, H, x + nx, y + ny), bil(Dsm, W, H, x - nx, y - ny)); c++;
  }
  return c ? s / c : 0;
}
function shapeScore(A, b) {
  const { W, H, Dsm } = A; let best = 0;
  for (const phi of ANGLES) {
    const dx = Math.cos(phi), dy = Math.sin(phi), nx = -dy, ny = dx;
    const R = 1 / Math.sqrt((dx / b.rx) ** 2 + (dy / b.ry) ** 2);
    for (const off of [-0.22, 0, 0.22]) {
      const cx = b.x + nx * off * b.rx, cy = b.y + ny * off * b.ry;
      const inner = lineStat(Dsm, W, H, cx, cy, dx, dy, nx, ny, -0.8 * R, 0.8 * R);
      const t1 = lineStat(Dsm, W, H, cx, cy, dx, dy, nx, ny, 1.12 * R, 1.5 * R), t2 = lineStat(Dsm, W, H, cx, cy, dx, dy, nx, ny, -1.5 * R, -1.12 * R);
      let refIn = 0, refT = 0;
      for (const sd of [-0.5, 0.5]) {
        const qx = cx + nx * sd * b.rx, qy = cy + ny * sd * b.ry;
        refIn += lineStat(Dsm, W, H, qx, qy, dx, dy, nx, ny, -0.56 * R, 0.56 * R) / 2;
        refT += (lineStat(Dsm, W, H, qx, qy, dx, dy, nx, ny, 1.12 * R, 1.5 * R) + lineStat(Dsm, W, H, qx, qy, dx, dy, nx, ny, -1.5 * R, -1.12 * R)) / 4;
      }
      const ic = Math.max(0, inner - refIn), tcA = Math.max(0, t1 - refT), tcB = Math.max(0, t2 - refT);
      const tc = Math.max(tcA, tcB), tcMin = Math.min(tcA, tcB);
      // needs: stroke inside the outline, extending past it on at least one end, and the inside part must be as strong as the
      // outside part (a '-2' note beside the bubble is mostly outside)
      let sc = 0;
      if (ic >= OPTS.shapeInner && tc >= OPTS.shapeTail && ic >= 0.6 * tc) sc = 0.5 * ic + 0.3 * tc + 0.2 * tcMin;
      if (sc > best) best = sc;
    }
  }
  return best;
}
function shapeSlash(A, bs) { return pickBest(bs.map(b => shapeScore(A, b)), OPTS.shapeMin, OPTS.shapeRatio, false); }


// ---------- handwriting crops (read by digits.js) ----------
// Per row: the Written digit that sits right of the written|tens and written|ones rules (it often runs into the first
// bubble column), and the official yield in the right margin. Each crop is cut by the lattice (a perspective patch between
// the rule lines, so tilt and curl of the row are followed) at the warp's own pixel scale:
//   { canvas, rect: bounding box in warpedCanvas px, vlines: x of printed vertical rules inside the crop, masks: printed
//     bubble ellipses {x, y, rx, ry} inside the crop (all in crop px) }
export const HAND = { tens: [0.4530, 0.4960], ones: [0.6375, 0.6830], margin: [0.986, 1.19], v: [-0.05, 1.05], ringDx: 0.8, ringK: [1.15, 1.35] }; // ringDx/ringK: where the printed rings really sit vs the template ellipses, and how much to grow them
function handCrops(cv, warp, L, W, geometry) {
  const src = cv.imread(warp), out = [];
  const cut = (r, u0, u1) => {
    while (u1 > u0 + 0.02 && mapPoint(L, u1, r, HAND.v[0]).x > W - 2) u1 -= 0.005; // margin: stay inside the warp
    const [v0, v1] = HAND.v;
    const q = [mapPoint(L, u0, r, v0), mapPoint(L, u1, r, v0), mapPoint(L, u1, r, v1), mapPoint(L, u0, r, v1)];
    const w = Math.max(8, Math.round((Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) + Math.hypot(q[2].x - q[3].x, q[2].y - q[3].y)) / 2));
    const h = Math.max(8, Math.round((Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y) + Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y)) / 2));
    const s = cv.matFromArray(4, 1, cv.CV_32FC2, q.flatMap(p => [p.x, p.y])), d = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
    const M = cv.getPerspectiveTransform(s, d), dst = new cv.Mat(), m = M.data64F;
    cv.warpPerspective(src, dst, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; cv.imshow(canvas, dst);
    const dd = dst.data, nc = dst.channels(), g = new Uint8Array(w * h); // grey copy so digits.js need not read the canvas back
    for (let i = 0; i < g.length; i++) g[i] = nc === 1 ? dd[i] : (0.299 * dd[i * nc] + 0.587 * dd[i * nc + 1] + 0.114 * dd[i * nc + 2] + 0.5) | 0;
    const to = (x, y) => { const k = m[6] * x + m[7] * y + m[8]; return { x: (m[0] * x + m[1] * y + m[2]) / k, y: (m[3] * x + m[4] * y + m[5]) / k }; };
    const vlines = [];
    for (const u of GRID.cols) if (u > u0 - 0.002 && u < u1 + 0.002) { const p = mapPoint(L, u, r, 0.5), t = to(p.x, p.y); vlines.push(+t.x.toFixed(1)); }
    const masks = [];
    for (const f of FIELDS) for (const b of geometry[r][f]) { const t = to(b.x + HAND.ringDx * b.rx, b.y); if (t.x > -b.rx && t.x < w + b.rx && t.y > -b.ry && t.y < h + b.ry) masks.push({ x: +t.x.toFixed(1), y: +t.y.toFixed(1), rx: +(b.rx * HAND.ringK[0]).toFixed(1), ry: +(b.ry * HAND.ringK[1]).toFixed(1) }); }
    [s, d, M, dst].forEach(mm => mm.delete());
    const xs = q.map(p => p.x), ys = q.map(p => p.y), x = Math.min(...xs), y = Math.min(...ys);
    return { canvas, g, w, h, rect: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }, vlines, masks };
  };
  try { for (let r = 0; r < 20; r++) out.push({ tens: cut(r, ...HAND.tens), ones: cut(r, ...HAND.ones), margin: cut(r, ...HAND.margin) }); } finally { src.delete(); }
  return out;
}

// ---------- main ----------
function rotateCanvas90(c) {
  const o = document.createElement('canvas'); o.width = c.height; o.height = c.width; const g = o.getContext('2d');
  g.translate(o.width, 0); g.rotate(Math.PI / 2); g.drawImage(c, 0, 0); return o;
}

export async function readSheet(imageSource, opts = {}) {
  let canvas = await toCanvas(imageSource); const warnings = [];
  let found = await findCorners(canvas), rot = 0;
  if (!found || found.method !== 'table') {
    const r = rotateCanvas90(canvas), f2 = await findCorners(r);
    if (f2 && f2.method === 'table') { canvas = r; found = f2; rot = 90; warnings.push('image rotated 90 degrees'); }
  }
  if (!found) return { ok: false, error: 'corners', warnings: ['could not find the grading table'], corners: null, rows: null, sourceCanvas: canvas };
  if (found.tableWidth && found.tableWidth < 800) warnings.push('the sheet is small in the photo; move closer for a safer read');
  const res = await readSheetWithCorners(canvas, found.corners, opts);
  res.warnings = warnings.concat(res.warnings); res.cornerMethod = found.method; res.rotated = rot; res.sourceCanvas = canvas;
  return res;
}

export async function readSheetWithCorners(imageSource, corners, opts = {}) {
  if (opts.tune) Object.assign(OPTS, opts.tune);
  const cv = await loadCV();
  const canvas = imageSource instanceof HTMLCanvasElement ? imageSource : await toCanvas(imageSource);
  const warp = await coarseWarp(canvas, corners);
  const A = await analyse(warp);
  const L = findLattice(cv, A);
  if (!L.ok) return { ok: false, error: 'lattice', warnings: ['could not find the table lines; adjust the corners and re-read'], corners, rows: null, lattice: L.q, warpedCanvas: warp };
  const warnings = [];
  if (L.q.rowFound < 0.7 * L.q.rowTotal) warnings.push('row lines are faint in this photo; check the overlay');
  const geometry = bubbles(L);
  const raw = geometry.map(row => Object.fromEntries(FIELDS.map(f => [f, row[f].map(b => measureFill(A, b))])));
  const lv = fillLevels(raw);
  if (lv.pencil < OPTS.minScale) warnings.push('no dark pencil marks found on this sheet');
  const rows = [], marginCrops = [];
  for (let r = 0; r < 20; r++) {
    const row = {};
    for (const f of FIELDS) {
      const bs = geometry[r][f], ms = raw[r][f];
      // darkness of the bubble, discounted when the dark part covers little of it (a grader's slash or a stray stroke, not a fill)
      const fill = ms.map((m, i) => {
        const lvl = Math.max(0, Math.min(1, (m.v - lv.base(f, i)) / lv.scale(f)));
        return lvl < OPTS.blankMax ? lvl : lvl * Math.min(1, coverage(A, bs[i], lv.base(f, i) + 0.45 * lv.scale(f)) / OPTS.coverFull);
      });
      const d = decideFill(fill, ms.map(m => m.off));
      const col = colorSlash(A, bs), sh = shapeSlash(A, bs);
      const pick = col.status === 'ok' || col.status === 'multiple' ? { m: 'color', r: col } : { m: 'shape', r: sh };
      row[f] = { value: d.value, status: d.status, fill, slash: pick.r.slash, slashStatus: pick.r.status, slashMode: pick.m,
        slashes: { color: { slash: col.slash, status: col.status, scores: col.scores }, shape: { slash: sh.slash, status: sh.status, scores: sh.scores } } };
    }
    rows.push(row);
    if (opts.marginCrops) {
      const last = GRID.cols.length - 1, ym = (L.rowY(r, A.W) + L.rowY(r + 1, A.W)) / 2;
      const x0 = Math.round(L.colX(last, ym)) + 3, mw = Math.max(20, Math.min(A.W - x0, Math.round(0.2 * (L.colX(last, ym) - L.colX(0, ym)))));
      const y0 = Math.max(0, Math.round(L.rowY(r, x0) - 6)), y1 = Math.min(A.H, Math.round(L.rowY(r + 1, x0) + 6));
      const c = document.createElement('canvas'); c.width = mw; c.height = y1 - y0;
      c.getContext('2d').drawImage(warp, x0, y0, mw, y1 - y0, 0, 0, mw, y1 - y0); marginCrops.push(c);
    }
  }
  if (A.grayPhoto) warnings.push('no coloured ink found: only shape slash mode applies');
  // view box of the table inside the warp (for cropped overlays)
  const last = GRID.cols.length - 1, bx = [L.colX(0, L.rowY(0, 0)), L.colX(0, L.rowY(20, 0)), L.colX(last, L.rowY(0, A.W)), L.colX(last, L.rowY(20, A.W))];
  const view = { x0: Math.max(0, Math.min(bx[0], bx[1]) - 50), x1: Math.min(A.W, Math.max(bx[2], bx[3]) + 12), y0: Math.max(0, Math.min(L.rowY(0, 0), L.rowY(0, A.W)) - 12), y1: Math.min(A.H, Math.max(L.rowY(20, 0), L.rowY(20, A.W)) + 12) };
  return { ok: true, warpedCanvas: warp, corners, rows, warnings, geometry, lattice: L.q, levels: { pencil: lv.pencil, pencilDigits: lv.pencilDigits }, view, marginCrops: opts.marginCrops ? marginCrops : null, grayPhoto: A.grayPhoto, hand: opts.hand ? handCrops(cv, warp, L, A.W, geometry) : null };
}

// ---------- overlay ----------
// green = read as the answer, orange = dark but not a clean read, thin blue = empty; magenta diagonal = detected grader slash.
// Cropped to the table.
export function drawOverlay(res, target) {
  const v = res.view || { x0: 0, y0: 0, x1: res.warpedCanvas.width, y1: res.warpedCanvas.height };
  const c = target || document.createElement('canvas'); c.width = Math.round(v.x1 - v.x0); c.height = Math.round(v.y1 - v.y0);
  const g = c.getContext('2d'); g.drawImage(res.warpedCanvas, -v.x0, -v.y0); g.translate(-v.x0, -v.y0);
  res.rows.forEach((row, r) => FIELDS.forEach(f => {
    const rd = row[f], bs = res.geometry[r][f];
    bs.forEach((b, i) => {
      const marked = rd.value === i && rd.status === 'ok';
      g.lineWidth = marked ? 3 : rd.fill[i] >= 0.4 ? 2.5 : 1;
      g.strokeStyle = marked ? '#0b0' : (rd.fill[i] >= 0.4 ? '#f80' : 'rgba(0,110,255,0.5)');
      g.beginPath(); g.ellipse(b.x, b.y, b.rx + 2, b.ry + 2, 0, 0, Math.PI * 2); g.stroke();
      if (rd.slash === i && rd.slashStatus !== 'none') { g.lineWidth = 2; g.strokeStyle = '#d0d'; g.beginPath(); g.moveTo(b.x - b.rx - 4, b.y + b.ry + 4); g.lineTo(b.x + b.rx + 4, b.y - b.ry - 4); g.stroke(); }
    });
  }));
  return c;
}
