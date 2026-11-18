import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DIGITS, cnnNet, setNet, softmax, groupGlyphs, layoutMargin, parseTail, splitGlyph, segment, inkMap, isPrint, readDigit, readMarginYield } from '../../beefgrading.study/fleece/digits.js';

const NETBIN = new URL('../../beefgrading.study/fleece/vendor/digits-net.bin', import.meta.url);
const buf = readFileSync(NETBIN);
setNet(cnnNet(new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))));

// synthetic grey crop: paper 200, strokes 40. Each stroke is a filled rect [x0,y0,x1,y1].
function crop(w, h, rects, extra = {}) {
  const g = new Uint8Array(w * h).fill(200);
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y * w + x] = 40;
  return { g, w, h, ...extra };
}
const bar = (x, y0, y1, t = 4) => [x, y0, x + t - 1, y1];

test('vendored net is the expected size and softmax normalises', () => {
  assert.equal(buf.length, 5994 * 4);
  const p = softmax([1, 2, 3, 0, 0, 0, 0, 0, 0, 0]);
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-6);
});

test('groupGlyphs merges pieces that overlap in x and keeps separate digits apart', () => {
  const gs = groupGlyphs([
    { id: 1, x0: 10, x1: 30, y0: 0, y1: 10, area: 50 }, { id: 2, x0: 12, x1: 28, y0: 20, y1: 40, area: 60 },
    { id: 3, x0: 50, x1: 70, y0: 0, y1: 40, area: 90 }]);
  assert.equal(gs.length, 2);
  assert.deepEqual([gs[0].x0, gs[0].x1, gs[0].y0, gs[0].y1], [10, 30, 0, 40]);
});

test('layoutMargin takes the first two tall glyphs and leaves the deduction as tail', () => {
  const g = (x0, x1, y0, y1) => ({ x0, x1, y0, y1 });
  const lay = layoutMargin([g(10, 30, 10, 60), g(40, 60, 10, 60), g(80, 100, 35, 38), g(110, 125, 20, 60)], 80);
  assert.equal(lay.digits.length, 2);
  assert.equal(lay.tail.length, 2);
  assert.equal(lay.needSplit, false);
  const one = layoutMargin([g(10, 70, 10, 60)], 80);
  assert.equal(one.needSplit, true);
});

test('parseTail turns a dash and digits into "-N"', () => {
  const dash = { x0: 0, x1: 20, y0: 30, y1: 34 }, d2 = { x0: 30, x1: 45, y0: 10, y1: 50 };
  assert.equal(parseTail([dash, d2], [null, { digit: 2 }]), '-2');
  assert.equal(parseTail([], []), null);
});

test('a blank crop reads as empty, with full confidence', () => {
  const r = readDigit(crop(60, 80, []));
  assert.equal(r.digit, null); assert.equal(r.empty, true);
  assert.equal(readMarginYield(crop(200, 80, [])).value, null);
});

test('a single vertical stroke reads as 1', () => {
  const r = readDigit(crop(60, 80, [bar(28, 12, 68)]));
  assert.equal(r.digit, 1);
});

test('printed furniture is not ink: a bottom rule, a vertical rule and a filled bubble leave only the digit', () => {
  const c = crop(60, 80, [bar(28, 12, 66), [0, 76, 59, 79], bar(5, 0, 79, 2), [40, 20, 56, 36]], { vlines: [6], masks: [{ x: 48, y: 28, rx: 14, ry: 14 }] });
  const seg = segment(inkMap({ g: Float32Array.from(c.g), w: 60, h: 80 }, c, DIGITS), DIGITS, c.vlines);
  assert.equal(seg.glyphs.length, 1);
  assert.ok(seg.glyphs[0].x0 >= 26 && seg.glyphs[0].x1 <= 33);
  assert.equal(readDigit(c).digit, 1);
});

test('isPrint flags thin pieces hugging a rule and pieces in the top/bottom zone', () => {
  assert.equal(isPrint({ x0: 4, x1: 8, y0: 10, y1: 70 }, 60, 80, [6]), true);
  assert.equal(isPrint({ x0: 20, x1: 40, y0: 74, y1: 79 }, 60, 80, []), true);
  assert.equal(isPrint({ x0: 20, x1: 40, y0: 20, y1: 60 }, 60, 80, []), false);
});

test('margin: two separate strokes read as the two-digit yield 11, and a "-" tail is reported', () => {
  const r = readMarginYield(crop(200, 80, [bar(30, 14, 66), bar(60, 14, 66), [95, 38, 115, 41], bar(130, 14, 66)]));
  assert.equal(r.value, 11);
  assert.ok(typeof r.conf === 'number' && r.conf >= 0 && r.conf <= 1);
  assert.match(r.extra || '', /^-/);
});

test('two touching digits are split in two', () => {
  const rects = [[20, 14, 23, 66], [20, 38, 52, 41], [49, 14, 52, 66]]; // "4"-like blob touching a bar: one wide component
  const c = crop(200, 80, [...rects, bar(53, 14, 66), bar(80, 14, 66)]);
  const r = readMarginYield(c);
  assert.equal(r.digits.length, 2);
});

test('splitGlyph cuts at the thinnest column', () => {
  const c = crop(100, 60, [bar(10, 10, 50), [10, 28, 70, 31], bar(67, 10, 50)]);
  const seg = segment(inkMap({ g: Float32Array.from(c.g), w: 100, h: 60 }, {}, DIGITS), DIGITS, []);
  const parts = splitGlyph(seg, seg.glyphs[0]);
  assert.equal(parts.length, 2);
  assert.ok(parts[0].x1 < parts[1].x0 + 1);
});

test('hand-truth.json: 20 rows per sheet, [tens, ones, margin]', () => {
  const t = JSON.parse(readFileSync(new URL('../assets/test/real/hand-truth.json', import.meta.url), 'utf8'));
  const sheets = Object.keys(t).filter(k => k[0] !== '_');
  assert.ok(sheets.length >= 12);
  for (const s of sheets) {
    assert.equal(t[s].length, 20, s);
    for (const [a, b, m] of t[s]) {
      for (const v of [a, b]) assert.ok(v === null || v === '?' || (Number.isInteger(v) && v >= 0 && v <= 9), s);
      assert.ok(m === null || m === '?' || /^\d\d(-\d+)?$/.test(m), s + ' ' + m);
    }
  }
});
