import test from 'node:test';
import assert from 'node:assert/strict';
import { GRADE_COUNTS, LIST, bestGrade, bestYield, lengthIndex, groupLines, groupTokens, letterFeatures, classifyLetter, isPlausibleRow, listLooksReal, readListKey, initListKey } from '../../beefgrading.study/fleece/listkey.js';

const oneHot = (d, p = 0.9) => Array.from({ length: 10 }, (_, k) => (k === d ? p : (1 - p) / 9));
const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });

test('bestGrade picks the valid pair and maps to the app index', () => {
  const g = bestGrade(oneHot(6), oneHot(2));
  assert.equal(GRADE_COUNTS[g.grade], 62);
  assert.ok(g.conf > 0.75);
});
test('bestGrade repairs an impossible pair by joint probability (59 -> 58 when 9 and 8 are close)', () => {
  const p2 = oneHot(9, 0.5); p2[8] = 0.4;
  assert.equal(GRADE_COUNTS[bestGrade(oneHot(5, 0.95), p2).grade], 58);
});
test('bestGrade: a 5 read as 3 (S-like) still lands on a valid grade, with low confidence', () => {
  const p1 = oneHot(3, 0.4); p1[5] = 0.35; // net torn between 3 and 5
  const g = bestGrade(p1, oneHot(4));
  assert.equal(GRADE_COUNTS[g.grade], 54);
  assert.ok(g.conf < 0.5);
});
test('bestGrade covers all ten counts', () => {
  for (let i = 0; i < 10; i++) { const v = GRADE_COUNTS[i]; assert.equal(bestGrade(oneHot(Math.floor(v / 10)), oneHot(v % 10)).grade, i); }
});
test('bestYield argmaxes each digit, restricts the tens digit, conf is the joint', () => {
  const y = bestYield(oneHot(5), oneHot(4));
  assert.equal(y.value, 54); assert.ok(Math.abs(y.conf - 0.81) < 1e-9);
  assert.equal(bestYield(oneHot(1, 0.5), oneHot(0)).value >= 30, true); // tens 1 is outside the 3..8 range
});
test('lengthIndex: S and St staple, F french, C clothing', () => {
  assert.deepEqual(['S', 'St', 'st', 'F', 'C', 'x'].map(lengthIndex), [0, 0, 0, 1, 2, null]);
});

test('groupLines clusters by vertical centre, tolerating drift, ordered top to bottom and left to right', () => {
  const bs = [box(300, 100, 320, 140), box(10, 92, 30, 132), box(150, 110, 170, 150), box(12, 190, 32, 230), box(300, 196, 320, 236)];
  const ls = groupLines(bs, 40);
  assert.equal(ls.length, 2);
  assert.deepEqual(ls[0].map(b => b.x0), [10, 150, 300]);
  assert.deepEqual(ls[1].map(b => b.x0), [12, 300]);
});
test('groupTokens splits columns at wide gaps, keeps digit pairs together', () => {
  const g = [box(0, 0, 20, 40), box(26, 0, 46, 40), box(200, 0, 220, 40), box(400, 0, 420, 40), box(426, 0, 446, 40)];
  const t = groupTokens(g, 40);
  assert.deepEqual(t.map(x => x.glyphs.length), [2, 1, 2]);
});
test('groupTokens merges the narrowest gaps when a line has a stray extra token, rejects hopeless lines', () => {
  const g = [box(0, 0, 20, 40), box(60, 0, 80, 40), box(200, 0, 220, 40), box(400, 0, 420, 40)];
  const t = groupTokens(g, 40);
  assert.equal(t.length, 3); assert.equal(t[0].glyphs.length, 2);
  const many = Array.from({ length: 8 }, (_, i) => box(i * 100, 0, i * 100 + 20, 40));
  assert.equal(groupTokens(many, 40), null);
});

// letter masks: strokes as rects on a w x h grid
function mask(w, h, rects) { const m = new Uint8Array(w * h); for (const [x0, y0, x1, y1] of rects) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m[y * w + x] = 1; return m; }
const T = 4;
const S = () => mask(30, 40, [[0, 0, 29, T - 1], [0, 0, T - 1, 19], [0, 18, 29, 18 + T - 1], [26, 20, 29, 39], [0, 36, 29, 39]]);
const F = () => mask(30, 40, [[0, 0, T - 1, 39], [0, 0, 29, T - 1], [0, 18, 20, 18 + T - 1]]);
const C = () => mask(30, 40, [[0, 0, 29, T - 1], [0, 0, T - 1, 39], [0, 36, 29, 39]]);
test('classifyLetter tells S, F and C apart by shape', () => {
  assert.equal(classifyLetter(letterFeatures(S(), 30, 40)).letter, 'S');
  assert.equal(classifyLetter(letterFeatures(F(), 30, 40)).letter, 'F');
  assert.equal(classifyLetter(letterFeatures(C(), 30, 40)).letter, 'C');
});
test('letterFeatures: F has a full left stem and a narrow bottom; C is empty in the centre', () => {
  const f = letterFeatures(F(), 30, 40), c = letterFeatures(C(), 30, 40);
  assert.ok(f.leftCover > 0.95); assert.ok(f.botSpan < 0.3); assert.ok(c.center < 0.1);
});

test('isPlausibleRow and listLooksReal reject a printed table (many lines, few clean rows)', () => {
  const ok = { length: 0, conf: { grade: 0.9, length: 0.9, yield: 0.9 } }, bad = { length: 0, conf: { grade: 0.01, length: 0.5, yield: 0.5 } };
  assert.ok(isPlausibleRow(ok)); assert.ok(!isPlausibleRow(bad)); assert.ok(!isPlausibleRow({ ...ok, length: null }));
  assert.ok(listLooksReal(20, 20)); assert.ok(!listLooksReal(2, 20)); assert.ok(!listLooksReal(4, 46));
});

test('readListKey: blank paper and a page of one scribble are nolist', async () => {
  await initListKey({ net: () => new Float32Array(10) });
  const blank = { g: new Uint8Array(300 * 200).fill(210), w: 300, h: 200 };
  assert.deepEqual([(await readListKey(blank)).ok, (await readListKey(blank)).error], [false, 'nolist']);
  const g = new Uint8Array(300 * 200).fill(210); for (let y = 50; y < 90; y++) for (let x = 100; x < 104; x++) g[y * 300 + x] = 30;
  assert.equal((await readListKey({ g, w: 300, h: 200 })).ok, false);
});
