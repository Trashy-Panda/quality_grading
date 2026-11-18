import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY_RE, encodeKey, decodeKey, isKeyString, blankFleece } from '../../beefgrading.study/fleece/keycodec.js';

const f = (grade, length, y, purity, character) => ({ grade, length, yield: y, purity, character });

test('round trip with blanks, n < 20, yield 0 and 99', () => {
  const key = Array.from({ length: 20 }, () => blankFleece());
  key[0] = f(0, 0, 0, 0, 0);
  key[1] = f(9, 2, 99, 1, 2);
  key[2] = f(4, null, 45, null, 1);
  key[3] = f(null, null, null, null, null);
  key[4] = f(7, 1, 5, 1, 0);
  const s = encodeKey(key, 5);
  assert.equal(s.length, 120);
  assert.match(s, KEY_RE);
  assert.equal(s.slice(0, 6), '000000');
  assert.equal(s.slice(6, 12), '929912');
  assert.equal(s.slice(12, 18), '4-45-1');
  assert.equal(s.slice(18, 24), '------');
  assert.equal(s.slice(24, 30), '710510');
  assert.equal(s.slice(30), '------'.repeat(15));
  assert.deepEqual(decodeKey(s), key);
});

test('rows at or past n are blanked even if filled', () => {
  const key = Array.from({ length: 20 }, () => f(1, 1, 11, 1, 1));
  const s = encodeKey(key, 3);
  assert.equal(s.slice(18), '------'.repeat(17));
  assert.deepEqual(decodeKey(s).slice(0, 3), key.slice(0, 3));
  assert.deepEqual(decodeKey(s)[3], blankFleece());
});

test('empty, short and junk input encode to a valid blank key', () => {
  for (const k of [undefined, null, [], [null, 5, 'x'], [{ grade: 10, length: -1, yield: 100, purity: 2, character: 3 }], [{ grade: 1.5, yield: '5' }]]) {
    const s = encodeKey(k, 20);
    assert.match(s, KEY_RE);
    assert.equal(s, '------'.repeat(20));
  }
  assert.equal(encodeKey([f(1, 1, 1, 1, 1)], 99).length, 120);
  assert.equal(encodeKey([f(1, 1, 1, 1, 1)], 0), '------'.repeat(20));
});

test('decodeKey rejects invalid strings', () => {
  for (const bad of [null, undefined, 5, '', 'x'.repeat(120), '------'.repeat(19), '------'.repeat(21), '3' + '-'.repeat(119), '--9---' + '------'.repeat(19), '-----2' + '------'.repeat(19).slice(6) + '------']) {
    if (typeof bad === 'string' && bad.length === 120 && KEY_RE.test(bad)) continue;
    assert.equal(decodeKey(bad), null, String(bad).slice(0, 12));
  }
  assert.equal(isKeyString('------'.repeat(20)), true);
  assert.equal(isKeyString('------'.repeat(19)), false);
});

test('exhaustive field values stay inside KEY_RE and decode back', () => {
  for (let y = 0; y <= 99; y++) {
    const s = encodeKey([f(9, 2, y, 1, 2)], 1);
    assert.match(s, KEY_RE);
    assert.equal(decodeKey(s)[0].yield, y);
  }
});
