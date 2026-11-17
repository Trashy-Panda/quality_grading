// omr.js - in-browser OMR for the wool grading sheet. Requires OpenCV.js (loaded lazily from a pinned CDN).
import { TEMPLATE, FIELDS, groupCenters } from './template-v1.js';
export { FIELDS };

export const OPENCV_URL = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js';
export const WARP_W = 1500;
export const WARP_H = Math.round(WARP_W / TEMPLATE.aspect);
export const MARGIN_W = 320; // extra px right of the table kept for the handwritten yield-note crops
const WORK_EDGE = 2000;


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

async function toCanvas(src) {
  if (typeof src === 'string') {
    src = await new Promise((res, rej) => { const i = new Image(); i.addEventListener('load', () => res(i)); i.addEventListener('error', () => rej(new Error('image load failed'))); i.src = src; });
  } else if (typeof Blob !== 'undefined' && src instanceof Blob) {
    const bmp = await createImageBitmap(src, { imageOrientation: 'from-image' });
    src = bmp;
  }
  const w = src.naturalWidth || src.videoWidth || src.width, h = src.naturalHeight || src.videoHeight || src.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

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

function mat3ToArray(m) { return Array.from(m.data64F); }

// Warp the table quad to a fixed WARP_W x WARP_H canvas. Returns {canvas, Hinv} (Hinv: warped->source, 3x3 row-major).
export async function warpTable(srcCanvas, corners, withMargin = false) {
  const cv = await loadCV();
  const src = cv.imread(srcCanvas), dst = new cv.Mat();
  const s = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flatMap(p => [p.x, p.y]));
  const d = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, WARP_W, 0, WARP_W, WARP_H, 0, WARP_H]);
  const M = cv.getPerspectiveTransform(s, d), Mi = new cv.Mat(); cv.invert(M, Mi);
  const OW = WARP_W + (withMargin ? MARGIN_W : 0);
  cv.warpPerspective(src, dst, M, new cv.Size(OW, WARP_H), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
  const full = document.createElement('canvas'); full.width = OW; full.height = WARP_H; cv.imshow(full, dst);
  let canvas = full, margin = null;
  if (withMargin) { canvas = document.createElement('canvas'); canvas.width = WARP_W; canvas.height = WARP_H; canvas.getContext('2d').drawImage(full, 0, 0); margin = full; }
  const Hinv = mat3ToArray(Mi);
  [src, dst, s, d, M, Mi].forEach(m => m.delete());
  return { canvas, Hinv, full: margin };
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
  for (let i = 0; i < W * H; i++) { D[i] = d8.data[i] / 255; Dsm[i] = sm.data[i] / 255; }
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

// ring score: mean darkness on superellipse ring minus mean on a ring outside it
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
      const i = y * W + x; // local max over 3x3 tolerates 1px misplacement of the thin dotted line
      let v = Dsm[i]; const q = [Dsm[i - 1], Dsm[i + 1], Dsm[i - W], Dsm[i + W], Dsm[i - W - 1], Dsm[i - W + 1], Dsm[i + W - 1], Dsm[i + W + 1]];
      for (let j = 0; j < 8; j++) if (q[j] > v) v = q[j];
      if (f) off += v; else { on += v; cnt++; }
    }
  }
  return cnt ? (on - off) / cnt : -1;
}

// ---------- horizontal row separators ----------
// Returns 21 y positions (px in warped canvas). expected: array of 21 y (px). Uses a horizontal-line profile + Viterbi over peaks.
// Horizontal-line profile of the x range [xa,xb): dark horizontal runs accumulated along sheared directions (tilt / curl).
async function rowProfile(A, xa, xb) {
  const cv = await loadCV(); const { W, H, Dsm } = A;
  const m = new cv.Mat(H, W, cv.CV_8U);
  for (let i = 0; i < W * H; i++) m.data[i] = Dsm[i] > OPTS.sepThr ? 255 : 0;
  const kc = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(13, 1)), ko = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(61, 1));
  cv.morphologyEx(m, m, cv.MORPH_CLOSE, kc); cv.morphologyEx(m, m, cv.MORPH_OPEN, ko); kc.delete(); ko.delete();
  const xmid = (xa + xb) / 2; let P = null, bestE = -1;
  for (let k = -0.05; k <= 0.0501; k += 0.0125) {
    const Q = new Float32Array(H);
    for (let y = 0; y < H; y++) { const o = y * W; for (let x = xa; x < xb; x += 2) if (m.data[o + x]) { const yy = y - Math.round(k * (x - xmid)); if (yy >= 0 && yy < H) Q[yy]++; } }
    let e = 0; for (let y = 0; y < H; y++) { Q[y] /= ((xb - xa) / 2); e += Q[y] * Q[y]; }
    if (e > bestE) { bestE = e; P = Q; }
  }
  m.delete();
  const S = new Float32Array(H);
  for (let y = 0; y < H; y++) S[y] = (P[Math.max(0, y - 1)] + P[y] * 2 + P[Math.min(H - 1, y + 1)]) / 4;
  return S;
}
function viterbiLines(S, expected, rf) {
  const H = S.length, pitch = (expected[20] - expected[0]) / 20, R = Math.round(pitch * rf);
  const cands = expected.map(e => { const c = [{ y: e, s: 0, miss: true }]; for (let y = Math.max(2, Math.round(e - R)); y <= Math.min(H - 3, Math.round(e + R)); y++) if (S[y] >= S[y - 1] && S[y] >= S[y + 1] && S[y] > 0.12) c.push({ y, s: S[y] }); return c; });
  const cost = [], back = [];
  for (let k = 0; k < 21; k++) {
    cost.push([]); back.push([]);
    cands[k].forEach((c) => {
      const unary = c.miss ? 0.35 : -c.s;
      if (k === 0) { cost[k].push(unary); back[k].push(-1); return; }
      let bj = 0, bc = 1e9;
      cands[k - 1].forEach((p, i) => { const dev = (c.y - p.y) - pitch; const pen = (c.miss || p.miss) ? 0.15 : Math.pow(dev / (pitch * 0.12), 2) * 0.25; const t = cost[k - 1][i] + pen; if (t < bc) { bc = t; bj = i; } });
      cost[k].push(bc + unary); back[k].push(bj);
    });
  }
  let j = 0, best = 1e9; cost[20].forEach((v, i) => { if (v < best) { best = v; j = i; } });
  const sel = new Array(21);
  for (let k = 20; k >= 0; k--) { sel[k] = cands[k][j]; j = back[k][j]; }
  const ys = sel.map(c => c.miss ? null : c.y);
  for (let k = 0; k < 21; k++) if (ys[k] == null) {
    let a = k - 1; while (a >= 0 && ys[a] == null) a--; let b = k + 1; while (b < 21 && ys[b] == null) b++;
    if (a >= 0 && b < 21) ys[k] = ys[a] + (ys[b] - ys[a]) * (k - a) / (b - a);
    else if (a >= 0) ys[k] = ys[a] + pitch * (k - a); else ys[k] = ys[b] - pitch * (b - k);
  }
  return { ys, found: sel.map(c => !c.miss), pitch, cost: best };
}

// Row lines are smooth in k (perspective only changes the pitch gradually): robust quadratic fit rejects erratic detections.
function smoothLines(res) {
  const ys = res.ys.slice(); let use = res.found.map((f, k) => f ? k : -1).filter(k => k >= 0);
  if (use.length < 9) return res;
  let c = null;
  for (let it = 0; it < 4; it++) {
    // normal equations for y = c0 + c1 k + c2 k^2
    const A3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b3 = [0, 0, 0];
    for (const k of use) { const v = [1, k, k * k]; for (let i = 0; i < 3; i++) { b3[i] += v[i] * ys[k]; for (let j = 0; j < 3; j++) A3[i][j] += v[i] * v[j]; } }
    // solve 3x3 by Cramer
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(A3); if (Math.abs(D) < 1e-9) return res;
    c = [0, 1, 2].map(i => { const m = A3.map((row, r) => row.map((v, cc) => (cc === i ? b3[r] : v))); return det(m) / D; });
    const keep = use.filter(k => Math.abs(ys[k] - (c[0] + c[1] * k + c[2] * k * k)) < 9);
    if (keep.length < 8) break; use = keep;
  }
  const out = ys.map((y, k) => c[0] + c[1] * k + c[2] * k * k);
  return Object.assign({}, res, { ys: out, inliers: use.length });
}

export async function findRowLines(A, expected, dbg, xa = 40, xb = A.W - 40, rf = 0.42) {
  const S = await rowProfile(A, xa, xb); if (dbg) dbg.profile = S;
  return viterbiLines(S, expected, rf);
}
// how well do the grade bubbles sit where these separators say the rows are (decides which detected line is row 1's top)
// Every column counts: the header has ring-like print above the grade column, but nothing like the 20 yield digit circles per row.
function rowEvidence(A, ys) {
  let tot = 0;
  for (let r = 0; r < 20; r++) {
    for (const f of FIELDS) {
      const pts = groupCenters(f, ys[r] / WARP_H, ys[r + 1] / WARP_H), T = TEMPLATE.fields[f]; let best = -9;
      for (let dy = -6; dy <= 6; dy += 3) for (let dx = -18; dx <= 18; dx += 6) { let t = 0; for (const p of pts) t += ringScore(A, p.x * WARP_W + dx, p.y * WARP_H + dy, T.rx * WARP_W, T.ry * WARP_H, T.sup); best = Math.max(best, t / pts.length); }
      tot += best;
    }
  }
  return tot / (20 * FIELDS.length);
}


// ---------- vertical column lines ----------
// Finds the x of the vertical separators inside rows [r0,r1). The three right-hand lines (little tilt) are located first with a
// narrow window; their median shift then predicts where the wide-spread grade|length line is.
async function findColLines(A, sepYs, r0, r1) {
  const cv = await loadCV(); const { W, H, Dsm } = A;
  const ya = Math.round(sepYs[r0]) + 6, yb = Math.round(sepYs[r1]) - 6, n = yb - ya;
  const m = new cv.Mat(H, W, cv.CV_8U);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m.data[y * W + x] = (y >= ya && y < yb && Dsm[y * W + x] > 0.12) ? 255 : 0;
  const kc = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, 15)), ko = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, 61)), kd = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 1));
  cv.dilate(m, m, kd); cv.morphologyEx(m, m, cv.MORPH_CLOSE, kc); cv.morphologyEx(m, m, cv.MORPH_OPEN, ko); kd.delete(); kc.delete(); ko.delete();
  const P = new Float32Array(W);
  for (let y = ya; y < yb; y++) for (let x = 0; x < W; x++) if (m.data[y * W + x]) P[x]++;
  m.delete();
  const peak = (e, half) => {
    let bb = 0, bx = -1; for (let q = Math.max(3, Math.round(e - half)); q < Math.min(W - 3, e + half); q++) { const v = (P[q - 1] + P[q] * 2 + P[q + 1]) / 4 / n; if (v > bb) { bb = v; bx = q; } }
    if (bx < 0 || bb < 0.1) return null;
    let sw = 0, sx = 0; for (let q = bx - 3; q <= bx + 3; q++) { sw += P[q]; sx += P[q] * q; }
    return { x: sx / sw, v: bb };
  };
  const tx = TEMPLATE.colLines.map(v => v * W), out = new Array(tx.length).fill(null);
  const shifts = [];
  for (let i = 1; i < tx.length; i++) { const r = peak(tx[i], 55); if (r) { out[i] = r.x; shifts.push(r.x - tx[i]); } }
  shifts.sort((a, b) => a - b); const s0 = shifts.length ? shifts[shifts.length >> 1] : 0;
  const r0p = peak(tx[0] + s0, 70); out[0] = r0p ? r0p.x : null;
  return out;
}
function makeXMap(anchors) { // anchors: array of detected x (null = missing) aligned with TEMPLATE.colLines (normalized); returns f(xNorm)->xNorm
  const pts = []; TEMPLATE.colLines.forEach((tx, i) => { if (anchors[i] != null) pts.push([tx, anchors[i] / WARP_W]); });
  // reject non-monotone / wildly off anchors
  const ok = pts.filter(p => Math.abs(p[1] - p[0]) < 0.06);
  if (ok.length < 2) return x => x;
  return x => {
    let i = 0; while (i < ok.length - 2 && x > ok[i + 1][0]) i++;
    const a = ok[i], b = ok[i + 1]; return a[1] + (x - a[0]) * (b[1] - a[1]) / (b[0] - a[0]);
  };
}

// ---------- tunables ----------
export const OPTS = {
  regHalf: 24, phaseGain: 0.02, phaseMin: 0.03, phaseMargin: 0.025, sepThr: 0.28, regMinScore: 0.05, snapX: 45, snapY: 8, snapMin: 0.04,
  fillScale: 0.30,        // raw excess darkness that maps to fill = 1
  markMin: 0.40, blankMax: 0.2, okMin: 0.55, alignMin: 0.025, centerMax: 0.6,          // fill needed for a bubble to count as marked
  multiRatio: 0.7,       // runner-up/winner ratio that makes a group 'multiple'
  colorChroma: 26, colorMinPx: 30, colorRatio: 0.45,
  shapeMin: 0.24, shapeInner: 0.14, shapeTail: 0.08, shapeRatio: 0.6,
};

function snapGroup(A, field, centers, seed, rx_, ry_) {
  const f = TEMPLATE.fields[field];
  const rx = f.rx * WARP_W, ry = f.ry * WARP_H, x0c = centers[0].x * WARP_W;
  const score = (ox, oy, sx) => { let s = 0; for (const c of centers) s += ringScore(A, x0c + (c.x * WARP_W - x0c) * sx + ox, c.y * WARP_H + oy, rx, ry, f.sup); return s / centers.length; };
  let best = -9, bx = seed.ox, by = seed.oy, bs = 1;
  for (let oy = seed.oy - ry_; oy <= seed.oy + ry_; oy += 2) for (let ox = seed.ox - rx_; ox <= seed.ox + rx_; ox += 3) { const sc = score(ox, oy, 1); if (sc > best) { best = sc; bx = ox; by = oy; } }
  const cx = bx, cy = by;
  for (let oy = cy - 2; oy <= cy + 2; oy++) for (let ox = cx - 2; ox <= cx + 2; ox++) { const sc = score(ox, oy, 1); if (sc > best) { best = sc; bx = ox; by = oy; } }
  if (centers.length >= 3 && best >= OPTS.snapMin) {
    const ox0 = bx;
    for (let sx = 0.92; sx <= 1.081; sx += 0.02) for (let ox = ox0 - 4; ox <= ox0 + 4; ox += 1) { const sc = score(ox, by, sx); if (sc > best + 0.002) { best = sc; bx = ox; bs = sx; } }
  }
  return { ox: bx, oy: by, sx: bs, x0c, score: best };
}

const med = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
function bil(D, W, H, x, y) {
  if (x < 0 || y < 0 || x >= W - 1 || y >= H - 1) return 0;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * W + x0;
  return D[i] * (1 - fx) * (1 - fy) + D[i + 1] * fx * (1 - fy) + D[i + W] * (1 - fx) * fy + D[i + W + 1] * fx * fy;
}

// fill: darkness of the interior (median resists printed digit strokes)
function measureFill(A, b) {
  const { W, H, D } = A; const vals = []; let sum = 0;
  const x0 = Math.floor(b.x - b.rx * 0.8), x1 = Math.ceil(b.x + b.rx * 0.8), y0 = Math.floor(b.y - b.ry * 0.8), y1 = Math.ceil(b.y + b.ry * 0.8);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const u = (x - b.x) / (b.rx * 0.8), v = (y - b.y) / (b.ry * 0.8);
    if (u * u + v * v > 1 || x < 0 || y < 0 || x >= W || y >= H) continue;
    const d = D[y * W + x]; vals.push(d); sum += d;
  }
  if (!vals.length) return { v: 0, off: 0 };
  vals.sort((a, c) => a - c);
  // darkness centroid within a slightly larger ellipse: a real mark sits on the bubble, a mis-registered geometry does not
  let sw = 0, sx = 0, sy = 0;
  for (let y = Math.floor(b.y - b.ry * 1.3); y <= Math.ceil(b.y + b.ry * 1.3); y++) for (let x = Math.floor(b.x - b.rx * 1.3); x <= Math.ceil(b.x + b.rx * 1.3); x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue; const u = (x - b.x) / (b.rx * 1.3), v2 = (y - b.y) / (b.ry * 1.3); if (u * u + v2 * v2 > 1) continue;
    const w = Math.max(0, D[y * W + x] - 0.2); sw += w; sx += w * x; sy += w * y;
  }
  const off = sw > 4 ? Math.hypot((sx / sw - b.x) / b.rx, (sy / sw - b.y) / b.ry) : 0;
  return { v: 0.6 * vals[vals.length >> 1] + 0.4 * (sum / vals.length), off };
}

function decideFill(raws, align, offs) {
  const n = raws.length, sorted = raws.slice().sort((a, b) => a - b);
  const base = sorted[Math.floor((n - 1) * 0.3)];
  const fill = raws.map(r => Math.max(0, Math.min(1, (r - base) / OPTS.fillScale)));
  const idx = fill.map((f, i) => i).sort((a, b) => fill[b] - fill[a]);
  const f1 = fill[idx[0]], f2 = fill[idx[1]];
  let status, value = null;
  if (f1 < OPTS.blankMax) status = 'blank';
  else if (f1 < OPTS.markMin) { status = 'unsure'; value = idx[0]; }
  else if (f2 >= OPTS.markMin && f2 >= OPTS.multiRatio * f1) status = 'multiple';
  else if ((f2 > 0.45 * f1 && f2 > 0.3) || f1 < OPTS.okMin) { status = 'unsure'; value = idx[0]; }
  else { status = 'ok'; value = idx[0]; }
  // mark not centred on the bubble: geometry probably mis-registered
  if (status === 'ok' && offs && offs[idx[0]] > OPTS.centerMax) status = 'unsure';
  // poorly aligned group: never claim a confident answer
  if (align < OPTS.alignMin && status !== 'unsure') { value = status === 'blank' ? null : idx[0]; status = 'unsure'; if (value == null && f1 >= 0.2) value = idx[0]; }
  return { fill, value, status };
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

// ---------- main ----------
function rotateCanvas90(c) {
  const o = document.createElement('canvas'); o.width = c.height; o.height = c.width; const g = o.getContext('2d');
  g.translate(o.width, 0); g.rotate(Math.PI / 2); g.drawImage(c, 0, 0); return o;
}

export async function readSheet(imageSource, opts = {}) {
  let canvas = await toCanvas(imageSource); const warnings = [];
  let found = null, rot = 0;
  if (!opts.corners) {
    found = await findCorners(canvas);
    if (!found || found.method !== 'table') {
      const r = rotateCanvas90(canvas), f2 = await findCorners(r);
      if (f2 && f2.method === 'table') { canvas = r; found = f2; rot = 90; warnings.push('image rotated 90 degrees'); }
    }
    if (!found) return { ok: false, error: 'corners', warnings: ['could not find the grading table'], corners: null, rows: null, sourceCanvas: canvas };
    if (found.method !== 'table') warnings.push('table border not found; used paper outline (check corners)');
  }
  const corners = opts.corners || found.corners;
  if (found && found.tableWidth && found.tableWidth < 900) warnings.push('move closer');
  const res = await readSheetWithCorners(canvas, corners, opts);
  res.warnings = warnings.concat(res.warnings); res.cornerMethod = found ? found.method : 'given'; res.rotated = rot; res.sourceCanvas = canvas;
  return res;
}




// ---------- lattice phase check ----------
// A group's bubbles look alike, so a registration that is off by one pitch (or one yield line) still "fits". Compare the group's
// lattice with copies shifted by one pitch / one line: real bubbles must have outlines, and the cells just outside the group must not.
function localBest(A, x, y, rx, ry, sup) {
  let b = -9; for (const dy of [-2, 0, 2]) for (const dx of [-3, 0, 3]) { const v = ringScore(A, x + dx, y + dy, rx, ry, sup); if (v > b) b = v; } return b;
}
function groupPhase(A, f, bs) {
  const T = TEMPLATE.fields[f], rx = T.rx * WARP_W, ry = T.ry * WARP_H, pitch = T.dx * WARP_W, vy = T.two ? TEMPLATE.dyY * WARP_H : 0, n = T.n;
  const xs = bs.slice(0, n).map(b => b.x), rowsY = T.two ? [bs[0].y, bs[n].y] : [bs[0].y];
  const hyps = [[0, 0], [-pitch, 0], [pitch, 0]]; if (T.two) hyps.push([0, -vy], [0, vy]);
  const sc = hyps.map(([ox, oy]) => {
    let on = 0, c = 0; for (const y of rowsY) for (const x of xs) { on += localBest(A, x + ox, y + oy, rx, ry, T.sup); c++; }
    on /= c;
    const ph = []; for (const y of rowsY) { ph.push(localBest(A, xs[0] - pitch + ox, y + oy, rx, ry, T.sup)); ph.push(localBest(A, xs[n - 1] + pitch + ox, y + oy, rx, ry, T.sup)); }
    if (T.two) { ph.push(localBest(A, xs[2] + ox, rowsY[0] - vy + oy, rx, ry, T.sup)); ph.push(localBest(A, xs[2] + ox, rowsY[1] + vy + oy, rx, ry, T.sup)); }
    return on - 0.6 * Math.max(0, ...ph);
  });
  let bi = 0; sc.forEach((v, i) => { if (v > sc[bi]) bi = i; });
  const second = Math.max(...sc.filter((v, i) => i !== bi));
  let shift = [0, 0];
  if (bi !== 0 && sc[bi] > sc[0] + OPTS.phaseGain) shift = hyps[bi];
  const best = shift[0] || shift[1] ? sc[bi] : sc[0];
  const margin = best - Math.max(...sc.filter((v, i) => hyps[i][0] !== shift[0] || hyps[i][1] !== shift[1]));
  return { shift, confident: best >= OPTS.phaseMin && margin >= OPTS.phaseMargin, score: best, margin, sc, hyps };
}

// Columns run straight down the sheet, so a row whose group sits a whole pitch away from its neighbours' is wrong, and the
// column-wide choice of lattice phase (summed over all rows) is far more reliable than any one row's.
// geo[r][f] = bubbles (mutated), phs[r][f] = groupPhase result, good[r] = row registration ok. Returns aligned[r][f] booleans.
function alignColumns(geo, phs, good) {
  const aligned = Array.from({ length: 20 }, () => ({}));
  for (const f of FIELDS) {
    const T = TEMPLATE.fields[f], pitch = T.dx * WARP_W, vy = T.two ? TEMPLATE.dyY * WARP_H : 0;
    const hyps = phs[0][f].hyps, tot = hyps.map(() => 0);
    for (let r = 0; r < 20; r++) if (good[r]) phs[r][f].sc.forEach((v, i) => { tot[i] += v; });
    let hb = 0; tot.forEach((v, i) => { if (v > tot[hb]) hb = i; });
    const [sx, sy] = hyps[hb];
    for (let r = 0; r < 20; r++) geo[r][f].forEach(b => { b.x += sx; b.y += sy; });
    // Per row, two independent opinions on the sideways phase: (a) a robust straight line x(r) down the column (Theil-Sen on
    // positions folded to the nearest pitch, so a run of slipped rows can't drag it), (b) the row's own lattice evidence.
    // Paper curl bends columns, so (a) alone can be wrong; when they disagree the row is left unsure instead of guessed.
    const xs = geo.map(g => g[f][0].x), gr = [];
    for (let r = 0; r < 20; r++) if (good[r]) gr.push(r);
    if (gr.length < 6) { for (let r = 0; r < 20; r++) aligned[r][f] = false; continue; }
    const m0 = med(gr.map(r => xs[r])), fold = (r) => xs[r] - Math.round((xs[r] - m0) / pitch) * pitch;
    const slopes = []; for (let i = 0; i < gr.length; i++) for (let j = i + 1; j < gr.length; j++) slopes.push((fold(gr[j]) - fold(gr[i])) / (gr[j] - gr[i]));
    const slope = med(slopes), icpt = med(gr.map(r => fold(r) - slope * r));
    const hypIdx = (ox, oy) => hyps.findIndex(h => Math.abs(h[0] - ox) < 1 && Math.abs(h[1] - oy) < 1);
    for (let r = 0; r < 20; r++) {
      const dev = xs[r] - (icpt + slope * r);
      const kx = Math.round(dev / pitch), res = dev - kx * pitch, sc = phs[r][f].sc;
      const cur = hypIdx(sx, sy), alt = hypIdx(sx - kx * pitch, sy);
      // the row's own best phase (relative to the column choice)
      let own = cur; sc.forEach((v, i) => { if (hyps[i][1] === sy && v > sc[own] + OPTS.phaseGain) own = i; });
      let ok = good[r] && Math.abs(res) < 0.3 * pitch;
      if (kx === 0) ok = ok && own === cur;                       // line and row agree on "stay"
      else if (alt >= 0 && own === alt) geo[r][f].forEach(b => { b.x -= kx * pitch; }); // both say "move one"
      else ok = false;                                              // they disagree: leave it, flag unsure
      aligned[r][f] = ok;
    }
  }
  return aligned;
}

// ---------- bubble-based registration ----------
// Every predicted bubble is searched for its printed outline; a per-row model (dx,dy linear in x) is fitted robustly (RANSAC)
// and rows whose fit is poor borrow from the nearest good rows and are flagged.
function bubbleSearch(A, f, cx, cy, half, step) {
  const T = TEMPLATE.fields[f], rx = T.rx * WARP_W, ry = T.ry * WARP_H;
  let best = -9, bx = 0, by = 0;
  for (let dy = -half; dy <= half; dy += step) for (let dx = -half; dx <= half; dx += step) { const sc = ringScore(A, cx + dx, cy + dy, rx, ry, T.sup); if (sc > best) { best = sc; bx = dx; by = dy; } }
  if (step > 1) { const cx0 = bx, cy0 = by; for (let dy = cy0 - step + 1; dy <= cy0 + step - 1; dy++) for (let dx = cx0 - step + 1; dx <= cx0 + step - 1; dx++) { const sc = ringScore(A, cx + dx, cy + dy, rx, ry, T.sup); if (sc > best) { best = sc; bx = dx; by = dy; } } }
  return { dx: bx, dy: by, score: best };
}
const XC = WARP_W / 2;
function lsLine(pts, key, wfn) { // weighted LS of key vs (x-XC)
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) { const w = wfn(p), x = p.x - XC, y = p[key]; sw += w; sx += w * x; sy += w * y; sxx += w * x * x; sxy += w * x * y; }
  const den = sw * sxx - sx * sx; if (sw <= 0 || Math.abs(den) < 1e-6) return { a: sw > 0 ? sy / sw : 0, b: 0 };
  const b = (sw * sxy - sx * sy) / den; return { a: (sy - b * sx) / sw, b };
}
function fitRow(pts, thr, minW) {
  const P = pts.filter(p => p.w >= minW);
  if (P.length < 6) return null;
  let best = -1, bm = null;
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    const dxp = P[j].x - P[i].x; if (Math.abs(dxp) < 40) continue;
    const b = (P[j].dx - P[i].dx) / dxp, d = (P[j].dy - P[i].dy) / dxp; if (Math.abs(b) > 0.06 || Math.abs(d) > 0.06) continue;
    const a = P[i].dx - b * (P[i].x - XC), c = P[i].dy - d * (P[i].x - XC);
    let cnt = 0; for (const p of P) if (Math.abs(p.dx - (a + b * (p.x - XC))) < thr && Math.abs(p.dy - (c + d * (p.x - XC))) < thr) cnt += p.w;
    if (cnt > best) { best = cnt; bm = { a, b, c, d }; }
  }
  if (!bm) return null;
  for (let it = 0; it < 2; it++) {
    const inl = P.filter(p => Math.abs(p.dx - (bm.a + bm.b * (p.x - XC))) < thr && Math.abs(p.dy - (bm.c + bm.d * (p.x - XC))) < thr);
    if (inl.length < 4) break;
    const lx = lsLine(inl, 'dx', p => p.w), ly = lsLine(inl, 'dy', p => p.w); bm = { a: lx.a, b: lx.b, c: ly.a, d: ly.b };
  }
  const inl = P.filter(p => Math.abs(p.dx - (bm.a + bm.b * (p.x - XC))) < thr && Math.abs(p.dy - (bm.c + bm.d * (p.x - XC))) < thr);
  let se = 0; for (const p of inl) se += (p.dx - (bm.a + bm.b * (p.x - XC))) ** 2 + (p.dy - (bm.c + bm.d * (p.x - XC))) ** 2;
  return Object.assign(bm, { inl: inl.length, tot: pts.length, rms: inl.length ? Math.sqrt(se / inl.length) : 99 });
}
// borrow parameters for poor rows from the nearest good rows (linear interpolation down the sheet)
function fillPoor(models, good) {
  const idx = good.map((g, i) => g ? i : -1).filter(i => i >= 0);
  return models.map((m, r) => {
    if (good[r]) return m;
    if (!idx.length) return { a: 0, b: 0, c: 0, d: 0 };
    const lo = idx.filter(i => i < r).pop(), hi = idx.find(i => i > r);
    const key = ['a', 'b', 'c', 'd']; const o = {};
    for (const k of key) o[k] = lo == null ? models[hi][k] : hi == null ? models[lo][k] : models[lo][k] + (models[hi][k] - models[lo][k]) * (r - lo) / (hi - lo);
    return o;
  });
}
function registerAll(A, pred) {
  const Z = () => ({ a: 0, b: 0, c: 0, d: 0 });
  const apply = (m, x, y) => ({ x: x + m.a + m.b * (x - XC), y: y + m.c + m.d * (x - XC) });
  const stages = [[OPTS.regHalf, 3, 3.5], [8, 2, 2.5], [4, 1, 2.0]];
  let models = Array.from({ length: 20 }, Z), good = Array(20).fill(false), last = null;
  stages.forEach(([half, step, thr], si) => {
    const fits = [], owns = [];
    for (let r = 0; r < 20; r++) {
      const pts = [], own = {};
      for (const f of FIELDS) pred[r][f].forEach((c, i) => {
        const q = apply(models[r], c.x, c.y), s = bubbleSearch(A, f, q.x, q.y, half, step);
        pts.push({ f, i, x: q.x, y: q.y, dx: s.dx, dy: s.dy, w: Math.max(0, s.score) }); own[f + i] = { s, qx: q.x, qy: q.y };
      });
      fits.push(fitRow(pts, thr, OPTS.regMinScore)); owns.push(own);
    }
    const ok = fits.map(m => !!m && m.inl >= Math.max(8, 0.25 * m.tot) && m.rms <= thr);
    const comp = models.map((m, r) => { const f = fits[r] && ok[r] ? fits[r] : Z(); return { a: m.a + f.a, b: m.b + f.b, c: m.c + f.c, d: m.d + f.d }; });
    // a row model that jumps away from both neighbours (more than the sheet could bend) is not trusted
    const good2 = ok.slice();
    for (let r = 0; r < 20; r++) if (good2[r]) {
      const nb = [r - 1, r + 1].filter(k => k >= 0 && k < 20 && ok[k]);
      if (nb.length === 2 && !nb.some(k => Math.abs(comp[r].a - comp[k].a) < 12 && Math.abs(comp[r].c - comp[k].c) < 10)) good2[r] = false;
    }
    const filled = fillPoor(comp, good2);
    models = filled; good = good2; last = { fits, owns, ok: good2 };
  });
  const out = [];
  for (let r = 0; r < 20; r++) {
    const geo = {}, f2 = last.fits[r];
    for (const f of FIELDS) geo[f] = pred[r][f].map((c, i) => {
      const q = apply(models[r], c.x, c.y), o = last.owns[r][f + i];
      // use the bubble's own match when it agrees with the row model (within 3px), else the model
      let x = q.x, y = q.y;
      if (good[r] && o.s.score >= OPTS.regMinScore) { const ox = o.qx + o.s.dx, oy = o.qy + o.s.dy; if (Math.abs(ox - q.x) <= 3 && Math.abs(oy - q.y) <= 3) { x = ox; y = oy; } }
      return { x, y, score: o.s.score };
    });
    out.push({ geo, q: { good: good[r], inliers: f2 ? f2.inl : 0, total: f2 ? f2.tot : 0, rms: f2 ? +f2.rms.toFixed(2) : null, model: models[r] } });
  }
  return out;
}

export async function readSheetWithCorners(imageSource, corners, opts = {}) {
  if (opts.tune) Object.assign(OPTS, opts.tune);
  const canvas = imageSource instanceof HTMLCanvasElement ? imageSource : await toCanvas(imageSource);
  const warnings = [];
  const w = await warpTable(canvas, corners, !!opts.marginCrops);
  const A = await analyse(w.canvas);
  const expected = TEMPLATE.sepY.map(v => v * WARP_H);
  const prof = { all: await rowProfile(A, 40, A.W - 40), L: await rowProfile(A, 60, 520), M: await rowProfile(A, 560, 1180), R: await rowProfile(A, 1200, 1450) };
  // the detected lines can include the header rules; pick the line-to-row assignment that puts bubbles where the rows say
  let sep = null, bestEv = -9, shift = 0;
  // the found border sometimes includes a strip above the title bar, so row 1 can sit up to ~1 row higher or lower than the
  // map says; rowEvidence (all columns) decides which detected line is row 1's top
  for (const d of [0, -40, 40, -81, 81]) { const cand = smoothLines(viterbiLines(prof.all, expected.map(v => v + d), 0.5)); const ev = rowEvidence(A, cand.ys); if (!sep || (ev > bestEv + 0.004)) { bestEv = ev; sep = cand; shift = d; } }
  const bandX = [290, 850, 1330];
  const bands = [smoothLines(viterbiLines(prof.L, sep.ys, 0.62)), smoothLines(viterbiLines(prof.M, sep.ys, 0.62)), smoothLines(viterbiLines(prof.R, sep.ys, 0.62))];
  const sepAt = (k, x) => { if (x <= bandX[0]) return bands[0].ys[k]; if (x >= bandX[2]) return bands[2].ys[k]; const i = x < bandX[1] ? 0 : 1, t = (x - bandX[i]) / (bandX[i + 1] - bandX[i]); return bands[i].ys[k] * (1 - t) + bands[i + 1].ys[k] * t; };
  const missing = sep.found.filter(f => !f).length;
  if (missing > 6) warnings.push('only ' + (21 - missing) + '/21 row lines found; check corners');
  const rows = [], geometry = [], marginCrops = [];
  const fxOf = (f) => (TEMPLATE.fields[f].x0 + TEMPLATE.fields[f].dx * (TEMPLATE.fields[f].n - 1) / 2) * WARP_W;
  const colTop = await findColLines(A, sep.ys, 0, 10), colBot = await findColLines(A, sep.ys, 10, 20);
  const mapTop = makeXMap(colTop), mapBot = makeXMap(colBot);
  const xmapFor = (r) => { const t = Math.max(0, Math.min(1, (r - 4.5) / 10)); return x => mapTop(x) * (1 - t) + mapBot(x) * t; };
  const centersFor = (r, f) => { const xm = xmapFor(r); return groupCenters(f, sepAt(r, fxOf(f)) / WARP_H, sepAt(r + 1, fxOf(f)) / WARP_H).map(c => ({ x: xm(c.x), y: c.y })); };
  // initial prediction: tilt-aware separators + column lines; bubble-based registration then refines it
  const pred = []; for (let r = 0; r < 20; r++) { pred.push({}); for (const f of FIELDS) pred[r][f] = centersFor(r, f).map(c => ({ x: c.x * WARP_W, y: c.y * WARP_H })); }
  const reg = registerAll(A, pred);
  const rowQuality = reg.map(o => o.q);
  const poorRows = rowQuality.filter(q => !q.good).length;
  if (poorRows > 0) warnings.push(poorRows + ' of 20 rows could not be aligned reliably; those are marked unsure');
  // pass 1: registered geometry + per-group phase evidence; then make columns agree across rows
  const G = [], PH = [];
  for (let r = 0; r < 20; r++) {
    G.push({}); PH.push({});
    for (const f of FIELDS) {
      const T = TEMPLATE.fields[f];
      G[r][f] = reg[r].geo[f].map(c => ({ x: c.x, y: c.y, rx: T.rx * WARP_W, ry: T.ry * WARP_H }));
      PH[r][f] = groupPhase(A, f, G[r][f]);
    }
  }
  const aligned = alignColumns(G, PH, rowQuality.map(q => q.good));
  for (let r = 0; r < 20; r++) {
    const row = {}, geo = {};
    for (const f of FIELDS) {
      const rg = reg[r].geo[f], ph = PH[r][f];
      const s = { score: rg.reduce((a, b) => a + b.score, 0) / rg.length };
      const bs = G[r][f];
      geo[f] = bs;
      const ms = bs.map(b => measureFill(A, b)); const fr = decideFill(ms.map(m => m.v), aligned[r][f] ? 1 : 0, ms.map(m => m.off));
      const col = colorSlash(A, bs), sh = shapeSlash(A, bs);
      const pick = col.status === 'ok' || col.status === 'multiple' ? { m: 'color', r: col } : { m: 'shape', r: sh };
      row[f] = { value: fr.value, status: fr.status, fill: fr.fill, slash: pick.r.slash, slashStatus: pick.r.status, slashMode: pick.m,
        slashes: { color: { slash: col.slash, status: col.status, scores: col.scores }, shape: { slash: sh.slash, status: sh.status, scores: sh.scores } }, snapScore: s.score, phase: { shift: ph.shift, score: +ph.score.toFixed(3), margin: +ph.margin.toFixed(3) } };
    }
    rows.push(row); geometry.push(geo);
    if (opts.marginCrops && w.full) {
      const y0 = Math.max(0, Math.round(sep.ys[r] - 6)), y1 = Math.min(WARP_H, Math.round(sep.ys[r + 1] + 6));
      const c = document.createElement('canvas'); c.width = MARGIN_W; c.height = y1 - y0;
      c.getContext('2d').drawImage(w.full, WARP_W, y0, MARGIN_W, y1 - y0, 0, 0, MARGIN_W, y1 - y0); marginCrops.push(c);
    }
  }
  if (A.grayPhoto) warnings.push('no coloured ink found: only shape slash mode applies');
  return { ok: true, warpedCanvas: w.canvas, corners, rows, warnings, geometry, colLines: { top: colTop, bottom: colBot }, rowQuality, bandLines: bands.map(b => b.ys), rowLines: sep.ys, Hinv: w.Hinv, warpSize: [WARP_W, WARP_H], marginCrops: opts.marginCrops ? marginCrops : null, grayPhoto: A.grayPhoto };
}

// ---------- overlay ----------
// green = marked, orange = filled but not decisive, blue = blank; magenta diagonal = detected slash.
export function drawOverlay(res, target) {
  const c = target || document.createElement('canvas'); c.width = res.warpedCanvas.width; c.height = res.warpedCanvas.height;
  const g = c.getContext('2d'); g.drawImage(res.warpedCanvas, 0, 0); g.lineWidth = 2;
  res.rows.forEach((row, r) => FIELDS.forEach(f => {
    const rd = row[f], bs = res.geometry[r][f];
    bs.forEach((b, i) => {
      const marked = rd.value === i && rd.status === 'ok';
      g.strokeStyle = marked ? '#0a0' : (rd.fill[i] >= 0.4 ? '#e80' : 'rgba(0,120,255,0.55)');
      g.beginPath(); g.ellipse(b.x, b.y, b.rx, b.ry, 0, 0, Math.PI * 2); g.stroke();
      if (rd.slash === i && rd.slashStatus !== 'none') { g.strokeStyle = '#d0d'; g.beginPath(); g.moveTo(b.x - b.rx, b.y + b.ry); g.lineTo(b.x + b.rx, b.y - b.ry); g.stroke(); }
    });
  }));
  return c;
}
