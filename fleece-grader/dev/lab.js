// dev lab: coarse warp + line masks, for measuring / debugging the lattice
import { loadCV, findCorners, analyse, ringScore, coarseWarp } from '../omr.js';
import { GRID } from '../template.js';
import { lineMasks, profile, fitComb, findLattice, mapPoint, bubbles } from '../grid.js';
export async function load(url) { const i = new Image(); i.src = url; await i.decode(); const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext('2d').drawImage(i, 0, 0); return c; }
export function grow(q, E) { const cx = q.reduce((a, p) => a + p.x, 0) / 4, cy = q.reduce((a, p) => a + p.y, 0) / 4; return q.map(p => ({ x: cx + (p.x - cx) * (1 + 2 * E), y: cy + (p.y - cy) * (1 + 2 * E) })); }
export const coarse = coarseWarp;
export async function masks(url) {
  const cv = await loadCV(); const src = await load(url); const f = await findCorners(src); const c = await coarse(src, f.corners); const A = await analyse(c);
  const m = lineMasks(cv, A); const o = document.createElement('canvas'); o.width = A.W; o.height = A.H; const g = o.getContext('2d'); g.drawImage(c, 0, 0);
  const id = g.getImageData(0, 0, A.W, A.H); for (let i = 0; i < A.W * A.H; i++) { if (m.Hm[i]) { id.data[i * 4] = 255; id.data[i * 4 + 1] = 0; id.data[i * 4 + 2] = 0; } if (m.Vm[i]) { id.data[i * 4] = 0; id.data[i * 4 + 1] = 60; id.data[i * 4 + 2] = 255; } }
  g.putImageData(id, 0, 0);
  return { A, m, canvas: o, plain: c, method: f.method };
}
export function peaks(S, min) { const o = []; for (let i = 2; i < S.length - 2; i++) if (S[i] >= min && S[i] >= S[i - 1] && S[i] > S[i + 1]) { if (o.length && i - o[o.length - 1][0] < 5) { if (S[i] > o[o.length - 1][1]) o[o.length - 1] = [i, +S[i].toFixed(2)]; } else o.push([i, +S[i].toFixed(2)]); } return o; }
export { profile, fitComb, GRID, findLattice, mapPoint };
export async function lattice(url) {
  const cv = await loadCV(); const src = await load(url); const f = await findCorners(src); const c = await coarse(src, f.corners); const A = await analyse(c);
  const L = findLattice(cv, A); return { A, L, plain: c, method: f.method };
}
export function drawLattice(r) {
  const o = document.createElement('canvas'); o.width = r.A.W; o.height = r.A.H; const g = o.getContext('2d'); g.drawImage(r.plain, 0, 0); const L = r.L;
  g.lineWidth = 1.5; g.strokeStyle = '#f00';
  for (let k = 0; k <= 20; k++) { g.beginPath(); for (let x = L.colX(0, L.rowY(k, 800)); x <= L.colX(GRID.cols.length - 1, L.rowY(k, 800)); x += 20) g.lineTo(x, L.rowY(k, x)); g.stroke(); }
  g.strokeStyle = '#06f';
  GRID.cols.forEach((t, i) => { g.beginPath(); for (let y = L.rowY(0, 800); y <= L.rowY(20, 800); y += 20) g.lineTo(L.colX(i, y), y); g.stroke(); });
  return o;
}

export { bubbles };
// ring-score calibration of the bubble template on a (blank) sheet: coordinate descent on u0, du, v per field, then dv, rv
export function calibrate(r) {
  const F = JSON.parse(JSON.stringify(GRID.fields)), G = { dv: GRID.dv, rv: GRID.rv };
  const score = (f) => { const one = { [f]: F[f] }, B = bubbles(r.L, one, G); let s = 0, c = 0; for (const row of B) for (const b of row[f]) { s += ringScore(r.A, b.x, b.y, b.rx, b.ry, F[f].sup); c++; } return s / c; };
  const all = () => Object.keys(F).reduce((a, f) => a + score(f), 0);
  const log = {};
  for (let pass = 0; pass < 3; pass++) {
    for (const f of Object.keys(F)) {
      for (const [key, half, step] of [['u0', 0.006, 0.0003], ['du', 0.0012, 0.00004], ['v', 0.06, 0.004], ['ru', 0.002, 0.0002]]) {
        const base = F[f][key]; let best = -9, bv = base;
        for (let v = base - half; v <= base + half + 1e-12; v += step) { F[f][key] = v; const s = score(f); if (s > best) { best = s; bv = v; } }
        F[f][key] = +bv.toFixed(5); log[f] = +best.toFixed(4);
      }
    }
    for (const [key, half, step] of [['dv', 0.05, 0.004], ['rv', 0.03, 0.004]]) {
      const base = G[key]; let best = -9, bv = base;
      for (let v = base - half; v <= base + half + 1e-12; v += step) { G[key] = v; const s = all(); if (s > best) { best = s; bv = v; } }
      G[key] = +bv.toFixed(4);
    }
  }
  return { F, G, log };
}
export function drawBubbles(r, B, color = '#0c0') {
  const o = drawLattice(r), g = o.getContext('2d'); g.strokeStyle = color; g.lineWidth = 1.2;
  for (const row of B) for (const f of Object.keys(row)) for (const b of row[f]) { g.beginPath(); g.ellipse(b.x, b.y, b.rx, b.ry, 0, 0, 7); g.stroke(); }
  return o;
}
