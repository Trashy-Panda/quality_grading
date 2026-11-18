// Pure scoring for the wool grading sheet. See SPEC.md.

// Editable deduction tables. steps = [minDistance, points], ascending.
export const RULES = {
  grade:     { range: [0, 9],  max: 6, steps: [[0, 0], [1, 2], [2, 4], [3, 6]] },
  length:    { range: [0, 2],  max: 4, steps: [[0, 0], [1, 2], [2, 4]] },
  yield:     { range: [0, 99], max: 6, steps: [[0, 0], [5, 2], [7, 4], [9, 6]] },
  purity:    { range: [0, 1],  max: 2, steps: [[0, 0], [1, 2]] },
  character: { range: [0, 2],  max: 2, steps: [[0, 0], [1, 1], [2, 2]] },
};

export const FIELDS = Object.keys(RULES);

function valid(v, range) {
  return Number.isInteger(v) && v >= range[0] && v <= range[1];
}

// Score one field. Null key field is skipped (max 0). Blank/invalid student = max deduction.
export function scoreField(field, student, key, rules = RULES) {
  const r = rules[field];
  if (!r || !valid(key, r.range)) return { off: 0, max: 0, d: null };
  if (!valid(student, r.range)) return { off: r.max, max: r.max, d: null };
  const d = Math.abs(student - key);
  let off = 0;
  for (const [min, pts] of r.steps) if (d >= min) off = pts;
  return { off: Math.min(off, r.max), max: r.max, d };
}

export function scoreFleece(studentAnswer, keyAnswer) {
  const s = studentAnswer || {};
  const k = keyAnswer || {};
  const fields = {};
  let off = 0, max = 0;
  for (const f of FIELDS) {
    fields[f] = scoreField(f, s[f], k[f]);
    off += fields[f].off;
    max += fields[f].max;
  }
  return { off, max, score: max - off, fields };
}

function hasKey(keyFleece) {
  if (!keyFleece) return false;
  return FIELDS.some((f) => valid(keyFleece[f], RULES[f].range));
}

// Only fleeces whose key has at least one field are graded.
export function scoreSheet(studentSheet, keySheet) {
  const st = studentSheet || [];
  const ks = keySheet || [];
  const fleeces = [];
  let total = 0, off = 0, gradedCount = 0;
  for (let i = 0; i < ks.length; i++) {
    if (!hasKey(ks[i])) {
      fleeces.push({ graded: false, off: 0, max: 0, score: 0, fields: {} });
      continue;
    }
    const r = scoreFleece(st[i], ks[i]);
    fleeces.push({ graded: true, ...r });
    total += r.max;
    off += r.off;
    gradedCount++;
  }
  return { score: total - off, total, off, fleeces, gradedCount };
}

export function yieldFromDigits(tens, ones) {
  if (tens == null || ones == null) return null;
  return tens * 10 + ones;
}

// OMR read -> answer value; only a clean read counts.
export function fieldFromRead(read) {
  if (!read || read.status !== 'ok') return null;
  return Number.isInteger(read.value) ? read.value : null;
}
