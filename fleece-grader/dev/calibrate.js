// Derives template geometry from the blank photo. Run from calibrate.html.
import { findCorners, warpTable, analyse, ringScore, findRowLines, WARP_W, WARP_H } from '../omr.js';

// initial guesses in warped px (1500x2000) - refined by ring-score search
const GUESS = {
  rowBase0: 431, pitch: 81,
  fields: {
    grade:     { n: 10, x0: 115, dx: 39.25, yo: 0, rx: 16, ry: 13.5, sup: 3 },
    length:    { n: 3, x0: 543, dx: 40.5, yo: 0, rx: 16, ry: 13.5, sup: 3 },
    yieldTens: { n: 5, x0: 732, dx: 39.5, yo: 0, rx: 13, ry: 13, sup: 2, two: true },
    yieldOnes: { n: 5, x0: 1000, dx: 39.3, yo: 0, rx: 13, ry: 13, sup: 2, two: true },
    purity:    { n: 2, x0: 1235, dx: 38, yo: 0, rx: 16, ry: 13.5, sup: 3 },
    character: { n: 3, x0: 1350, dx: 40, yo: 0, rx: 16, ry: 13.5, sup: 3 },
  },
  dyY: 40,
};

function groupScore(A, f, x0, dx, y, dyY) {
  let s = 0, c = 0;
  const rows = f.two ? [y - dyY, y] : [y];
  for (const yy of rows) for (let k = 0; k < f.n; k++) { s += ringScore(A, x0 + k * dx, yy, f.rx, f.ry, f.sup); c++; }
  return s / c;
}
function search(fn, ranges) { // coordinate-descent grid search; ranges: [[center, halfrange, step]...]
  let cur = ranges.map(r => r[0]), best = fn(cur);
  for (let pass = 0; pass < 3; pass++) {
    ranges.forEach((r, i) => {
      const [, half, step] = r; const base = cur[i];
      for (let v = base - half; v <= base + half + 1e-9; v += step) { const t = cur.slice(); t[i] = v; const s = fn(t); if (s > best) { best = s; cur = t; } }
    });
  }
  return { p: cur, score: best };
}
const med = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

export async function calibrate(imgUrl, log = () => {}) {
  const i = new Image(); i.src = imgUrl; await i.decode();
  const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; c.getContext('2d').drawImage(i, 0, 0);
  const found = await findCorners(c); const w = await warpTable(c, found.corners); const A = await analyse(w.canvas);
  const names = Object.keys(GUESS.fields);
  // per row / field fit of (x0, dx, y)
  const rowFit = [];
  const exp = []; for (let k = 0; k < 21; k++) exp.push(371 + k * 81.5);
  const sep = await findRowLines(A, exp);
  for (let r = 0; r < 20; r++) {
    const rh = sep.ys[r + 1] - sep.ys[r];
    const yGuess = sep.ys[r] + 0.76 * rh;
    let bs = -9, y = yGuess; const g = GUESS.fields.grade;
    for (let yy = yGuess - 10; yy <= yGuess + 10; yy++) { const sc = groupScore(A, g, g.x0, g.dx, yy, 0); if (sc > bs) { bs = sc; y = yy; } }
    const row = { y, rh, f: {} };
    for (const nm of names) {
      const f = GUESS.fields[nm];
      const fit = search(p => groupScore(A, f, p[0], p[1], y + p[2], GUESS.dyY), [[f.x0, 10, 1], [f.dx, f.dx * 0.05, f.dx * 0.01], [0, 8, 1]]);
      row.f[nm] = { x0: fit.p[0], dx: fit.p[1], dy: fit.p[2], score: fit.score };
    }
    rowFit.push(row);
  }
  log('rows fitted');
  // consolidate
  const fields = {};
  for (const nm of names) {
    fields[nm] = { x0: med(rowFit.map(r => r.f[nm].x0)), dx: med(rowFit.map(r => r.f[nm].dx)), dy: med(rowFit.map(r => r.f[nm].dy)) };
  }
  const yFrac = med(rowFit.map(r => (r.y - sep.ys[rowFit.indexOf(r)]) / r.rh));
  const ys = rowFit.map(r => r.y);
  // refine dyY, radii using fitted centers (median row)
  const radii = {};
  for (const nm of names) {
    const f = GUESS.fields[nm], q = fields[nm];
    const fit = search(p => { let s = 0; for (let r = 0; r < 20; r += 2) { const y = rowFit[r].y + q.dy; const g = Object.assign({}, f, { rx: p[0], ry: nm.startsWith('yield') ? p[0] : p[1] }); s += groupScore(A, g, q.x0, q.dx, y, p[2]); } return s; },
      [[f.rx, 5, 0.5], [f.ry, 5, 0.5], [GUESS.dyY, 6, 1]]);
    radii[nm] = { rx: fit.p[0], ry: fit.p[1], dyY: fit.p[2], score: fit.score };
  }
  const dyY = (radii.yieldTens.dyY + radii.yieldOnes.dyY) / 2;
  // row separators: horizontal dark lines between rows - measure y of strongest horizontal line near expected (rowBase - 0.78*pitch ... ) for info
  const out = {
    aspect: WARP_W / WARP_H, sepY: sep.ys.map(v => +(v / WARP_H).toFixed(5)), yFrac, dyY, fields, radii,
    rowFitY: ys, found: sep.found.join(''), rowScores: rowFit.map(r => Object.fromEntries(names.map(nm => [nm, +r.f[nm].score.toFixed(2)]))),
  };
  return { out, canvas: w.canvas, A, corners: found.corners, method: found.method, rowFit };
}
