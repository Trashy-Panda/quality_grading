// Sheet geometry, normalized 0..1 inside the table border (x / table width, y / table height).
// Derived from assets/blank-sheet.jpg with dev/calibrate.html, then baked here.
// Rows are defined between 21 horizontal separator lines (sepY). A bubble row sits at sepY[r] + yFrac*(rowHeight).
// Real sheets curl, so the reader re-detects the separators and snaps each bubble group (see omr.js).
const W = 1500, H = 2000; // calibration canvas, only used to express the baked numbers below

export const FIELDS = ['grade', 'length', 'yieldTens', 'yieldOnes', 'purity', 'character'];

// Re-measured from correctly read real sheets (02, 13): row 1 top ~0.203, table bottom ~0.991 of the table height.
const SEP_PX = Array.from({ length: 21 }, (_, k) => Math.round(2000 * (0.2028 + k * (0.9908 - 0.2028) / 20)));

export const TEMPLATE = {
  aspect: W / H,
  paperFallback: { l: 0.13, t: 0.155, r: 0.14, b: 0.055 }, // rough table position inside the paper quad
  sepY: SEP_PX.map(v => v / H),
  colLines: [505 / W, 1196 / W, 1312 / W, 1468 / W], // vertical separators used to anchor x (grade|length, yield|purity, purity|character, right border)            // 21 row separators
  yFrac: 0.76,                              // bubble baseline within a row
  dyY: 39 / H,                              // top digit row (0-4) sits this far above the 5-9 row
  // per field: n bubbles per line, first-centre x0, pitch dx, y nudge dy, radii, superellipse exponent (3 rounded box, 2 circle)
  fields: {
    grade:     { n: 10, x0: 116 / W,  dx: 39.25 / W, dy: 0 / H,  rx: 16 / W,   ry: 13 / H, sup: 3 },
    length:    { n: 3,  x0: 544 / W,  dx: 39.7 / W,  dy: -2 / H, rx: 16 / W,   ry: 13 / H, sup: 3 },
    yieldTens: { n: 5,  x0: 732 / W,  dx: 39.1 / W,  dy: -1 / H, rx: 13 / W,   ry: 13 / H, sup: 2, two: true },
    yieldOnes: { n: 5,  x0: 1003 / W, dx: 39.3 / W,  dy: -1 / H, rx: 13 / W,   ry: 13 / H, sup: 2, two: true },
    purity:    { n: 2,  x0: 1236 / W, dx: 38.5 / W,  dy: -1 / H, rx: 16 / W,   ry: 13 / H, sup: 3 },
    character: { n: 3,  x0: 1354 / W, dx: 40 / W,    dy: 0 / H,  rx: 16 / W,   ry: 13 / H, sup: 3 },
  },
  // right margin of the table: where the handwritten official yield note lives (x range, normalized)
  marginNote: { x0: 1.0, x1: 1.0 },
};

// Bubble centres for a group in a row. sepA/sepB: separator y (normalized) above/below the row.
// Returns array (length n, or 2n for yield: index 0-4 top row, 5-9 bottom row = digit value) of {x,y}.
export function groupCenters(field, sepA, sepB) {
  const f = TEMPLATE.fields[field], base = sepA + TEMPLATE.yFrac * (sepB - sepA) + f.dy, out = [];
  if (f.two) {
    for (let r = 0; r < 2; r++) for (let k = 0; k < f.n; k++) out.push({ x: f.x0 + k * f.dx, y: base - (r === 0 ? TEMPLATE.dyY : 0) });
  } else for (let k = 0; k < f.n; k++) out.push({ x: f.x0 + k * f.dx, y: base });
  return out;
}

// Full ideal layout from the baked separators: bubbles[row][field] = [{x,y}], 20 rows x 38 bubbles
// (yield groups hold 10 entries each: digit value = index, so 20 + ... = 10+3+10+10+2+3 = 38).
export const BUBBLES = Array.from({ length: 20 }, (_, r) =>
  Object.fromEntries(FIELDS.map(f => [f, groupCenters(f, TEMPLATE.sepY[r], TEMPLATE.sepY[r + 1])])));

// ---- v2: line-lattice template (see grid.js) ----
// The reader finds the table's ruled lines and places every bubble between them, so all positions here are relative to
// the rules: u = 0 at the left border, 1 at the right border; rows are counted between the 21 horizontal separators.
// Measured on assets/blank-sheet.jpg with dev/lab.html (lab.calibrate).
export const GRID = {
  // coarse warp: the roughly-found table quad is grown by these fractions and drawn at CW x CH (the right side keeps
  // extra room for the handwritten yield notes)
  grow: { l: 0.07, r: 0.19, t: 0.07, b: 0.07 }, CW: 1760, CH: 2134,
  pitchFrac: 0.0355, widthFrac: 0.772,  // nominal row pitch / CH and table width / CW in that warp
  // vertical rules: left border, number|grade, grade|length, length|written, written|tens, tens|written, written|ones,
  // ones|purity, purity|character, right border
  cols: [0, 0.0413, 0.3343, 0.4406, 0.4547, 0.6251, 0.6391, 0.8122, 0.8915, 1], colsAbsent: [],
  // bubbles: first centre u0, pitch du, radius ru (all in u); v = centre as a fraction of the row height (the 5-9 line
  // for yield); dv = how far the 0-4 line sits above the 5-9 line; rv = vertical radius (fractions of the row height)
  rv: 0.163, dv: 0.477,
  fields: {
    grade:     { n: 10, u0: 0.0687, du: 0.02687, ru: 0.0108, v: 0.768, sup: 3 },
    length:    { n: 3,  u0: 0.3618, du: 0.02694, ru: 0.0108, v: 0.768, sup: 3 },
    yieldTens: { n: 5,  u0: 0.4870, du: 0.02657, ru: 0.0098, v: 0.762, sup: 2, two: true },
    yieldOnes: { n: 5,  u0: 0.6730, du: 0.02663, ru: 0.0098, v: 0.762, sup: 2, two: true },
    purity:    { n: 2,  u0: 0.8394, du: 0.02695, ru: 0.0108, v: 0.770, sup: 3 },
    character: { n: 3,  u0: 0.9184, du: 0.02739, ru: 0.0110, v: 0.772, sup: 3 },
  },
};
