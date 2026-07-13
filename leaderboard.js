/* ============================================================
   LEADERBOARD — leaderboard.js
   Depends on: app.js (state), auth.js (window._db, window._currentUser),
               weekly.js (getWeekId, DB_COLLECTIONS)
   ============================================================ */

'use strict';

// ── Firestore listener cleanup handle ──────────────────────────
window._leaderboardUnsubscribe = null;

// ── Active tab state ───────────────────────────────────────────
let _activeRuleSet = 'ffa';

/* ── formatWeekRange ──────────────────────────────────────────
   Parses "2026-W12" → "Mar 16 – Mar 22, 2026"
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

  return `Week of ${fmtDate(wMon)} – ${fmtDate(wSun)}, ${wSun.getUTCFullYear()}`;
}

/* ── _setActiveTab ─────────────────────────────────────────── */
function _setActiveTab(ruleSet) {
  const ffaBtn  = document.getElementById('leaderboard-tab-ffa');
  const colBtn  = document.getElementById('leaderboard-tab-collegiate');
  if (!ffaBtn || !colBtn) return;
  ffaBtn.classList.toggle('active', ruleSet === 'ffa');
  colBtn.classList.toggle('active', ruleSet === 'collegiate');
}

let _leaderboardReturnScreen = 'home'; // 'home' or 'summary'

/* ── showLeaderboardScreen ─────────────────────────────────── */
function showLeaderboardScreen(weekId, ruleSet) {
  weekId  = weekId  || (typeof getWeekId  === 'function' ? getWeekId()       : '');
  ruleSet = ruleSet || (typeof state      !== 'undefined' ? state.ruleSet     : 'ffa') || 'ffa';

  // Remember where to go back to
  const summaryVisible = document.getElementById('summary-screen') &&
    !document.getElementById('summary-screen').classList.contains('hidden');
  _leaderboardReturnScreen = summaryVisible ? 'summary' : 'home';

  // Hide every known screen
  document.querySelectorAll('main.screen').forEach(s => s.classList.add('hidden'));
  // drill-screen doesn't use .screen class
  const drillScreen = document.getElementById('drill-screen');
  if (drillScreen) drillScreen.classList.add('hidden');
  // Hide the app header if visible
  const appHeader = document.getElementById('app-header');
  if (appHeader) appHeader.classList.add('hidden');
  // Also hide landing hero if present
  const landing = document.getElementById('landing-hero');
  if (landing) landing.classList.add('hidden');

  // Show leaderboard screen
  const lbScreen = document.getElementById('leaderboard-screen');
  if (lbScreen) lbScreen.classList.remove('hidden');

  // Update week label
  const weekLabel = document.getElementById('leaderboard-week-label');
  if (weekLabel) weekLabel.textContent = formatWeekRange(weekId);

  // Set active tab
  _activeRuleSet = ruleSet;
  _setActiveTab(ruleSet);

  // Load data
  renderLeaderboard(weekId, ruleSet);
}

/* ── hideLeaderboardScreen ─────────────────────────────────── */
function hideLeaderboardScreen() {
  // Hide leaderboard
  const lbScreen = document.getElementById('leaderboard-screen');
  if (lbScreen) lbScreen.classList.add('hidden');

  // Unsubscribe Firestore listener
  if (typeof window._leaderboardUnsubscribe === 'function') {
    window._leaderboardUnsubscribe();
    window._leaderboardUnsubscribe = null;
  }

  // Return to where we came from
  if (_leaderboardReturnScreen === 'summary') {
    const summaryScreen = document.getElementById('summary-screen');
    if (summaryScreen) summaryScreen.classList.remove('hidden');
    const appHeader = document.getElementById('app-header');
    if (appHeader) appHeader.classList.remove('hidden');
    // Re-evaluate submit button (preserves visibility if not yet submitted)
    if (typeof updateWeeklySubmitBtn === 'function') updateWeeklySubmitBtn();
  } else {
    const homeScreen = document.getElementById('home-screen');
    if (homeScreen) homeScreen.classList.remove('hidden');
  }
}

/* ── renderLeaderboard ─────────────────────────────────────── */
function renderLeaderboard(weekId, ruleSet) {
  // Unsubscribe any previous listener
  if (typeof window._leaderboardUnsubscribe === 'function') {
    window._leaderboardUnsubscribe();
    window._leaderboardUnsubscribe = null;
  }

  const tbody = document.getElementById('leaderboard-tbody');
  if (!tbody) return;

  // Show skeleton loading state
  tbody.innerHTML = _buildSkeletonRows(5);

  // Guard: no Firestore
  if (!window._db) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5">
          <div class="leaderboard-signin">
            <strong>Sign in to view the leaderboard</strong>
            Create an account to submit your scores and compete weekly.
          </div>
        </td>
      </tr>`;
    return;
  }

  // Determine the collection name
  const collectionName = (typeof DB_COLLECTIONS !== 'undefined' && DB_COLLECTIONS.submissions)
    ? DB_COLLECTIONS.submissions
    : 'submissions';

  // Subscribe to live updates
  const unsubscribe = window._db
    .collection(collectionName)
    .where('weekId',  '==', weekId)
    .where('ruleSet', '==', ruleSet)
    .orderBy('pct', 'desc')
    .limit(20)
    .onSnapshot(
      (snapshot) => {
        renderLeaderboardRows(snapshot.docs);
      },
      (err) => {
        console.error('[leaderboard] Firestore error:', err);
        if (tbody) {
          tbody.innerHTML = `
            <tr>
              <td colspan="5">
                <div class="leaderboard-empty">
                  <strong>Could not load leaderboard</strong>
                  ${_escapeHtml(err.message || 'An error occurred. Please try again.')}
                </div>
              </td>
            </tr>`;
        }
      }
    );

  window._leaderboardUnsubscribe = unsubscribe;
}

/* ── renderLeaderboardRows ─────────────────────────────────── */
function renderLeaderboardRows(docs) {
  const tbody = document.getElementById('leaderboard-tbody');
  if (!tbody) return;

  if (!docs || docs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5">
          <div class="leaderboard-empty">
            <strong>No submissions yet this week</strong>
            Complete a drill session to appear on the leaderboard.
          </div>
        </td>
      </tr>`;
    return;
  }

  const currentUid = window._currentUser ? window._currentUser.uid : null;

  const rows = docs.map((doc, index) => {
    const d    = doc.data();
    const rank = index + 1;

    // Rank badge
    let rankCell;
    if (rank === 1) {
      rankCell = `<span class="rank-badge rank-1st">1ST</span>`;
    } else if (rank === 2) {
      rankCell = `<span class="rank-badge rank-2nd">2ND</span>`;
    } else if (rank === 3) {
      rankCell = `<span class="rank-badge rank-3rd">3RD</span>`;
    } else {
      rankCell = `<span style="color:var(--text-muted);font-size:0.82rem;font-weight:700;">${rank}</span>`;
    }

    // Avatar
    const avatarSrc  = d.photoURL || '';
    const displayName = _escapeHtml(d.displayName || d.userName || 'Anonymous');
    let avatarHtml   = '';
    if (avatarSrc) {
      const avatarImg = document.createElement('img');
      avatarImg.className = 'leaderboard-avatar';
      avatarImg.src = _escapeAttr(avatarSrc);
      avatarImg.alt = '';
      avatarImg.loading = 'lazy';
      avatarImg.onerror = function() { this.style.display = 'none'; };
      avatarHtml = avatarImg.outerHTML;
    } else {
      // Initials fallback rendered as inline SVG circle
      const initials = _getInitials(displayName);
      avatarHtml = `<svg class="leaderboard-avatar" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" style="background:var(--bg-alt);border-radius:50%;">
        <circle cx="14" cy="14" r="14" fill="var(--bg-alt)" />
        <text x="14" y="18" text-anchor="middle" font-size="11" font-weight="700" font-family="Helvetica Neue,Arial,sans-serif" fill="var(--text-muted)">${initials}</text>
      </svg>`;
    }

    // Score: "earned / max pts"
    const earned = typeof d.earned !== 'undefined' ? d.earned : (typeof d.score !== 'undefined' ? d.score : '—');
    const max    = typeof d.max    !== 'undefined' ? d.max    : (typeof d.total !== 'undefined' ? d.total : '—');
    const scoreCell = (earned !== '—' && max !== '—') ? `${earned} / ${max} pts` : '—';

    // Pct
    const pct = typeof d.pct !== 'undefined' ? `${Math.round(d.pct)}%` : '—';

    // Date
    let dateStr = '—';
    try {
      const raw = d.submittedAt;
      let dateObj;
      if (raw && typeof raw.toDate === 'function') {
        dateObj = raw.toDate();
      } else if (raw) {
        dateObj = new Date(raw);
      } else {
        dateObj = new Date();
      }
      if (!isNaN(dateObj.getTime())) {
        dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
    } catch (_) {
      dateStr = '—';
    }

    // Row class
    const isMe   = currentUid && d.userId === currentUid;
    const rowCls = isMe ? ' class="leaderboard-row-me"' : '';

    return `<tr${rowCls}>
      <td class="col-rank">${rankCell}</td>
      <td class="col-name">
        <div class="leaderboard-name-cell">
          ${avatarHtml}
          <span>${displayName}${isMe ? ' <span style="font-size:0.68rem;color:var(--primary);font-weight:800;letter-spacing:0.06em;">(you)</span>' : ''}</span>
        </div>
      </td>
      <td class="col-score">${scoreCell}</td>
      <td class="col-pct">${pct}</td>
      <td class="col-date">${dateStr}</td>
    </tr>`;
  });

  tbody.innerHTML = rows.join('');
}

/* ── _buildSkeletonRows ────────────────────────────────────── */
function _buildSkeletonRows(count) {
  const widths = [
    ['30%', '70%', '55%', '40%', '45%'],
    ['25%', '60%', '60%', '40%', '50%'],
    ['20%', '75%', '50%', '40%', '40%'],
    ['30%', '65%', '55%', '40%', '45%'],
    ['25%', '55%', '60%', '40%', '50%'],
  ];
  let html = '';
  for (let i = 0; i < count; i++) {
    const w = widths[i % widths.length];
    html += `<tr class="leaderboard-skeleton">
      <td><span style="width:${w[0]};"></span></td>
      <td><span style="width:${w[1]};"></span></td>
      <td><span style="width:${w[2]};"></span></td>
      <td><span style="width:${w[3]};"></span></td>
      <td><span style="width:${w[4]};"></span></td>
    </tr>`;
  }
  return html;
}

/* ── Helpers ───────────────────────────────────────────────── */
function _escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _escapeAttr(str) {
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
  // Back button
  const backBtn = document.getElementById('leaderboard-back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', hideLeaderboardScreen);
  }

  // FFA tab
  const ffaTab = document.getElementById('leaderboard-tab-ffa');
  if (ffaTab) {
    ffaTab.addEventListener('click', () => {
      _activeRuleSet = 'ffa';
      _setActiveTab('ffa');
      const weekId = (typeof getWeekId === 'function') ? getWeekId() : '';
      renderLeaderboard(weekId, 'ffa');
    });
  }

  // Collegiate tab
  const colTab = document.getElementById('leaderboard-tab-collegiate');
  if (colTab) {
    colTab.addEventListener('click', () => {
      _activeRuleSet = 'collegiate';
      _setActiveTab('collegiate');
      const weekId = (typeof getWeekId === 'function') ? getWeekId() : '';
      renderLeaderboard(weekId, 'collegiate');
    });
  }

  // Expose globally
  window.showLeaderboardScreen = showLeaderboardScreen;
  window.hideLeaderboardScreen = hideLeaderboardScreen;
});
