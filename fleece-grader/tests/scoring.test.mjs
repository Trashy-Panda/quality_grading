import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, scoreField, scoreFleece, scoreSheet, yieldFromDigits, fieldFromRead } from '../../beefgrading.study/fleece/scoring.js';

const off = (f, s, k) => scoreField(f, s, k).off;

test('yield boundaries', () => {
  const cases = [[4, 0], [5, 2], [6, 2], [7, 4], [8, 4], [9, 6], [30, 6]];
  for (const [d, want] of cases) assert.equal(off('yield', 50 + d, 50), want, `d=${d}`);
  assert.equal(off('yield', 50 - 9, 50), 6);
  assert.equal(off('yield', 0, 0), 0);
});

test('grade distances', () => {
  assert.deepEqual([0, 1, 2, 3, 5, 9].map((d) => off('grade', d, 0)), [0, 2, 4, 6, 6, 6]);
});

test('length distances', () => {
  assert.deepEqual([0, 1, 2].map((d) => off('length', d, 0)), [0, 2, 4]);
});

test('purity and character', () => {
  assert.equal(off('purity', 0, 0), 0);
  assert.equal(off('purity', 1, 0), 2);
  assert.deepEqual([0, 1, 2].map((s) => off('character', s, 0)), [0, 1, 2]);
});

test('blank/invalid student on keyed field = max', () => {
  assert.equal(off('grade', null, 3), 6);
  assert.equal(off('yield', undefined, 50), 6);
  assert.equal(off('length', 7, 1), 4);
  assert.equal(off('purity', 'x', 0), 2);
  assert.equal(off('character', null, 1), 2);
});

test('null key field skipped', () => {
  assert.deepEqual(scoreField('grade', 3, null), { off: 0, max: 0, d: null });
});

test('RULES is editable', () => {
  const custom = { ...RULES, purity: { ...RULES.purity, steps: [[0, 0], [1, 5]], max: 5 } };
  assert.equal(scoreField('purity', 1, 0, custom).off, 5);
});

test('fleece totals 20', () => {
  const k = { grade: 0, length: 0, yield: 50, purity: 0, character: 0 };
  const perfect = scoreFleece(k, k);
  assert.equal(perfect.max, 20);
  assert.equal(perfect.score, 20);
  const blank = scoreFleece({}, k);
  assert.equal(blank.off, 20);
  assert.equal(blank.score, 0);
});

test('partial key row drops points', () => {
  const r = scoreFleece({ grade: 5, length: 2 }, { grade: 5, length: null, yield: null, purity: null, character: 1 });
  assert.equal(r.max, 8);
  assert.equal(r.off, 2);
  assert.equal(r.score, 6);
});

test('20-fleece perfect sheet = 400/400', () => {
  const key = Array.from({ length: 20 }, (_, i) => ({ grade: i % 10, length: i % 3, yield: 40 + i, purity: i % 2, character: i % 3 }));
  const r = scoreSheet(key.map((f) => ({ ...f })), key);
  assert.equal(r.score, 400);
  assert.equal(r.total, 400);
  assert.equal(r.off, 0);
  assert.equal(r.gradedCount, 20);
  assert.equal(r.fleeces.length, 20);
});

test('ungraded rows are skipped', () => {
  const full = { grade: 1, length: 1, yield: 50, purity: 1, character: 1 };
  const empty = { grade: null, length: null, yield: null, purity: null, character: null };
  const key = [full, empty, full];
  const student = [full, full, { ...full, grade: 4 }];
  const r = scoreSheet(student, key);
  assert.equal(r.gradedCount, 2);
  assert.equal(r.total, 40);
  assert.equal(r.off, 6);
  assert.equal(r.score, 34);
  assert.equal(r.fleeces[1].graded, false);
});

test('helpers', () => {
  assert.equal(yieldFromDigits(7, 3), 73);
  assert.equal(yieldFromDigits(0, 0), 0);
  assert.equal(yieldFromDigits(null, 3), null);
  assert.equal(yieldFromDigits(3, null), null);
  assert.equal(fieldFromRead({ value: 4, status: 'ok' }), 4);
  assert.equal(fieldFromRead({ value: 0, status: 'ok' }), 0);
  assert.equal(fieldFromRead({ value: 4, status: 'multiple' }), null);
  assert.equal(fieldFromRead({ value: null, status: 'blank' }), null);
  assert.equal(fieldFromRead(null), null);
});
