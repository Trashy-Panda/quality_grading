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

const pct = (a, p) => { const s = Float64Array.from(a).sort(); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : 0; };

// Sheet-wide normalisation. Blank level per bubble kind (empty boxes, and each printed digit 0-9 separately because the
// digit itself darkens its circle); pencil level from the darkest bubbles on this sheet. fill = 0 blank .. 1 this sheet's pencil.
function fillLevels(raw) {
  const box = [], dig = Array.from({ length: 10 }, () => []), all = [];
  for (const row of raw) for (const f of FIELDS) row[f].forEach((m, i) => { all.push(m.v); if (GRID.fields[f].two) dig[i].push(m.v); else box.push(m.v); });
  const baseBox = pct(box, 0.25), baseDig = dig.map(d => pct(d, 0.25));
  const top = Float64Array.from(all).sort().slice(Math.floor(all.length * 0.93)); let dark = 0; top.forEach(v => { dark += v; }); dark /= top.length || 1;
  const scale = Math.max(OPTS.minScale, dark - baseBox);
  return { base: (f, i) => (GRID.fields[f].two ? baseDig[i] : baseBox), scale, pencil: +(dark - baseBox).toFixed(3) };
}

function decideFill(fill, offs) {
  const idx = fill.map((f, i) => i).sort((a, b) => fill[b] - fill[a]);
  const f1 = fill[idx[0]], f2 = fill[idx[1]];
  if (f1 < OPTS.blankMax) return { value: null, status: 'blank' };
  if (f1 >= OPTS.markMin && f2 >= OPTS.markMin && f2 >= OPTS.multiRatio * f1) return { value: null, status: 'multiple' };
  if (f1 >= OPTS.markMin && f2 < OPTS.loneRatio * f1 && offs[idx[0]] <= OPTS.centerMax) return { value: idx[0], status: 'ok' };
  return { value: idx[0], status: 'unsure' };
}

