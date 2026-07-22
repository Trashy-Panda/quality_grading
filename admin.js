// ============================================================
//  Beef Carcass Grading Drill — Admin Panel
//  admin.js
//
//  Requires (loaded before this file):
//    - Firebase compat SDK (app, auth, firestore)
//    - data.js  (FIREBASE_CONFIG, DB_COLLECTIONS, DEFAULT_CARCASSES,
//                QUALITY_GRADES, GRADE_MAP)
// ============================================================

const ADMIN_UID = 'KLoBqbA2P9UkQ83urzmgpxT4Oit1';

// ============================================================
//  Week ID Utilities (copied from weekly.js — not loaded here)
// ============================================================

function getWeekId(offsetWeeks) {
  offsetWeeks = offsetWeeks || 0;
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + offsetWeeks * 7);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return d.getUTCFullYear() + '-W' + String(weekNum).padStart(2, '0');
}

function formatWeekLabel(weekId) {
  if (typeof weekId !== 'string') return weekId;
  const m = weekId.match(/^(\d{4})-W(\d{2})$/);
  if (!m) return weekId;
  const year = parseInt(m[1]), week = parseInt(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = (jan4.getUTCDay() + 6) % 7;
  const w1Mon = new Date(jan4);
  w1Mon.setUTCDate(jan4.getUTCDate() - jan4Dow);
  const mon = new Date(w1Mon);
  mon.setUTCDate(w1Mon.getUTCDate() + (week - 1) * 7);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${fmt(mon)} \u2013 ${fmt(sun)}, ${year}`;
}

// ============================================================
//  State
// ============================================================

let _db, _auth, _currentUser;
let _currentTab = 'leaderboard';
let _lbWeekId = getWeekId();
let _lbRuleSet = 'ffa';
let _wcWeekId = getWeekId();
let _selectedCarcassIds = new Set();
let _wcAllCarcasses = [];

// ============================================================
//  Initialization
// ============================================================

document.addEventListener('DOMContentLoaded', function () {
  // 1. Initialize Firebase
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
  } catch (e) {
    firebase.app();
  }

  _db = firebase.firestore();
  _auth = firebase.auth();
  // powerrank.js (documented dependency: auth.js's window._db) expects a
  // global — admin.html doesn't load auth.js, so expose the same instance
  // under that name here instead of duplicating Firebase init.
  window._db = _db;

  // 4. Auth state listener
  _auth.onAuthStateChanged(onAuthStateChanged);

  // 5. Tab buttons
  const tabLeaderboard = document.getElementById('tab-btn-leaderboard');
  const tabWeekly = document.getElementById('tab-btn-weekly');
  const tabUsers = document.getElementById('tab-btn-users');
  if (tabLeaderboard) tabLeaderboard.addEventListener('click', function () { switchTab('leaderboard'); });
  if (tabWeekly) tabWeekly.addEventListener('click', function () { switchTab('weekly'); });
  if (tabUsers) tabUsers.addEventListener('click', function () { switchTab('users'); });
  const tabCommunity = document.getElementById('tab-btn-community');
  if (tabCommunity) tabCommunity.addEventListener('click', function () { switchTab('community'); });
  const tabGradingVotes = document.getElementById('tab-btn-grading-votes');
  if (tabGradingVotes) tabGradingVotes.addEventListener('click', function () { switchTab('grading-votes'); });
  const tabAnalytics = document.getElementById('tab-btn-analytics');
  if (tabAnalytics) tabAnalytics.addEventListener('click', function () { switchTab('analytics'); });
  const tabPowerrank = document.getElementById('tab-btn-powerrank');
  if (tabPowerrank) tabPowerrank.addEventListener('click', function () { switchTab('powerrank'); });
  const tabPowerrankPreview = document.getElementById('tab-btn-powerrank-preview');
  if (tabPowerrankPreview) tabPowerrankPreview.addEventListener('click', function () { switchTab('powerrank-preview'); });
  const anRefreshBtn = document.getElementById('an-refresh-btn');
  if (anRefreshBtn) anRefreshBtn.addEventListener('click', function () { loadAnalyticsTab(); });

  // 6. Sign-in / sign-out
  const signinBtn = document.getElementById('admin-signin-btn');
  const signoutBtn = document.getElementById('admin-signout-btn');
  function doSignIn() {
    var provider = new firebase.auth.GoogleAuthProvider();
    _auth.signInWithPopup(provider).catch(function(e) {
      if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
        console.error('[admin] Sign-in error:', e.code, e.message);
        alert('Sign-in failed: ' + e.message);
      }
    });
  }
  if (signinBtn) signinBtn.addEventListener('click', doSignIn);
  const gateBtn = document.getElementById('admin-signin-gate-btn');
  if (gateBtn) gateBtn.addEventListener('click', doSignIn);
  if (signoutBtn) {
    signoutBtn.addEventListener('click', function () {
      _auth.signOut();
    });
  }

  // 8. Leaderboard refresh
  const lbRefreshBtn = document.getElementById('lb-refresh-btn');
  if (lbRefreshBtn) lbRefreshBtn.addEventListener('click', loadLeaderboard);

  const lbClearAllBtn = document.getElementById('lb-clear-all-btn');
  if (lbClearAllBtn) lbClearAllBtn.addEventListener('click', clearAllSubmissions);

  // 9. Leaderboard week select
  const lbWeekSelect = document.getElementById('lb-week-select');
  if (lbWeekSelect) {
    lbWeekSelect.addEventListener('change', function () {
      _lbWeekId = this.value;
      loadLeaderboard();
    });
  }

  // 10. Leaderboard ruleset select
  const lbRulesetSelect = document.getElementById('lb-ruleset-select');
  if (lbRulesetSelect) {
    lbRulesetSelect.addEventListener('change', function () {
      _lbRuleSet = this.value;
      loadLeaderboard();
    });
  }

  // 11. Weekly challenge week select
  const wcWeekSelect = document.getElementById('wc-week-select');
  if (wcWeekSelect) {
    wcWeekSelect.addEventListener('change', function () {
      _wcWeekId = this.value;
      loadWeeklyTab();
    });
  }

  // 12. Save override
  const wcSaveBtn = document.getElementById('wc-save-btn');
  if (wcSaveBtn) wcSaveBtn.addEventListener('click', saveWeekOverride);

  // 13. Reset week override
  const wcResetBtn = document.getElementById('wc-reset-btn');
  if (wcResetBtn) wcResetBtn.addEventListener('click', resetWeekOverride);

  // Add image by URL
  const wcAddUrlBtn = document.getElementById('wc-add-url-btn');
  if (wcAddUrlBtn) wcAddUrlBtn.addEventListener('click', addCarcassByUrl);

  // 16. Users refresh
  const usersRefreshBtn = document.getElementById('users-refresh-btn');
  if (usersRefreshBtn) usersRefreshBtn.addEventListener('click', loadUsers);

  // 17. Populate week selects
  populateWeekSelects();


  // 19. Community tab refresh
  var communityRefreshBtn = document.getElementById('community-refresh-btn');
  if (communityRefreshBtn) communityRefreshBtn.addEventListener('click', loadCommunityTab);

  // 20. Community add-new form
  var communityAddBtn = document.getElementById('community-add-btn');
  if (communityAddBtn) communityAddBtn.addEventListener('click', addCommunityRecord);

  // 22. Grading Votes refresh
  var gvRefreshBtn = document.getElementById('gv-refresh-btn');
  if (gvRefreshBtn) gvRefreshBtn.addEventListener('click', loadGradingVotesTab);

  // 21. Community JSON import
  var communityImportBtn = document.getElementById('community-import-btn');
  if (communityImportBtn) communityImportBtn.addEventListener('click', importCommunityJson);
  var communityImportClearBtn = document.getElementById('community-import-clear-btn');
  if (communityImportClearBtn) communityImportClearBtn.addEventListener('click', function() {
    var ta = document.getElementById('community-import-json');
    if (ta) ta.value = '';
    var st = document.getElementById('community-import-status');
    if (st) st.textContent = '';
  });

  // 23. Power Rankings tab
  var prRefreshBtn = document.getElementById('pr-refresh-btn');
  if (prRefreshBtn) prRefreshBtn.addEventListener('click', loadPowerrankTab);

  var prImportPreviewBtn = document.getElementById('pr-import-preview-btn');
  if (prImportPreviewBtn) prImportPreviewBtn.addEventListener('click', prPreviewImport);

  var prImportClearBtn = document.getElementById('pr-import-clear-btn');
  if (prImportClearBtn) prImportClearBtn.addEventListener('click', prClearImport);

  var prAddRowBtn = document.getElementById('pr-add-row-btn');
  if (prAddRowBtn) prAddRowBtn.addEventListener('click', function () {
    var rows = document.getElementById('pr-team-rows');
    if (rows) rows.appendChild(prBuildTeamRow(null));
  });

  var prSaveBtn = document.getElementById('pr-form-save-btn');
  if (prSaveBtn) prSaveBtn.addEventListener('click', prSaveManual);

  var prCancelEditBtn = document.getElementById('pr-edit-cancel-btn');
  if (prCancelEditBtn) prCancelEditBtn.addEventListener('click', function () {
    if (!confirm('Discard the contest currently loaded in the form?')) return;
    prResetForm();
  });

  var prDateInput = document.getElementById('pr-form-date');
  if (prDateInput) prDateInput.addEventListener('change', function () {
    var seasonInput = document.getElementById('pr-form-season');
    if (!seasonInput) return;
    var year = (this.value || '').slice(0, 4);
    if (/^\d{4}$/.test(year) && (!seasonInput.value || seasonInput.value === seasonInput.dataset.auto)) {
      seasonInput.value = year;
      seasonInput.dataset.auto = year;
    }
    prUpdateSlugPreview();
  });

  ['pr-form-shortname', 'pr-form-division'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', prUpdateSlugPreview);
    if (el) el.addEventListener('change', prUpdateSlugPreview);
  });

  // Start the manual form with one empty team row
  var prRows = document.getElementById('pr-team-rows');
  if (prRows) prRows.appendChild(prBuildTeamRow(null));
});

// ============================================================
//  Auth State
// ============================================================

function onAuthStateChanged(user) {
  _currentUser = user;
  const headerUser = document.getElementById('admin-header-user');
  const signinBtn = document.getElementById('admin-signin-btn');
  const signoutBtn = document.getElementById('admin-signout-btn');
  const accessDenied = document.getElementById('access-denied');
  const adminTabs = document.getElementById('admin-tabs');
  const adminUi = document.getElementById('admin-ui');
  const gate = document.getElementById('admin-signin-gate');

  if (!user) {
    signinBtn && signinBtn.classList.remove('hidden');
    signoutBtn && signoutBtn.classList.add('hidden');
    if (headerUser) headerUser.textContent = '';
    if (accessDenied) accessDenied.classList.add('hidden');
    if (adminTabs) adminTabs.classList.add('hidden');
    if (adminUi) adminUi.classList.add('hidden');
    if (gate) gate.classList.remove('hidden');
    return;
  }

  console.log('[admin] Your UID:', user.uid);
  if (gate) gate.classList.add('hidden');
  signinBtn && signinBtn.classList.add('hidden');
  signoutBtn && signoutBtn.classList.remove('hidden');
  if (headerUser) headerUser.textContent = user.displayName || user.email;

  if (user.uid !== ADMIN_UID) {
    if (accessDenied) accessDenied.classList.remove('hidden');
    if (adminTabs) adminTabs.classList.add('hidden');
    if (adminUi) adminUi.classList.add('hidden');
    return;
  }

  if (accessDenied) accessDenied.classList.add('hidden');
  if (adminTabs) adminTabs.classList.remove('hidden');
  if (adminUi) adminUi.classList.remove('hidden');
  switchTab('leaderboard');
}

// ============================================================
//  Tab Management
// ============================================================

var _tabLoaded = {};

function switchTab(name) {
  _currentTab = name;

  // Update tab button active states
  ['leaderboard', 'weekly', 'users', 'community', 'grading-votes', 'analytics', 'powerrank', 'powerrank-preview'].forEach(function (t) {
    const btn = document.getElementById('tab-btn-' + t);
    const section = document.getElementById('tab-' + t);
    if (btn) {
      if (t === name) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
    if (section) {
      if (t === name) {
        section.classList.remove('hidden');
      } else {
        section.classList.add('hidden');
      }
    }
  });

  // Load data if not already loaded (or force reload on switch)
  if (name === 'leaderboard') {
    loadLeaderboard();
  } else if (name === 'weekly') {
    loadWeeklyTab();
  } else if (name === 'users') {
    loadUsers();
  } else if (name === 'community') {
    loadCommunityTab();
  } else if (name === 'grading-votes') {
    loadGradingVotesTab();
  } else if (name === 'analytics') {
    loadAnalyticsTab();
  } else if (name === 'powerrank') {
    loadPowerrankTab();
  } else if (name === 'powerrank-preview') {
    if (typeof showPowerRankScreen === 'function') showPowerRankScreen();
  }
}

// ============================================================
//  Leaderboard Tab
// ============================================================

function loadLeaderboard() {
  const tbody = document.getElementById('lb-tbody');
  const stats = document.getElementById('lb-stats');

  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="admin-loading">Loading\u2026</td></tr>';
  if (stats) stats.textContent = '';

  _db.collection(DB_COLLECTIONS.submissions)
    .where('weekId', '==', _lbWeekId)
    .where('ruleSet', '==', _lbRuleSet)
    .get()
    .then(function (snapshot) {
      if (!tbody) return;

      if (snapshot.empty) {
        tbody.innerHTML = '<tr><td colspan="7" class="admin-empty">No submissions found for this week and rule set.</td></tr>';
        if (stats) stats.textContent = 'Total: 0';
        return;
      }

      var rows = [];
      var totalPct = 0;
      var topPct = null;

      snapshot.forEach(function (doc) {
        var d = doc.data();
        rows.push({ id: doc.id, data: d });
      });

      // Sort client-side — no composite index required
      rows.sort(function(a, b) { return (b.data.pct || 0) - (a.data.pct || 0); });

      rows.forEach(function(row) {
        var pct = typeof row.data.pct === 'number' ? row.data.pct : 0;
        totalPct += pct;
        if (topPct === null || pct > topPct) topPct = pct;
      });

      var count = rows.length;
      var avgPct = count > 0 ? (totalPct / count) : 0;

      if (stats) {
        stats.textContent =
          'Total: ' + count +
          ' \u00b7 Top: ' + (topPct !== null ? topPct.toFixed(1) : '—') + '%' +
          ' \u00b7 Avg: ' + avgPct.toFixed(1) + '%';
      }

      tbody.innerHTML = '';
      rows.forEach(function (row, idx) {
        var d = row.data;
        var rank = idx + 1;
        var pct = typeof d.pct === 'number' ? d.pct : 0;
        var earned = typeof d.earned === 'number' ? d.earned : '—';
        var max = typeof d.max === 'number' ? d.max : '—';
        var dateStr = '—';
        if (d.submittedAt && d.submittedAt.toDate) {
          dateStr = d.submittedAt.toDate().toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
          });
        }

        var avatarHtml;
        if (d.photoURL) {
          var avatarImg = document.createElement('img');
          avatarImg.src = escapeHtml(d.photoURL);
          avatarImg.alt = '';
          avatarImg.className = 'admin-avatar';
          avatarImg.onerror = function() { this.style.display = 'none'; };
          avatarHtml = avatarImg.outerHTML;
        } else {
          var initials = getInitials(d.displayName || d.email || '?');
          avatarHtml = '<span class="admin-avatar admin-avatar-initials">' + escapeHtml(initials) + '</span>';
        }

        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td class="admin-td-rank">' + rank + '</td>' +
          '<td class="admin-td-avatar">' + avatarHtml + '</td>' +
          '<td class="admin-td-name">' + escapeHtml(d.displayName || d.email || 'Unknown') + '</td>' +
          '<td class="admin-td-score">' + earned + ' / ' + max + '</td>' +
          '<td class="admin-td-pct">' + pct.toFixed(1) + '%</td>' +
          '<td class="admin-td-date">' + escapeHtml(dateStr) + '</td>' +
          '<td class="admin-td-actions"><button class="admin-btn-danger admin-btn-sm" data-id="' + escapeHtml(row.id) + '">Delete</button></td>';

        tr.querySelector('[data-id]').addEventListener('click', function () {
          var docId = this.dataset.id;
          if (!confirm('Delete this submission? This cannot be undone.')) return;
          _db.collection(DB_COLLECTIONS.submissions).doc(docId).delete().then(function () {
            loadLeaderboard();
          }).catch(function (err) {
            alert('Error deleting submission: ' + err.message);
          });
        });

        tbody.appendChild(tr);
      });
    })
    .catch(function (err) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="admin-error">Error loading leaderboard: ' + escapeHtml(err.message) + '</td></tr>';
      console.error('[admin] loadLeaderboard error:', err);
    });
}

function clearAllSubmissions() {
  if (!confirm('Delete ALL ' + _lbRuleSet.toUpperCase() + ' submissions for ' + formatWeekLabel(_lbWeekId) + '?\nThis cannot be undone.')) return;
  _db.collection(DB_COLLECTIONS.submissions)
    .where('weekId', '==', _lbWeekId)
    .where('ruleSet', '==', _lbRuleSet)
    .get()
    .then(function(snapshot) {
      var batch = _db.batch();
      snapshot.forEach(function(doc) { batch.delete(doc.ref); });
      return batch.commit();
    })
    .then(function() { loadLeaderboard(); })
    .catch(function(err) { alert('Error clearing submissions: ' + err.message); });
}

// ============================================================
//  Weekly Challenge Tab
// ============================================================

function loadWeeklyTab() {
  _selectedCarcassIds = new Set();
  _wcAllCarcasses = [];
  window._adminAddedCarcasses = [];

  var weekInfoEl   = document.getElementById('wc-week-info');
  var selectedGrid = document.getElementById('wc-selected-grid');
  var poolGrid     = document.getElementById('wc-pool-grid');
  var saveStatus   = document.getElementById('wc-save-status');

  if (weekInfoEl)   weekInfoEl.textContent = 'Loading\u2026';
  if (selectedGrid) selectedGrid.innerHTML = '<div class="admin-empty" style="grid-column:1/-1;">Loading\u2026</div>';
  if (poolGrid)     poolGrid.innerHTML     = '';
  if (saveStatus)   saveStatus.textContent = '';

  // Community fetch runs in parallel — load from Firestore community_carcasses collection
  var communityPromise = _db
    ? _db.collection(DB_COLLECTIONS.community_carcasses)
        .orderBy('submittedAt', 'desc').limit(100).get()
        .then(function(snap) {
          return snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); })
            .filter(function(r) { return r.imageUrl && r.correct && r.correct.qualityGrade; });
        })
        .catch(function() { return []; })
    : Promise.resolve([]);

  var overrideQuery   = _db.collection('weeks').doc(_wcWeekId).get();
  var ffaQuery        = _db.collection(DB_COLLECTIONS.submissions).where('weekId', '==', _wcWeekId).where('ruleSet', '==', 'ffa').get();
  var collegiateQuery = _db.collection(DB_COLLECTIONS.submissions).where('weekId', '==', _wcWeekId).where('ruleSet', '==', 'collegiate').get();
  Promise.all([overrideQuery, ffaQuery, collegiateQuery, communityPromise])
    .then(function (results) {
      var overrideDoc    = results[0];
      var ffaSnap        = results[1];
      var collegiateSnap = results[2];
      var communitySet   = results[3] || [];

      // Week info bar
      if (weekInfoEl) {
        var overrideActive = overrideDoc.exists && Array.isArray(overrideDoc.data().carcassIds) && overrideDoc.data().carcassIds.length > 0;
        weekInfoEl.innerHTML =
          '<strong>' + escapeHtml(formatWeekLabel(_wcWeekId)) + '</strong>' +
          '<span class="wc-info-pill">FFA: ' + ffaSnap.size + ' submissions</span>' +
          '<span class="wc-info-pill">Collegiate: ' + collegiateSnap.size + ' submissions</span>' +
          (overrideActive ? '<span class="wc-info-pill wc-info-override">Override Active</span>' : '<span class="wc-info-pill">Auto-seeded</span>') +
          (communitySet.length ? '<span class="wc-info-pill">' + communitySet.length + ' community</span>' : '');
      }

      // Load existing override selection
      if (overrideDoc.exists) {
        var od = overrideDoc.data();
        if (Array.isArray(od.carcassIds) && od.carcassIds.length > 0) {
          _selectedCarcassIds = new Set(od.carcassIds);
        }
        if (Array.isArray(od.adminCarcasses)) {
          window._adminAddedCarcasses = od.adminCarcasses;
        }
      }

      // Build pool: DEFAULT_CARCASSES (non-placeholder) + community (deduplicated)
      var defaultPool = DEFAULT_CARCASSES.filter(function (c) {
        var nameLower = (c.imageName || '').toLowerCase();
        var urlLower  = (c.imageUrl  || '').toLowerCase();
        return !nameLower.includes('placeholder') && !urlLower.includes('placehold.co');
      });

      var existingIds = new Set(defaultPool.map(function (c) { return c.id; }));
      var validCommunity = communitySet.filter(function (c) {
        return c && c.id && !existingIds.has(c.id);
      });

      _wcAllCarcasses = defaultPool.concat(validCommunity);

      _renderWeeklyUI();
      _renderCommunityForAdmin(communitySet);
    })
    .catch(function (err) {
      if (weekInfoEl) {
        weekInfoEl.textContent = 'Error loading weekly data: ' + err.message + ' ';
        var retryBtn = document.createElement('button');
        retryBtn.textContent = 'Retry';
        retryBtn.style.cssText = 'padding:0.2rem 0.6rem;font-size:0.8rem;cursor:pointer;';
        retryBtn.addEventListener('click', loadWeeklyTab);
        weekInfoEl.appendChild(retryBtn);
      }
      console.error('[admin] loadWeeklyTab error:', err);
    });
}

function _renderWeeklyUI() {
  _renderSelectedGrid();
  _renderPoolGrid();
  _updateSelectedCount();
}

function _renderSelectedGrid() {
  var grid = document.getElementById('wc-selected-grid');
  if (!grid) return;

  // Collect all carcass objects (pool + admin-added)
  var allKnown = _wcAllCarcasses.concat(window._adminAddedCarcasses || []);

  if (_selectedCarcassIds.size === 0) {
    grid.innerHTML = '<div class="admin-empty" style="grid-column:1/-1;">No carcasses selected — pick from the pool below.</div>';
    return;
  }

  grid.innerHTML = '';

  _selectedCarcassIds.forEach(function (id) {
    var c = allKnown.find(function (x) { return x.id === id; });
    if (!c) return;

    var gradeObj   = GRADE_MAP[c.correct && c.correct.qualityGrade];
    var gradeLabel = gradeObj ? gradeObj.label : (c.correct && c.correct.qualityGrade) || '';

    var card = document.createElement('div');
    card.className   = 'wc-carcass-card wc-carcass-selected';
    card.dataset.id  = id;

    var img = document.createElement('img');
    img.className = 'wc-card-img';
    img.src       = c.imageUrl || '';
    img.alt       = '';
    img.loading   = 'lazy';
    img.onerror   = function () { this.style.opacity = '0'; };
    card.appendChild(img);

    var info = document.createElement('div');
    info.className = 'wc-card-info';
    info.innerHTML =
      '<div class="wc-card-name">' + escapeHtml(c.imageName || 'Unnamed') + '</div>' +
      '<div class="wc-card-grade">' + escapeHtml(gradeLabel) + '</div>';
    card.appendChild(info);

    var removeBtn = document.createElement('button');
    removeBtn.className = 'wc-remove-btn';
    removeBtn.title     = 'Remove from this week';
    removeBtn.innerHTML = '&times;';
    removeBtn.dataset.id = id;
    removeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      _selectedCarcassIds.delete(this.dataset.id);
      _renderWeeklyUI();
    });
    card.appendChild(removeBtn);

    grid.appendChild(card);
  });
}

function _renderPoolGrid() {
  var grid = document.getElementById('wc-pool-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (!_wcAllCarcasses.length) {
    grid.innerHTML = '<div class="admin-empty" style="grid-column:1/-1;">No carcasses found in data.js.</div>';
    return;
  }

  _wcAllCarcasses.forEach(function (c) {
    var isSelected = _selectedCarcassIds.has(c.id);
    var gradeObj   = GRADE_MAP[c.correct && c.correct.qualityGrade];
    var gradeLabel = gradeObj ? gradeObj.label : (c.correct && c.correct.qualityGrade) || '';

    var card = document.createElement('div');
    card.className  = 'wc-carcass-card wc-carcass-pool' + (isSelected ? ' in-set' : '');
    card.dataset.id = c.id;
    card.title      = isSelected ? 'In this week\'s set \u2014 click to remove' : 'Click to add to this week\'s set';

    var img = document.createElement('img');
    img.className = 'wc-card-img';
    img.src       = c.imageUrl || '';
    img.alt       = '';
    img.loading   = 'lazy';
    img.onerror   = function () { this.style.opacity = '0'; };
    card.appendChild(img);

    var info = document.createElement('div');
    info.className = 'wc-card-info';
    info.innerHTML =
      '<div class="wc-card-name">' + escapeHtml(c.imageName || 'Unnamed') + '</div>' +
      '<div class="wc-card-grade">' + escapeHtml(gradeLabel) + '</div>';
    card.appendChild(info);

    var badge = document.createElement('div');
    badge.className = 'wc-card-badge' + (isSelected ? ' wc-badge-check' : '');
    badge.innerHTML = isSelected ? '&#10003;' : '+';
    card.appendChild(badge);

    card.addEventListener('click', function () {
      var cid = this.dataset.id;
      if (_selectedCarcassIds.has(cid)) {
        _selectedCarcassIds.delete(cid);
      } else {
        _selectedCarcassIds.add(cid);
      }
      _renderWeeklyUI();
    });

    grid.appendChild(card);
  });
}

function _updateSelectedCount() {
  var n = _selectedCarcassIds.size;

  var countEl = document.getElementById('wc-selected-count');
  if (countEl) {
    countEl.textContent = n + ' carcass' + (n !== 1 ? 'es' : '') + ' selected';
    countEl.className   = 'wc-count-badge' + (n > 0 ? ' wc-count-active' : '');
  }

  var noticeCount = document.getElementById('wc-notice-count');
  if (noticeCount) noticeCount.textContent = n;

  var noticeStatus = document.getElementById('wc-notice-status');
  if (noticeStatus) {
    noticeStatus.textContent = n > 0 ? 'Save to apply.' : 'No carcasses selected — auto-seed will be used.';
  }
}

// ============================================================
//  Add Image by URL
// ============================================================

function addCarcassByUrl() {
  var url   = (document.getElementById('wc-add-url').value || '').trim();
  var name  = (document.getElementById('wc-add-name').value || '').trim() || 'Custom Carcass';
  var grade = document.getElementById('wc-add-grade').value;
  var log   = document.getElementById('wc-added-list');

  if (!url)   { alert('Enter an image URL.'); return; }
  if (!grade) { alert('Select a grade.'); return; }

  var id = 'admin-' + Date.now();
  // Store full carcass object temporarily in a global so weekly.js can find it
  window._adminAddedCarcasses = window._adminAddedCarcasses || [];
  window._adminAddedCarcasses.push({ id: id, imageName: name, imageUrl: url, source: 'Admin', correct: { qualityGrade: grade }, notes: '' });

  _selectedCarcassIds.add(id);

  if (log) log.innerHTML += '<div style="margin-top:0.35rem;">&#10003; Added: <b>' + escapeHtml(name) + '</b> (' + escapeHtml(grade) + ')</div>';
  document.getElementById('wc-add-url').value   = '';
  document.getElementById('wc-add-name').value  = '';
  document.getElementById('wc-add-grade').value = '';
  _renderWeeklyUI();
}

// ============================================================
//  Load Community Submissions for Admin
// ============================================================

function _renderCommunityForAdmin(set) {
  var container = document.getElementById('wc-community-list');
  if (!container) return;
  set = set || [];
  if (!set.length) { container.innerHTML = '<p class="admin-empty">No community carcasses yet.</p>'; return; }
  container.innerHTML = '';
  set.forEach(function(c) {
    var docId = c.id;
    var gradeObj = GRADE_MAP[c.correct && c.correct.qualityGrade];
    var gradeLabel = gradeObj ? gradeObj.label : (c.correct && c.correct.qualityGrade) || '';
    var checked = _selectedCarcassIds.has(docId);

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:0.5rem;margin-bottom:0.35rem;';

    var label = document.createElement('label');
    label.className = 'admin-carcass-item' + (checked ? ' selected' : '');
    label.style.flex = '1';

    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.id = docId;
    cb.checked = checked;
    cb.addEventListener('change', function() {
      if (this.checked) { _selectedCarcassIds.add(this.dataset.id); label.classList.add('selected'); }
      else              { _selectedCarcassIds.delete(this.dataset.id); label.classList.remove('selected'); }
      _renderWeeklyUI();
    });

    var info = document.createElement('span');
    info.innerHTML = '<span class="admin-carcass-name">' + escapeHtml(c.imageName || 'Unnamed') + '</span>' +
                     '<span class="admin-carcass-grade">' + escapeHtml(gradeLabel) + '</span>';

    label.appendChild(cb);
    label.appendChild(info);

    var delBtn = document.createElement('button');
    delBtn.className = 'admin-btn-danger admin-btn-sm';
    delBtn.textContent = 'Delete';
    delBtn.dataset.id = docId;
    delBtn.addEventListener('click', function() {
      var id = this.dataset.id;
      if (!confirm('Delete ' + escapeHtml(c.imageName || 'this carcass') + '?')) return;
      _db.collection(DB_COLLECTIONS.community_carcasses).doc(id).delete()
        .then(function() { loadWeeklyTab(); })
        .catch(function(err) { alert('Error deleting: ' + err.message); });
    });

    row.appendChild(label);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
}

// ============================================================
//  Community Tab
// ============================================================

function loadCommunityTab() {
  var listEl    = document.getElementById('community-list');
  var countEl   = document.getElementById('community-stat-count');

  if (listEl) listEl.innerHTML = '<div class="admin-empty">Loading\u2026</div>';
  if (countEl) countEl.textContent = '\u2026';

  if (!_db) {
    if (listEl) listEl.innerHTML = '<div class="admin-empty">Database not available.</div>';
    return;
  }

  _db.collection(DB_COLLECTIONS.community_carcasses)
    .orderBy('submittedAt', 'desc')
    .get()
    .then(function(snap) {
      var docs = snap.docs.map(function(d) { return Object.assign({ _docId: d.id }, d.data()); });

      if (countEl) countEl.textContent = docs.length;
      if (!listEl) return;

      if (!docs.length) {
        listEl.innerHTML = '<div class="admin-empty">No community carcasses yet. Use the Seed button above to get started.</div>';
        return;
      }

      listEl.innerHTML = '';
      docs.forEach(function(c) {
        listEl.appendChild(_buildCommunityRow(c));
      });
    })
    .catch(function(err) {
      if (listEl) listEl.innerHTML = '<div class="admin-empty">Error loading: ' + escapeHtml(err.message) + '</div>';
      console.error('[admin] loadCommunityTab error:', err);
    });
}

function _buildCommunityRow(c) {
  var docId      = c._docId;
  var gradeObj   = GRADE_MAP[c.correct && c.correct.qualityGrade];
  var gradeLabel = gradeObj ? gradeObj.label : (c.correct && c.correct.qualityGrade) || '—';

  var row = document.createElement('div');
  row.className    = 'community-row';
  row.dataset.docId = docId;

  var thumb = document.createElement('img');
  thumb.className = 'community-thumb';
  thumb.src       = c.imageUrl || '';
  thumb.alt       = '';
  thumb.loading   = 'lazy';
  thumb.onerror   = function() { this.style.display = 'none'; };

  var info = document.createElement('div');
  info.className = 'community-row-info';
  info.innerHTML =
    '<span class="community-row-name">' + escapeHtml(c.imageName || 'Unnamed') + '</span>' +
    '<span class="community-row-grade">' + escapeHtml(gradeLabel) + '</span>' +
    '<span class="community-row-source">' + escapeHtml(c.source || '') + '</span>';

  var actions = document.createElement('div');
  actions.className = 'community-row-actions';

  var editBtn = document.createElement('button');
  editBtn.className   = 'admin-btn-secondary admin-btn-sm';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', function() {
    _showCommunityEditForm(row, c);
  });

  var delBtn = document.createElement('button');
  delBtn.className   = 'admin-btn-danger admin-btn-sm';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', function() {
    if (!_currentUser || _currentUser.uid !== ADMIN_UID) {
      alert('Admin access required.');
      return;
    }
    if (!confirm('Delete "' + escapeHtml(c.imageName || 'this carcass') + '"?')) return;
    _db.collection(DB_COLLECTIONS.community_carcasses).doc(docId).delete()
      .then(function() { loadCommunityTab(); })
      .catch(function(err) { alert('Error deleting: ' + err.message); });
  });

  actions.appendChild(editBtn);
  actions.appendChild(delBtn);

  row.appendChild(thumb);
  row.appendChild(info);
  row.appendChild(actions);

  return row;
}

function _showCommunityEditForm(row, c) {
  var docId = c._docId;

  var form = document.createElement('div');
  form.className = 'community-edit-form';

  // Build grade options HTML — restricted to scorable grades since
  // community_carcasses is the primary practice pool
  var gradeOptions = '<option value="">— Grade —</option>';
  QUALITY_GRADES.filter(function(g) { return !g.collegiateOnly; }).forEach(function(g) {
    var sel = (c.correct && c.correct.qualityGrade === g.key) ? ' selected' : '';
    gradeOptions += '<option value="' + escapeHtml(g.key) + '"' + sel + '>' + escapeHtml(g.label) + '</option>';
  });

  var nameInput  = document.createElement('input');
  nameInput.type  = 'text';
  nameInput.value = c.imageName || '';
  nameInput.placeholder = 'Name';
  nameInput.className = 'community-edit-input';

  var urlInput  = document.createElement('input');
  urlInput.type  = 'url';
  urlInput.value = c.imageUrl || '';
  urlInput.placeholder = 'Image URL';
  urlInput.className = 'community-edit-input';

  var gradeSelect = document.createElement('select');
  gradeSelect.className = 'community-edit-select';
  gradeSelect.innerHTML = gradeOptions;

  var notesInput  = document.createElement('input');
  notesInput.type  = 'text';
  notesInput.value = c.notes || '';
  notesInput.placeholder = 'Notes';
  notesInput.className = 'community-edit-input';

  var saveBtn = document.createElement('button');
  saveBtn.className   = 'admin-btn-primary admin-btn-sm';
  saveBtn.textContent = 'Save';

  var cancelBtn = document.createElement('button');
  cancelBtn.className   = 'admin-btn-secondary admin-btn-sm';
  cancelBtn.textContent = 'Cancel';

  var statusSpan = document.createElement('span');
  statusSpan.style.cssText = 'font-size:0.8rem;color:var(--text-muted);';

  saveBtn.addEventListener('click', function() {
    var newName  = nameInput.value.trim();
    var newUrl   = urlInput.value.trim();
    var newGrade = gradeSelect.value;

    if (!newName) { alert('Name is required.'); return; }
    if (!newUrl)  { alert('Image URL is required.'); return; }
    if (!newGrade){ alert('Grade is required.'); return; }

    saveBtn.disabled = true;
    statusSpan.textContent = 'Saving\u2026';

    _db.collection(DB_COLLECTIONS.community_carcasses).doc(docId).update({
      imageName: newName,
      imageUrl:  newUrl,
      notes:     notesInput.value.trim(),
      correct:   { qualityGrade: newGrade }
    })
    .then(function() {
      loadCommunityTab();
    })
    .catch(function(err) {
      statusSpan.textContent = 'Error: ' + err.message;
      saveBtn.disabled = false;
    });
  });

  cancelBtn.addEventListener('click', function() {
    // Restore original row
    var parent = form.parentNode;
    if (parent) parent.replaceChild(_buildCommunityRow(c), form);
  });

  var fields = document.createElement('div');
  fields.className = 'community-edit-fields';
  fields.appendChild(nameInput);
  fields.appendChild(urlInput);
  fields.appendChild(gradeSelect);
  fields.appendChild(notesInput);

  var btns = document.createElement('div');
  btns.className = 'community-edit-btns';
  btns.appendChild(saveBtn);
  btns.appendChild(cancelBtn);
  btns.appendChild(statusSpan);

  form.appendChild(fields);
  form.appendChild(btns);

  row.parentNode.replaceChild(form, row);
}

function addCommunityRecord() {
  var urlInput   = document.getElementById('community-add-url');
  var nameInput  = document.getElementById('community-add-name');
  var gradeInput = document.getElementById('community-add-grade');
  var notesInput = document.getElementById('community-add-notes');
  var statusEl   = document.getElementById('community-add-status');
  var addBtn     = document.getElementById('community-add-btn');

  var url   = (urlInput   ? urlInput.value.trim()   : '');
  var name  = (nameInput  ? nameInput.value.trim()  : '');
  var grade = (gradeInput ? gradeInput.value        : '');
  var notes = (notesInput ? notesInput.value.trim() : '');

  if (!url || !url.startsWith('https://')) {
    if (statusEl) statusEl.textContent = 'Image URL is required and must start with https://';
    return;
  }
  if (!name) {
    if (statusEl) statusEl.textContent = 'Name is required.';
    return;
  }
  if (!grade) {
    if (statusEl) statusEl.textContent = 'Grade is required.';
    return;
  }

  if (!_currentUser) {
    if (statusEl) statusEl.textContent = 'You must be signed in.';
    return;
  }

  if (addBtn) addBtn.disabled = true;
  if (statusEl) statusEl.textContent = 'Adding\u2026';

  _db.collection(DB_COLLECTIONS.community_carcasses).add({
    imageUrl:    url,
    imageName:   name,
    source:      'Admin',
    notes:       notes,
    correct:     { qualityGrade: grade },
    submittedBy: _currentUser.uid,
    submittedAt: firebase.firestore.FieldValue.serverTimestamp()
  })
  .then(function() {
    if (statusEl) statusEl.textContent = 'Added successfully.';
    if (urlInput)   urlInput.value   = '';
    if (nameInput)  nameInput.value  = '';
    if (gradeInput) gradeInput.value = '';
    if (notesInput) notesInput.value = '';
    if (addBtn) addBtn.disabled = false;
    loadCommunityTab();
  })
  .catch(function(err) {
    if (statusEl) statusEl.textContent = 'Error: ' + err.message;
    if (addBtn) addBtn.disabled = false;
  });
}


// ============================================================
//  Import Community JSON
// ============================================================

function importCommunityJson() {
  var VALID_GRADES = {
    PR_HI: true, PR_AVG: true, PR_LO: true,
    CH_HI: true, CH_AVG: true, CH_LO: true,
    SE_HI: true, SE_LO: true,
    STD: true
  };

  var statusEl = document.getElementById('community-import-status');
  var ta       = document.getElementById('community-import-json');

  if (!_currentUser || !_db) {
    if (statusEl) statusEl.textContent = 'Not signed in.';
    return;
  }

  if (!ta || !ta.value.trim()) {
    if (statusEl) statusEl.textContent = 'Paste a JSON array first.';
    return;
  }

  var parsed;
  try {
    parsed = JSON.parse(ta.value.trim());
  } catch (e) {
    if (statusEl) statusEl.textContent = 'Invalid JSON: ' + e.message;
    return;
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    if (statusEl) statusEl.textContent = 'JSON must be a non-empty array.';
    return;
  }

  var valid   = [];
  var skipped = 0;

  for (var i = 0; i < parsed.length; i++) {
    var item = parsed[i];
    if (!item || typeof item !== 'object') { skipped++; continue; }

    var name  = item.imageName;
    var url   = item.imageUrl;
    var grade = item.correct && item.correct.qualityGrade;

    if (typeof name !== 'string' || !name.trim() || name.length > 100) { skipped++; continue; }
    if (typeof url !== 'string' || url.indexOf('https://') !== 0 || url.length > 2000) { skipped++; continue; }
    if (!grade || !VALID_GRADES[grade]) { skipped++; continue; }

    valid.push({
      imageName:   name.trim(),
      imageUrl:    url,
      notes:       (typeof item.notes === 'string') ? item.notes : '',
      correct:     { qualityGrade: grade },
      source:      'Admin Import',
      submittedBy: _currentUser.uid,
      submittedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  if (valid.length === 0) {
    if (statusEl) statusEl.textContent = 'No valid records found. ' + skipped + ' skipped.';
    return;
  }

  var BATCH_SIZE = 10;
  var total      = valid.length;
  var batches    = [];

  for (var b = 0; b < total; b += BATCH_SIZE) {
    batches.push(valid.slice(b, b + BATCH_SIZE));
  }

  var importBtn = document.getElementById('community-import-btn');
  if (importBtn) importBtn.disabled = true;

  var imported = 0;

  function runBatch(idx) {
    if (idx >= batches.length) {
      if (ta) ta.value = '';
      if (statusEl) statusEl.textContent = 'Imported ' + imported + ' carcasses (' + skipped + ' skipped).';
      if (importBtn) importBtn.disabled = false;
      loadCommunityTab();
      return;
    }

    var batch    = batches[idx];
    var start    = idx * BATCH_SIZE + 1;
    var end      = Math.min(start + batch.length - 1, total);
    if (statusEl) statusEl.textContent = 'Importing ' + start + '\u2013' + end + ' of ' + total + '\u2026';

    var writes = batch.map(function(doc) {
      return _db.collection(DB_COLLECTIONS.community_carcasses).add(doc);
    });

    Promise.all(writes).then(function() {
      imported += batch.length;
      runBatch(idx + 1);
    }).catch(function(err) {
      if (statusEl) statusEl.textContent = 'Error during import: ' + err.message;
      if (importBtn) importBtn.disabled = false;
    });
  }

  runBatch(0);
}


// ============================================================
//  Save / Reset Week Override
// ============================================================

function saveWeekOverride() {
  var saveStatus = document.getElementById('wc-save-status');
  if (saveStatus) saveStatus.textContent = '';

  if (_selectedCarcassIds.size === 0) {
    alert('Select at least one carcass before saving.');
    return;
  }

  if (!_currentUser) {
    alert('You must be signed in to save.');
    return;
  }

  // Include any admin-added custom carcasses as embedded objects alongside IDs
  var adminAdded = (window._adminAddedCarcasses || []).filter(function(c) {
    return _selectedCarcassIds.has(c.id);
  });

  var payload = {
    weekId: _wcWeekId,
    carcassIds: Array.from(_selectedCarcassIds),
    adminCarcasses: adminAdded,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: _currentUser.uid
  };

  _db.collection('weeks').doc(_wcWeekId).set(payload).then(function () {
    if (saveStatus) {
      saveStatus.textContent = 'Saved! Override active for ' + formatWeekLabel(_wcWeekId);
      saveStatus.className = 'admin-save-status admin-save-ok';
    }
  }).catch(function (err) {
    if (saveStatus) {
      saveStatus.textContent = 'Error saving: ' + err.message;
      saveStatus.className = 'admin-save-status admin-save-error';
    }
    console.error('[admin] saveWeekOverride error:', err);
  });
}

function resetWeekOverride() {
  if (!confirm('Reset the override for ' + formatWeekLabel(_wcWeekId) + '? The drill will revert to auto-seeding for this week.')) return;

  _db.collection('weeks').doc(_wcWeekId).delete().then(function () {
    loadWeeklyTab();
  }).catch(function (err) {
    alert('Error resetting override: ' + err.message);
    console.error('[admin] resetWeekOverride error:', err);
  });
}

// ============================================================
//  Users Tab
// ============================================================

function loadUsers() {
  var tbody = document.getElementById('users-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="admin-loading">Loading\u2026</td></tr>';

  _db.collection(DB_COLLECTIONS.users)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get()
    .then(function (snapshot) {
      if (!tbody) return;

      if (snapshot.empty) {
        tbody.innerHTML = '<tr><td colspan="4" class="admin-empty">No users found.</td></tr>';
        return;
      }

      tbody.innerHTML = '';
      snapshot.forEach(function (doc) {
        var d = doc.data();

        var dateStr = '—';
        if (d.createdAt && d.createdAt.toDate) {
          dateStr = d.createdAt.toDate().toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
          });
        }

        var avatarHtml;
        if (d.photoURL) {
          var avatarImg = document.createElement('img');
          avatarImg.src = escapeHtml(d.photoURL);
          avatarImg.alt = '';
          avatarImg.className = 'admin-avatar';
          avatarImg.onerror = function() { this.style.display = 'none'; };
          avatarHtml = avatarImg.outerHTML;
        } else {
          var initials = getInitials(d.displayName || d.email || '?');
          avatarHtml = '<span class="admin-avatar admin-avatar-initials">' + escapeHtml(initials) + '</span>';
        }

        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td class="admin-td-avatar">' + avatarHtml + '</td>' +
          '<td class="admin-td-name">' + escapeHtml(d.displayName || '—') + '</td>' +
          '<td class="admin-td-email">' + escapeHtml(d.email || '—') + '</td>' +
          '<td class="admin-td-date">' + escapeHtml(dateStr) + '</td>';
        tbody.appendChild(tr);
      });
    })
    .catch(function (err) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="admin-error">Error loading users: ' + escapeHtml(err.message) + '</td></tr>';
      console.error('[admin] loadUsers error:', err);
    });
}

// ============================================================
//  Week Select Population
// ============================================================

function populateWeekSelects() {
  var selects = [
    { el: document.getElementById('lb-week-select'), currentId: _lbWeekId },
    { el: document.getElementById('wc-week-select'), currentId: _wcWeekId }
  ];

  // Offsets: -4, -3, -2, -1, 0 (current), +1, +2
  var offsets = [-4, -3, -2, -1, 0, 1, 2];

  selects.forEach(function (s) {
    if (!s.el) return;
    s.el.innerHTML = '';
    offsets.forEach(function (offset) {
      var weekId = getWeekId(offset);
      var label = formatWeekLabel(weekId);
      if (offset === 0) label += ' (current)';
      var opt = document.createElement('option');
      opt.value = weekId;
      opt.textContent = label;
      if (weekId === s.currentId) opt.selected = true;
      s.el.appendChild(opt);
    });
  });
}

// ============================================================
//  Grading Votes Tab
// ============================================================

const GRADE_LABELS_GV = {
  PR_HI:'High Prime', PR_AVG:'Avg Prime', PR_LO:'Low Prime',
  CH_HI:'High Choice', CH_AVG:'Avg Choice', CH_LO:'Low Choice',
  SE_HI:'High Select', SE_LO:'Low Select', STD:'Standard',
};

// Promotion gate — a consensus is only trustworthy enough to push into
// community_carcasses (used elsewhere as few-shot calibration input) once
// it clears a minimum sample size and a clear majority.
var GV_MIN_VOTES = 5;
var GV_MIN_SHARE = 0.6;

// Returns { passed: bool, reasons: [String] } describing why a consensus
// is or isn't eligible to be pushed to references.
function gvEvaluatePromotionGate(tally, sortedGrades, totalVotes) {
  var consensusGrade = sortedGrades[0];
  var runnerUpGrade  = sortedGrades[1];
  var topShare       = tally[consensusGrade] / totalVotes;
  var reasons = [];

  if (totalVotes < GV_MIN_VOTES) {
    reasons.push('Needs ' + GV_MIN_VOTES + '+ votes (has ' + totalVotes + ')');
  }

  if (topShare < GV_MIN_SHARE) {
    var topPct = Math.round(topShare * 100);
    if (runnerUpGrade) {
      var runnerPct = Math.round((tally[runnerUpGrade] / totalVotes) * 100);
      reasons.push('Contentious — ' + consensusGrade + ' ' + topPct + '% vs ' +
        runnerUpGrade + ' ' + runnerPct + '%, needs 60%+ share');
    } else {
      reasons.push('Needs 60%+ share (has ' + topPct + '%)');
    }
  }

  return { passed: reasons.length === 0, reasons: reasons };
}

async function loadGradingVotesTab() {
  var listEl   = document.getElementById('gv-card-list');
  var statImgs = document.getElementById('gv-stat-images');
  var statVotes= document.getElementById('gv-stat-votes');
  var statProm = document.getElementById('gv-stat-promoted');
  if (!listEl) return;
  listEl.innerHTML = '<div class="admin-empty">Loading votes…</div>';

  try {
    // Fetch all votes
    var votesSnap = await _db.collection('grading_votes').get();
    var allVotes  = votesSnap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });

    // Group by imageId
    var byImage = {};
    allVotes.forEach(function(v) {
      if (!byImage[v.imageId]) byImage[v.imageId] = [];
      byImage[v.imageId].push(v);
    });

    var imageIds = Object.keys(byImage);
    if (!imageIds.length) {
      listEl.innerHTML = '<div class="admin-empty">No votes yet.</div>';
      if (statImgs)  statImgs.textContent  = '0';
      if (statVotes) statVotes.textContent = '0';
      if (statProm)  statProm.textContent  = '0';
      return;
    }

    // Fetch ai_carcasses docs for each imageId (batched, max 10 per in-query)
    var imageData = {};
    var promoted  = 0;
    var batches = [];
    for (var i = 0; i < imageIds.length; i += 10) {
      batches.push(imageIds.slice(i, i + 10));
    }
    for (var b = 0; b < batches.length; b++) {
      var snap = await _db.collection('ai_carcasses')
        .where(firebase.firestore.FieldPath.documentId(), 'in', batches[b]).get();
      snap.docs.forEach(function(d) { imageData[d.id] = d.data(); });
    }

    // Sort by vote count desc
    imageIds.sort(function(a, b) { return byImage[b].length - byImage[a].length; });

    // Stats
    if (statImgs)  statImgs.textContent  = imageIds.length;
    if (statVotes) statVotes.textContent = allVotes.length;

    listEl.innerHTML = '';

    imageIds.forEach(function(imageId) {
      var votes = byImage[imageId];
      var data  = imageData[imageId] || {};
      var imageUrl = data.imageUrl || (votes[0] && votes[0].imageUrl) || '';
      var aiGrade  = (data.correct && data.correct.qualityGrade) || '—';
      var isPromoted = data.promoted === true;
      if (isPromoted) promoted++;

      // Tally votes per grade
      var tally = {};
      votes.forEach(function(v) { tally[v.grade] = (tally[v.grade] || 0) + 1; });
      var sortedGrades   = Object.keys(tally).sort(function(a,b){ return tally[b]-tally[a]; });
      var consensusGrade = sortedGrades[0];
      var totalVotes     = votes.length;
      var gateResult     = gvEvaluatePromotionGate(tally, sortedGrades, totalVotes);

      // Build card
      var card = document.createElement('div');
      card.className = 'gv-card' + (isPromoted ? ' gv-card-promoted' : '');

      // Image
      var imgEl = document.createElement('img');
      imgEl.className = 'gv-card-img';
      imgEl.alt = 'ribeye';
      imgEl.src = escapeHtml(imageUrl);
      imgEl.onerror = function() { this.style.opacity = '0.2'; };
      card.appendChild(imgEl);

      // Body
      var body = document.createElement('div');
      body.className = 'gv-card-body';

      // Grade rows
      var gradesHtml = '<div class="gv-grade-rows">';
      Object.keys(tally).sort(function(a,b){return tally[b]-tally[a];}).forEach(function(g) {
        var pct = Math.round(tally[g] / totalVotes * 100);
        var isWinner = g === consensusGrade;
        gradesHtml += '<div class="gv-grade-row' + (isWinner ? ' gv-winner' : '') + '">'
          + '<span class="gv-grade-key">' + escapeHtml(g) + '</span>'
          + '<span class="gv-grade-bar"><span class="gv-grade-fill" style="width:' + pct + '%"></span></span>'
          + '<span class="gv-grade-count">' + tally[g] + '</span>'
          + '</div>';
      });
      gradesHtml += '</div>';

      var metaHtml = '<div class="gv-meta">'
        + '<span>AI grade: <strong>' + escapeHtml(aiGrade) + '</strong></span>'
        + '<span>Consensus: <strong>' + escapeHtml(consensusGrade) + '</strong></span>'
        + '<span>' + totalVotes + ' vote' + (totalVotes !== 1 ? 's' : '') + '</span>'
        + '</div>';

      body.innerHTML = metaHtml + gradesHtml;

      // Push button — gated behind minimum votes / share / rung-distance
      if (!isPromoted) {
        if (gateResult.passed) {
          var pushBtn = document.createElement('button');
          pushBtn.className = 'admin-btn-primary gv-push-btn';
          pushBtn.textContent = 'Push to References as ' + escapeHtml(consensusGrade);
          pushBtn.addEventListener('click', function() {
            pushToReferences(imageId, imageUrl, consensusGrade, tally, totalVotes, card, pushBtn);
          });
          body.appendChild(pushBtn);
        } else {
          var gateNote = document.createElement('div');
          gateNote.className = 'gv-gate-note';
          gateNote.textContent = gateResult.reasons.join(' — ');
          body.appendChild(gateNote);
        }
      } else {
        var badge = document.createElement('div');
        badge.className = 'gv-promoted-badge';
        badge.textContent = '✓ Promoted';
        body.appendChild(badge);
      }

      card.appendChild(body);
      listEl.appendChild(card);
    });

    if (statProm) statProm.textContent = promoted;

    // Wire refresh button
    var refreshBtn = document.getElementById('gv-refresh-btn');
    if (refreshBtn) {
      refreshBtn.onclick = null;
      refreshBtn.addEventListener('click', loadGradingVotesTab);
    }

  } catch(e) {
    listEl.innerHTML = '<div class="admin-empty">Error: ' + escapeHtml(e.message) + '</div>';
  }
}

async function pushToReferences(imageId, imageUrl, consensusGrade, tally, totalVotes, cardEl, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = 'Pushing…';
  try {
    await _db.collection('community_carcasses').add({
      imageUrl:      imageUrl,
      correct:       { qualityGrade: consensusGrade },
      source:        'Crowdsourced — ' + totalVotes + ' votes',
      submittedBy:   'admin',
      submittedAt:   firebase.firestore.FieldValue.serverTimestamp(),
      voteBreakdown: tally,
    });
    await _db.collection('ai_carcasses').doc(imageId).update({ promoted: true });
    cardEl.classList.add('gv-card-promoted');
    btnEl.style.display = 'none';
    var badge = document.createElement('div');
    badge.className = 'gv-promoted-badge';
    badge.textContent = '✓ Promoted as ' + escapeHtml(consensusGrade);
    btnEl.parentNode.appendChild(badge);
    var statProm = document.getElementById('gv-stat-promoted');
    if (statProm) statProm.textContent = String((parseInt(statProm.textContent,10)||0) + 1);
  } catch(e) {
    btnEl.disabled = false;
    btnEl.textContent = 'Push to References as ' + escapeHtml(consensusGrade);
    alert('Push failed: ' + e.message);
  }
}

// ============================================================
//  Analytics Tab
// ============================================================

async function loadAnalyticsTab() {
  var statUsers     = document.getElementById('an-stat-users');
  var statSubs      = document.getElementById('an-stat-subs');
  var statWeek      = document.getElementById('an-stat-week');
  var statCommunity = document.getElementById('an-stat-community');
  var weeksTbody    = document.getElementById('an-weeks-tbody');
  var distEl        = document.getElementById('an-dist');
  var missedTbody   = document.getElementById('an-missed-tbody');
  var contestedTbody = document.getElementById('an-contested-tbody');
  if (!weeksTbody || !window._db) return;

  weeksTbody.innerHTML = '<tr><td colspan="5" class="admin-empty">Loading…</td></tr>';
  missedTbody.innerHTML = '<tr><td colspan="5" class="admin-empty">Loading…</td></tr>';
  contestedTbody.innerHTML = '<tr><td colspan="4" class="admin-empty">Loading…</td></tr>';
  distEl.innerHTML = '<div class="admin-empty">Loading…</div>';

  try {
    // All fetches in parallel; every aggregation is client-side so no
    // composite indexes are ever required (same convention as leaderboard).
    var results = await Promise.all([
      _db.collection('users').get(),
      _db.collection('submissions').get(),
      _db.collection(DB_COLLECTIONS.community_carcasses).get(),
      _db.collection('grading_votes').get(),
    ]);
    var usersSnap = results[0], subsSnap = results[1],
        commSnap  = results[2], votesSnap = results[3];

    var subs = subsSnap.docs.map(function (d) { return d.data(); });
    var currentWeek = getWeekId();

    // ---- Stat chips ----
    if (statUsers)     statUsers.textContent     = String(usersSnap.size);
    if (statSubs)      statSubs.textContent      = String(subsSnap.size);
    if (statCommunity) statCommunity.textContent = String(commSnap.size);
    var thisWeekSubs = subs.filter(function (s) { return s.weekId === currentWeek; });
    if (statWeek) statWeek.textContent = String(thisWeekSubs.length);

    // ---- Weekly participation table ----
    var byWeek = {};
    subs.forEach(function (s) {
      if (!s.weekId) return;
      if (!byWeek[s.weekId]) byWeek[s.weekId] = [];
      byWeek[s.weekId].push(s);
    });
    var weekIds = Object.keys(byWeek).sort().reverse().slice(0, 8);
    if (!weekIds.length) {
      weeksTbody.innerHTML = '<tr><td colspan="5" class="admin-empty">No submissions yet.</td></tr>';
    } else {
      weeksTbody.innerHTML = weekIds.map(function (w) {
        var rows = byWeek[w];
        var ffa  = rows.filter(function (s) { return s.ruleSet === 'ffa'; }).length;
        var col  = rows.length - ffa;
        var pcts = rows.map(function (s) { return typeof s.pct === 'number' ? s.pct : 0; });
        var avg  = Math.round(pcts.reduce(function (a, b) { return a + b; }, 0) / rows.length);
        var top  = Math.max.apply(null, pcts);
        return '<tr>'
          + '<td>' + escapeHtml(formatWeekLabel(w)) + (w === currentWeek ? ' <span class="an-now">now</span>' : '') + '</td>'
          + '<td>' + rows.length + '</td>'
          + '<td>' + ffa + ' / ' + col + '</td>'
          + '<td>' + avg + '%</td>'
          + '<td>' + top + '%</td>'
          + '</tr>';
      }).join('');
    }

    // ---- Score distribution (this week) ----
    var buckets = [
      { label: '90–100%', min: 90,  max: 101 },
      { label: '80–89%',  min: 80,  max: 90 },
      { label: '70–79%',  min: 70,  max: 80 },
      { label: '50–69%',  min: 50,  max: 70 },
      { label: '0–49%',   min: 0,   max: 50 },
    ];
    if (!thisWeekSubs.length) {
      distEl.innerHTML = '<div class="admin-empty">No submissions this week yet.</div>';
    } else {
      distEl.innerHTML = buckets.map(function (b) {
        var count = thisWeekSubs.filter(function (s) { return s.pct >= b.min && s.pct < b.max; }).length;
        var pct = Math.round(count / thisWeekSubs.length * 100);
        return '<div class="an-dist-row">'
          + '<span class="an-dist-label">' + b.label + '</span>'
          + '<span class="an-dist-track"><span class="an-dist-bar" style="width:' + pct + '%"></span></span>'
          + '<span class="an-dist-count">' + count + '</span>'
          + '</div>';
      }).join('');
    }

    // ---- Most-missed carcasses (from per-answer logs) ----
    var nameById = {};
    commSnap.docs.forEach(function (d) {
      var data = d.data();
      nameById[d.id] = data.imageName || d.id;
    });
    var perCarcass = {};
    subs.forEach(function (s) {
      if (!Array.isArray(s.answers)) return;
      s.answers.forEach(function (a) {
        if (!a || !a.carcassId) return;
        if (!perCarcass[a.carcassId]) {
          perCarcass[a.carcassId] = { attempts: 0, misses: 0, ptsSum: 0, correct: a.correct || '' };
        }
        var rec = perCarcass[a.carcassId];
        rec.attempts++;
        rec.ptsSum += (typeof a.pts === 'number' ? a.pts : 0);
        if (a.pts !== 10) rec.misses++;
      });
    });
    var missedIds = Object.keys(perCarcass).filter(function (id) {
      return perCarcass[id].attempts >= 3;
    }).sort(function (a, b) {
      return (perCarcass[b].misses / perCarcass[b].attempts)
           - (perCarcass[a].misses / perCarcass[a].attempts);
    }).slice(0, 10);
    if (!missedIds.length) {
      missedTbody.innerHTML = '<tr><td colspan="5" class="admin-empty">Collecting data — appears as new weekly submissions come in.</td></tr>';
    } else {
      missedTbody.innerHTML = missedIds.map(function (id) {
        var rec = perCarcass[id];
        var gradeLabel = (typeof GRADE_MAP !== 'undefined' && GRADE_MAP[rec.correct])
          ? GRADE_MAP[rec.correct].label : rec.correct;
        return '<tr>'
          + '<td>' + escapeHtml(nameById[id] || id) + '</td>'
          + '<td>' + escapeHtml(gradeLabel) + '</td>'
          + '<td>' + rec.attempts + '</td>'
          + '<td>' + Math.round(rec.misses / rec.attempts * 100) + '%</td>'
          + '<td>' + (rec.ptsSum / rec.attempts).toFixed(1) + '</td>'
          + '</tr>';
      }).join('');
    }

    // ---- Most contested crowdsource images ----
    var votesByImage = {};
    votesSnap.docs.forEach(function (d) {
      var v = d.data();
      if (!v.imageId) return;
      if (!votesByImage[v.imageId]) votesByImage[v.imageId] = [];
      votesByImage[v.imageId].push(v);
    });
    var contested = Object.keys(votesByImage).map(function (id) {
      var votes = votesByImage[id];
      var tally = {};
      votes.forEach(function (v) { tally[v.grade] = (tally[v.grade] || 0) + 1; });
      var top = Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; })[0];
      return {
        id: id,
        total: votes.length,
        leader: top,
        consensus: Math.round(tally[top] / votes.length * 100),
      };
    }).filter(function (r) { return r.total >= 3; })
      .sort(function (a, b) { return a.consensus - b.consensus; })
      .slice(0, 10);
    if (!contested.length) {
      contestedTbody.innerHTML = '<tr><td colspan="4" class="admin-empty">Not enough votes yet (min 3 per image).</td></tr>';
    } else {
      contestedTbody.innerHTML = contested.map(function (r) {
        var gradeLabel = (typeof GRADE_MAP !== 'undefined' && GRADE_MAP[r.leader])
          ? GRADE_MAP[r.leader].label : r.leader;
        return '<tr>'
          + '<td>' + escapeHtml(r.id) + '</td>'
          + '<td>' + r.total + '</td>'
          + '<td>' + escapeHtml(gradeLabel) + '</td>'
          + '<td>' + r.consensus + '%</td>'
          + '</tr>';
      }).join('');
    }
  } catch (e) {
    weeksTbody.innerHTML = '<tr><td colspan="5" class="admin-empty">Failed to load analytics: ' + escapeHtml(e.message) + '</td></tr>';
    distEl.innerHTML = '';
    missedTbody.innerHTML = '<tr><td colspan="5" class="admin-empty">—</td></tr>';
    contestedTbody.innerHTML = '<tr><td colspan="4" class="admin-empty">—</td></tr>';
  }
}

// ============================================================
//  Power Rankings Tab — meat_contests
// ============================================================

var PR_COLLECTION = 'meat_contests';

var PR_CATEGORIES = [
  { key: 'beefGrading',    label: 'Beef Grading' },
  { key: 'beefJudging',    label: 'Beef Judging' },
  { key: 'lambJudging',    label: 'Lamb Judging' },
  { key: 'porkJudging',    label: 'Pork Judging' },
  { key: 'specifications', label: 'Specifications' },
  { key: 'overallBeef',    label: 'Overall Beef' },
  { key: 'totalPlacings',  label: 'Total Placings' },
  { key: 'reasons',        label: 'Reasons' }
];

var _prContests = [];        // cache: [{ slug, data }] of existing meat_contests docs
var _prParsedImport = null;  // { doc, slug } awaiting import confirmation
var _prEditingSlug = null;   // original docId when a contest is loaded into the form
var _prRowSeq = 0;           // unique ids for category panels (aria-controls)

// ---------- slug ----------

function prKebab(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function prBuildSlug(doc) {
  return doc.date + '_' + prKebab(doc.shortName) + '_' + doc.division;
}

function prUpdateSlugPreview() {
  var el = document.getElementById('pr-slug-preview');
  if (!el) return;
  var shortName = (document.getElementById('pr-form-shortname') || {}).value || '';
  var date      = (document.getElementById('pr-form-date') || {}).value || '';
  var division  = (document.getElementById('pr-form-division') || {}).value || 'senior';
  if (!shortName.trim() || !date) {
    el.textContent = '—';
    return;
  }
  el.textContent = date + '_' + prKebab(shortName) + '_' + division;
}

// ---------- validation ----------

// Validates a raw contest object (from JSON import or the manual form).
// Returns { errors: [String], doc: normalizedDoc|null }. The normalized doc
// contains only schema fields — unknown keys are dropped.
function prValidateContest(raw) {
  var errors = [];
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: ['Root must be a single JSON object (one contest doc).'], doc: null };
  }

  var name = typeof raw.name === 'string' ? raw.name.replace(/\s+/g, ' ').trim() : '';
  if (!name || name.length > 200) errors.push('name: required string, 1–200 chars.');

  var shortName = typeof raw.shortName === 'string' ? raw.shortName.replace(/\s+/g, ' ').trim() : '';
  if (!shortName || shortName.length > 60) errors.push('shortName: required string, 1–60 chars.');

  var date = typeof raw.date === 'string' ? raw.date.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + 'T00:00:00Z').getTime())) {
    errors.push('date: required ISO string yyyy-mm-dd.');
  }

  var season = raw.season;
  if (season === undefined || season === null || season === '') {
    season = /^\d{4}/.test(date) ? parseInt(date.slice(0, 4), 10) : NaN; // derive from date
  }
  if (!isInt(season) || season < 1990 || season > 2100) {
    errors.push('season: integer year 1990–2100 (derived from date when omitted).');
  }

  var division = raw.division;
  if (division !== 'senior' && division !== 'junior') {
    errors.push('division: must be "senior" or "junior".');
  }

  var weight = (raw.weight === undefined || raw.weight === null || raw.weight === '') ? 1 : raw.weight;
  if (typeof weight !== 'number' || !isFinite(weight) || weight < 1 || weight > 2) {
    errors.push('weight: number between 1 and 2 (default 1).');
  }

  var sourceUrl = raw.sourceUrl;
  if (sourceUrl === undefined || sourceUrl === null || sourceUrl === '') {
    sourceUrl = '';
  } else if (typeof sourceUrl !== 'string' || sourceUrl.indexOf('https://') !== 0 || sourceUrl.length > 500) {
    errors.push('sourceUrl: optional, but must start with https:// (max 500 chars) when present.');
    sourceUrl = '';
  }

  if (!Array.isArray(raw.results) || raw.results.length < 1 || raw.results.length > 80) {
    errors.push('results: required array of 1–80 team rows.');
  }

  var results = [];
  if (Array.isArray(raw.results)) {
    // Oversized arrays already errored above — validate only the first 81 rows
    // so a huge paste can't build hundreds of thousands of error strings.
    raw.results.slice(0, 81).forEach(function (r, i) {
      var rowLabel = 'results[' + i + ']';
      if (!r || typeof r !== 'object' || Array.isArray(r)) {
        errors.push(rowLabel + ': must be an object.');
        return;
      }
      var school = typeof r.school === 'string' ? r.school.replace(/\s+/g, ' ').trim() : '';
      if (!school || school.length > 120) errors.push(rowLabel + '.school: required string, 1–120 chars.');
      if (!isInt(r.place) || r.place < 1) errors.push(rowLabel + '.place: required integer ≥ 1.');

      var row = { school: school, place: r.place };
      if (r.score !== undefined && r.score !== null && r.score !== '') {
        if (typeof r.score !== 'number' || !isFinite(r.score)) {
          errors.push(rowLabel + '.score: must be a number when present.');
        } else {
          row.score = r.score;
        }
      }

      if (r.categories !== undefined && r.categories !== null) {
        if (typeof r.categories !== 'object' || Array.isArray(r.categories)) {
          errors.push(rowLabel + '.categories: must be an object map.');
        } else {
          var cats = {};
          Object.keys(r.categories).forEach(function (k) {
            var known = PR_CATEGORIES.some(function (c) { return c.key === k; });
            if (!known) { errors.push(rowLabel + '.categories.' + k + ': unknown category key.'); return; }
            var c = r.categories[k];
            if (!c || typeof c !== 'object' || Array.isArray(c)) {
              errors.push(rowLabel + '.categories.' + k + ': must be an object {place, score}.');
              return;
            }
            if (!isInt(c.place) || c.place < 1) {
              errors.push(rowLabel + '.categories.' + k + '.place: integer ≥ 1 required.');
              return;
            }
            var entry = { place: c.place };
            if (c.score !== undefined && c.score !== null && c.score !== '') {
              if (typeof c.score !== 'number' || !isFinite(c.score)) {
                errors.push(rowLabel + '.categories.' + k + '.score: must be a number when present.');
              } else {
                entry.score = c.score;
              }
            }
            cats[k] = entry;
          });
          if (Object.keys(cats).length) row.categories = cats;
        }
      }
      results.push(row);
    });
  }

  var teamCount = raw.teamCount;
  if (teamCount === undefined || teamCount === null || teamCount === '') teamCount = results.length;
  if (!isInt(teamCount) || teamCount < 1) {
    errors.push('teamCount: integer > 0 (defaults to results length when omitted).');
  } else if (Array.isArray(raw.results) && teamCount < raw.results.length) {
    errors.push('teamCount: cannot be smaller than the number of result rows.');
  }

  if (errors.length) return { errors: errors, doc: null };

  var doc = {
    name: name,
    shortName: shortName,
    date: date,
    season: season,
    division: division,
    weight: weight,
    teamCount: teamCount,
    results: results
  };
  if (sourceUrl) doc.sourceUrl = sourceUrl;
  return { errors: [], doc: doc };
}

// ---------- school-name consistency ----------

// Shared case/whitespace-insensitive normalization used to match school
// names both against the cross-contest consistency check and against the
// ingest script's transient altOnlySchools hint below.
function prNormSchool(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Compares incoming school names against every school name already stored in
// meat_contests (cached in _prContests). Warns — never blocks — when a
// case/whitespace-insensitive match differs in exact spelling, since the
// rankings engine joins on exact strings. Also flags duplicate schools within
// the incoming contest.
function prSchoolWarnings(doc, excludeSlug) {
  var norm = prNormSchool;
  var existing = {}; // normKey -> { name, contest }
  _prContests.forEach(function (c) {
    if (excludeSlug && c.slug === excludeSlug) return;
    var rows = (c.data && Array.isArray(c.data.results)) ? c.data.results : [];
    rows.forEach(function (r) {
      if (!r || typeof r.school !== 'string') return;
      var key = norm(r.school);
      if (!existing[key]) existing[key] = { name: r.school, contest: (c.data.shortName || c.slug) };
    });
  });

  var warnings = [];
  var seen = {};
  doc.results.forEach(function (r) {
    var key = norm(r.school);
    if (seen[key]) {
      warnings.push('Duplicate school in this contest: "' + r.school + '" — enter only the highest-placing team per school.');
    }
    seen[key] = true;
    var match = existing[key];
    if (match && match.name !== r.school) {
      warnings.push('Spelling mismatch: incoming "' + r.school + '" vs existing "' + match.name + '" (in ' + match.contest + '). Rankings join on exact strings — consider matching the existing spelling.');
    }
  });
  return warnings;
}

// ---------- Firestore write ----------

// Writes a contest doc at the given slug. Reads the doc first so an overwrite
// keeps the original createdAt; updatedAt is always a fresh server timestamp.
function prWriteContest(doc, slug) {
  var ref = _db.collection(PR_COLLECTION).doc(slug);
  return ref.get().then(function (snap) {
    var payload = Object.assign({}, doc);
    // Defense in depth: altOnlySchools is a transient import-time hint from
    // the ingest script (never part of the meat_contests schema) and must
    // never reach Firestore, regardless of which rows the admin excluded/kept.
    // prValidateContest() already never copies it into doc, so this is belt
    // and suspenders — but explicit, so a future doc-building change can't
    // silently leak it.
    delete payload.altOnlySchools;
    payload.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    payload.createdAt = (snap.exists && snap.data() && snap.data().createdAt)
      ? snap.data().createdAt
      : firebase.firestore.FieldValue.serverTimestamp();
    return ref.set(payload);
  });
}

function prIsAdmin() {
  return !!(_currentUser && _currentUser.uid === ADMIN_UID);
}

function prSetStatus(el, msg, kind) {
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'pr-status' + (kind === 'ok' ? ' pr-status-ok' : (kind === 'error' ? ' pr-status-error' : ''));
}

// ---------- load / manage ----------

function loadPowerrankTab() {
  var tbody = document.getElementById('pr-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="admin-empty">Loading…</td></tr>';

  _db.collection(PR_COLLECTION)
    .orderBy('date', 'desc')
    .get()
    .then(function (snap) {
      _prContests = snap.docs.map(function (d) { return { slug: d.id, data: d.data() }; });
      prRenderManageTable();
    })
    .catch(function (err) {
      if (tbody) {
        tbody.innerHTML = '';
        var tr = document.createElement('tr');
        var td = document.createElement('td');
        td.colSpan = 5;
        td.className = 'admin-empty';
        td.textContent = 'Error loading contests: ' + err.message;
        tr.appendChild(td);
        tbody.appendChild(tr);
      }
      console.error('[admin] loadPowerrankTab error:', err);
    });
}

function prRenderManageTable() {
  var tbody = document.getElementById('pr-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!_prContests.length) {
    var trEmpty = document.createElement('tr');
    var tdEmpty = document.createElement('td');
    tdEmpty.colSpan = 5;
    tdEmpty.className = 'admin-empty';
    tdEmpty.textContent = 'No contests yet — import or enter one above.';
    trEmpty.appendChild(tdEmpty);
    tbody.appendChild(trEmpty);
    return;
  }

  _prContests.forEach(function (c) {
    var d = c.data || {};
    var tr = document.createElement('tr');

    var tdName = document.createElement('td');
    tdName.className = 'admin-td-name';
    tdName.textContent = d.name || c.slug;
    tr.appendChild(tdName);

    var tdDate = document.createElement('td');
    tdDate.className = 'admin-td-date';
    tdDate.textContent = d.date || '—';
    tr.appendChild(tdDate);

    var tdDiv = document.createElement('td');
    tdDiv.textContent = d.division === 'junior' ? 'Junior' : (d.division === 'senior' ? 'Senior' : '—');
    tr.appendChild(tdDiv);

    var tdTeams = document.createElement('td');
    tdTeams.textContent = String(typeof d.teamCount === 'number' ? d.teamCount : (Array.isArray(d.results) ? d.results.length : 0));
    tr.appendChild(tdTeams);

    var tdActions = document.createElement('td');
    tdActions.className = 'admin-td-actions pr-td-actions';

    var editBtn = document.createElement('button');
    editBtn.className = 'admin-btn-secondary admin-btn-sm';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', function () {
      prLoadIntoForm(c);
    });

    var delBtn = document.createElement('button');
    delBtn.className = 'admin-btn-danger admin-btn-sm';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', function () {
      if (!prIsAdmin()) { alert('Admin access required.'); return; }
      if (!confirm('Delete contest "' + (d.name || c.slug) + '"?\nIt will be removed from the power rankings. This cannot be undone.')) return;
      _db.collection(PR_COLLECTION).doc(c.slug).delete()
        .then(function () {
          if (_prEditingSlug === c.slug) prResetForm();
          loadPowerrankTab();
        })
        .catch(function (err) { alert('Error deleting contest: ' + err.message); });
    });

    tdActions.appendChild(editBtn);
    tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  });
}

// ---------- import ----------

function prClearImport() {
  var ta = document.getElementById('pr-import-json');
  if (ta) ta.value = '';
  prSetStatus(document.getElementById('pr-import-status'), '');
  var preview = document.getElementById('pr-import-preview');
  if (preview) { preview.innerHTML = ''; preview.classList.add('hidden'); }
  _prParsedImport = null;
}

function prPreviewImport() {
  var ta       = document.getElementById('pr-import-json');
  var statusEl = document.getElementById('pr-import-status');
  var preview  = document.getElementById('pr-import-preview');
  _prParsedImport = null;
  if (preview) { preview.innerHTML = ''; preview.classList.add('hidden'); }

  if (!ta || !ta.value.trim()) {
    prSetStatus(statusEl, 'Paste a contest JSON doc first.', 'error');
    return;
  }

  var raw;
  try {
    raw = JSON.parse(ta.value.trim());
  } catch (e) {
    prSetStatus(statusEl, 'Invalid JSON: ' + e.message, 'error');
    return;
  }

  var v = prValidateContest(raw);
  if (v.errors.length) {
    prSetStatus(statusEl, v.errors.length + ' validation error' + (v.errors.length !== 1 ? 's' : '') + ' — nothing written.', 'error');
    if (preview) {
      preview.classList.remove('hidden');
      preview.appendChild(prBuildMessageList('Validation Errors', v.errors, 'pr-error-list'));
    }
    return;
  }

  var doc  = v.doc;
  var slug = prBuildSlug(doc);
  var overwriting = _prContests.some(function (c) { return c.slug === slug; });
  var warnings = prSchoolWarnings(doc, overwriting ? slug : null);

  // altOnlySchools is a transient, import-only hint from the ingest script —
  // NOT part of the meat_contests schema (prValidateContest never copies it
  // into doc). It lists schools where every raw judgingcard.com entry that
  // collapsed into that school was an "Alt N" row, so the captured place/score
  // may reflect one individual, not the full team. Flag the matching result
  // rows for admin review; the array itself is discarded after this preview.
  var rawAltOnly = Array.isArray(raw.altOnlySchools)
    ? raw.altOnlySchools.filter(function (s) { return typeof s === 'string' && s.trim(); })
    : [];
  var altOnlySet = {};
  rawAltOnly.forEach(function (s) { altOnlySet[prNormSchool(s)] = true; });
  var flagged = [];
  doc.results.forEach(function (r, i) { if (altOnlySet[prNormSchool(r.school)]) flagged.push(i); });

  _prParsedImport = { doc: doc, slug: slug, altOnlySchools: rawAltOnly, flagged: flagged };

  prSetStatus(statusEl, 'Parsed OK — review the preview, then confirm.', 'ok');
  if (!preview) return;
  preview.classList.remove('hidden');

  // Summary grid
  var grid = document.createElement('div');
  grid.className = 'pr-preview-grid';
  var top3 = doc.results.slice().sort(function (a, b) { return a.place - b.place; }).slice(0, 3);
  var items = [
    ['Contest', doc.name],
    ['Date', doc.date],
    ['Division', doc.division === 'junior' ? 'Junior College' : 'Senior College'],
    ['Teams', String(doc.teamCount) + ' (' + doc.results.length + ' rows)'],
    ['Season / Weight', doc.season + ' / ' + doc.weight],
    ['Doc ID', slug]
  ];
  items.forEach(function (pair) {
    var item = document.createElement('div');
    item.className = 'pr-preview-item';
    var lab = document.createElement('span');
    lab.className = 'pr-preview-label';
    lab.textContent = pair[0];
    var val = document.createElement('span');
    val.className = 'pr-preview-value';
    val.textContent = pair[1];
    item.appendChild(lab);
    item.appendChild(val);
    grid.appendChild(item);
  });
  preview.appendChild(grid);

  // Top 3
  var top3Wrap = document.createElement('div');
  var top3Label = document.createElement('span');
  top3Label.className = 'pr-preview-label';
  top3Label.textContent = 'Top 3';
  top3Wrap.appendChild(top3Label);
  var ol = document.createElement('ol');
  ol.className = 'pr-preview-top3';
  top3.forEach(function (r) {
    var li = document.createElement('li');
    li.textContent = r.place + '. ' + r.school + (typeof r.score === 'number' ? ' — ' + r.score : '');
    ol.appendChild(li);
  });
  top3Wrap.appendChild(ol);
  preview.appendChild(top3Wrap);

  // School-name warnings (non-blocking)
  if (warnings.length) {
    preview.appendChild(prBuildMessageList('School-Name Warnings (non-blocking)', warnings, 'pr-warning-inner'));
  }

  // Alt-squad-only rows (non-blocking) — per-row badge + editable place/score
  // + an explicit exclude toggle, resolved by prApplyAltRowEdits() when the
  // admin confirms. Keep-as-is (the default) preserves today's behavior.
  var altBlock = null;
  if (flagged.length) {
    altBlock = prBuildAltOnlyBlock(doc, flagged);
    preview.appendChild(altBlock);
  }

  if (overwriting) {
    var note = document.createElement('div');
    note.className = 'pr-overwrite-note';
    note.textContent = 'A doc with this ID already exists — confirming will overwrite it (createdAt is preserved).';
    preview.appendChild(note);
  }

  // Confirm button
  var actions = document.createElement('div');
  actions.className = 'pr-form-actions';
  var confirmBtn = document.createElement('button');
  confirmBtn.className = 'admin-btn-primary';
  confirmBtn.textContent = overwriting ? 'Confirm Overwrite' : 'Confirm Import';
  var confirmStatus = document.createElement('span');
  confirmStatus.className = 'pr-status';
  confirmStatus.setAttribute('role', 'status');
  confirmBtn.addEventListener('click', function () {
    if (altBlock && !prApplyAltRowEdits(altBlock, _prParsedImport.doc)) {
      prSetStatus(confirmStatus, 'Cannot exclude every row — a contest needs at least 1 result.', 'error');
      return;
    }
    prConfirmImport(confirmBtn, confirmStatus);
  });
  actions.appendChild(confirmBtn);
  actions.appendChild(confirmStatus);

  // Only useful when there's something flagged to resolve with the full
  // manual-entry toolkit (per-row remove already exists there).
  if (flagged.length) {
    var editInFormBtn = document.createElement('button');
    editInFormBtn.className = 'admin-btn-secondary';
    editInFormBtn.textContent = 'Edit in Manual Form First';
    editInFormBtn.addEventListener('click', function () {
      if (altBlock) prApplyAltRowEdits(altBlock, _prParsedImport.doc);
      prLoadParsedImportIntoForm(_prParsedImport);
    });
    actions.appendChild(editInFormBtn);
  }

  preview.appendChild(actions);
}

// Builds the "Alt-Squad-Only Schools" review block for the import preview.
// Each flagged row gets a badge, editable place/score inputs (pre-filled with
// the parsed value), and an "Exclude from this contest" checkbox. Reads back
// via prApplyAltRowEdits() at confirm time.
function prBuildAltOnlyBlock(doc, flagged) {
  var wrap = document.createElement('div');
  wrap.className = 'pr-warning-list pr-altonly-block';

  var heading = document.createElement('span');
  heading.className = 'pr-warning-title';
  heading.textContent = 'Alt-Squad-Only Schools — Review Before Saving';
  wrap.appendChild(heading);

  var desc = document.createElement('p');
  desc.className = 'pr-altonly-desc';
  desc.textContent = 'judgingcard.com had no varsity-named entry for these schools — every raw row that collapsed into them was an "Alt N" squad, so the captured place/score may reflect one individual rather than the full team. Edit the numbers, exclude the row, or keep as-is.';
  wrap.appendChild(desc);

  var list = document.createElement('div');
  list.className = 'pr-altonly-rows';

  flagged.forEach(function (idx) {
    var r = doc.results[idx];
    var row = document.createElement('div');
    row.className = 'pr-altonly-row';
    row.dataset.rowIndex = String(idx);

    var head = document.createElement('div');
    head.className = 'pr-altonly-row-head';
    var name = document.createElement('span');
    name.className = 'pr-altonly-school';
    name.textContent = r.school;
    var badge = document.createElement('span');
    badge.className = 'pr-alt-badge';
    badge.textContent = '⚠ unverified — alt squad only';
    head.appendChild(name);
    head.appendChild(badge);
    row.appendChild(head);

    var fields = document.createElement('div');
    fields.className = 'pr-altonly-fields';

    var placeLabel = document.createElement('label');
    placeLabel.className = 'pr-altonly-field';
    var placeSpan = document.createElement('span');
    placeSpan.textContent = 'Place';
    var placeInput = document.createElement('input');
    placeInput.type = 'number';
    placeInput.min = '1';
    placeInput.step = '1';
    placeInput.className = 'pr-altrow-place';
    placeInput.value = String(r.place);
    placeInput.setAttribute('aria-label', r.school + ' place');
    placeLabel.appendChild(placeSpan);
    placeLabel.appendChild(placeInput);

    var scoreLabel = document.createElement('label');
    scoreLabel.className = 'pr-altonly-field';
    var scoreSpan = document.createElement('span');
    scoreSpan.textContent = 'Score';
    var scoreInput = document.createElement('input');
    scoreInput.type = 'number';
    scoreInput.step = 'any';
    scoreInput.className = 'pr-altrow-score';
    if (typeof r.score === 'number') scoreInput.value = String(r.score);
    scoreInput.setAttribute('aria-label', r.school + ' score');
    scoreLabel.appendChild(scoreSpan);
    scoreLabel.appendChild(scoreInput);

    var excludeLabel = document.createElement('label');
    excludeLabel.className = 'pr-altonly-exclude';
    var excludeCb = document.createElement('input');
    excludeCb.type = 'checkbox';
    excludeCb.className = 'pr-altrow-exclude';
    excludeCb.setAttribute('aria-label', 'Exclude ' + r.school + ' from this contest');
    var excludeText = document.createElement('span');
    excludeText.textContent = 'Exclude from this contest';
    excludeLabel.appendChild(excludeCb);
    excludeLabel.appendChild(excludeText);

    fields.appendChild(placeLabel);
    fields.appendChild(scoreLabel);
    fields.appendChild(excludeLabel);
    row.appendChild(fields);

    list.appendChild(row);
  });

  wrap.appendChild(list);
  return wrap;
}

// Applies whatever the admin did in the alt-only block (place/score edits,
// or exclude) back onto doc.results in place. Returns false (and leaves doc
// untouched) if every flagged row was excluded and nothing remains, so the
// caller can block the write instead of saving a contest with zero results.
function prApplyAltRowEdits(container, doc) {
  var rows = container.querySelectorAll('.pr-altonly-row');
  var excludedIdx = {};
  Array.prototype.forEach.call(rows, function (rowEl) {
    var idx = parseInt(rowEl.dataset.rowIndex, 10);
    if (!isFinite(idx) || !doc.results[idx]) return;
    var placeEl   = rowEl.querySelector('.pr-altrow-place');
    var scoreEl   = rowEl.querySelector('.pr-altrow-score');
    var excludeEl = rowEl.querySelector('.pr-altrow-exclude');

    if (excludeEl && excludeEl.checked) { excludedIdx[idx] = true; return; }

    if (placeEl && placeEl.value !== '') {
      var p = parseInt(placeEl.value, 10);
      if (isFinite(p) && p >= 1) doc.results[idx].place = p;
    }
    if (scoreEl) {
      if (scoreEl.value === '') {
        delete doc.results[idx].score;
      } else {
        var s = parseFloat(scoreEl.value);
        if (isFinite(s)) doc.results[idx].score = s;
      }
    }
  });

  var excludedCount = Object.keys(excludedIdx).length;
  if (!excludedCount) return true;

  var kept = doc.results.filter(function (_, i) { return !excludedIdx[i]; });
  if (!kept.length) return false;

  doc.results = kept;
  if (typeof doc.teamCount === 'number') {
    doc.teamCount = Math.max(doc.results.length, doc.teamCount - excludedCount);
  }
  return true;
}

function prConfirmImport(btn, statusEl) {
  if (!_prParsedImport) { prSetStatus(statusEl, 'Nothing parsed — run Parse & Preview again.', 'error'); return; }
  if (!prIsAdmin()) { prSetStatus(statusEl, 'Admin access required.', 'error'); return; }

  var slug = _prParsedImport.slug;
  var doc  = _prParsedImport.doc;
  if (btn) btn.disabled = true;
  prSetStatus(statusEl, 'Writing…');

  prWriteContest(doc, slug)
    .then(function () {
      prClearImport();
      prSetStatus(document.getElementById('pr-import-status'), 'Imported ' + slug + '.', 'ok');
      loadPowerrankTab();
    })
    .catch(function (err) {
      if (btn) btn.disabled = false;
      prSetStatus(statusEl, 'Error: ' + err.message, 'error');
      console.error('[admin] prConfirmImport error:', err);
    });
}

// Builds a titled message list (errors or warnings) using textContent only.
function prBuildMessageList(title, messages, extraClass) {
  var wrap = document.createElement('div');
  wrap.className = 'pr-warning-list' + (extraClass ? ' ' + extraClass : '');
  var heading = document.createElement('span');
  heading.className = 'pr-warning-title';
  heading.textContent = title;
  wrap.appendChild(heading);
  var ul = document.createElement('ul');
  var MAX_SHOWN = 50; // defense in depth — never render an unbounded list
  messages.slice(0, MAX_SHOWN).forEach(function (m) {
    var li = document.createElement('li');
    li.textContent = m;
    ul.appendChild(li);
  });
  if (messages.length > MAX_SHOWN) {
    var more = document.createElement('li');
    more.textContent = '…and ' + (messages.length - MAX_SHOWN) + ' more.';
    ul.appendChild(more);
  }
  wrap.appendChild(ul);
  return wrap;
}

// ---------- manual entry ----------

function prBuildTeamRow(data, isAltOnly) {
  _prRowSeq++;
  var panelId = 'pr-cat-panel-' + _prRowSeq;

  var row = document.createElement('div');
  row.className = 'pr-team-row';

  var main = document.createElement('div');
  main.className = 'pr-team-main';

  var schoolInput = document.createElement('input');
  schoolInput.type = 'text';
  schoolInput.className = 'pr-row-school';
  schoolInput.placeholder = 'School (e.g. Oklahoma State University)';
  schoolInput.maxLength = 120;
  schoolInput.setAttribute('aria-label', 'School name');
  if (data && data.school) schoolInput.value = data.school;

  var placeInput = document.createElement('input');
  placeInput.type = 'number';
  placeInput.className = 'pr-row-place';
  placeInput.min = '1';
  placeInput.step = '1';
  placeInput.placeholder = 'Place';
  placeInput.setAttribute('aria-label', 'Overall place');
  if (data && typeof data.place === 'number') placeInput.value = String(data.place);

  var scoreInput = document.createElement('input');
  scoreInput.type = 'number';
  scoreInput.className = 'pr-row-score';
  scoreInput.step = 'any';
  scoreInput.placeholder = 'Score';
  scoreInput.setAttribute('aria-label', 'Overall score (optional)');
  if (data && typeof data.score === 'number') scoreInput.value = String(data.score);

  var hasCats = !!(data && data.categories && Object.keys(data.categories).length);
  var catsBtn = document.createElement('button');
  catsBtn.type = 'button';
  catsBtn.className = 'admin-btn-secondary admin-btn-sm pr-row-cats-toggle';
  catsBtn.textContent = hasCats ? 'Categories (' + Object.keys(data.categories).length + ')' : 'Categories';
  catsBtn.setAttribute('aria-expanded', 'false');
  catsBtn.setAttribute('aria-controls', panelId);

  var removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'admin-btn-danger admin-btn-sm pr-row-remove';
  removeBtn.innerHTML = '&times;';
  removeBtn.setAttribute('aria-label', 'Remove team row');
  removeBtn.addEventListener('click', function () {
    if (schoolInput.value.trim() && !confirm('Remove the row for "' + schoolInput.value.trim() + '"?')) return;
    row.remove();
  });

  main.appendChild(schoolInput);
  if (isAltOnly) {
    var altBadge = document.createElement('span');
    altBadge.className = 'pr-alt-badge pr-alt-badge-row';
    altBadge.textContent = '⚠ unverified — alt squad only';
    main.appendChild(altBadge);
  }
  main.appendChild(placeInput);
  main.appendChild(scoreInput);
  main.appendChild(catsBtn);
  main.appendChild(removeBtn);
  row.appendChild(main);

  var panel = document.createElement('div');
  panel.className = 'pr-cat-panel hidden';
  panel.id = panelId;

  var catGrid = document.createElement('div');
  catGrid.className = 'pr-cat-grid';
  PR_CATEGORIES.forEach(function (cat) {
    var group = document.createElement('div');
    group.className = 'pr-cat-group';

    var lab = document.createElement('span');
    lab.className = 'pr-cat-label';
    lab.textContent = cat.label;

    var cp = document.createElement('input');
    cp.type = 'number';
    cp.className = 'pr-cat-place';
    cp.min = '1';
    cp.step = '1';
    cp.placeholder = 'Pl';
    cp.dataset.cat = cat.key;
    cp.dataset.kind = 'place';
    cp.setAttribute('aria-label', cat.label + ' place');

    var cs = document.createElement('input');
    cs.type = 'number';
    cs.className = 'pr-cat-score';
    cs.step = 'any';
    cs.placeholder = 'Score';
    cs.dataset.cat = cat.key;
    cs.dataset.kind = 'score';
    cs.setAttribute('aria-label', cat.label + ' score');

    if (data && data.categories && data.categories[cat.key]) {
      var entry = data.categories[cat.key];
      if (typeof entry.place === 'number') cp.value = String(entry.place);
      if (typeof entry.score === 'number') cs.value = String(entry.score);
    }

    group.appendChild(lab);
    group.appendChild(cp);
    group.appendChild(cs);
    catGrid.appendChild(group);
  });
  panel.appendChild(catGrid);
  row.appendChild(panel);

  catsBtn.addEventListener('click', function () {
    var open = panel.classList.toggle('hidden') === false;
    catsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  return row;
}

// Reads the manual form into a raw contest object (same shape as import JSON).
function prCollectFormRaw() {
  function num(id) {
    var el = document.getElementById(id);
    if (!el || el.value === '') return undefined;
    var n = parseFloat(el.value);
    return isFinite(n) ? n : NaN;
  }
  function txt(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }

  var raw = {
    name: txt('pr-form-name'),
    shortName: txt('pr-form-shortname'),
    date: txt('pr-form-date'),
    division: txt('pr-form-division')
  };
  var season = num('pr-form-season');
  if (season !== undefined) raw.season = season;
  var weight = num('pr-form-weight');
  if (weight !== undefined) raw.weight = weight;
  var sourceUrl = txt('pr-form-sourceurl').trim();
  if (sourceUrl) raw.sourceUrl = sourceUrl;

  var results = [];
  var rowsEl = document.getElementById('pr-team-rows');
  var rowEls = rowsEl ? rowsEl.querySelectorAll('.pr-team-row') : [];
  Array.prototype.forEach.call(rowEls, function (rowEl) {
    var schoolEl = rowEl.querySelector('.pr-row-school');
    var placeEl  = rowEl.querySelector('.pr-row-place');
    var scoreEl  = rowEl.querySelector('.pr-row-score');
    var school = schoolEl ? schoolEl.value.trim() : '';
    var placeStr = placeEl ? placeEl.value : '';
    var scoreStr = scoreEl ? scoreEl.value : '';

    // Skip rows the admin left completely empty
    var anyCat = false;
    var catInputs = rowEl.querySelectorAll('.pr-cat-place, .pr-cat-score');
    Array.prototype.forEach.call(catInputs, function (inp) { if (inp.value !== '') anyCat = true; });
    if (!school && placeStr === '' && scoreStr === '' && !anyCat) return;

    var r = { school: school };
    if (placeStr !== '') r.place = parseFloat(placeStr);
    if (scoreStr !== '') r.score = parseFloat(scoreStr);

    var categories = {};
    PR_CATEGORIES.forEach(function (cat) {
      var cp = rowEl.querySelector('.pr-cat-place[data-cat="' + cat.key + '"]');
      var cs = rowEl.querySelector('.pr-cat-score[data-cat="' + cat.key + '"]');
      var pVal = cp && cp.value !== '' ? parseFloat(cp.value) : undefined;
      var sVal = cs && cs.value !== '' ? parseFloat(cs.value) : undefined;
      if (pVal === undefined && sVal === undefined) return;
      var entry = {};
      if (pVal !== undefined) entry.place = pVal;
      if (sVal !== undefined) entry.score = sVal;
      categories[cat.key] = entry;
    });
    if (Object.keys(categories).length) r.categories = categories;

    results.push(r);
  });
  raw.results = results;
  return raw;
}

function prSaveManual() {
  var statusEl   = document.getElementById('pr-form-status');
  var warningsEl = document.getElementById('pr-form-warnings');
  var saveBtn    = document.getElementById('pr-form-save-btn');
  if (warningsEl) { warningsEl.innerHTML = ''; warningsEl.classList.add('hidden'); }
  prSetStatus(statusEl, '');

  if (!prIsAdmin()) { prSetStatus(statusEl, 'Admin access required.', 'error'); return; }

  var raw = prCollectFormRaw();
  var v = prValidateContest(raw);
  if (v.errors.length) {
    prSetStatus(statusEl, 'Fix ' + v.errors.length + ' validation error' + (v.errors.length !== 1 ? 's' : '') + ' — nothing saved.', 'error');
    if (warningsEl) {
      warningsEl.classList.remove('hidden');
      warningsEl.appendChild(prBuildMessageList('Validation Errors', v.errors, 'pr-error-list'));
    }
    return;
  }

  var doc  = v.doc;
  var slug = prBuildSlug(doc);

  // School-name consistency check (non-blocking) — shown before the write
  var warnings = prSchoolWarnings(doc, _prEditingSlug || slug);
  if (warnings.length && warningsEl) {
    warningsEl.classList.remove('hidden');
    warningsEl.appendChild(prBuildMessageList('School-Name Warnings (saving anyway)', warnings, 'pr-warning-inner'));
  }

  // Overwriting a doc we did not load for editing needs an explicit OK
  var exists = _prContests.some(function (c) { return c.slug === slug; });
  if (exists && slug !== _prEditingSlug) {
    if (!confirm('A contest doc already exists at\n' + slug + '\nOverwrite it?')) return;
  }

  var renamedFrom = (_prEditingSlug && _prEditingSlug !== slug) ? _prEditingSlug : null;

  if (saveBtn) saveBtn.disabled = true;
  prSetStatus(statusEl, 'Saving…');

  prWriteContest(doc, slug)
    .then(function () {
      // If editing changed date/shortName/division, the docId changed too —
      // offer to remove the doc under the old id so it is not double-counted.
      if (renamedFrom && confirm('Contest ID changed:\n' + renamedFrom + ' → ' + slug + '\nDelete the old doc so the contest is not counted twice?')) {
        return _db.collection(PR_COLLECTION).doc(renamedFrom).delete();
      }
    })
    .then(function () {
      if (saveBtn) saveBtn.disabled = false;
      prResetForm();
      prSetStatus(statusEl, 'Saved ' + slug + (warnings.length ? ' (with ' + warnings.length + ' school-name warning' + (warnings.length !== 1 ? 's' : '') + ')' : '') + '.', 'ok');
      loadPowerrankTab();
    })
    .catch(function (err) {
      if (saveBtn) saveBtn.disabled = false;
      prSetStatus(statusEl, 'Error saving: ' + err.message, 'error');
      console.error('[admin] prSaveManual error:', err);
    });
}

function prLoadIntoForm(contest) {
  var d = contest.data || {};
  _prEditingSlug = contest.slug;

  var banner = document.getElementById('pr-editing-banner');
  var slugEl = document.getElementById('pr-editing-slug');
  if (slugEl) slugEl.textContent = contest.slug;
  if (banner) banner.classList.remove('hidden');

  function setVal(id, v) {
    var el = document.getElementById(id);
    if (el) el.value = (v === undefined || v === null) ? '' : String(v);
  }
  setVal('pr-form-name', d.name);
  setVal('pr-form-shortname', d.shortName);
  setVal('pr-form-date', d.date);
  setVal('pr-form-season', d.season);
  setVal('pr-form-division', d.division === 'junior' ? 'junior' : 'senior');
  setVal('pr-form-weight', typeof d.weight === 'number' ? d.weight : 1);
  setVal('pr-form-sourceurl', d.sourceUrl);
  var seasonInput = document.getElementById('pr-form-season');
  if (seasonInput) delete seasonInput.dataset.auto;

  var rowsEl = document.getElementById('pr-team-rows');
  if (rowsEl) {
    rowsEl.innerHTML = '';
    var results = Array.isArray(d.results) ? d.results : [];
    results.slice().sort(function (a, b) { return (a.place || 0) - (b.place || 0); }).forEach(function (r) {
      rowsEl.appendChild(prBuildTeamRow(r));
    });
    if (!results.length) rowsEl.appendChild(prBuildTeamRow(null));
  }

  var warningsEl = document.getElementById('pr-form-warnings');
  if (warningsEl) { warningsEl.innerHTML = ''; warningsEl.classList.add('hidden'); }
  prSetStatus(document.getElementById('pr-form-status'), 'Loaded ' + contest.slug + ' — edit and save.');
  prUpdateSlugPreview();

  var formCard = document.getElementById('pr-editing-banner');
  if (formCard && formCard.scrollIntoView) formCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Bridges the "Edit in Manual Form First" button on a freshly parsed import
// preview into the manual-entry form. This is the only realistic place
// altOnlySchools ever survives past the import textarea (Firestore docs never
// carry it — prWriteContest strips it before every write), so rows matching
// it get the same badge prBuildTeamRow renders in the import preview; the
// existing per-row remove button doubles as "exclude" here.
function prLoadParsedImportIntoForm(parsed) {
  if (!parsed || !parsed.doc) return;
  var d = parsed.doc;
  _prEditingSlug = null; // treat as a fresh manual entry; slug recomputes from the fields

  var banner = document.getElementById('pr-editing-banner');
  var slugEl = document.getElementById('pr-editing-slug');
  if (slugEl) slugEl.textContent = parsed.slug + ' (from import — review, then Save Contest below)';
  if (banner) banner.classList.remove('hidden');

  function setVal(id, v) {
    var el = document.getElementById(id);
    if (el) el.value = (v === undefined || v === null) ? '' : String(v);
  }
  setVal('pr-form-name', d.name);
  setVal('pr-form-shortname', d.shortName);
  setVal('pr-form-date', d.date);
  setVal('pr-form-season', d.season);
  setVal('pr-form-division', d.division === 'junior' ? 'junior' : 'senior');
  setVal('pr-form-weight', typeof d.weight === 'number' ? d.weight : 1);
  setVal('pr-form-sourceurl', d.sourceUrl);
  var seasonInput = document.getElementById('pr-form-season');
  if (seasonInput) delete seasonInput.dataset.auto;

  var altSet = {};
  (parsed.altOnlySchools || []).forEach(function (s) { altSet[prNormSchool(s)] = true; });

  var rowsEl = document.getElementById('pr-team-rows');
  if (rowsEl) {
    rowsEl.innerHTML = '';
    var results = Array.isArray(d.results) ? d.results : [];
    results.slice().sort(function (a, b) { return (a.place || 0) - (b.place || 0); }).forEach(function (r) {
      rowsEl.appendChild(prBuildTeamRow(r, !!altSet[prNormSchool(r.school)]));
    });
    if (!results.length) rowsEl.appendChild(prBuildTeamRow(null));
  }

  var warningsEl = document.getElementById('pr-form-warnings');
  if (warningsEl) { warningsEl.innerHTML = ''; warningsEl.classList.add('hidden'); }
  prSetStatus(document.getElementById('pr-form-status'), 'Loaded from import preview — review flagged rows (⚠), edit, then Save Contest.');
  prUpdateSlugPreview();

  if (banner && banner.scrollIntoView) banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function prResetForm() {
  _prEditingSlug = null;
  var banner = document.getElementById('pr-editing-banner');
  if (banner) banner.classList.add('hidden');
  ['pr-form-name', 'pr-form-shortname', 'pr-form-date', 'pr-form-season', 'pr-form-sourceurl'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  var divisionEl = document.getElementById('pr-form-division');
  if (divisionEl) divisionEl.value = 'senior';
  var weightEl = document.getElementById('pr-form-weight');
  if (weightEl) weightEl.value = '1';
  var seasonInput = document.getElementById('pr-form-season');
  if (seasonInput) delete seasonInput.dataset.auto;
  var rowsEl = document.getElementById('pr-team-rows');
  if (rowsEl) {
    rowsEl.innerHTML = '';
    rowsEl.appendChild(prBuildTeamRow(null));
  }
  var warningsEl = document.getElementById('pr-form-warnings');
  if (warningsEl) { warningsEl.innerHTML = ''; warningsEl.classList.add('hidden'); }
  prSetStatus(document.getElementById('pr-form-status'), '');
  prUpdateSlugPreview();
}

// ============================================================
//  Utilities
// ============================================================

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getInitials(name) {
  var parts = String(name).trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return String(name).slice(0, 2).toUpperCase();
}
