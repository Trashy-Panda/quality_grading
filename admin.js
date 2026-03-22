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
  ['leaderboard', 'weekly', 'users', 'community'].forEach(function (t) {
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

  _db.enableNetwork().catch(function () {}).then(function () {
    return _db.collection(DB_COLLECTIONS.submissions)
      .where('weekId', '==', _lbWeekId)
      .where('ruleSet', '==', _lbRuleSet)
      .get();
  })
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
          return snap.docs.map(function(d) { return d.data(); })
            .filter(function(r) { return r.imageUrl && r.correct && r.correct.qualityGrade; });
        })
        .catch(function() { return []; })
    : Promise.resolve([]);

  // Force network reconnect before Firestore queries (prevents "client is offline" error)
  _db.enableNetwork()
    .catch(function () { /* ignore — still try queries */ })
    .then(function () {
      var overrideQuery   = _db.collection('weeks').doc(_wcWeekId).get();
      var ffaQuery        = _db.collection(DB_COLLECTIONS.submissions).where('weekId', '==', _wcWeekId).where('ruleSet', '==', 'ffa').get();
      var collegiateQuery = _db.collection(DB_COLLECTIONS.submissions).where('weekId', '==', _wcWeekId).where('ruleSet', '==', 'collegiate').get();
      return Promise.all([overrideQuery, ffaQuery, collegiateQuery, communityPromise]);
    })
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
      loadCommunityForAdmin();
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

function loadCommunityForAdmin() {
  var container = document.getElementById('wc-community-list');
  if (!container) return;
  if (!_db) {
    container.innerHTML = '<p class="admin-empty">Database not available.</p>';
    return;
  }
  container.innerHTML = '<p class="admin-empty">Loading…</p>';
  _db.collection(DB_COLLECTIONS.community_carcasses)
    .orderBy('submittedAt', 'desc').limit(100).get()
  .then(function(snap) {
    var set = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); })
      .filter(function(r) { return r.imageUrl && r.correct && r.correct.qualityGrade; });
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
          .then(function() { loadCommunityForAdmin(); })
          .catch(function(err) { alert('Error deleting: ' + err.message); });
      });

      row.appendChild(label);
      row.appendChild(delBtn);
      container.appendChild(row);
    });
  })
  .catch(function(e) { container.innerHTML = '<p class="admin-empty">Failed to load: ' + escapeHtml(e.message) + '</p>'; });
}

// ============================================================
//  Community Tab
// ============================================================

// NOTE: The edit feature below requires updating the Firestore security rule for
// community_carcasses from `allow update: if false` to `allow update: if isAdmin()`.
// Without this rule change, save operations will be rejected by Firestore.

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

  // Build grade options HTML
  var gradeOptions = '<option value="">— Grade —</option>';
  QUALITY_GRADES.forEach(function(g) {
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

    // NOTE: This update requires the Firestore rule to allow updates by admin.
    // Change `allow update: if false` to `allow update: if isAdmin()` in your rules.
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
    SE_HI: true, SE_AVG: true, SE_LO: true,
    STD: true, COM: true
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
