import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKeyFromSlashes, mergeKey, detectKeyMode, keyFromScan } from '../../beefgrading.study/fleece/consensus.js';

const r = (slash) => ({ slash, slashStatus: slash == null ? 'none' : 'ok' });
const fleece = (o = {}) => ({
  grade: r(o.grade ?? null), length: r(o.length ?? null),
  yieldTens: r(o.tens ?? null), yieldOnes: r(o.ones ?? null),
  purity: r(o.purity ?? null), character: r(o.character ?? null),
});
const sheet = (f0) => [f0, ...Array.from({ length: 19 }, () => fleece())];
const full = { grade: 2, length: 1, tens: 7, ones: 3, purity: 0, character: 1 };

test('majority vote builds key', () => {
  const res = buildKeyFromSlashes([sheet(fleece(full)), sheet(fleece(full)), sheet(fleece({ ...full, grade: 5 }))]);
  assert.deepEqual(res.key[0], { grade: 2, length: 1, yield: 73, purity: 0, character: 1 });
  assert.deepEqual(res.confidence[0].grade, { votes: 3, agreeing: 2, tie: false });
  assert.equal(res.confidence[0].yield.votes, 3);
  assert.equal(res.key.length, 20);
});

test('disagreement flagged', () => {
  const res = buildKeyFromSlashes([sheet(fleece(full)), sheet(fleece(full)), sheet(fleece({ ...full, grade: 5, ones: 4 }))]);
  assert.deepEqual(res.disagreements.filter((d) => d.sheetIndex === 2).map((d) => [d.field, d.slashed, d.consensus]),
    [['grade', 5, 2], ['yield', 74, 73]]);
  assert.equal(res.disagreements.filter((d) => d.sheetIndex !== 2).length, 0);
});

test('tie gives null with flag, no disagreements', () => {
  const res = buildKeyFromSlashes([sheet(fleece({ grade: 1 })), sheet(fleece({ grade: 2 }))]);
  assert.equal(res.key[0].grade, null);
  assert.deepEqual(res.confidence[0].grade, { votes: 2, agreeing: 1, tie: true });
  assert.equal(res.disagreements.length, 0);
  assert.ok(!res.missing.some((m) => m.fleece === 0 && m.field === 'grade'));
});

test('missing fields listed', () => {
  const res = buildKeyFromSlashes([sheet(fleece({ grade: 1, tens: 5 }))]);
  const m0 = res.missing.filter((m) => m.fleece === 0).map((m) => m.field);
  assert.deepEqual(m0, ['length', 'purity', 'character', 'yield']);
  assert.equal(res.key[0].yield, null);
  assert.equal(res.missing.filter((m) => m.fleece === 1).length, 5);
});

test('non-ok slash statuses are ignored', () => {
  const bad = fleece(full);
  bad.grade = { slash: 9, slashStatus: 'multiple' };
  const res = buildKeyFromSlashes([sheet(fleece(full)), sheet(bad)]);
  assert.equal(res.key[0].grade, 2);
  assert.equal(res.confidence[0].grade.votes, 1);
});

test('mergeKey: manual wins when non-null', () => {
  const manual = [{ grade: 4, length: null, yield: null, purity: 0, character: null }];
  const cons = [{ grade: 2, length: 1, yield: 73, purity: 1, character: null }];
  assert.deepEqual(mergeKey(manual, cons)[0], { grade: 4, length: 1, yield: 73, purity: 0, character: null });
  assert.equal(mergeKey([], cons).length, 1);
});

// ---- official-key scan ----
const rd = (value, status = 'ok', slash = null, slashStatus = slash == null ? 'none' : 'ok') => ({ value, status, slash, slashStatus });
const blankRow = () => ({ grade: rd(null, 'blank'), length: rd(null, 'blank'), yieldTens: rd(null, 'blank'), yieldOnes: rd(null, 'blank'), purity: rd(null, 'blank'), character: rd(null, 'blank') });
const rows20 = (f) => Array.from({ length: 20 }, (_, i) => f(i, blankRow()));
const none = () => Array.from({ length: 20 }, () => ({ value: null, conf: 0 }));

test('detect: slashes or confident margins make it graded, else bubbled', () => {
  const slashed = rows20((i, r) => (i < 3 ? { ...r, grade: rd(1, 'ok', 2) } : r));
  assert.equal(detectKeyMode(slashed, none(), 0.99).mode, 'graded');
  const margin = none().map((m, i) => (i < 3 ? { value: 55, conf: 1 } : m));
  assert.equal(detectKeyMode(rows20((i, r) => r), margin, 0.99).mode, 'graded');
  assert.equal(detectKeyMode(rows20((i, r) => ({ ...r, grade: rd(2) })), none(), 0.99).mode, 'bubbled');
  assert.equal(detectKeyMode(rows20((i, r) => (i < 2 ? { ...r, grade: rd(1, 'ok', 2) } : r)), none(), 0.99).mode, 'bubbled');
});

test('graded: slash is the key, student fill with no slash is inferred and low, margin gives yield', () => {
  const rows = rows20((i, r) => (i === 0
    ? { ...r, grade: rd(1, 'ok', 3), length: rd(0), purity: rd(0, 'ok', 1) }   // grade slashed (3) over student fill (1); length only filled
    : r));
  const margin = none(); margin[0] = { value: 66, conf: 1 }; margin[1] = { value: 54, conf: 0.5 };
  const out = keyFromScan('graded', { rows, margin }, {});
  assert.deepEqual(out.key[0], { grade: 3, length: 0, yield: 66, purity: 1, character: 1 });
  assert.deepEqual(out.src[0].grade, { s: 'slash' });
  assert.deepEqual(out.src[0].length, { s: 'inferred' }); // marked row, clear fill, no slash: quiet
  assert.deepEqual(out.src[0].yield, { s: 'margin' });
  assert.deepEqual(out.auto[0], { purity: false, character: true });
  assert.equal(out.key[1].yield, 54);
  assert.deepEqual(out.src[1].yield, { s: 'margin', low: true });
  assert.deepEqual(out.auto[1], { purity: true, character: true });
  assert.equal(out.key[1].purity, 0);            // Good
  assert.equal(out.key[2].yield, null);          // nothing read: stays blank, no auto
  assert.equal(out.auto[2].purity, false);
});

test('graded: low only where the evidence is weak', () => {
  const rows = rows20((i, r) => (i === 0 ? { ...r, grade: rd(2), length: rd(0) }                       // no grader mark, no margin: nothing backs the fills
    : i === 1 ? { ...r, grade: rd(2, 'unsure'), length: rd(0, 'ok', 1) }                                // unclear fill; length slashed
    : i === 2 ? { ...r, grade: rd(3, 'ok', 4, 'unsure'), length: rd(1) }                                  // faint slash
    : i === 3 ? { ...r, grade: rd(5), length: rd(0, 'ok', 0) }                                            // marked via the length slash: grade fill stands
    : r));
  const out = keyFromScan('graded', { rows, margin: none() }, {});
  assert.deepEqual(out.src[0].grade, { s: 'inferred', low: true });
  assert.deepEqual(out.src[1].grade, { s: 'inferred', low: true });
  assert.equal(out.key[1].grade, 2);
  assert.deepEqual(out.src[1].length, { s: 'slash' });
  assert.deepEqual(out.src[2].grade, { s: 'slash', low: true });
  assert.equal(out.key[2].grade, 4);
  assert.deepEqual(out.src[3].grade, { s: 'inferred' });
});

test('graded: a low margin read yields to a clean slashed yield; yield bubbles are the last resort', () => {
  const rows = rows20((i, r) => (i === 0 ? { ...r, yieldTens: rd(5, 'ok', 5), yieldOnes: rd(4, 'ok', 4) } : i === 1 ? { ...r, yieldTens: rd(6), yieldOnes: rd(1) } : r));
  const margin = none(); margin[0] = { value: 85, conf: 0.4 };
  const out = keyFromScan('graded', { rows, margin }, {});
  assert.equal(out.key[0].yield, 54); assert.deepEqual(out.src[0].yield, { s: 'slash' });
  assert.equal(out.key[1].yield, 61); assert.deepEqual(out.src[1].yield, { s: 'inferred', low: true }); // the student's yield is never trusted quietly
});

test('bubbled: fills are the key; written digits fill an unclear yield', () => {
  const rows = rows20((i, r) => (i === 0 ? { ...r, grade: rd(2), length: rd(1), yieldTens: rd(7), yieldOnes: rd(3), purity: rd(1), character: rd(2) }
    : i === 1 ? { ...r, grade: rd(4), yieldTens: rd(null, 'unsure'), yieldOnes: rd(null, 'blank') } : r));
  const tens = Array.from({ length: 20 }, () => ({ digit: null, conf: 1 })), ones = tens.map((x) => ({ ...x }));
  tens[1] = { digit: 5, conf: 0.95 }; ones[1] = { digit: 8, conf: 0.5 };
  const out = keyFromScan('bubbled', { rows, tens, ones }, {});
  assert.deepEqual(out.key[0], { grade: 2, length: 1, yield: 73, purity: 1, character: 2 });
  assert.deepEqual(out.src[0].yield, { s: 'fill' });
  assert.equal(out.key[1].yield, 58); assert.deepEqual(out.src[1].yield, { s: 'written', low: true });
  assert.equal(out.auto[0].purity, false);
});

test('list: rows map across with confidence; P/C auto', () => {
  const list = { ok: true, rows: [{ grade: 2, length: 0, yield: 54, conf: { grade: 0.9, length: 0.3, yield: 0.8 } }] };
  const out = keyFromScan('list', { list }, { confList: 0.5 });
  assert.deepEqual(out.key[0], { grade: 2, length: 0, yield: 54, purity: 0, character: 1 });
  assert.deepEqual(out.src[0].length, { s: 'list', low: true });
  assert.deepEqual(out.src[0].grade, { s: 'list' });
  assert.deepEqual(out.auto[0], { purity: true, character: true });
  assert.equal(out.stats.filled, 1);
  assert.equal(out.key[1].grade, null);
});
