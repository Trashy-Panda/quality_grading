import test from 'node:test';
import assert from 'node:assert/strict';
import { createRails, RAILS_STORE } from '../../beefgrading.study/fleece/rails.js';
import { KEY_RE } from '../../beefgrading.study/fleece/keycodec.js';
import * as online from '../../beefgrading.study/fleece/online.js';

function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, m };
}
const f = (grade, length, y, purity, character) => ({ grade, length, yield: y, purity, character });
const blank = () => f(null, null, null, null, null);

function session(over = {}) {
  const key = Array.from({ length: 20 }, blank);
  key[0] = f(0, 0, 50, 0, 1); key[1] = f(3, 1, 0, 1, 2); key[2] = f(9, 2, 99, 0, 0);
  const ans = (a) => { const r = Array.from({ length: 20 }, blank); a.forEach((x, i) => { r[i] = x; }); return r; };
  return {
    name: 'Region 3 Class A', n: 3, key,
    auto: Array.from({ length: 20 }, (_, i) => ({ purity: i === 0, character: i === 1 })),
    sheets: [
      { id: 1, name: 'Ann', file: 'a.jpg', corr: { 0: { grade: 2 } }, saved: { answers: ans([f(0, 0, 50, 0, 1), f(3, 1, 0, 1, 2), f(9, 2, 99, 0, 0)]), flags: { need: 0, audit: 1 } } },
      { id: 2, name: 'Bo', file: '', corr: {}, saved: { answers: ans([f(1, 0, 55, 0, 1), blank(), f(9, 2, 99, 0, 0)]), flags: { need: 2, audit: 0 } } },
    ],
    nextId: 3, ...over,
  };
}

let t = 1_700_000_000_000;
const clock = () => (t += 1000);

test('saveFromSession builds a compact record with summary; toSession round trips', () => {
  const st = memStore();
  const rails = createRails(st, { now: clock });
  const s = session();
  const r = rails.saveFromSession(s, { title: 'Spring Class', date: '2026-03-04', tag: 'Region', notes: 'n1' });
  assert.equal(r.ok, true);
  const rec = rails.get(r.id);
  assert.equal(rec.v, 1);
  assert.match(rec.key, KEY_RE);
  assert.equal(rec.sheets.length, 2);
  assert.equal(rec.summary.sheets, 2);
  assert.equal(rec.summary.keyed, 3);
  assert.equal(rec.summary.top, 60);
  assert.ok(rec.summary.avg < 60 && rec.summary.avg > 0);
  assert.equal(rec.postedId, null);
  const back = rails.toSession(r.id);
  assert.equal(back.name, 'Spring Class');
  assert.equal(back.n, 3);
  assert.equal(back.sheets.length, 2);
  assert.deepEqual(back.sheets[0].saved.answers, s.sheets[0].saved.answers);
  assert.deepEqual(back.sheets[1].saved.answers, s.sheets[1].saved.answers);
  assert.deepEqual(back.sheets[0].saved.flags, { need: 0, audit: 1 });
  assert.deepEqual(back.key.slice(0, 3), s.key.slice(0, 3));
  assert.equal(back.key.length, 20);
  assert.equal(back.auto.length, 20);
  assert.deepEqual(back.auto[0], { purity: true, character: false });
  assert.deepEqual(back.auto[1], { purity: false, character: true });
  assert.equal(back.nextId, 3);
  assert.deepEqual(back.sheets[0].corr, {});
  assert.equal(rails.toSession('nope'), null);
});

test('CRUD: update, duplicate, remove, overwrite via meta.id', () => {
  const rails = createRails(memStore(), { now: clock });
  const a = rails.saveFromSession(session(), { title: 'A', date: '2026-01-01' });
  const b = rails.saveFromSession(session({ name: 'B' }), { date: '2026-02-01' });
  assert.equal(rails.list().length, 2);
  assert.equal(rails.get(b.id).title, 'B');

  const u = rails.update(a.id, { title: 'A2', tag: 'FFA', notes: 'hello', postedId: 'abc123', n: 5, key: 'x' });
  assert.equal(u.ok, true);
  const ra = rails.get(a.id);
  assert.equal(ra.title, 'A2'); assert.equal(ra.tag, 'FFA'); assert.equal(ra.postedId, 'abc123');
  assert.equal(ra.n, 3);
  assert.match(ra.key, KEY_RE);
  assert.ok(ra.updatedAt > ra.createdAt);
  assert.equal(rails.update(a.id, { date: 'garbage' }).rail.date, '2026-01-01');
  assert.equal(rails.update(a.id, { postedId: null }).rail.postedId, null);
  assert.equal(rails.update('missing', { title: 'x' }).error, 'notfound');

  const d = rails.duplicate(a.id);
  assert.equal(d.ok, true);
  assert.notEqual(d.id, a.id);
  assert.equal(rails.get(d.id).title, 'A2 (copy)');
  assert.equal(rails.get(d.id).sheets.length, 2);
  assert.equal(rails.get(d.id).postedId, null);
  assert.equal(rails.list().length, 3);

  const o = rails.saveFromSession(session({ name: 'ignored' }), { id: a.id, title: 'A3' });
  assert.equal(o.id, a.id);
  assert.equal(rails.list().length, 3);
  assert.equal(rails.get(a.id).tag, 'FFA');

  assert.equal(rails.remove(d.id).ok, true);
  assert.equal(rails.list().length, 2);
  assert.equal(rails.remove(d.id).error, 'notfound');
});

test('list: search, tag filter, sort; tags()', () => {
  const rails = createRails(memStore(), { now: clock });
  rails.saveFromSession(session(), { title: 'Zebra Open', date: '2026-01-10', tag: 'FFA' });
  rails.saveFromSession(session(), { title: 'alpha cup', date: '2026-03-10', tag: '4-H', notes: 'wool heavy' });
  rails.saveFromSession(session(), { title: 'Mid', date: '2026-02-10', tag: 'ffa' });
  assert.deepEqual(rails.list().map((r) => r.title), ['alpha cup', 'Mid', 'Zebra Open']);
  assert.deepEqual(rails.list({ sort: 'old' }).map((r) => r.title), ['Zebra Open', 'Mid', 'alpha cup']);
  assert.deepEqual(rails.list({ sort: 'title' }).map((r) => r.title), ['alpha cup', 'Mid', 'Zebra Open']);
  assert.deepEqual(rails.list({ q: 'ZEBRA' }).map((r) => r.title), ['Zebra Open']);
  assert.deepEqual(rails.list({ q: 'wool' }).map((r) => r.title), ['alpha cup']);
  assert.deepEqual(rails.list({ q: 'ann' }).length, 3);
  assert.deepEqual(rails.list({ q: 'nomatch' }), []);
  assert.deepEqual(rails.list({ tag: 'FFA' }).map((r) => r.title), ['Mid', 'Zebra Open']);
  assert.deepEqual(rails.list({ tag: '4-H', q: 'cup' }).length, 1);
  assert.deepEqual(rails.tags(), ['4-H', 'ffa']);
  assert.equal(rails.list()[0].sheets, undefined);
});

test('quota and unavailable storage return errors, never throw', () => {
  const st = memStore();
  const rails = createRails(st, { now: clock });
  const a = rails.saveFromSession(session(), { title: 'Keep' });
  assert.equal(a.ok, true);
  const full = { getItem: st.getItem, setItem() { throw new Error('QuotaExceededError'); } };
  const r2 = createRails(full, { now: clock });
  assert.deepEqual(r2.saveFromSession(session(), { title: 'x' }), { ok: false, error: 'quota' });
  assert.deepEqual(r2.update(a.id, { title: 'y' }), { ok: false, error: 'quota' });
  assert.deepEqual(r2.duplicate(a.id), { ok: false, error: 'quota' });
  assert.deepEqual(r2.remove(a.id), { ok: false, error: 'quota' });
  assert.equal(r2.get(a.id).title, 'Keep');

  const dead = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const r3 = createRails(dead);
  assert.deepEqual(r3.list(), []);
  assert.equal(r3.get('x'), null);
  assert.equal(r3.saveFromSession(session()).ok, false);
  const none = createRails(null);
  assert.deepEqual(none.list(), []);
  assert.equal(none.saveFromSession(session()).error, 'storage');
});

test('corrupt and hostile stored data is sanitized on read', () => {
  const st = memStore();
  const rails = createRails(st, { now: clock });
  st.setItem(RAILS_STORE, '{not json');
  assert.deepEqual(rails.list(), []);
  st.setItem(RAILS_STORE, JSON.stringify({ rails: [
    null, 5, { id: 'bad id!' },
    { id: 'ok1', title: '<img src=x onerror=1>' + 'x'.repeat(200), date: 'nope', tag: 7, notes: { a: 1 }, n: 99, key: 'short', auto: 'zz', sheets: [{ name: 'S'.repeat(200), a: 'bad', flags: { need: -4, audit: 'x' } }, null], postedId: 'has space', createdAt: 'x' },
    { id: 'ok1', title: 'dup' },
  ] }));
  const l = rails.list();
  assert.equal(l.length, 1);
  assert.equal(l[0].title.length, 80);
  assert.equal(l[0].n, 20);
  assert.match(l[0].date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(l[0].postedId, null);
  const s = rails.toSession('ok1');
  assert.equal(s.key.length, 20);
  assert.equal(s.sheets.length, 2);
  assert.equal(s.sheets[0].name.length, 60);
  assert.deepEqual(s.sheets[0].saved.flags, { need: 0, audit: 0 });
  assert.equal(s.sheets[0].saved.answers.length, 20);
});

test('online: no network at import; bad input and offline resolve to errors', async () => {
  assert.deepEqual(Object.keys(online).sort(), ['currentUser', 'deleteOfficial', 'getOfficial', 'listOfficials', 'postOfficial']);
  assert.equal((await online.postOfficial({ title: '', n: 5, key: '------'.repeat(20) })).error, 'invalid');
  assert.equal((await online.postOfficial({ title: 'ok', n: 21, key: '------'.repeat(20) })).error, 'invalid');
  assert.equal((await online.postOfficial({ title: 'ok', n: 5, key: 'short' })).error, 'invalid');
  assert.equal((await online.getOfficial('bad id')).error, 'invalid');
  assert.equal((await online.deleteOfficial('')).error, 'invalid');
  // Node cannot import https: URLs, so the lazy Firebase load fails fast without touching the network.
  const r = await online.listOfficials();
  assert.equal(r.ok, false);
  assert.equal(r.error, 'offline');
});
