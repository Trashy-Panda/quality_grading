// ============================================================
//  BEEF CARCASS GRADING DRILL — Weekly Challenge
//  weekly.js
// ============================================================

'use strict';

// ------------------------------------------------------------------
//  WEEK UTILITIES
// ------------------------------------------------------------------

function getWeekId() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return d.getUTCFullYear() + '-W' + String(weekNum).padStart(2, '0');
}

function getWeekBounds() {
  const now = new Date();
  // Find Monday of the current week (ISO: week starts Monday)
  const dayOfWeek = now.getUTCDay(); // 0 = Sun, 1 = Mon, ...
  const diffToMonday = (dayOfWeek === 0) ? -6 : 1 - dayOfWeek;

  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diffToMonday));
  monday.setUTCHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);

  return { start: monday, end: sunday };
}

// ------------------------------------------------------------------
//  WEEKLY CARCASS DECK
// ------------------------------------------------------------------

// Cache keyed by weekId — ensures the card count and actual session
// always use the exact same deck regardless of async timing.
let _weeklyDeckCache = null; // { weekId: string, deck: array }

// ------------------------------------------------------------------
//  DEV FIXTURES (localhost / 127.0.0.1 only, ?wktest=<state>)
//  Fakes the signed-in user and the submissions list so every state of
//  the weekly page can be exercised without signing in. Inert anywhere
//  else, and it never reads or writes Firestore.
// ------------------------------------------------------------------

const WK_FIXTURE = (function () {
  try {
    const h = location.hostname;
    if (h !== 'localhost' && h !== '127.0.0.1') return null;
    const s = new URLSearchParams(location.search).get('wktest');
    return ['notsetup', 'signedout', 'nottaken', 'submitted', 'past'].indexOf(s) >= 0 ? s : null;
  } catch (_) { return null; }
})();

if (WK_FIXTURE) {
  const fixtureUser = (WK_FIXTURE === 'nottaken' || WK_FIXTURE === 'submitted' || WK_FIXTURE === 'past')
    ? { uid: 'fixture-me', displayName: 'Gunny Test', photoURL: '', email: '' }
    : null;
  Object.defineProperty(window, '_currentUser', {
    configurable: true,
    get: function () { return fixtureUser; },
    set: function () { /* auth.js writes are ignored in fixture mode */ }
  });
}

// pts for ten carcasses that add up to exactly `target` (valid pts: 10, 9, 7, 4, 0)
function _wkFixtureAnswers(target, seed) {
  const pts = [];
  for (let i = 0; i < 10; i++) pts.push(10);
  let deficit = 100 - target;
  const steps = [[10, 0], [6, 4], [3, 7], [1, 9]];
  let cell = 0;
  while (deficit > 0 && cell < 10) {
    const s = steps.find(function (x) { return x[0] <= deficit; });
    pts[cell] = s[1];
    deficit -= s[0];
    cell++;
  }
  // deterministic shuffle so misses are not always first
  for (let i = pts.length - 1; i > 0; i--) {
    const j = (i * 7 + seed * 3) % (i + 1);
    const t = pts[i]; pts[i] = pts[j]; pts[j] = t;
  }
  return pts.map(function (p, i) {
    return { carcassId: 'fx-' + (i + 1), guess: p === 10 ? 'PR_HI' : 'CH_LO', correct: 'PR_HI', pts: p };
  });
}

function wkFixtureDocs(weekId, ruleSet) {
  if (WK_FIXTURE === 'notsetup') return [];
  const shift = ruleSet === 'collegiate' ? -3 : 0;
  const people = [
    ['Ana Whitfield', 96], ['Ben Ortega', 93], ['Cy Larsen', 90], ['Dee Harmon', 88],
    ['Eli Brandt', 85], ['Faith Okafor', 84], ['Gus Pruitt', 81], ['Hana Sato', 78],
    ['Ivo Marsh', 78], ['Jo Delgado', 76], ['Kit Nakamura', 74], ['Lena Voss', 71],
    ['<b>x</b>', 71], ['Bartholomew Maximilian Featherstonehaugh-Worthington III', 71],
    ['Mo Rivera', 66], ['Nia Banks', 66], ['Oz Kemper', 61], ['Pia Lindqvist', 58], ['Quinn Abara', 52]
  ];
  const rows = people.map(function (p, i) {
    return { name: p[0], pct: p[1] + shift, uid: 'fx-' + i, day: 2 + (i % 3) };
  });
  if (WK_FIXTURE === 'submitted' || WK_FIXTURE === 'past') {
    rows.push({ name: 'Gunny Test', pct: 84 + shift, uid: 'fixture-me', day: 3 });
  }
  rows.sort(function (a, b) { return b.pct - a.pct; });
  return rows.map(function (r, i) {
    const data = {
      userId: r.uid, displayName: r.name, photoURL: '', weekId: weekId, ruleSet: ruleSet,
      earned: r.pct, max: 100, pct: r.pct,
      answers: _wkFixtureAnswers(r.pct, i),
      submittedAt: new Date(Date.UTC(2026, 10, r.day, 15, 0, 0))
    };
    return { id: r.uid, data: function () { return data; } };
  });
}

// One-time read of a week+division, newest scores first by pct.
function wkFetchSubmissions(weekId, ruleSet) {
  if (WK_FIXTURE) return Promise.resolve(wkFixtureDocs(weekId, ruleSet));
  if (!window._db || typeof DB_COLLECTIONS === 'undefined' || !DB_COLLECTIONS.submissions) {
    return Promise.reject(new Error('unavailable'));
  }
  return wkSubmissionsQuery(weekId, ruleSet).get().then(function (snap) { return snap.docs; });
}

function wkSubmissionsQuery(weekId, ruleSet) {
  const name = (typeof DB_COLLECTIONS !== 'undefined' && DB_COLLECTIONS.submissions)
    ? DB_COLLECTIONS.submissions : 'submissions';
  return window._db.collection(name)
    .where('weekId', '==', weekId)
    .where('ruleSet', '==', ruleSet)
    .orderBy('pct', 'desc')
    .limit(100);
}

// ------------------------------------------------------------------
//  SHARED BOARD HELPERS (used by the weekly page and the setup panel)
// ------------------------------------------------------------------

function wkOrdinal(n) {
  const v = n % 100;
  const suffix = (v >= 11 && v <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return n + suffix;
}

function wkDivisionName(ruleSet) {
  return ruleSet === 'collegiate' ? 'college' : 'high school';
}

// Entries from Firestore docs (already ordered by pct desc). Ties share a rank.
function wkBuildEntries(docs) {
  return (docs || []).map(function (doc, index) {
    const d = doc.data();
    const pct = typeof d.pct === 'number' ? d.pct : null;
    let rank = index + 1;
    if (pct !== null) {
      for (let j = 0; j < index; j++) {
        if (docs[j].data().pct === pct) { rank = j + 1; break; }
      }
    }
    const earned = typeof d.earned === 'number' ? d.earned : (typeof d.score === 'number' ? d.score : null);
    const max = typeof d.max === 'number' ? d.max : (typeof d.total === 'number' ? d.total : null);
    let date = null;
    try {
      const raw = d.submittedAt;
      const dt = raw && typeof raw.toDate === 'function' ? raw.toDate() : (raw ? new Date(raw) : null);
      if (dt && !isNaN(dt.getTime())) date = dt;
    } catch (_) { date = null; }
    const answers = Array.isArray(d.answers)
      ? d.answers.filter(function (a) { return a && typeof a.pts === 'number'; }).map(function (a) { return a.pts; })
      : [];
    return {
      rank: rank, pct: pct, earned: earned, max: max, date: date,
      name: String(d.displayName || d.userName || 'Anonymous'),
      photoURL: d.photoURL, userId: d.userId,
      answers: answers.length ? answers : null
    };
  });
}

// Median pct of the field, or null below three graders (too thin to mean anything).
function wkMedian(entries) {
  const v = (entries || []).filter(function (e) { return e.pct !== null; })
    .map(function (e) { return e.pct; }).sort(function (a, b) { return a - b; });
  if (v.length < 3) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Everything the state machine needs, loaded once for a week + division.
async function wkLoadContext(weekId, ruleSet, entries) {
  const isCurrent = weekId === getWeekId();
  const user = window._currentUser || null;
  let deckCount = 0;
  let submission = null;
  if (isCurrent) deckCount = (await getWeeklyCarcasses(ruleSet)).length;
  if (user) submission = await checkUserSubmission(user.uid, ruleSet, weekId);
  const mine = (user && entries) ? entries.find(function (e) { return e.userId === user.uid; }) : null;
  return {
    weekId: weekId, ruleSet: ruleSet, isCurrent: isCurrent,
    closed: isCurrent && (getWeekBounds().end.getTime() - Date.now() <= 0),
    deckCount: deckCount, user: user, submission: submission,
    rank: mine ? mine.rank : null
  };
}

// The one state machine for the challenge, used by the weekly page and the setup panel.
//   past       viewing an earlier week: division only, no action
//   submitted  you have a score: status + "Review my card"
//   notset     the week has no deck: disabled button, honest sentence
//   closed     the week ended before you took it
//   signedout  needs an account to compete
//   nottaken   signed in, ready to start
function wkResolveState(ctx) {
  if (!ctx.isCurrent) return { key: 'past', status: '', primary: null, secondary: null };
  if (ctx.user && ctx.submission) {
    const pct = typeof ctx.submission.pct === 'number' ? Math.round(ctx.submission.pct) : null;
    let status = 'You submitted this week’s challenge.';
    if (pct !== null) {
      status = ctx.rank
        ? 'You placed ' + wkOrdinal(ctx.rank) + ' with ' + pct + '%.'
        : 'You scored ' + pct + '%.';
    }
    return { key: 'submitted', status: status, primary: null, secondary: { label: 'Review my card', action: 'review' } };
  }
  if (ctx.deckCount === 0) {
    return {
      key: 'notset', status: 'This week’s carcasses aren’t posted yet.',
      primary: { label: 'Start the challenge', action: 'start', disabled: true }, secondary: null
    };
  }
  if (ctx.closed) {
    return { key: 'closed', status: 'This week’s challenge has closed.', primary: null, secondary: null };
  }
  if (!ctx.user) {
    return {
      key: 'signedout', status: 'Sign in to take this week’s challenge.',
      primary: { label: 'Sign in to compete', action: 'signin' }, secondary: null
    };
  }
  return {
    key: 'nottaken', status: 'You haven’t taken this week’s challenge yet.',
    primary: { label: 'Start the challenge', action: 'start' }, secondary: null
  };
}

function wkOpenAuth() {
  if (typeof window.openAuthModal === 'function') {
    window.openAuthModal();
  } else {
    const m = document.getElementById('auth-modal');
    if (m) { m.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
  }
}

async function getWeeklyCarcasses(ruleSet) {
  const weekId = getWeekId();

  if (WK_FIXTURE) {
    const fx = WK_FIXTURE === 'notsetup' ? [] : Array.from({ length: 10 }, function (_, i) { return { id: 'fx-' + (i + 1) }; });
    window._weeklyCarcasses = fx;
    return fx;
  }

  // If we already confirmed an override this session, return it directly.
  // Only ever set when a real override comes back from Firestore — never for
  // the seeded fallback — so this can't lock in the wrong deck.
  if (_weeklyDeckCache && _weeklyDeckCache.weekId === weekId) {
    return _weeklyDeckCache.deck;
  }

  // Check Firestore for an admin override.
  // source:'server' waits for a real server response rather than resolving
  // instantly from the local IndexedDB cache (which may predate the override).
  // Falls back to local cache if the server is unreachable (offline users).
  if (window._db) {
    let doc = null;
    try {
      doc = await window._db.collection('weeks').doc(weekId).get({ source: 'server' });
    } catch (serverErr) {
      try {
        doc = await window._db.collection('weeks').doc(weekId).get({ source: 'cache' });
      } catch (_) { /* no cache either — seeded fallback below */ }
    }

    if (doc && doc.exists && Array.isArray(doc.data().carcassIds) && doc.data().carcassIds.length > 0) {
      const ids = doc.data().carcassIds;
      const adminExtras = Array.isArray(doc.data().adminCarcasses) ? doc.data().adminCarcasses : [];
      // Use state.communitySet if available; otherwise fetch from Firestore so
      // override decks that include community carcasses can resolve correctly.
      let communitySet = (typeof state !== 'undefined' && Array.isArray(state.communitySet) && state.communitySet.length > 0)
        ? state.communitySet
        : [];
      if (communitySet.length === 0 && window._db && typeof DB_COLLECTIONS !== 'undefined') {
        try {
          const cSnap = await window._db.collection(DB_COLLECTIONS.community_carcasses)
            .orderBy('submittedAt', 'desc').limit(100).get();
          communitySet = cSnap.docs
            .map(function(d) { return Object.assign({ id: d.id }, d.data()); })
            .filter(function(r) { return r.imageUrl && r.correct && r.correct.qualityGrade; });
          if (typeof state !== 'undefined') state.communitySet = communitySet;
        } catch (_) {}
      }
      const pool = [...DEFAULT_CARCASSES, ...communitySet, ...adminExtras];
      const overrideDeck = ids.map(id => pool.find(c => c.id === id)).filter(Boolean);
      if (overrideDeck.length > 0) {
        // Cache the confirmed override so card count and session always match
        _weeklyDeckCache = { weekId, deck: overrideDeck };
        window._weeklyCarcasses = overrideDeck;
        return overrideDeck;
      }
    }
  }

  // No admin-configured week — the challenge is unavailable. Placeholder
  // carcasses (DEFAULT_CARCASSES) are never served as a deck. Not cached so
  // the next call still retries Firestore in case the override was just saved.
  window._weeklyCarcasses = [];
  return [];
}

// ------------------------------------------------------------------
//  WEEKLY RULE SET STATE (independent from free drill)
// ------------------------------------------------------------------

let _weeklyRuleSet = 'ffa';

// Single division control for the weekly page. Sets the challenge ruleset,
// syncs the segmented buttons, refreshes the status strip and (unless silent)
// tells the leaderboard to re-filter.
function setWeeklyRuleSet(ruleSet, silent) {
  _weeklyRuleSet = ruleSet === 'collegiate' ? 'collegiate' : 'ffa';
  const ffaBtn = document.getElementById('weekly-rule-ffa');
  const collBtn = document.getElementById('weekly-rule-collegiate');
  if (ffaBtn && collBtn) {
    ffaBtn.classList.toggle('active', _weeklyRuleSet === 'ffa');
    collBtn.classList.toggle('active', _weeklyRuleSet === 'collegiate');
    ffaBtn.setAttribute('aria-pressed', String(_weeklyRuleSet === 'ffa'));
    collBtn.setAttribute('aria-pressed', String(_weeklyRuleSet === 'collegiate'));
  }
  renderWeeklyCard();
  if (!silent) {
    document.dispatchEvent(new CustomEvent('weeklyRuleSetChanged', { detail: _weeklyRuleSet }));
  }
}

// ------------------------------------------------------------------
//  FIRESTORE HELPERS
// ------------------------------------------------------------------

function getWeeklySubmissionId(uid, ruleSet, weekId) {
  return uid + '_' + (weekId || getWeekId()) + '_' + (ruleSet || _weeklyRuleSet);
}

async function checkUserSubmission(uid, ruleSet, weekId) {
  if (WK_FIXTURE) {
    if (WK_FIXTURE !== 'submitted' && WK_FIXTURE !== 'past') return null;
    const mine = wkFixtureDocs(weekId || getWeekId(), ruleSet || _weeklyRuleSet)
      .find(function (d) { return d.id === uid; });
    return mine ? mine.data() : null;
  }
  if (!window._db) return null;
  try {
    const docId = getWeeklySubmissionId(uid, ruleSet || _weeklyRuleSet, weekId);
    const snap = await window._db.collection(DB_COLLECTIONS.submissions).doc(docId).get();
    return snap.exists ? snap.data() : null;
  } catch (e) {
    console.error('checkUserSubmission error:', e);
    return null;
  }
}

async function submitWeeklyScore(scoreData) {
  if (WK_FIXTURE) return false; // fixtures never write
  if (!window._currentUser || !window._db) return false;

  // Client-side pre-validation (defense-in-depth — Firestore rules enforce the same checks server-side)
  if (typeof scoreData.earned !== 'number' || scoreData.earned < 0) return false;
  if (typeof scoreData.max !== 'number' || scoreData.max <= 0) return false;
  if (typeof scoreData.pct !== 'number' || scoreData.pct < 0 || scoreData.pct > 100) return false;
  const expectedPct = (scoreData.earned / scoreData.max) * 100;
  if (Math.abs(scoreData.pct - expectedPct) > 0.5) return false;

  const uid = window._currentUser.uid;
  const ruleSet = scoreData.ruleSet || _weeklyRuleSet;
  const docId = getWeeklySubmissionId(uid, ruleSet);

  const existing = await checkUserSubmission(uid, ruleSet);
  if (existing) return false; // already submitted

  // Compact per-carcass answer log — feeds admin analytics (most-missed carcasses).
  // Grade keys (PR_HI etc.) kept small; capped at 60 entries to bound doc size.
  const answers = Array.isArray(scoreData.answers)
    ? scoreData.answers.slice(0, 60).map(a => ({
        carcassId: String(a.carcassId || ''),
        guess: String(a.userKey || ''),
        correct: String(a.correctKey || ''),
        pts: typeof a.score === 'number' ? a.score : 0,
      }))
    : [];

  try {
    await window._db.collection(DB_COLLECTIONS.submissions).doc(docId).set({
      userId: uid,
      weekId: getWeekId(),
      displayName: window._currentUser.displayName || 'Anonymous',
      photoURL: window._currentUser.photoURL || '',
      ruleSet: ruleSet,
      earned: scoreData.earned,
      max: scoreData.max,
      pct: scoreData.pct,
      answers: answers,
      submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  } catch (e) {
    console.error('submitWeeklyScore error:', e);
    return false;
  }
}

// ------------------------------------------------------------------
//  DATE FORMATTING HELPERS
// ------------------------------------------------------------------

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function _formatWeekDates(start, end) {
  const startStr = MONTH_NAMES[start.getUTCMonth()] + ' ' + start.getUTCDate();
  const endStr   = MONTH_NAMES[end.getUTCMonth()]   + ' ' + end.getUTCDate();
  return startStr + ' \u2013 ' + endStr;
}

function formatCountdown(msRemaining) {
  if (msRemaining <= 0) return 'Challenge closed';

  const totalSec = Math.floor(msRemaining / 1000);
  const days  = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins  = Math.floor((totalSec % 3600) / 60);
  const secs  = totalSec % 60;

  const pad = n => String(n).padStart(2, '0');

  if (days > 0) {
    return days + 'd ' + pad(hours) + 'h ' + pad(mins) + 'm';
  }
  return pad(hours) + ':' + pad(mins) + ':' + pad(secs);
}

// ------------------------------------------------------------------
//  RENDER WEEKLY CARD
// ------------------------------------------------------------------

let _wkCardToken = 0;

function _wkViewedWeekId() {
  return (typeof window.wkViewedWeekId === 'function') ? window.wkViewedWeekId() : getWeekId();
}

// Challenge band on the weekly page: division control, one status sentence,
// and the state machine's buttons.
async function renderWeeklyCard() {
  const card = document.getElementById('weekly-challenge-card');
  if (!card) return;
  const statusEl  = document.getElementById('weekly-user-status');
  const actionsEl = document.getElementById('weekly-card-actions');
  if (!statusEl || !actionsEl) return;

  const token = ++_wkCardToken;
  const weekId = _wkViewedWeekId();
  const ruleSet = _weeklyRuleSet;
  const board = window._wkBoard;
  const entries = (board && board.weekId === weekId && board.ruleSet === ruleSet) ? board.entries : null;
  const userBefore = window._currentUser || null;

  let ctx;
  try {
    ctx = await wkLoadContext(weekId, ruleSet, entries);
  } catch (e) {
    if (token !== _wkCardToken) return;
    statusEl.textContent = 'This week’s status is unavailable right now.';
    actionsEl.textContent = '';
    return;
  }
  if (token !== _wkCardToken || (window._currentUser || null) !== userBefore) return;

  const state = wkResolveState(ctx);
  card.dataset.state = state.key;
  statusEl.textContent = state.status;
  statusEl.hidden = !state.status;
  actionsEl.textContent = '';

  const addButton = (spec, cls) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = spec.label;
    if (spec.disabled) b.disabled = true;
    b.addEventListener('click', () => {
      if (spec.action === 'start') startWeeklyChallenge();
      else if (spec.action === 'signin') wkOpenAuth();
      else if (spec.action === 'review') wkFocusYourResult();
    });
    actionsEl.appendChild(b);
  };
  if (state.primary) addButton(state.primary, 'wk-btn wk-btn--primary');
  if (state.secondary) addButton(state.secondary, 'wk-btn wk-btn--secondary');
  actionsEl.hidden = !state.primary && !state.secondary;

  if (typeof window.wkOnCardContext === 'function') window.wkOnCardContext(ctx);
}

function wkFocusYourResult() {
  const panel = document.getElementById('wk-you-panel');
  if (!panel || panel.hidden) return;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  panel.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  panel.focus({ preventScroll: true });
}

function _escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ------------------------------------------------------------------
//  START WEEKLY CHALLENGE
// ------------------------------------------------------------------

async function startWeeklyChallenge() {
  const user = window._currentUser || null;
  if (!user) {
    if (typeof window.openAuthModal === 'function') window.openAuthModal();
    else {
      const m = document.getElementById('auth-modal');
      if (m) { m.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
    }
    return;
  }
  window._isWeeklySession = true;
  // Always use collegiate (full grades) for the drill — toggle only routes the leaderboard
  if (typeof state !== 'undefined') state.ruleSet = 'collegiate';
  const deck = await getWeeklyCarcasses(_weeklyRuleSet);
  if (!deck || deck.length === 0) {
    alert('This week\'s challenge isn\'t set up yet. Check back soon.');
    window._isWeeklySession = false;
    return;
  }
  if (typeof startSession === 'function') {
    startSession(deck);
  }
}

// ------------------------------------------------------------------
//  SUBMIT BUTTON ON SUMMARY SCREEN
// ------------------------------------------------------------------

async function handleWeeklySubmit() {
  const btn = document.getElementById('weekly-submit-btn');
  if (!btn) return;

  const user = window._currentUser || null;
  if (!user) {
    if (typeof window.openAuthModal === 'function') window.openAuthModal();
    else {
      const m = document.getElementById('auth-modal');
      if (m) { m.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
    }
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Submitting\u2026';

  // Gather score from app state
  const earned = typeof sessionTotal === 'function' ? sessionTotal() : 0;
  const max    = (typeof state !== 'undefined' && state.answers) ? state.answers.length * 10 : 0;
  const pctVal = max === 0 ? 0 : Math.round((earned / max) * 100);
  const ruleSet = _weeklyRuleSet;

  const ok = await submitWeeklyScore({
    earned,
    max,
    pct: pctVal,
    answers: (typeof state !== 'undefined' && state.answers) ? state.answers : [],
    ruleSet,
  });

  if (ok) {
    btn.textContent = 'View leaderboard';
    btn.classList.add('weekly-submit-success');
    btn.disabled = false;
    btn.onclick = () => {
      window._isWeeklySession = false;
      if (typeof showLeaderboardScreen === 'function') showLeaderboardScreen(getWeekId(), _weeklyRuleSet);
    };
    // Swap restart button to View Leaderboard too
    const restartBtn = document.getElementById('restart-btn');
    if (restartBtn) {
      restartBtn.textContent = 'View leaderboard';
      restartBtn.onclick = (e) => {
        e.stopImmediatePropagation();
        window._isWeeklySession = false;
        if (typeof showLeaderboardScreen === 'function') showLeaderboardScreen(getWeekId(), _weeklyRuleSet);
      };
    }
    renderWeeklyCard();
  } else {
    btn.disabled = false;
    btn.textContent = 'Already submitted';
  }
}

// ------------------------------------------------------------------
//  SHOW / HIDE SUBMIT BUTTON ON SUMMARY
// ------------------------------------------------------------------

function updateWeeklySubmitBtn() {
  const btn = document.getElementById('weekly-submit-btn');
  const restartBtn = document.getElementById('restart-btn');
  if (!btn) return;

  const isWeekly = !!window._isWeeklySession;
  const user = window._currentUser || null;

  if (isWeekly && user) {
    btn.classList.remove('hidden');
    // Replace "New session" with "View leaderboard" during weekly sessions
    if (restartBtn) {
      restartBtn.textContent = 'View leaderboard';
      restartBtn.onclick = async (e) => {
        e.stopImmediatePropagation();
        // Auto-submit score before showing leaderboard (if not already submitted)
        const user = window._currentUser || null;
        if (user) {
          const already = await checkUserSubmission(user.uid, _weeklyRuleSet);
          if (!already) {
            restartBtn.disabled = true;
            restartBtn.textContent = 'Submitting\u2026';
            const earned = typeof sessionTotal === 'function' ? sessionTotal() : 0;
            const max    = (typeof state !== 'undefined' && state.answers) ? state.answers.length * 10 : 0;
            const pctVal = max === 0 ? 0 : Math.round((earned / max) * 100);
            await submitWeeklyScore({ earned, max, pct: pctVal, answers: (typeof state !== 'undefined' && state.answers) ? state.answers : [], ruleSet: _weeklyRuleSet });
          }
        }
        window._isWeeklySession = false;
        if (typeof showLeaderboardScreen === 'function') showLeaderboardScreen(getWeekId(), _weeklyRuleSet);
      };
    }
  } else {
    btn.classList.add('hidden');
    // Restore "New session" button
    if (restartBtn) {
      // .ic sizes the glyph in em and takes its stroke from --ic-sw; .wk-btn is
      // weight 600, so the stroke is 2. No attribute strokes to drift from the text.
      restartBtn.innerHTML = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg><span>New session</span>';
      restartBtn.onclick = null;
    }
  }
}

// ------------------------------------------------------------------
//  COUNTDOWN TIMER
// ------------------------------------------------------------------

let _weeklyCountdownInterval = null;

function startWeeklyCountdown() {
  const el = document.getElementById('weekly-countdown');
  if (!el) return;

  function tick() {
    // A past week shows "Final" instead of a countdown (leaderboard.js sets data-past)
    if (el.dataset.past === '1') return;
    el.textContent = formatCountdown(getWeekBounds().end.getTime() - Date.now());
  }

  tick(); // run immediately
  if (_weeklyCountdownInterval) clearInterval(_weeklyCountdownInterval);
  _weeklyCountdownInterval = setInterval(tick, 1000);
}

// ------------------------------------------------------------------
//  INITIALIZATION
// ------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  // Weekly rule set toggle
  const ffaBtn = document.getElementById('weekly-rule-ffa');
  const collBtn = document.getElementById('weekly-rule-collegiate');
  if (ffaBtn && collBtn) {
    ffaBtn.addEventListener('click', () => setWeeklyRuleSet('ffa'));
    collBtn.addEventListener('click', () => setWeeklyRuleSet('collegiate'));
  }

  // Render the weekly card on load
  renderWeeklyCard();

  // Firestore's WebSocket connection isn't open at DOMContentLoaded time,
  // so source:'server' throws on the first call and we fall through to the
  // seeded deck. Retry once after 1.5s so the admin override shows without
  // needing user interaction.
  setTimeout(function () {
    if (!_weeklyDeckCache) renderWeeklyCard();
  }, 1500);

  // Start the countdown timer
  startWeeklyCountdown();

  // Re-render card whenever auth state changes
  document.addEventListener('authStateChanged', () => {
    renderWeeklyCard();
    updateWeeklySubmitBtn();
  });

  // Watch for summary screen becoming visible to show/hide submit btn
  const summaryScreen = document.getElementById('summary-screen');
  if (summaryScreen) {
    const observer = new MutationObserver(() => {
      const visible = !summaryScreen.classList.contains('hidden');
      if (visible) updateWeeklySubmitBtn();
    });
    observer.observe(summaryScreen, { attributes: true, attributeFilter: ['class'] });
  }

  // Attach submit-to-leaderboard button (delegated, button may be re-rendered)
  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'weekly-submit-btn') {
      handleWeeklySubmit();
    }
  });
});

// ------------------------------------------------------------------
//  SETUP SCREEN WEEKLY PANEL (read-only summary on #home-screen)
//  Re-renders every time the screen becomes visible, when auth settles
//  and when the division changes, so it never shows a stale week.
// ------------------------------------------------------------------

let _setupWeeklyTimer = null;
let _setupToken = 0;

function _setupHomeVisible() {
  const home = document.getElementById('home-screen');
  return !!(home && !home.classList.contains('hidden'));
}

// Which panel the bottom sheet starts. The week is picked for the user once,
// when it is posted, unless they already chose.
let _setupPickedByUser = false;
let _setupAutoPicked = false;

function syncSetupDock() {
  const home = document.getElementById('home-screen');
  const t = document.getElementById('su-dock-title');
  const sub = document.getElementById('su-dock-sub');
  if (!home || !t || !sub) return;
  if (home.dataset.pick === 'weekly') {
    const g = (document.getElementById('setup-weekly-graders') || {}).textContent || '';
    const cd = (document.getElementById('setup-weekly-countdown') || {}).textContent || '';
    t.textContent = 'This week';
    sub.textContent = (/^[1-9]/.test(g))
      ? g + (g === '1' ? ' grader' : ' graders')
      : (cd.trim() ? 'Closes in ' + cd.trim() : '');
  } else {
    t.textContent = 'Practice';
    sub.textContent = ((document.getElementById('community-set-sub') || {}).textContent || '').trim();
  }
}

function setSetupPick(pick, auto) {
  const home = document.getElementById('home-screen');
  if (!home) return;
  if (auto) { if (_setupPickedByUser) return; } else { _setupPickedByUser = true; }
  home.dataset.pick = pick;
  document.querySelectorAll('#home-screen .su-pick').forEach((b) => {
    const on = b.dataset.pick === pick;
    b.setAttribute('aria-pressed', String(on));
    const panel = b.closest('.su-panel');
    if (panel) panel.classList.toggle('is-on', on);
  });
  syncSetupDock();
}

async function renderSetupWeekly() {
  const weekEl = document.getElementById('setup-weekly-week');
  const cdEl = document.getElementById('setup-weekly-countdown');
  const gradersEl = document.getElementById('setup-weekly-graders');
  const listEl = document.getElementById('setup-weekly-top3');
  const statusEl = document.getElementById('setup-weekly-status');
  const subEl = document.getElementById('setup-weekly-sub');
  if (!weekEl || !cdEl || !listEl) return;

  const token = ++_setupToken;
  const weekId = getWeekId();
  const ruleSet = _weeklyRuleSet;
  const userBefore = window._currentUser || null;

  weekEl.textContent = (typeof formatWeekRange === 'function')
    ? formatWeekRange(weekId).replace(/^Week of /, '')
    : _formatWeekDates(getWeekBounds().start, getWeekBounds().end).replace('–', 'to');
  cdEl.textContent = formatCountdown(getWeekBounds().end.getTime() - Date.now());
  if (subEl) subEl.textContent = 'Top 3 so far, ' + wkDivisionName(ruleSet);

  const setList = (text) => {
    listEl.textContent = '';
    const li = document.createElement('li');
    li.className = 'su-top3-empty';
    li.textContent = text;
    listEl.appendChild(li);
  };

  let docs;
  try {
    docs = await wkFetchSubmissions(weekId, ruleSet);
  } catch (e) {
    if (token !== _setupToken) return;
    if (gradersEl) gradersEl.textContent = '-';
    if (statusEl) statusEl.textContent = 'Weekly scores are unavailable right now.';
    setList('Top scores are unavailable right now.');
    return;
  }
  if (token !== _setupToken) return;

  const entries = wkBuildEntries(docs);
  if (gradersEl) gradersEl.textContent = String(entries.length) + (entries.length >= 100 ? '+' : '');
  syncSetupDock();

  if (entries.length === 0) {
    setList('No scores yet this week.');
  } else {
    listEl.textContent = '';
    entries.slice(0, 3).forEach((e) => {
      const li = document.createElement('li');
      li.className = 'su-top3-row';
      const rank = document.createElement('span');
      rank.className = 'su-top3-rank num';
      rank.textContent = String(e.rank);
      const name = document.createElement('span');
      name.className = 'su-top3-name';
      name.textContent = e.name;
      const pct = document.createElement('span');
      pct.className = 'su-top3-pct num';
      pct.textContent = e.pct !== null ? Math.round(e.pct) + '%' : '';
      li.append(rank, name, pct);
      listEl.appendChild(li);
    });
  }

  let ctx;
  try {
    ctx = await wkLoadContext(weekId, ruleSet, entries);
  } catch (e) {
    if (token !== _setupToken) return;
    if (statusEl) statusEl.textContent = 'This week’s status is unavailable right now.';
    return;
  }
  if (token !== _setupToken || (window._currentUser || null) !== userBefore) return;
  const state = wkResolveState(ctx);
  if (statusEl) statusEl.textContent = state.status;
  const panel = document.getElementById('setup-weekly');
  if (panel) panel.dataset.state = state.key;
  if (!_setupAutoPicked && (state.key === 'signedout' || state.key === 'nottaken' || state.key === 'submitted')) {
    _setupAutoPicked = true;
    setSetupPick('weekly', true);
  }
  syncSetupDock();
}

document.addEventListener('DOMContentLoaded', () => {
  const openBtn = document.getElementById('setup-weekly-open-btn');
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      if (typeof window.pageNavGo === 'function') window.pageNavGo('weekly');
      else if (typeof showLeaderboardScreen === 'function') showLeaderboardScreen();
    });
  }

  // Live countdown, only while the setup screen is showing
  _setupWeeklyTimer = setInterval(() => {
    if (!_setupHomeVisible()) return;
    const cdEl = document.getElementById('setup-weekly-countdown');
    if (cdEl) cdEl.textContent = formatCountdown(getWeekBounds().end.getTime() - Date.now());
    syncSetupDock();
  }, 1000);

  document.querySelectorAll('#home-screen .su-pick').forEach((b) => {
    b.addEventListener('click', () => setSetupPick(b.dataset.pick, false));
  });
  const setSubEl = document.getElementById('community-set-sub');
  if (setSubEl) new MutationObserver(syncSetupDock).observe(setSubEl, { childList: true, characterData: true, subtree: true });

  // Re-run whenever the screen becomes visible (hidden -> shown)
  const home = document.getElementById('home-screen');
  if (home) {
    let wasVisible = _setupHomeVisible();
    new MutationObserver(() => {
      const nowVisible = _setupHomeVisible();
      if (nowVisible && !wasVisible) renderSetupWeekly();
      wasVisible = nowVisible;
    }).observe(home, { attributes: true, attributeFilter: ['class'] });
  }

  document.addEventListener('authStateChanged', () => {
    if (_setupHomeVisible()) renderSetupWeekly();
  });
  document.addEventListener('weeklyRuleSetChanged', () => {
    if (_setupHomeVisible()) renderSetupWeekly();
  });

  if (_setupHomeVisible()) renderSetupWeekly();
  // First paint of the home screen may happen before Firestore is open
  setTimeout(() => {
    if (_setupHomeVisible()) renderSetupWeekly();
  }, 1500);
});
