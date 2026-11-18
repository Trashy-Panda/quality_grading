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
      const fill = ms.map((m, i) => Math.max(0, Math.min(1, (m.v - lv.base(f, i)) / lv.scale)));
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
  return { ok: true, warpedCanvas: warp, corners, rows, warnings, geometry, lattice: L.q, levels: { scale: +lv.scale.toFixed(3), pencil: lv.pencil }, view, marginCrops: opts.marginCrops ? marginCrops : null, grayPhoto: A.grayPhoto };
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
