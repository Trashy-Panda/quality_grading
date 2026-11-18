import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml, csvCell, railCsv, csvFileName, fmtDate, todayStr, keyedRows, sessionInfo, sessionHasWork,
  shareUrl, officialIdFromSearch, onlineMessage, plural,
} from '../../beefgrading.study/fleece/railsview.js';
import { createRails } from '../../beefgrading.study/fleece/rails.js';

function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
}
const f = (grade, length, y, purity, character) => ({ grade, length, yield: y, purity, character });
const blank = () => f(null, null, null, null, null);
function session(over = {}) {
  const key = Array.from({ length: 20 }, blank);
  key[0] = f(0, 0, 50, 0, 1); key[1] = f(3, 1, 0, 1, 2); key[2] = f(9, 2, 99, 0, 0);
  const ans = (a) => { const r = Array.from({ length: 20 }, blank); a.forEach((x, i) => { r[i] = x; }); return r; };
  return {
    name: 'Region 3', n: 3, key, auto: [],
    sheets: [
      { id: 1, name: 'Ann', saved: { answers: ans([f(0, 0, 50, 0, 1), f(3, 1, 0, 1, 2), f(9, 2, 99, 0, 0)]), flags: { need: 0, audit: 1 } } },
      { id: 2, name: '=SUM(A1), "Bo"', saved: { answers: ans([f(1, 0, 55, 0, 1), blank(), f(9, 2, 99, 0, 0)]), flags: { need: 2, audit: 0 } } },
    ],
    nextId: 3, ...over,
  };
}

test('escapeHtml covers & < > " \'', () => {
  assert.equal(escapeHtml(`<a href="x" onclick='y'>&`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(5), '5');
});

test('csvCell quotes and neutralizes formulas', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('@x'), "'@x");
  assert.equal(csvCell('-2'), "'-2");
  assert.equal(csvCell(-2), '-2');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
});

test('railCsv: header, scores, flags, per-fleece off, formula-safe names', () => {
  const rails = createRails(memStore());
  const { id } = rails.saveFromSession(session(), { title: 'T' });
  const csv = railCsv(rails.get(id));
  const lines = csv.split('\n');
  assert.equal(lines[0], 'Name,Score,Total,Points off,To confirm,Grading checks,F1 off,F2 off,F3 off');
  assert.equal(lines.length, 3);
  const ann = lines[1].split(',');
  assert.equal(ann[0], 'Ann');
  assert.equal(+ann[3], 0);                 // perfect sheet
  assert.equal(+ann[1], +ann[2]);
  assert.equal(+ann[5], 1);                 // audit flag carried
  assert.ok(lines[2].startsWith(`"'=SUM(A1), ""Bo"""`), lines[2]);
  const bo = lines[2].slice(lines[2].lastIndexOf('"') + 2).split(',');
  assert.ok(+bo[0] < +bo[1]);               // Bo lost points
  assert.equal(+bo[2], +bo[1] - +bo[0]);    // Points off = total - score
  assert.equal(+bo[3], 2);                  // To confirm
});

test('railCsv: no sheets gives header only; blank fleeces stay empty', () => {
  const rails = createRails(memStore());
  const { id } = rails.saveFromSession(session({ sheets: [] }), {});
  assert.equal(railCsv(rails.get(id)).split('\n').length, 1);
  const s = session(); s.key[1] = blank();
  const r2 = rails.saveFromSession(s, {});
  const row = railCsv(rails.get(r2.id)).split('\n')[1].split(',');
  assert.equal(row[7], '');                 // F2 not keyed
});

test('csvFileName', () => {
  assert.equal(csvFileName({ title: 'Region 3: Class A!', date: '2026-03-04' }), 'region-3-class-a-2026-03-04.csv');
  assert.equal(csvFileName({ title: '???', date: '' }), 'rail.csv');
  assert.equal(csvFileName(null), 'rail.csv');
});

test('fmtDate / todayStr', () => {
  assert.match(fmtDate('2026-03-04'), /2026/);
  assert.equal(fmtDate('nope'), '');
  assert.equal(todayStr(new Date(2026, 0, 5)), '2026-01-05');
});

test('session helpers', () => {
  const s = session();
  assert.equal(keyedRows(s.key, 3), 3);
  assert.equal(keyedRows(s.key, 2), 2);
  assert.equal(keyedRows(null), 0);
  assert.deepEqual(sessionInfo(s), { sheets: 2, keyed: 3, name: 'Region 3' });
  assert.equal(sessionHasWork(s), true);
  assert.equal(sessionHasWork({ n: 20, key: Array.from({ length: 20 }, blank), sheets: [] }), false);
  assert.equal(sessionHasWork(null), false);
  assert.equal(plural(1, 'sheet'), '1 sheet');
});

test('shareUrl and officialIdFromSearch round-trip', () => {
  const u = shareUrl('abc_123', 'https://beefgrading.study/fleece/?x=1#frag');
  assert.equal(u, 'https://beefgrading.study/fleece/?official=abc_123');
  assert.equal(officialIdFromSearch(new URL(u).search), 'abc_123');
  assert.equal(officialIdFromSearch('?official=bad id'), '');
  assert.equal(officialIdFromSearch('?official=' + 'a'.repeat(65)), '');
  assert.equal(officialIdFromSearch(''), '');
});

test('onlineMessage', () => {
  assert.match(onlineMessage('offline', 'list'), /connection/);
  assert.match(onlineMessage('denied', 'list'), /not available/);
  assert.match(onlineMessage('denied'), /Not available/);
  assert.match(onlineMessage('weird'), /Try again/);
});
