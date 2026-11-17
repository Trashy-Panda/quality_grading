// Slash consensus across a stack of sheets, plus grading-error audit. See SPEC.md.
// Fleece indexes are 0-based.

const SIMPLE = ['grade', 'length', 'purity', 'character'];
const FIELDS = ['grade', 'length', 'yield', 'purity', 'character'];

function slashOf(read) {
  if (!read || read.slashStatus !== 'ok') return null;
  return Number.isInteger(read.slash) ? read.slash : null;
}

// Plurality vote; a tie for first place gives value null and tie true.
function vote(values) {
  const counts = new Map();
  for (const v of values) if (v != null) counts.set(v, (counts.get(v) || 0) + 1);
  const votes = values.filter((v) => v != null).length;
  if (!votes) return { value: null, votes: 0, agreeing: 0, tie: false };
  const top = Math.max(...counts.values());
  const winners = [...counts.keys()].filter((v) => counts.get(v) === top);
  if (winners.length > 1) return { value: null, votes, agreeing: top, tie: true };
  return { value: winners[0], votes, agreeing: top, tie: false };
}

export function buildKeyFromSlashes(sheetReads) {
  const sheets = sheetReads || [];
  const n = sheets.reduce((m, s) => Math.max(m, s.length), 0) || 20;
  const key = [], confidence = [], missing = [], disagreements = [];

  for (let i = 0; i < n; i++) {
    const kf = {}, cf = {};
    const col = (field) => sheets.map((s) => slashOf(s[i] && s[i][field]));

    for (const f of SIMPLE) {
      const v = vote(col(f));
      kf[f] = v.value;
      cf[f] = { votes: v.votes, agreeing: v.agreeing, tie: v.tie };
      if (!v.votes) missing.push({ fleece: i, field: f });
    }

    const tens = vote(col('yieldTens'));
    const ones = vote(col('yieldOnes'));
    kf.yield = tens.value == null || ones.value == null ? null : tens.value * 10 + ones.value;
    cf.yield = {
      votes: Math.min(tens.votes, ones.votes),
      agreeing: Math.min(tens.agreeing, ones.agreeing),
      tie: tens.tie || ones.tie,
      tens: { votes: tens.votes, agreeing: tens.agreeing, tie: tens.tie },
      ones: { votes: ones.votes, agreeing: ones.agreeing, tie: ones.tie },
    };
    if (!tens.votes || !ones.votes) missing.push({ fleece: i, field: 'yield' });

    // Audit: a sheet whose slash differs from a settled consensus.
    sheets.forEach((s, sheetIndex) => {
      for (const f of SIMPLE) {
        const sl = slashOf(s[i] && s[i][f]);
        if (sl != null && kf[f] != null && sl !== kf[f]) {
          disagreements.push({ sheetIndex, fleece: i, field: f, slashed: sl, consensus: kf[f] });
        }
      }
      const t = slashOf(s[i] && s[i].yieldTens);
      const o = slashOf(s[i] && s[i].yieldOnes);
      if (t != null && o != null && kf.yield != null && t * 10 + o !== kf.yield) {
        disagreements.push({ sheetIndex, fleece: i, field: 'yield', slashed: t * 10 + o, consensus: kf.yield });
      }
    });

    key.push(kf);
    confidence.push(cf);
  }
  return { key, confidence, missing, disagreements };
}

// Manual answers win where non-null; consensus fills the rest.
export function mergeKey(manualKey, consensusKey) {
  const m = manualKey || [], c = consensusKey || [];
  const n = Math.max(m.length, c.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const f = {};
    for (const field of FIELDS) {
      const mv = m[i] ? m[i][field] : null;
      const cv = c[i] ? c[i][field] : null;
      f[field] = mv != null ? mv : cv != null ? cv : null;
    }
    out.push(f);
  }
  return out;
}
