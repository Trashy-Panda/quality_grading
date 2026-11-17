// grid.js - registers the sheet from its printed table lines (21 row separators x 10 column separators).
// The bubbles are faint dotted outlines that pencil and grader marks cover, so they are a poor thing to register on;
// the ruled lines are long, redundant and have a spacing signature that cannot be confused by one bubble pitch.
// Works on the analysis maps of a coarse warp (table roughly centred, any small tilt/curl/perspective left in).
import { GRID } from './template.js';

export const GOPTS = { lineThr: 0.13, hOpen: 51, vOpen: 41, close: 5 };

// Binary masks of long horizontal / vertical dark runs.
export function lineMasks(cv, A, o = GOPTS) {
  const { W, H, Dsm } = A;
  const bin = new cv.Mat(H, W, cv.CV_8U);
  { const bd = bin.data, N = W * H; for (let i = 0; i < N; i++) bd[i] = Dsm[i] > o.lineThr ? 255 : 0; }
  const mk = (w, h) => cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(w, h));
  const run = (dil, clo, ope) => {
    const m = new cv.Mat(); cv.dilate(bin, m, dil); cv.morphologyEx(m, m, cv.MORPH_CLOSE, clo); cv.morphologyEx(m, m, cv.MORPH_OPEN, ope);
    const out = new Uint8Array(W * H), md = m.data; for (let i = 0; i < W * H; i++) out[i] = md[i] ? 1 : 0;
    [m, dil, clo, ope].forEach(x => x.delete()); return out;
  };
  const Hm = run(mk(1, 3), mk(o.close, 1), mk(o.hOpen, 1));
  const Vm = run(mk(3, 1), mk(1, o.close), mk(1, o.vOpen));
  bin.delete();
  return { Hm, Vm };
}

// Fraction of the span [a,b) covered by line pixels, per position along the other axis. Tries a few shears so a tilted
// line still piles up on one bin. horiz=true: profile over y of horizontal lines within x in [a,b).
export function profile(mask, W, H, horiz, a, b, kLo = -0.06, kHi = 0.06, lo = 0, hi = horiz ? H : W) {
  const n = horiz ? H : W, mid = (a + b) / 2; let best = null, bestE = -1, bestK = 0;
  for (let k = kLo; k <= kHi + 1e-4; k += 0.01) {
    const Q = new Float32Array(n);
    if (horiz) { for (let y = lo; y < hi; y++) { const o = y * W; for (let x = a; x < b; x += 2) if (mask[o + x]) { const yy = y - Math.round(k * (x - mid)); if (yy >= 0 && yy < n) Q[yy]++; } } }
    else { for (let y = a; y < b; y += 2) { const o = y * W, sh = Math.round(k * (y - mid)); for (let x = lo; x < hi; x++) if (mask[o + x]) { const xx = x - sh; if (xx >= 0 && xx < n) Q[xx]++; } } }
    let e = 0; const d = (b - a) / 2; for (let i = 0; i < n; i++) { Q[i] /= d; e += Q[i] * Q[i]; }
    if (e > bestE) { bestE = e; best = Q; bestK = k; }
  }
  const S = new Float32Array(n);
  for (let i = 0; i < n; i++) S[i] = Math.min(1, (best[Math.max(0, i - 1)] + best[i] * 2 + best[Math.min(n - 1, i + 1)]) / 3);
  return { S, k: bestK };
}

function boxMax(S, r) { const n = S.length, o = new Float32Array(n); for (let i = 0; i < n; i++) { let m = 0; for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) if (S[j] > m) m = S[j]; o[i] = m; } return o; }
function peakNear(S, x, r, min) { let b = -1, bv = min; for (let i = Math.max(1, Math.round(x - r)); i <= Math.min(S.length - 2, Math.round(x + r)); i++) if (S[i] > bv) { bv = S[i]; b = i; } if (b < 0) return null; let sw = 0, sx = 0; for (let i = b - 2; i <= b + 2; i++) { const v = S[i] || 0; sw += v; sx += v * i; } return { x: sx / sw, v: bv }; }

// Fit positions pos_i = a + s * t_i (t = template coordinates, any unit) to a line profile.
// absent: template positions where there must be NO line (penalised). Returns {a, s, score}.
export function fitComb(S, t, absent, sLo, sHi, sStep, aLo, aHi, aStep, tol) {
  const M = boxMax(S, tol), n = S.length; let best = { score: -1e9 };
  const at = (v) => { const i = Math.round(v); return i < 0 || i >= n ? 0 : M[i]; };
  for (let s = sLo; s <= sHi; s += sStep) for (let a = aLo; a <= aHi; a += aStep) {
    let sc = 0; for (let i = 0; i < t.length; i++) sc += at(a + s * t[i]);
    for (let i = 0; i < absent.length; i++) sc -= 1.5 * at(a + s * absent[i]);
    if (sc > best.score) best = { a, s, score: sc };
  }
  return best;
}

// Robust polynomial (deg 1 or 2) fit of v over u with outlier rejection; returns evaluator and inlier flags.
export function robustPoly(us, vs, deg, thr) {
  let use = us.map((_, i) => i).filter(i => vs[i] != null); const all = use.slice();
  const solve = (idx) => {
    const m = deg + 1, A = Array.from({ length: m }, () => new Array(m + 1).fill(0));
    for (const i of idx) { const p = [1, us[i], us[i] * us[i]]; for (let r = 0; r < m; r++) { for (let c = 0; c < m; c++) A[r][c] += p[r] * p[c]; A[r][m] += p[r] * vs[i]; } }
    for (let c = 0; c < m; c++) { let pv = c; for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[pv][c])) pv = r; [A[c], A[pv]] = [A[pv], A[c]]; if (Math.abs(A[c][c]) < 1e-12) return null; for (let r = 0; r < m; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= m; k++) A[r][k] -= f * A[c][k]; } }
    return A.map((row, r) => row[m] / row[r]);
  };
  if (use.length < deg + 2) return null;
  // start from the median-residual consensus: iterate fit / reject
  let c = solve(use);
  for (let it = 0; it < 5 && c; it++) {
    const ev = (u) => c[0] + c[1] * u + (deg > 1 ? c[2] * u * u : 0);
    const res = all.map(i => Math.abs(vs[i] - ev(us[i]))), srt = res.slice().sort((x, y) => x - y), medr = srt[srt.length >> 1];
    const lim = Math.max(thr, it < 2 ? 2.5 * medr : 0);
    const keep = all.filter((i, j) => res[j] <= lim); if (keep.length < deg + 2) break;
    const c2 = solve(keep); if (!c2) break; c = c2; use = keep;
  }
  if (!c) return null;
  const ev = (u) => c[0] + c[1] * u + (deg > 1 ? c[2] * u * u : 0);
  return { ev, inliers: use, c };
}

// Row comb with a perspective term: y_k = a + s (k-10) + c (k-10)^2, k = 0..20. Run on the grade column, where the header
// above the first row has no horizontal line for four pitches: no line is allowed at k = -3..-1 and 21..23, which pins
// the phase (which printed line is fleece 1) even when the bottom rows are faint.
function fitRows(S, pNom) {
  const n = S.length; let best = { score: -1e9 };
  const search = (M, cs, ss, as) => {
    for (const c of cs) for (const s of ss) for (const a of as) {
      let sc = 0;
      for (let k = -3; k <= 23; k++) { const d = k - 10, i = Math.round(a + s * d + c * d * d); const v = i < 0 || i >= n ? 0 : M[i]; sc += (k < 0 || k > 20) ? -1.5 * v : v; }
      if (sc > best.score) best = { a, s, c, score: sc };
    }
  };
  const range = (lo, hi, st) => { const o = []; for (let v = lo; v <= hi + 1e-9; v += st) o.push(v); return o; };
  search(boxMax(S, 4), range(-0.8, 0.8, 0.08), range(pNom * 0.78, pNom * 1.22, 0.4), range(0, n - 1, 2));
  const b = best; best = { score: -1e9 };
  search(boxMax(S, 2), range(b.c - 0.08, b.c + 0.08, 0.02), range(b.s - 0.4, b.s + 0.4, 0.1), range(b.a - 4, b.a + 4, 1));
  return best;
}

// Column comb with a perspective term: x = a + s (t - 0.5) + c (t - 0.5)^2 for the template positions t (0..1).
function fitCols(S, t, aLo, aHi, aStep, sLo, sHi, sStep, cLo, cHi, cStep, tol) {
  const M = boxMax(S, tol), n = S.length, d = t.map(v => v - 0.5), d2 = d.map(v => v * v), dl = -(t[1] - t[0]) - 0.5; let best = { score: -1e9 };
  for (let c = cLo; c <= cHi + 1e-9; c += cStep) for (let s = sLo; s <= sHi + 1e-9; s += sStep) for (let a = aLo; a <= aHi + 1e-9; a += aStep) {
    let sc = 0; for (let i = 0; i < d.length; i++) { const x = Math.round(a + s * d[i] + c * d2[i]); if (x >= 0 && x < n) sc += M[x]; }
    { const x = Math.round(a + s * dl + c * dl * dl); if (x >= 0 && x < n) sc -= M[x]; } // a line one number-column left of the border: we are one line off
    if (sc > best.score) best = { a, s, c, score: sc };
  }
  return best;
}

// Find the lattice. Returns { ok, rowY(k, x), colX(i, y), q } where k = 0..20 (row separators), i = index into GRID.cols.
export function findLattice(cv, A, o = {}) {
  const { W, H } = A; const { Hm, Vm } = lineMasks(cv, A);
  const dbg = { Hm, Vm }, warn = [];
  // ---- rows: global comb first (pitch + phase), then per-band snapping ----
  const xa = Math.round(W * 0.11), xb = Math.round(W * 0.29);
  const g = profile(Hm, W, H, true, xa, xb, -0.16, 0.16);
  const tRows = Array.from({ length: 21 }, (_, k) => k);
  const pNom = H * GRID.pitchFrac;
  const fine = fitRows(g.S, pNom), rowAt = (k) => fine.a + fine.s * (k - 10) + fine.c * (k - 10) * (k - 10);
  dbg.rowFit = fine; dbg.rowProfile = g.S;
  // Bands across the sheet. The global fit is only trusted near the middle; each band outwards is predicted from the
  // band before it (lines are continuous), so rows that fan out under perspective are still followed to the edges.
  const NB = 8, bandX = [], bandY = new Array(NB);
  const x0 = W * 0.06, x1 = W * 0.85, bw = (x1 - x0) / NB, xMid = (xa + xb) / 2;
  let rowFound = 0;
  for (let b = 0; b < NB; b++) bandX.push(x0 + (b + 0.5) * bw);
  const doBand = (b, pred, k0) => {
    const a = Math.round(x0 + b * bw), e = Math.round(a + bw);
    const p = profile(Hm, W, H, true, a, e, k0 - 0.04, k0 + 0.04);
    const ys = tRows.map(k => { const pk = peakNear(p.S, pred[k], fine.s * 0.2, 0.3); return pk ? pk.x : null; });
    const rp = robustPoly(tRows, ys, 2, 4);
    bandY[b] = tRows.map(k => { if (!rp) return pred[k]; const m = rp.ev(k); return ys[k] != null && Math.abs(ys[k] - m) <= 4 ? ys[k] : m; });
    rowFound += ys.filter(v => v != null).length;
  };
  let mid = 1; while (mid < NB - 1 && bandX[mid] < xMid) mid++;
  for (const b of [mid - 1, mid]) doBand(b, tRows.map(k => rowAt(k) + g.k * (bandX[b] - xMid)), g.k);
  const slope = (i, j) => (bandY[j][10] - bandY[i][10]) / (bandX[j] - bandX[i]);
  for (let b = mid + 1; b < NB; b++) doBand(b, tRows.map(k => 2 * bandY[b - 1][k] - bandY[b - 2][k]), slope(b - 2, b - 1));
  for (let b = mid - 2; b >= 0; b--) doBand(b, tRows.map(k => 2 * bandY[b + 1][k] - bandY[b + 2][k]), slope(b + 1, b + 2));
  const rowY = (k, x) => {
    if (x <= bandX[0]) { const t = (x - bandX[0]) / (bandX[1] - bandX[0]); return bandY[0][k] + (bandY[1][k] - bandY[0][k]) * t; }
    let i = 0; while (i < NB - 2 && x > bandX[i + 1]) i++;
    const t = (x - bandX[i]) / (bandX[i + 1] - bandX[i]); return bandY[i][k] + (bandY[i + 1][k] - bandY[i][k]) * t;
  };
  // ---- columns: per band of rows, fit the template's column signature, then smooth each line down the sheet ----
  // The column spacing signature is unique only if the fit is close to linear, so the perspective term is not searched
  // freely: it is predicted from the rows (row pitch at the left vs the right of the sheet tells how fast the scale
  // changes across the page; along that direction lengths change twice as fast) and only refined a little.
  const tc = GRID.cols, VB = 10, perBand = [], bandMid = [];
  const midX = W * 0.45, sNom = W * GRID.widthFrac, xL = bandX[1], xR = bandX[NB - 2];
  for (let b = 0; b < VB; b++) {
    const ya = Math.round(rowY(b * 2, midX)) + 4, yb = Math.round(rowY(b * 2 + 2, midX)) - 4;
    const p = profile(Vm, W, H, false, ya, yb, -g.k - 0.07, -g.k + 0.07);
    const k0 = Math.max(0, b * 2 - 3), k1 = Math.min(20, b * 2 + 5);
    const pL = rowY(k1, xL) - rowY(k0, xL), pR = rowY(k1, xR) - rowY(k0, xR), rel = (pR - pL) / ((pR + pL) / 2) / (xR - xL);
    const cPred = Math.max(-0.12, Math.min(0.12, rel * sNom)) * sNom;
    const f = fitCols(p.S, tc, W * 0.15, W * 0.75, 2, sNom * 0.8, sNom * 1.2, sNom * 0.004, cPred - sNom * 0.03, cPred + sNom * 0.03, sNom * 0.01, 5);
    const f1 = fitCols(p.S, tc, f.a - 5, f.a + 5, 1, f.s - sNom * 0.005, f.s + sNom * 0.005, sNom * 0.001, f.c - sNom * 0.01, f.c + sNom * 0.01, sNom * 0.0025, 2);
    const at = (t) => f1.a + f1.s * (t - 0.5) + f1.c * (t - 0.5) * (t - 0.5);
    const xs = tc.map(t => { const e = at(t), pk = peakNear(p.S, e, 7, 0.25) || peakNear(p.S, e, 14, 0.45); return pk ? pk.x : null; });
    perBand.push({ fit: f1, xs, S: p.S, cPred }); bandMid.push((ya + yb) / 2);
  }
  dbg.colBands = perBand;
  const colFn = tc.map((t, i) => {
    const vs = perBand.map(pb => pb.xs[i]); const rp = robustPoly(bandMid, vs, 2, 5);
    if (rp && rp.inliers.length >= 5) return { ev: rp.ev, n: rp.inliers.length };
    return { ev: null, n: rp ? rp.inliers.length : 0 };
  });
  // lines too weak to trace on their own are placed from the fitted template between their traced neighbours
  const okIdx = colFn.map((c, i) => c.ev ? i : -1).filter(i => i >= 0);
  const colX = (i, y) => {
    if (colFn[i].ev) return colFn[i].ev(y);
    const lo = okIdx.filter(j => j < i).pop(), hi = okIdx.find(j => j > i);
    if (lo != null && hi != null) { const xl = colFn[lo].ev(y), xh = colFn[hi].ev(y); return xl + (xh - xl) * (tc[i] - tc[lo]) / (tc[hi] - tc[lo]); }
    const a = lo != null ? lo : hi, b2 = lo != null ? okIdx[okIdx.indexOf(lo) - 1] : okIdx[okIdx.indexOf(hi) + 1];
    const xa2 = colFn[a].ev(y), xb2 = colFn[b2].ev(y); return xa2 + (xb2 - xa2) * (tc[i] - tc[a]) / (tc[b2] - tc[a]);
  };
  const q = { rowScore: +(fine.score / 21).toFixed(3), rowFound, rowTotal: NB * 21, colTraced: okIdx.length, colTotal: tc.length, colN: colFn.map(c => c.n), pitch: +fine.s.toFixed(2), bend: +fine.c.toFixed(3) };
  const ok = q.rowScore > 0.3 && rowFound >= 0.6 * NB * 21 && okIdx.length >= 5 && okIdx.includes(okIdx[0]) && (tc[okIdx[okIdx.length - 1]] - tc[okIdx[0]]) > 0.6;
  if (!ok) warn.push('table lines not found');
  return { ok, rowY, colX, q, warn, dbg };
}

// Map a template point (u = x in column-template units, k + v = row index + fraction of the row) into the canvas.
export function mapPoint(L, u, k, v) {
  const tc = GRID.cols; let i = 0; while (i < tc.length - 2 && u > tc[i + 1]) i++;
  // two-pass: x depends on y (columns lean), y depends on x (rows tilt)
  let x = 0, y = L.rowY(k, 0) + v * (L.rowY(k + 1, 0) - L.rowY(k, 0));
  for (let it = 0; it < 3; it++) {
    const xa = L.colX(i, y), xb = L.colX(i + 1, y); x = xa + (xb - xa) * (u - tc[i]) / (tc[i + 1] - tc[i]);
    const ya = L.rowY(k, x), yb = L.rowY(k + 1, x); y = ya + v * (yb - ya);
  }
  return { x, y, h: L.rowY(k + 1, x) - L.rowY(k, x), w: (L.colX(i + 1, y) - L.colX(i, y)) / (tc[i + 1] - tc[i]) };
}

// All bubble ellipses from the lattice: out[r][field] = [{x, y, rx, ry}] (yield fields: index = digit, 0-4 on the upper line).
export function bubbles(L, fields = GRID.fields, G = GRID) {
  const out = [];
  for (let r = 0; r < 20; r++) {
    const row = {};
    for (const f of Object.keys(fields)) {
      const T = fields[f], list = [];
      for (let line = T.two ? 0 : 1; line < 2; line++) for (let k = 0; k < T.n; k++) {
        const p = mapPoint(L, T.u0 + k * T.du, r, T.v - (line === 0 ? G.dv : 0));
        list.push({ x: p.x, y: p.y, rx: T.ru * p.w, ry: G.rv * p.h });
      }
      row[f] = list;
    }
    out.push(row);
  }
  return out;
}
