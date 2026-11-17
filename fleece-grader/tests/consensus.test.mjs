import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKeyFromSlashes, mergeKey } from '../../beefgrading.study/fleece/consensus.js';

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
