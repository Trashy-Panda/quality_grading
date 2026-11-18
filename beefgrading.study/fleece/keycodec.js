// Fixed-width codec for 20 fleeces <-> 120 chars. Pure, no DOM, no storage.
// 6 chars per fleece: grade 0-9, length 0-2, yield 2 digits, purity 0-1, character 0-2.
// '-' is a blank. Rows at or past n encode as '------'.
// Same format as the fleece_keys Firestore rule (firestore.rules); keep KEY_RE in step with it.
// Used for posted official keys and, unchanged, for saved student answers.

export const KEY_RE = /^([0-9-][0-2-]([0-9]{2}|--)[01-][0-2-]){20}$/;
export const FLEECES = 20;
export const KEY_LEN = FLEECES * 6;

const MAX = { grade: 9, length: 2, purity: 1, character: 2 };

export const blankFleece = () => ({ grade: null, length: null, yield: null, purity: null, character: null });

const okInt = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
const one = (v, max) => (okInt(v, max) ? String(v) : '-');

export function isKeyString(s) {
  return typeof s === 'string' && s.length === KEY_LEN && KEY_RE.test(s);
}

// key: array of fleece objects (missing or invalid values become blanks). n: rows in use, 1-20.
export function encodeKey(key, n = FLEECES) {
  const rows = Number.isInteger(n) ? Math.max(0, Math.min(FLEECES, n)) : FLEECES;
  const list = Array.isArray(key) ? key : [];
  let out = '';
  for (let i = 0; i < FLEECES; i++) {
    const f = i < rows && list[i] && typeof list[i] === 'object' ? list[i] : {};
    const y = okInt(f.yield, 99) ? String(f.yield).padStart(2, '0') : '--';
    out += one(f.grade, MAX.grade) + one(f.length, MAX.length) + y + one(f.purity, MAX.purity) + one(f.character, MAX.character);
  }
  return out;
}

// -> array of 20 fleece objects (null fields for blanks), or null if str is not a valid key string.
export function decodeKey(str) {
  if (!isKeyString(str)) return null;
  const num = (c) => (c === '-' ? null : Number(c));
  const out = [];
  for (let i = 0; i < FLEECES; i++) {
    const s = str.slice(i * 6, i * 6 + 6);
    out.push({
      grade: num(s[0]),
      length: num(s[1]),
      yield: s.slice(2, 4) === '--' ? null : Number(s.slice(2, 4)),
      purity: num(s[4]),
      character: num(s[5]),
    });
  }
  return out;
}
