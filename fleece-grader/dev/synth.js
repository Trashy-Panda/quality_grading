// Synthetic mark generator + accuracy test: draws marks onto the blank photo (at the detected bubble positions),
// applies mild rotation/perspective, runs readSheet, compares with truth.
import { readSheet, loadCV, FIELDS } from '../omr.js';

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const apply = (H, x, y) => { const w = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]; };

function drawMarks(base, geo, Hinv, truth, style, R) {
  const c = document.createElement('canvas'); c.width = base.width; c.height = base.height; const g = c.getContext('2d'); g.drawImage(base, 0, 0);
  g.globalCompositeOperation = 'multiply'; g.lineCap = 'round';
  const poly = (pts) => { g.beginPath(); pts.forEach((p, i) => { const q = apply(Hinv, p[0], p[1]); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); };
  const fill = (b, alpha) => {
    const cx = b.x + (R() - 0.5) * 5, cy = b.y + (R() - 0.5) * 4, rx = b.rx * (0.8 + R() * 0.25), ry = b.ry * (0.8 + R() * 0.25);
    const pts = []; for (let k = 0; k < 28; k++) { const t = k / 28 * 2 * Math.PI, j = 0.9 + R() * 0.18; pts.push([cx + Math.cos(t) * rx * j, cy + Math.sin(t) * ry * j]); }
    g.fillStyle = 'rgba(40,40,40,' + alpha + ')'; poly(pts); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(30,30,30,' + (alpha * 0.8) + ')'; g.lineWidth = 1.6;
    for (let k = 0; k < 7; k++) { const a = -ry + (k / 6) * 2 * ry; poly([[cx - rx, cy + a], [cx + rx, cy + a - 3]]); g.stroke(); }
  };
  const slash = (b, kind) => {
    const a = (R() - 0.5) * 0.5, dx = b.rx * 0.75 * 1.35, dy = b.ry * 1.45;
    const x0 = b.x - dx + (R() - 0.5) * 3, y0 = b.y + dy + a * 6, x1 = b.x + dx + (R() - 0.5) * 3, y1 = b.y - dy;
    if (kind === 'red') { g.strokeStyle = 'rgb(205,35,45)'; g.lineWidth = 3.2; } else { g.strokeStyle = 'rgba(70,70,70,0.85)'; g.lineWidth = 2.4; }
    poly([[x0, y0], [(x0 + x1) / 2 + a * 4, (y0 + y1) / 2], [x1, y1]]); g.stroke();
  };
  truth.forEach((row, r) => FIELDS.forEach(f => {
    const t = row[f], bs = geo[r][f];
    if (t.marks) t.marks.forEach(m => fill(bs[m.i], m.a));
    if (t.slash != null) slash(bs[t.slash], style);
  }));
  return c;
}

function makeTruth(R, variant) {
  const n = { grade: 10, length: 3, yieldTens: 10, yieldOnes: 10, purity: 2, character: 3 };
  return Array.from({ length: 20 }, () => Object.fromEntries(FIELDS.map(f => {
    const k = n[f], v = Math.floor(R() * k), roll = R();
    let marks, cls;
    if (roll < 0.07) { marks = null; cls = 'blank'; }
    else if (roll < 0.14) { const w = (v + 1 + Math.floor(R() * (k - 1))) % k; marks = [{ i: v, a: 0.88 }, { i: w, a: 0.85 }]; cls = 'multiple'; }
    else if (roll < 0.30) { marks = [{ i: v, a: 0.5 }]; cls = 'light'; }
    else { marks = [{ i: v, a: 0.9 }]; cls = 'dark'; }
    let slash = null;
    if (variant.slashRate > R()) slash = cls === 'dark' && R() < 0.3 ? v : Math.floor(R() * k);
    return [f, { cls, value: cls === 'blank' || cls === 'multiple' ? null : v, marks, slash }];
  })));
}

async function distort(cv, canvas, ang, persp) {
  const src = cv.imread(canvas), dst = new cv.Mat(); const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2, ca = Math.cos(ang), sa = Math.sin(ang);
  const pts = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => { const X = x - cx, Y = y - cy; return [cx + X * ca - Y * sa, cy + X * sa + Y * ca]; });
  const d = pts.map((p, i) => [p[0] + persp[i][0] * w, p[1] + persp[i][1] * h]);
  const M = cv.getPerspectiveTransform(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]), cv.matFromArray(4, 1, cv.CV_32FC2, d.flat()));
  cv.warpPerspective(src, dst, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(30, 30, 30, 255));
  const out = document.createElement('canvas'); out.width = w; out.height = h; cv.imshow(out, dst); src.delete(); dst.delete(); return out;
}

export async function runSynth(log = () => {}) {
  const cv = await loadCV();
  const blank = await readSheet('../assets/blank-sheet.jpg'); // detected bubble geometry on the real blank photo
  const base = blank.sourceCanvas;
  const Z = [[0, 0], [0, 0], [0, 0], [0, 0]];
  const variants = [
    { name: 'synth1_red', style: 'red', slashRate: 0.85, seed: 11, ang: 0.0, persp: Z },
    { name: 'synth2_red_rot', style: 'red', slashRate: 0.7, seed: 22, ang: 0.05, persp: [[0.01, 0.01], [-0.01, 0], [-0.015, -0.01], [0.01, -0.01]] },
    { name: 'synth3_pencil', style: 'pencil', slashRate: 0.85, seed: 33, ang: -0.04, persp: [[0, 0.015], [0, -0.01], [-0.01, 0], [0.01, 0]] },
    { name: 'synth4_pencil_persp', style: 'pencil', slashRate: 0.7, seed: 44, ang: 0.03, persp: [[0.02, 0], [-0.02, 0.01], [-0.01, -0.015], [0.015, 0.01]] },
  ];
  const total = { fill: { n: 0, ok: 0 }, byCls: {}, color: { n: 0, ok: 0, fp: 0, nneg: 0 }, shape: { n: 0, ok: 0, fp: 0, nneg: 0 }, perSheet: {} };
  const images = [], truths = {};
  for (const v of variants) {
    const R = rng(v.seed), truth = makeTruth(R, v);
    const marked = drawMarks(base, blank.geometry, blank.Hinv, truth, v.style, R);
    const img = await distort(cv, marked, v.ang, v.persp);
    const res = await readSheet(img);
    images.push({ name: v.name, canvas: img }); truths[v.name] = truth;
    if (!res.ok) { log(v.name + ' FAILED corners'); total.failed = (total.failed || 0) + 1; continue; }
    let sOk = 0, sN = 0;
    truth.forEach((row, r) => FIELDS.forEach(f => {
      const t = row[f], rd = res.rows[r][f];
      let ok;
      if (t.cls === 'blank') ok = rd.status === 'blank'; else if (t.cls === 'multiple') ok = rd.status === 'multiple';
      else ok = rd.value === t.value && (rd.status === 'ok' || (t.cls === 'light' && rd.status === 'unsure'));
      const flagged = rd.status === 'unsure' && !ok; const b = total.byCls[t.cls] || (total.byCls[t.cls] = { n: 0, ok: 0, unsure: 0, silent: 0 }); b.n++; b.ok += ok ? 1 : 0; b.unsure += flagged ? 1 : 0; b.silent += (!ok && !flagged) ? 1 : 0; total.silent = (total.silent || 0) + ((!ok && !flagged) ? 1 : 0); total.unsure = (total.unsure || 0) + (flagged ? 1 : 0); total.fill.n++; total.fill.ok += ok ? 1 : 0; sN++; sOk += ok ? 1 : 0;
      for (const m of ['color', 'shape']) {
        const s = rd.slashes[m], tot = total[m];
        if (t.slash != null) { tot.n++; if (s.status === 'ok' && s.slash === t.slash) tot.ok++; } else { tot.nneg++; if (s.status === 'ok') tot.fp++; }
      }
    }));
    total.perSheet[v.name] = sOk + '/' + sN;
    log(v.name + ' done');
  }
  window.__synthImages = images; window.__synthTruths = truths;
  return total;
}
