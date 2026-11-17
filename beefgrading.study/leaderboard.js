/* ============================================================
   WEEKLY PAGE / LEADERBOARD — leaderboard.js
   Depends on: app.js (state), auth.js (window._db, window._currentUser),
               weekly.js (getWeekId, setWeeklyRuleSet, _weeklyRuleSet, DB_COLLECTIONS)
   ============================================================ */

'use strict';

// ── Firestore listener cleanup handle ──────────────────────────
window._leaderboardUnsubscribe = null;

const LB_MAX_ROWS = 100;
const LB_MAX_WEEKS_BACK = 52;

/* ── formatWeekRange ──────────────────────────────────────────
   Parses "2026-W12" to "Week of Mar 16 to Mar 22, 2026"
   ISO week 1 = week containing the first Thursday of January.
   Monday is day 1, Sunday is day 7.
   ─────────────────────────────────────────────────────────── */
function formatWeekRange(weekId) {
  // weekId = "YYYY-Www"
  if (typeof weekId !== 'string') weekId = String(weekId || '');
  const match = weekId.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return weekId;

  const year    = parseInt(match[1], 10);
  const week    = parseInt(match[2], 10);

  // Find the Monday of the given ISO week.
  // Jan 4 is always in ISO week 1 (by definition).
  const jan4    = new Date(Date.UTC(year, 0, 4));
  // Day of week for Jan 4: getUTCDay() — 0=Sun…6=Sat; convert to Mon=0
  const jan4Dow = (jan4.getUTCDay() + 6) % 7; // Mon=0, Tue=1 … Sun=6
  // Monday of week 1
  const w1Mon   = new Date(jan4);
  w1Mon.setUTCDate(jan4.getUTCDate() - jan4Dow);
  // Monday of target week
  const wMon    = new Date(w1Mon);
  wMon.setUTCDate(w1Mon.getUTCDate() + (week - 1) * 7);
  // Sunday of target week
  const wSun    = new Date(wMon);
  wSun.setUTCDate(wMon.getUTCDate() + 6);

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun',
                  'Jul','Aug','Sep','Oct','Nov','Dec'];
  const fmtDate = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;

  return `Week of ${fmtDate(wMon)} to ${fmtDate(wSun)}, ${wSun.getUTCFullYear()}`;
}

/* ── ISO week helpers ─────────────────────────────────────────
   Shifting works on the Monday of the week, then re-derives the
   ISO id from that week's Thursday.
   ─────────────────────────────────────────────────────────── */
function _weekMonday(weekId) {
  const m = String(weekId).match(/^(\d{4})-W(\d{2})$/);
  if (!m) return null;
  const jan4 = new Date(Date.UTC(parseInt(m[1], 10), 0, 4));
  const mon = new Date(jan4);
  mon.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (parseInt(m[2], 10) - 1) * 7);
  return mon;
}

function _isoWeekIdOf(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return d.getUTCFullYear() + '-W' + String(weekNum).padStart(2, '0');
}

function _shiftWeek(weekId, delta) {
  const mon = _weekMonday(weekId);
  if (!mon) return weekId;
  mon.setUTCDate(mon.getUTCDate() + delta * 7);
  return _isoWeekIdOf(mon);
}

function _currentWeekId() {
  return typeof getWeekId === 'function' ? getWeekId() : '';
}

function _currentRuleSet() {
  return (typeof _weeklyRuleSet !== 'undefined' && _weeklyRuleSet) || 'ffa';
}

/* ── Screen state ─────────────────────────────────────────── */
let _lbWeekId = '';
let _lbToken = 0;          // guards stale one-time reads
let _lbLastDocs = null;
let _leaderboardReturnScreen = 'home'; // 'home' or 'summary'

function _lbEl(id) { return document.getElementById(id); }

function _lbIsOpen() {
  const s = _lbEl('leaderboard-screen');
  return !!(s && !s.classList.contains('hidden'));
}

/* Week label, week-nav state, challenge strip mode, back link */
function _lbSyncChrome() {
  const current = _currentWeekId();
  const isCurrent = _lbWeekId === current;

  const label = _lbEl('leaderboard-week-label');
  if (label) {
    let text = formatWeekRange(_lbWeekId).replace(/^Week of /, '');
    // Carcass count only for the live week, and only when the deck is known
    const deck = window._weeklyCarcasses;
    if (isCurrent && Array.isArray(deck) && deck.length) {
      text += '. ' + _lbCount(deck.length) + ' carcasses, one attempt.';
    }
    label.textContent = text;
  }

  const next = _lbEl('leaderboard-next-week');
  if (next) next.disabled = isCurrent;
  const prev = _lbEl('leaderboard-prev-week');
  if (prev) prev.disabled = _lbWeekId <= _shiftWeek(current, -LB_MAX_WEEKS_BACK);

  const band = _lbEl('weekly-challenge-card');
  if (band) band.classList.toggle('is-past', !isCurrent);

  // Readout: a countdown for the live week, "Final" for earlier ones
  const cd = _lbEl('weekly-countdown');
  const cdK = _lbEl('weekly-closes-k');
  if (cd && cdK) {
    cd.dataset.past = isCurrent ? '0' : '1';
    cdK.textContent = isCurrent ? 'Closes in' : 'Status';
    if (!isCurrent) cd.textContent = 'Final';
    else if (typeof formatCountdown === 'function' && typeof getWeekBounds === 'function') {
      cd.textContent = formatCountdown(getWeekBounds().end.getTime() - Date.now());
    }
  }

  const back = _lbEl('leaderboard-back-btn');
  if (back) back.hidden = _leaderboardReturnScreen !== 'summary';
}

/* ── showLeaderboardScreen ─────────────────────────────────── */
function showLeaderboardScreen(weekId, ruleSet) {
  weekId  = weekId || _currentWeekId();
  ruleSet = ruleSet || _currentRuleSet();

  // Remember where to go back to (kept as-is when already on this page)
  if (!_lbIsOpen()) {
    const summary = document.getElementById('summary-screen');
    _leaderboardReturnScreen = (summary && !summary.classList.contains('hidden')) ? 'summary' : 'home';
  }

  // Hide every known screen
  document.querySelectorAll('main.screen').forEach(s => s.classList.add('hidden'));
  // drill-screen doesn't use .screen class
  const drillScreen = document.getElementById('drill-screen');
  if (drillScreen) drillScreen.classList.add('hidden');
  const appHeader = document.getElementById('app-header');
  if (appHeader) appHeader.classList.add('hidden');
  const landing = document.getElementById('landing-hero');
  if (landing) landing.classList.add('hidden');

  const lbScreen = _lbEl('leaderboard-screen');
  if (lbScreen) lbScreen.classList.remove('hidden');
  window.scrollTo(0, 0);

  // One division for the whole page: challenge strip and board agree
  if (typeof setWeeklyRuleSet === 'function' && _currentRuleSet() !== ruleSet) {
    setWeeklyRuleSet(ruleSet, true);
  }

  _lbWeekId = weekId;
  _lbSyncChrome();
  renderLeaderboard(weekId, ruleSet);
}

/* ── hideLeaderboardScreen ─────────────────────────────────── */
/* Pass { restore: false } when another page is about to take over. */
function hideLeaderboardScreen(opts) {
  const lbScreen = _lbEl('leaderboard-screen');
  if (lbScreen) lbScreen.classList.add('hidden');

  // Unsubscribe Firestore listener
  _lbUnsubscribe();

  if (opts && opts.restore === false) return;

  // Return to where we came from
  if (_leaderboardReturnScreen === 'summary') {
    const summaryScreen = document.getElementById('summary-screen');
    if (summaryScreen) summaryScreen.classList.remove('hidden');
    const appHeader = document.getElementById('app-header');
    if (appHeader) appHeader.classList.remove('hidden');
    if (typeof updateWeeklySubmitBtn === 'function') updateWeeklySubmitBtn();
  } else {
    const homeScreen = document.getElementById('home-screen');
    if (homeScreen) homeScreen.classList.remove('hidden');
  }
}

function _lbUnsubscribe() {
  _lbToken++;
  if (typeof window._leaderboardUnsubscribe === 'function') {
    window._leaderboardUnsubscribe();
  }
  window._leaderboardUnsubscribe = null;
}

/* ── renderLeaderboard ─────────────────────────────────────── */
function renderLeaderboard(weekId, ruleSet) {
  _lbUnsubscribe();
  const token = _lbToken;
  _lbWeekId = weekId;
  _lbLastDocs = null;

  if (!_lbEl('leaderboard-list')) return;
  _lbShowSkeleton(5);

  if (typeof WK_FIXTURE !== 'undefined' && WK_FIXTURE) {
    // Dev fixture: same render path, no Firestore
    setTimeout(() => {
      if (token !== _lbToken) return;
      renderLeaderboardRows(wkFixtureDocs(weekId, ruleSet));
    }, 0);
    return;
  }

  if (!window._db) {
    _lbShowMessage('Scores are unavailable right now.');
    return;
  }

  const query = wkSubmissionsQuery(weekId, ruleSet);

  const onError = (err) => {
    console.error('[leaderboard] Firestore error:', err);
    _lbShowMessage('Could not load scores. Try again in a moment.');
  };

  if (weekId === _currentWeekId()) {
    // Current week: live listener
    window._leaderboardUnsubscribe = query.onSnapshot(
      (snapshot) => { renderLeaderboardRows(snapshot.docs); },
      onError
    );
  } else {
    // Past week: scores are final, one read is enough
    query.get().then((snapshot) => {
      if (token !== _lbToken) return;
      renderLeaderboardRows(snapshot.docs);
    }).catch((err) => {
      if (token !== _lbToken) return;
      onError(err);
    });
  }
}

/* ── DOM builders (textContent only, no user data in innerHTML) ── */
function _lbMake(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function _lbSvg(tag, attrs) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k]));
  return n;
}

function _lbAvatar(photoURL, rawName) {
  const src = String(photoURL || '');
  if (/^https?:\/\//i.test(src)) {
    const img = document.createElement('img');
    img.className = 'leaderboard-avatar';
    img.src = src;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    return img;
  }
  const svg = _lbSvg('svg', { 'class': 'leaderboard-avatar leaderboard-avatar-fallback', viewBox: '0 0 28 28', 'aria-hidden': 'true' });
  const c = _lbSvg('circle', { cx: '14', cy: '14', r: '14' });
  const t = _lbSvg('text', { x: '14', y: '18', 'text-anchor': 'middle' });
  t.textContent = _getInitials(rawName);
  svg.append(c, t);
  return svg;
}

const _LB_WORDS = ['zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];
function _lbCount(n) { return _LB_WORDS[n] || String(n); }

/* "Ana Whitfield" -> "Ana W.", one word stays as is. Labels only; the table shows full names. */
function _lbShortName(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  if (parts.length === 0) return 'Anonymous';
  if (parts.length === 1) return clip(parts[0], 14);
  return clip(parts[0], 12) + ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.';
}

function _lbCurrentUid() { return window._currentUser ? window._currentUser.uid : null; }

/* ── Plot: axis + ticks, always drawn ───────────────────────── */
function _lbDrawAxis(scale) {
  scale.textContent = '';
  scale._wk = null;
  scale.append(_lbMake('span', 'wk-axis'));
  const ticks = _lbMake('div', 'wk-ticks');
  ticks.setAttribute('aria-hidden', 'true');
  for (let i = 0; i <= 10; i++) {
    const t = _lbMake('span', 'wk-tick' + (i % 2 ? ' wk-tick--odd' : ''), String(i * 10));
    t.style.left = (i * 10) + '%';
    ticks.appendChild(t);
  }
  scale.appendChild(ticks);
}

function _lbPlotMessage(text) {
  const scale = _lbEl('wk-scale');
  if (!scale) return;
  _lbDrawAxis(scale);
  scale.style.height = '150px';
  scale.appendChild(_lbMake('p', 'wk-scale-msg', text));
  const sum = _lbEl('wk-plot-sum');
  if (sum) sum.textContent = text;
}

function _lbRenderPlot(entries) {
  const scale = _lbEl('wk-scale');
  if (!scale) return;
  const uid = _lbCurrentUid();
  const scored = entries.filter((e) => e.pct !== null);
  if (!scored.length) {
    _lbPlotMessage(_lbWeekId === _currentWeekId() ? 'No scores yet this week.' : 'No scores were posted this week.');
    return;
  }
  _lbDrawAxis(scale);

  const model = { dots: [], flags: [] };
  const meEntry = uid ? scored.find((e) => e.userId === uid) : null;

  scored.forEach((e, i) => {
    const isMe = !!meEntry && e === meEntry;
    const isTop = i < 3;
    const dot = _lbMake('span', 'wk-dot' + (isTop ? ' wk-dot--top' : '') + (isMe ? ' wk-dot--me' : ''));
    const pct = Math.max(0, Math.min(100, e.pct));
    dot.style.left = pct + '%';
    const d = { el: dot, pct: pct, entry: e, me: isMe };
    model.dots.push(d);
  });
  // Draw order: everyone, then top three, then you on top
  const weight = (d) => (d.me ? 2 : (scored.indexOf(d.entry) < 3 ? 1 : 0));
  model.dots.slice().sort((a, b) => weight(a) - weight(b)).forEach((d) => scale.appendChild(d.el));

  // Flags: top three and you. A tie with a labelled score shares that label.
  const flagFor = (d, text, me) => {
    const el = _lbMake('span', 'wk-flag' + (me ? ' wk-flag--me' : ''));
    el.appendChild(_lbMake('b', '', text.name));
    el.appendChild(document.createTextNode(' ' + text.value));
    const stem = _lbMake('span', 'wk-stem' + (me ? ' wk-stem--me' : ''));
    stem.setAttribute('aria-hidden', 'true');
    scale.append(stem, el);
    const f = { el: el, stem: stem, dot: d, pct: d.pct };
    model.flags.push(f);
    return f;
  };
  model.dots.forEach((d, i) => {
    if (i < 3 && !d.me) flagFor(d, { name: _lbShortName(d.entry.name), value: String(Math.round(d.entry.pct)) }, false);
  });
  const meDot = model.dots.find((d) => d.me);
  if (meDot) {
    const twin = model.flags.find((f) => Math.abs(f.pct - meDot.pct) < 0.5);
    if (twin) {
      twin.el.textContent = '';
      twin.el.classList.add('wk-flag--me');
      twin.stem.classList.add('wk-stem--me');
      twin.el.appendChild(_lbMake('b', '', _lbShortName(twin.dot.entry.name) + ' and you'));
      twin.el.appendChild(document.createTextNode(' ' + Math.round(meDot.entry.pct)));
    } else {
      flagFor(meDot, { name: 'You', value: String(Math.round(meDot.entry.pct)) }, true);
    }
  }

  scale._wk = model;
  scale._wkW = 0;

  // Summary sentence for assistive tech
  const sum = _lbEl('wk-plot-sum');
  if (sum) {
    const lo = Math.round(Math.min.apply(null, scored.map((e) => e.pct)));
    const hi = Math.round(Math.max.apply(null, scored.map((e) => e.pct)));
    let text = scored.length + (scored.length === 1 ? ' grader' : ' graders') + ', scores from ' + lo + ' to ' + hi + ' percent. Top: '
      + scored.slice(0, 3).map((e) => _lbShortName(e.name) + ' ' + Math.round(e.pct)).join(', ') + '.';
    if (meEntry) text += ' You scored ' + Math.round(meEntry.pct) + ', ' + wkOrdinal(meEntry.rank) + ' of ' + entries.length + '.';
    sum.textContent = text;
  }

  _lbEnsurePlotObserver();
  _lbLayoutPlot();
}

let _lbPlotObserver = null;
function _lbEnsurePlotObserver() {
  if (_lbPlotObserver || typeof ResizeObserver === 'undefined') return;
  const scale = _lbEl('wk-scale');
  if (!scale) return;
  _lbPlotObserver = new ResizeObserver(() => { requestAnimationFrame(_lbLayoutPlot); });
  _lbPlotObserver.observe(scale);
}

/* Pixel layout: stack crowded dots, then stagger the labels so none collide.
   Needs a laid-out width, so it re-runs on resize and when the screen shows. */
function _lbLayoutPlot() {
  const scale = _lbEl('wk-scale');
  const m = scale && scale._wk;
  if (!m) return;
  const W = scale.clientWidth;
  if (!W) return;
  if (scale._wkW === W) return;
  scale._wkW = W;

  // 1. Dots: lowest level where nothing sits within one dot-width
  const GAP = 13;
  const order = m.dots.slice().sort((a, b) => a.pct - b.pct);
  const lastX = [];
  order.forEach((d) => {
    d.x = d.pct / 100 * W;
    let l = 0;
    while (lastX[l] !== undefined && d.x - lastX[l] < GAP) l++;
    lastX[l] = d.x;
    d.level = l;
  });
  const maxLevel = Math.max(0, lastX.length - 1);
  const step = Math.min(GAP, 190 / Math.max(1, maxLevel));
  order.forEach((d) => { d.bottom = 32 + d.level * step; });

  // 2. Flags: first row where the label clears labels in its row and stems crossing it
  const ROW = 24;
  const TEXT_H = 20;
  const placed = [];
  // Narrow plots label only you (or the leader when you have no score), as in the comp
  const narrow = W < 480;
  const keep = narrow ? (m.flags.find((f) => f.dot.me || f.el.classList.contains('wk-flag--me')) || m.flags.slice().sort((a, b) => b.pct - a.pct)[0]) : null;
  m.flags.forEach((f) => {
    const off = narrow && f !== keep;
    f.off = off;
    f.el.style.display = off ? 'none' : '';
    f.stem.style.display = off ? 'none' : '';
  });
  m.flags.filter((f) => !f.off).sort((a, b) => a.pct - b.pct).forEach((f) => {
    const w = f.el.offsetWidth;
    f.x = f.dot.x;
    const half = w / 2;
    f.cx = Math.max(half, Math.min(W - half, f.x));
    f.lo = f.cx - half - 8;
    f.hi = f.cx + half + 8;
    const STEM_PAD = 4;
    const clashes = (row) => placed.reduce((n, p) => {
      let c;
      if (p.row === row) c = p.lo < f.hi && f.lo < p.hi;
      else if (p.row < row) c = p.x > f.cx - half - STEM_PAD && p.x < f.cx + half + STEM_PAD;  // its stem passes through our row
      else c = f.x > p.cx - p.el.offsetWidth / 2 - STEM_PAD && f.x < p.cx + p.el.offsetWidth / 2 + STEM_PAD; // our stem passes through its row
      return n + (c ? 1 : 0);
    }, 0);
    let row = 0;
    let best = 0;
    let bestN = Infinity;
    for (let r = 0; r < 5; r++) {
      const n = clashes(r);
      if (n < bestN) { bestN = n; best = r; }
      if (n === 0) break;
    }
    row = best;
    f.row = row;
    placed.push(f);
  });
  const shown = m.flags.filter((f) => !f.off);
  const rows = shown.length ? Math.max.apply(null, shown.map((f) => f.row)) + 1 : 0;
  const labelsH = rows ? rows * ROW + 4 : 0;

  // 3. Heights and positions
  const dotsH = maxLevel * step + 16;
  const H = labelsH + dotsH + 32;
  scale.style.height = H + 'px';
  order.forEach((d) => { d.el.style.bottom = d.bottom + 'px'; });
  shown.forEach((f) => {
    const top = f.row * ROW;
    f.el.style.left = (f.cx - f.el.offsetWidth / 2) + 'px';
    f.el.style.top = top + 'px';
    const dotTop = H - f.dot.bottom - (f.dot.me ? 14 : 12);
    f.stem.style.left = f.x + 'px';
    f.stem.style.top = (top + TEXT_H) + 'px';
    f.stem.style.height = Math.max(4, dotTop - (top + TEXT_H) - 2) + 'px';
  });
}

/* ── Table + panels ─────────────────────────────────────────── */
function _lbShowSkeleton(count) {
  const list = _lbEl('leaderboard-list');
  list.textContent = '';
  for (let i = 0; i < count; i++) {
    const tr = _lbMake('tr', 'wk-skel');
    for (let c = 0; c < 5; c++) {
      const td = _lbMake('td', c === 4 ? 'wk-col-date' : '');
      td.appendChild(_lbMake('span'));
      tr.appendChild(td);
    }
    list.appendChild(tr);
  }
  const grid = _lbEl('wk-grid'); if (grid) grid.hidden = false;
  const you = _lbEl('wk-you-panel'); if (you) you.hidden = true;
  const scale = _lbEl('wk-scale');
  if (scale) {
    _lbDrawAxis(scale);
    scale.style.height = '150px';
    scale.appendChild(_lbMake('p', 'wk-scale-msg', 'Loading scores.'));
  }
}

function _lbShowMessage(text) {
  _lbEl('leaderboard-list').textContent = '';
  const grid = _lbEl('wk-grid'); if (grid) grid.hidden = true;
  _lbPlotMessage(text);
  _lbSetReadout(null, null);
}

function _lbSetReadout(entries, median) {
  const g = _lbEl('wk-graders');
  if (g) g.textContent = !entries ? '-' : String(entries.length) + (entries.length >= LB_MAX_ROWS ? '+' : '');
  const cell = _lbEl('wk-median-cell');
  const mv = _lbEl('wk-median');
  if (cell && mv) {
    cell.hidden = median === null;
    if (median !== null) mv.textContent = Math.round(median) + '%';
  }
}

function _lbDateText(d) {
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
}

/* ── renderLeaderboardRows ─────────────────────────────────── */
function renderLeaderboardRows(docs) {
  const list = _lbEl('leaderboard-list');
  if (!list) return;
  _lbLastDocs = docs || [];

  const entries = wkBuildEntries(_lbLastDocs);
  const median = wkMedian(entries);
  window._wkBoard = { weekId: _lbWeekId, ruleSet: _currentRuleSet(), entries: entries };
  _lbView = { entries: entries, median: median, weekId: _lbWeekId, ruleSet: _currentRuleSet() };

  _lbSetReadout(entries, median);
  _lbRenderPlot(entries);

  const grid = _lbEl('wk-grid');
  list.textContent = '';
  if (!entries.length) {
    // Nothing to tabulate: the plot above carries the empty state
    if (grid) grid.hidden = true;
    _lbRenderYou();
    if (typeof renderWeeklyCard === 'function') renderWeeklyCard();
    return;
  }
  if (grid) grid.hidden = false;

  const uid = _lbCurrentUid();
  entries.forEach((e) => {
    const isMe = !!uid && e.userId === uid;
    const tr = _lbMake('tr', isMe ? 'wk-me' : '');
    const rk = _lbMake('td', 'rk');
    if (e.rank <= 3) {
      const medal = _lbMake('span', 'wk-medal' + (e.rank === 1 ? ' wk-medal--1' : ''), String(e.rank));
      medal.setAttribute('aria-label', 'Rank ' + e.rank);
      rk.appendChild(medal);
    } else {
      rk.textContent = String(e.rank);
    }
    const who = _lbMake('td', 'who');
    const wrap = _lbMake('div', 'wk-who');
    wrap.append(_lbAvatar(e.photoURL, e.name), _lbMake('span', 'wk-name-text', e.name));
    if (isMe) wrap.append(_lbMake('span', 'wk-you-tag', 'You'));
    who.appendChild(wrap);
    tr.append(
      rk, who,
      _lbMake('td', 'n', e.earned !== null ? String(e.earned) : ''),
      _lbMake('td', 'n', e.pct !== null ? Math.round(e.pct) + '%' : ''),
      _lbMake('td', 'n wk-col-date', _lbDateText(e.date))
    );
    list.appendChild(tr);
  });

  _lbRenderYou();
  // Rank changes the status sentence ("You placed 6th with 84%.")
  if (typeof renderWeeklyCard === 'function') renderWeeklyCard();

  // Rows arrive from a live Firestore listener, so re-scan after each
  // render. No-op if scroll.js isn't loaded on this page.
  if (typeof window.initScrollReveals === 'function') {
    window.initScrollReveals(_lbEl('leaderboard-screen'));
  }
}

/* ── Your result (dark panel) ───────────────────────────────── */
let _lbView = null;
let _lbCardCtx = null;

function _lbMine() {
  if (!_lbView) return null;
  const uid = _lbCurrentUid();
  if (!uid) return null;
  const found = _lbView.entries.find((e) => e.userId === uid);
  if (found) return found;
  // Outside the loaded rows (or not listed yet): fall back to the submission itself
  const ctx = _lbCardCtx;
  if (ctx && ctx.weekId === _lbView.weekId && ctx.ruleSet === _lbView.ruleSet && ctx.submission && ctx.user && ctx.user.uid === uid) {
    const sub = ctx.submission;
    const built = wkBuildEntries([{ data: function () { return sub; } }])[0];
    built.rank = null;
    built.userId = uid;
    return built;
  }
  return null;
}

function _lbRenderYou() {
  const panel = _lbEl('wk-you-panel');
  const grid = _lbEl('wk-grid');
  if (!panel) return;
  const mine = _lbMine();
  panel.textContent = '';
  if (!mine || mine.earned === null || mine.max === null) {
    panel.hidden = true;
    if (grid) grid.classList.remove('has-you');
    return;
  }
  panel.hidden = false;
  if (grid) { grid.classList.add('has-you'); grid.hidden = false; }

  const view = _lbView;
  const division = wkDivisionName(view.ruleSet);
  const total = view.entries.length + (view.entries.length >= LB_MAX_ROWS ? '+' : '');

  panel.appendChild(_lbMake('div', 'wk-you-k', 'Your result'));
  const big = _lbMake('div', 'wk-you-big num', String(mine.earned));
  big.appendChild(_lbMake('small', '', '/' + mine.max));
  panel.appendChild(big);
  panel.appendChild(_lbMake('div', 'wk-you-k',
    mine.rank ? wkOrdinal(mine.rank) + ' of ' + total + ' in ' + division : 'In ' + division));

  const rows = [];
  if (mine.answers) {
    const exact = mine.answers.filter((p) => p === 10).length;
    const near = mine.answers.filter((p) => p === 9 || p === 7).length;
    const miss = mine.answers.length - exact - near;
    const strip = _lbMake('div', 'wk-ladder');
    strip.style.setProperty('--n', String(mine.answers.length));
    strip.setAttribute('role', 'img');
    strip.setAttribute('aria-label', 'Carcass by carcass: ' + exact + ' exact, ' + near + ' within a third, ' + miss + (miss === 1 ? ' miss' : ' misses'));
    mine.answers.forEach((p) => {
      strip.appendChild(_lbMake('i', p === 10 ? 'ok' : (p === 9 || p === 7 ? 'near' : 'miss')));
    });
    panel.appendChild(strip);
    panel.appendChild(_lbMake('div', 'wk-you-legend', 'Carcass 1 to ' + mine.answers.length + ': exact, within a third, miss'));
    rows.push(['Exact calls', exact + ' of ' + mine.answers.length]);
    rows.push(['Within one third', String(near)]);
  }
  if (view.median !== null && mine.pct !== null) {
    const diff = Math.round(mine.pct - view.median);
    rows.push(['Versus field median', (diff > 0 ? '+' : '') + diff + ' pts']);
  }
  if (rows.length) {
    const dl = _lbMake('dl', 'wk-you-dl');
    rows.forEach((r) => { dl.append(_lbMake('dt', '', r[0]), _lbMake('dd', 'num', r[1])); });
    panel.appendChild(dl);
  }
}

/* weekly.js reports what it learned about the challenge (deck size, your submission) */
window.wkOnCardContext = function (ctx) {
  _lbCardCtx = ctx;
  if (!_lbIsOpen()) return;
  if (ctx.weekId === _lbWeekId) _lbSyncChrome();
  if (_lbView && ctx.weekId === _lbView.weekId) _lbRenderYou();
};
window.wkViewedWeekId = function () { return _lbWeekId || _currentWeekId(); };

/* ── Helpers ───────────────────────────────────────────────── */
function _escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _getInitials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/* ── DOMContentLoaded — wire up buttons ────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // "Back to your results" (only shown when opened from the summary)
  const backBtn = document.getElementById('leaderboard-back-btn');
  if (backBtn) backBtn.addEventListener('click', () => hideLeaderboardScreen());

  // Week navigation
  const prevBtn = document.getElementById('leaderboard-prev-week');
  const nextBtn = document.getElementById('leaderboard-next-week');
  const go = (delta) => {
    const target = _shiftWeek(_lbWeekId || _currentWeekId(), delta);
    if (delta > 0 && target > _currentWeekId()) return;
    _lbWeekId = target;
    _lbSyncChrome();
    renderLeaderboard(target, _currentRuleSet());
    if (typeof renderWeeklyCard === 'function') renderWeeklyCard();
  };
  if (prevBtn) prevBtn.addEventListener('click', () => go(-1));
  if (nextBtn) nextBtn.addEventListener('click', () => go(1));

  // The one division control lives in the action row: weekly.js sets the
  // ruleset, then announces it here so the board re-filters.
  document.addEventListener('weeklyRuleSetChanged', (e) => {
    if (_lbIsOpen()) renderLeaderboard(_lbWeekId || _currentWeekId(), e.detail);
  });

  // Re-mark "you" when auth state settles
  document.addEventListener('authStateChanged', () => {
    if (_lbIsOpen() && _lbLastDocs) renderLeaderboardRows(_lbLastDocs);
  });

  // Expose globally
  window.showLeaderboardScreen = showLeaderboardScreen;
  window.hideLeaderboardScreen = hideLeaderboardScreen;
});
