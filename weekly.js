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

function seededShuffle(array, seed) {
  const arr = [...array];
  let s = seed;
  function rand() {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  }
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ------------------------------------------------------------------
//  WEEKLY CARCASS DECK
// ------------------------------------------------------------------

// Cache keyed by weekId — ensures the card count and actual session
// always use the exact same deck regardless of async timing.
let _weeklyDeckCache = null; // { weekId: string, deck: array }

async function getWeeklyCarcasses(ruleSet) {
  const weekId = getWeekId();

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

  // Seeded fallback — DEFAULT_CARCASSES only (no community set).
  // Community set loads async so its size varies across calls; excluding it
  // keeps the fallback count consistent. Not cached so the next call still
  // retries Firestore in case the override was just saved by the admin.
  const seed = parseInt(weekId.replace(/\D/g, ''), 10);
  const deck = seededShuffle([...DEFAULT_CARCASSES], seed);
  window._weeklyCarcasses = deck;
  return deck;
}

// ------------------------------------------------------------------
//  WEEKLY RULE SET STATE (independent from free drill)
// ------------------------------------------------------------------

let _weeklyRuleSet = 'ffa';

// ------------------------------------------------------------------
//  FIRESTORE HELPERS
// ------------------------------------------------------------------

function getWeeklySubmissionId(uid, ruleSet) {
  return uid + '_' + getWeekId() + '_' + (ruleSet || _weeklyRuleSet);
}

async function checkUserSubmission(uid, ruleSet) {
  if (!window._db) return null;
  try {
    const docId = getWeeklySubmissionId(uid, ruleSet || _weeklyRuleSet);
    const snap = await window._db.collection(DB_COLLECTIONS.submissions).doc(docId).get();
    return snap.exists ? snap.data() : null;
  } catch (e) {
    console.error('checkUserSubmission error:', e);
    return null;
  }
}

async function submitWeeklyScore(scoreData) {
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

async function renderWeeklyCard() {
  const card = document.getElementById('weekly-challenge-card');
  if (!card) return;

  const bounds = getWeekBounds();
  const weekLabel = document.getElementById('weekly-week-label');
  if (weekLabel) {
    weekLabel.textContent = 'Week of ' + _formatWeekDates(bounds.start, bounds.end);
  }

  const ruleSet = _weeklyRuleSet;
  const carcasses = await getWeeklyCarcasses(ruleSet);
  const ruleLabel = ruleSet === 'ffa' ? 'FFA Rules' : 'Collegiate Rules';

  const metaEl = document.getElementById('weekly-card-meta');
  if (metaEl) {
    metaEl.textContent = carcasses.length + ' carcasses \u00b7 ' + ruleLabel;
  }

  const statusEl  = document.getElementById('weekly-user-status');
  const actionsEl = document.getElementById('weekly-card-actions');
  if (!statusEl || !actionsEl) return;

  const user = window._currentUser || null;

  if (!user) {
    // Not signed in
    statusEl.innerHTML = '';
    actionsEl.innerHTML = `
      <button id="weekly-signin-btn" class="btn-weekly-primary">
        Sign In to Compete
      </button>`;
    const signinBtn = document.getElementById('weekly-signin-btn');
    if (signinBtn) {
      signinBtn.addEventListener('click', () => {
        if (typeof window.openAuthModal === 'function') {
          window.openAuthModal();
        } else {
          // Fallback: show modal element directly
          const m = document.getElementById('auth-modal');
          if (m) { m.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
        }
      });
    }
    return;
  }

  // Signed in — check submission
  const submission = await checkUserSubmission(user.uid, _weeklyRuleSet);

  if (submission) {
    // Already submitted
    const pctVal = typeof submission.pct === 'number' ? submission.pct : 0;
    const earnedVal = typeof submission.earned === 'number' ? submission.earned : 0;
    const maxVal = typeof submission.max === 'number' ? submission.max : 0;

    statusEl.innerHTML = `
      <div class="weekly-score-display">${pctVal}%</div>
      <div class="weekly-score-label">Your Score</div>
      <div class="weekly-rank">${earnedVal} / ${maxVal} pts &mdash; Submitted</div>`;

    actionsEl.innerHTML = `
      <button id="weekly-leaderboard-btn" class="btn-weekly-primary">
        View Leaderboard &rarr;
      </button>`;

    const lbBtn = document.getElementById('weekly-leaderboard-btn');
    if (lbBtn) {
      lbBtn.addEventListener('click', () => {
        if (typeof showLeaderboardScreen === 'function') showLeaderboardScreen(getWeekId(), _weeklyRuleSet);
      });
    }
  } else {
    // Not yet submitted
    const displayName = user.displayName ? user.displayName.split(' ')[0] : 'Competitor';
    statusEl.innerHTML = `
      <div class="weekly-rank">Signed in as <strong>${_escapeHtml(displayName)}</strong> &mdash; score not yet submitted</div>`;

    actionsEl.innerHTML = `
      <button id="weekly-start-btn" class="btn-weekly-primary">
        Start Weekly Challenge &rarr;
      </button>`;

    const startBtn = document.getElementById('weekly-start-btn');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        startWeeklyChallenge();
      });
    }
  }
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
  // Sync state.ruleSet to match the weekly challenge selection so grade buttons are correct
  if (typeof state !== 'undefined') state.ruleSet = _weeklyRuleSet;
  const deck = await getWeeklyCarcasses(_weeklyRuleSet);
  if (!deck || deck.length === 0) {
    alert('No carcasses available for this week\'s challenge.');
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
    btn.textContent = 'View Leaderboard →';
    btn.classList.add('weekly-submit-success');
    btn.disabled = false;
    btn.onclick = () => {
      window._isWeeklySession = false;
      if (typeof showLeaderboardScreen === 'function') showLeaderboardScreen(getWeekId(), _weeklyRuleSet);
    };
    // Swap restart button to View Leaderboard too
    const restartBtn = document.getElementById('restart-btn');
    if (restartBtn) {
      restartBtn.textContent = 'View Leaderboard';
      restartBtn.onclick = (e) => {
        e.stopImmediatePropagation();
        window._isWeeklySession = false;
        if (typeof showLeaderboardScreen === 'function') showLeaderboardScreen(getWeekId(), _weeklyRuleSet);
      };
    }
    renderWeeklyCard();
  } else {
    btn.disabled = false;
    btn.textContent = 'Already Submitted';
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
    // Replace "New Session" with "View Leaderboard" during weekly sessions
    if (restartBtn) {
      restartBtn.textContent = 'View Leaderboard';
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
    // Restore "New Session" button
    if (restartBtn) {
      restartBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg> New Session';
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
    const bounds = getWeekBounds();
    const now = Date.now();
    const remaining = bounds.end.getTime() - now;
    el.textContent = formatCountdown(remaining);
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
    ffaBtn.addEventListener('click', () => {
      _weeklyRuleSet = 'ffa';
      ffaBtn.classList.add('active');
      collBtn.classList.remove('active');
      renderWeeklyCard();
    });
    collBtn.addEventListener('click', () => {
      _weeklyRuleSet = 'collegiate';
      collBtn.classList.add('active');
      ffaBtn.classList.remove('active');
      renderWeeklyCard();
    });
  }

  // Render the weekly card on load
  renderWeeklyCard();

  // Firestore's WebSocket connection isn't open at DOMContentLoaded time,
  // so source:'server' throws on the first call and we fall through to the
  // seeded deck. Retry once after 1.5s — connection is always established
  // by then — so the admin override shows without needing user interaction.
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

  // Attach submit-to-leaderboard button (delegated — button may be re-rendered)
  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'weekly-submit-btn') {
      handleWeeklySubmit();
    }
  });
});
