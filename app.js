// ============================================================
//  BEEF CARCASS GRADING DRILL — Application Logic
//  app.js
// ============================================================

'use strict';

// ------------------------------------------------------------------
//  GRADE POSITION MAP
// ------------------------------------------------------------------
const GRADE_POSITIONS = {};
QUALITY_GRADES.forEach(g => { GRADE_POSITIONS[g.key] = g.position; });

// ------------------------------------------------------------------
//  APPLICATION STATE
// ------------------------------------------------------------------
const state = {
  ruleSet: 'ffa',         // 'ffa' | 'collegiate'
  currentIndex: 0,
  carcasses: [],
  answers: [],
  sessionActive: false,
  selectedFamily: null,
  selectedKey: null,
  communitySet: [],
};

// ------------------------------------------------------------------
//  SCORING
// ------------------------------------------------------------------

function scoreQuality(userKey, correctKey) {
  if (userKey === correctKey) return 10;
  // Count steps between the two grades using only grades active in the current rule set.
  // This means FFA mode (no Average Select) correctly scores Low Choice ↔ Low Select as
  // 2 steps (7 pts) instead of 3 steps (4 pts).
  const activeGrades = QUALITY_GRADES
    .filter(g => state.ruleSet === 'ffa' ? !g.collegiateOnly : true)
    .sort((a, b) => a.position - b.position);
  const userIdx    = activeGrades.findIndex(g => g.key === userKey);
  const correctIdx = activeGrades.findIndex(g => g.key === correctKey);
  const diff = Math.abs(userIdx - correctIdx);
  if (diff === 0) return 10;
  if (diff === 1) return 9;
  if (diff === 2) return 7;
  if (diff === 3) return 4;
  return 0;
}

// ------------------------------------------------------------------
//  UTILITY
// ------------------------------------------------------------------

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function loadAllCarcasses() {
  const custom = JSON.parse(localStorage.getItem('bcd_customCarcasses') || '[]');
  return [...DEFAULT_CARCASSES, ...custom];
}

function savePrefs() {
  localStorage.setItem('bcd_preferences', JSON.stringify({ ruleSet: state.ruleSet }));
}

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('bcd_preferences') || '{}');
    if (p.ruleSet) state.ruleSet = p.ruleSet;
  } catch (e) { /* ignore */ }
}

function sessionTotal() {
  return state.answers.reduce((sum, a) => sum + a.score, 0);
}

function pct(earned, max) {
  return max === 0 ? 0 : Math.round((earned / max) * 100);
}

// ------------------------------------------------------------------
//  GRADE SELECTOR HELPERS
// ------------------------------------------------------------------

function getSubsForFamily(family) {
  const grades = QUALITY_GRADES.filter(g => g.family === family);
  return state.ruleSet === 'ffa' ? grades.filter(g => !g.collegiateOnly) : grades;
}

function resolveKey(family) {
  const solo = QUALITY_GRADES.find(g => g.family === family && g.sub === null);
  return solo ? solo.key : null;
}

// ------------------------------------------------------------------
//  DOM ELEMENT CACHE
// ------------------------------------------------------------------
const el = {};

function cacheElements() {
  el.homeScreen     = document.getElementById('home-screen');
  el.drillScreen    = document.getElementById('drill-screen');
  el.summaryScreen  = document.getElementById('summary-screen');

  // Home
  el.ruleFFA        = document.getElementById('rule-ffa');
  el.ruleCollegiate = document.getElementById('rule-collegiate');
  el.startBtn       = document.getElementById('start-btn');
  el.managePhotosBtn= document.getElementById('manage-photos-btn');

  // Drill
  el.headerRuleLabel= document.getElementById('header-rule-label');
  el.headerScore    = document.getElementById('header-score');
  el.progressBar    = document.getElementById('progress-bar');
  el.progressText   = document.getElementById('progress-text');
  el.carcassImage   = document.getElementById('carcass-image');
  el.carcassName    = document.getElementById('carcass-name');
  el.imageSource    = document.getElementById('image-source');
  el.imageModal     = document.getElementById('image-modal');
  el.imageModalImg  = document.getElementById('image-modal-img');
  el.imageModalClose= document.getElementById('image-modal-close');
  el.familyBtns     = document.getElementById('family-btns');
  el.subBtns        = document.getElementById('sub-btns');
  el.subRow         = document.getElementById('sub-row');
  el.gradeDisplay   = document.getElementById('selected-grade-display');
  el.submitBtn      = document.getElementById('submit-btn');
  el.nextBtn        = document.getElementById('next-btn');
  el.submitError    = document.getElementById('submit-error');
  el.feedbackPanel  = document.getElementById('feedback-panel');
  el.feedbackQuality= document.getElementById('feedback-quality');
  el.feedbackNotes  = document.getElementById('feedback-notes');

  // Summary
  el.summaryTotal   = document.getElementById('summary-total');
  el.summaryPct     = document.getElementById('summary-pct');
  el.summaryTable   = document.getElementById('summary-table');
  el.restartBtn     = document.getElementById('restart-btn');
  el.exportBtn      = document.getElementById('export-btn');

  // Settings modal
  el.settingsBtn    = document.getElementById('settings-btn');
  el.settingsModal  = document.getElementById('settings-modal');
  el.settingsClose  = document.getElementById('settings-close');
  el.formSectionLabel = document.getElementById('form-section-label');
  el.editIndex      = document.getElementById('edit-index');
  el.customUrl      = document.getElementById('custom-url');
  el.customName     = document.getElementById('custom-name');
  el.customQuality  = document.getElementById('custom-quality');
  el.customNotes    = document.getElementById('custom-notes');
  el.customPreview  = document.getElementById('custom-preview');
  el.addCustomBtn   = document.getElementById('add-custom-btn');
  el.cancelEditBtn  = document.getElementById('cancel-edit-btn');
  el.customList     = document.getElementById('custom-list');
  el.importJson          = document.getElementById('import-json');
  el.importBtn           = document.getElementById('import-btn');
  el.exportJsonBtn       = document.getElementById('export-json-btn');
  el.submitCommunityBtn  = document.getElementById('submit-community-btn');
  el.communitySetSub     = document.getElementById('community-set-sub');
  el.refreshCommunityBtn = document.getElementById('refresh-community-btn');
  el.communityStatus     = document.getElementById('community-status');
  el.communityList       = document.getElementById('community-list');
}

// ------------------------------------------------------------------
//  SCREENS
// ------------------------------------------------------------------

function showScreen(name) {
  el.homeScreen.classList.add('hidden');
  el.drillScreen.classList.add('hidden');
  el.summaryScreen.classList.add('hidden');
  document.getElementById(name + '-screen').classList.remove('hidden');
}

// ------------------------------------------------------------------
//  HOME SCREEN
// ------------------------------------------------------------------

function renderHomeScreen() {
  showScreen('home');
  el.ruleFFA.checked        = state.ruleSet === 'ffa';
  el.ruleCollegiate.checked = state.ruleSet === 'collegiate';
}

// ------------------------------------------------------------------
//  GRADE SELECTOR
// ------------------------------------------------------------------

function renderFamilyButtons() {
  el.familyBtns.innerHTML = '';
  const families = state.ruleSet === 'ffa'
    ? ['Prime', 'Choice', 'Select', 'Standard']
    : GRADE_FAMILIES;

  families.forEach(fam => {
    const btn = document.createElement('button');
    btn.className = 'grade-btn family-btn';
    btn.textContent = fam;
    btn.dataset.family = fam;
    if (state.selectedFamily === fam) btn.classList.add('active');
    btn.addEventListener('click', () => onFamilyClick(fam));
    el.familyBtns.appendChild(btn);
  });
}

function renderSubButtons(family) {
  el.subBtns.innerHTML = '';
  const subs = getSubsForFamily(family);

  if (!subs.length || subs[0].sub === null) {
    el.subRow.classList.add('hidden');
    state.selectedKey = resolveKey(family);
    updateGradeDisplay();
    return;
  }

  el.subRow.classList.remove('hidden');
  subs.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'grade-btn sub-btn';
    btn.textContent = g.sub;
    btn.dataset.key = g.key;
    if (state.selectedKey === g.key) btn.classList.add('active');
    btn.addEventListener('click', () => onSubClick(g.key));
    el.subBtns.appendChild(btn);
  });
}

function onFamilyClick(family) {
  state.selectedFamily = family;
  state.selectedKey = null;
  renderFamilyButtons();
  renderSubButtons(family);
  updateGradeDisplay();
}

function onSubClick(key) {
  state.selectedKey = key;
  document.querySelectorAll('.sub-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.key === key);
  });
  updateGradeDisplay();
}

function updateGradeDisplay() {
  if (!state.selectedKey) {
    el.gradeDisplay.textContent = '— select a grade —';
    el.gradeDisplay.className = 'grade-display unset';
    return;
  }
  const g = GRADE_MAP[state.selectedKey];
  el.gradeDisplay.textContent = g.label;
  el.gradeDisplay.className = 'grade-display family-' + g.family.toLowerCase();
}

function resetGradeSelector() {
  state.selectedFamily = null;
  state.selectedKey = null;
  renderFamilyButtons();
  el.subRow.classList.add('hidden');
  el.subBtns.innerHTML = '';
  updateGradeDisplay();
}

// ------------------------------------------------------------------
//  DRILL SCREEN
// ------------------------------------------------------------------

function startSession(carcassSet) {
  state.carcasses    = shuffle(carcassSet);
  state.currentIndex = 0;
  state.answers      = [];
  state.sessionActive = true;
  savePrefs();
  showScreen('drill');
  el.headerRuleLabel.textContent = state.ruleSet === 'ffa' ? 'FFA Rules' : 'Collegiate Rules';
  renderCarcass(0);
}

function renderCarcass(index) {
  const c = state.carcasses[index];
  const total = state.carcasses.length;

  el.progressText.textContent = `Carcass ${index + 1} of ${total}`;
  el.progressBar.style.width = ((index / total) * 100) + '%';

  const earned = sessionTotal();
  const max = state.answers.length * 10;
  el.headerScore.textContent = `Score: ${earned}/${max} pts`;

  const imgWrap = el.carcassImage.parentElement;
  imgWrap.classList.add('img-loading');
  el.carcassImage.style.opacity = '0';
  el.carcassImage.alt = c.imageName;
  el.carcassImage.src = '';

  const _onLoad = () => {
    imgWrap.classList.remove('img-loading');
    el.carcassImage.style.opacity = '1';
    el.carcassImage.removeEventListener('load',  _onLoad);
    el.carcassImage.removeEventListener('error', _onError);
  };
  const _onError = () => {
    imgWrap.classList.remove('img-loading');
    el.carcassImage.style.opacity = '0.25';
    el.carcassImage.removeEventListener('load',  _onLoad);
    el.carcassImage.removeEventListener('error', _onError);
  };
  el.carcassImage.addEventListener('load',  _onLoad);
  el.carcassImage.addEventListener('error', _onError);
  el.carcassImage.src = c.imageUrl;

  el.carcassName.textContent = c.imageName;
  el.imageSource.textContent = c.source ? 'Source: ' + c.source : '';

  resetGradeSelector();

  el.feedbackPanel.className = 'feedback-panel hidden';
  el.feedbackQuality.textContent = '';
  el.feedbackNotes.textContent = '';
  el.feedbackNotes.classList.add('hidden');

  el.submitBtn.classList.remove('hidden');
  el.nextBtn.classList.add('hidden');
}

function onSubmit() {
  if (!state.selectedKey) {
    el.submitError.textContent = 'Please select a Quality Grade before submitting.';
    el.submitError.classList.remove('hidden');
    setTimeout(() => el.submitError.classList.add('hidden'), 2500);
    return;
  }

  const c = state.carcasses[state.currentIndex];
  const score = scoreQuality(state.selectedKey, c.correct.qualityGrade);
  const userLabel    = GRADE_MAP[state.selectedKey].label;
  const correctLabel = GRADE_MAP[c.correct.qualityGrade].label;

  state.answers.push({
    carcassId: c.id,
    carcassName: c.imageName,
    userQualityLabel: userLabel,
    correctQualityLabel: correctLabel,
    score,
    maxPossible: 10,
  });

  el.feedbackPanel.classList.remove('hidden', 'feedback-perfect', 'feedback-partial', 'feedback-zero');
  if (score === 10)    el.feedbackPanel.classList.add('feedback-perfect');
  else if (score >= 5) el.feedbackPanel.classList.add('feedback-partial');
  else                 el.feedbackPanel.classList.add('feedback-zero');

  el.feedbackQuality.innerHTML =
    `<strong>${score}/10 pts</strong> — You: ${userLabel} &nbsp;|&nbsp; Correct: ${correctLabel}`;

  if (c.notes && score < 10) {
    el.feedbackNotes.textContent = c.notes;
    el.feedbackNotes.classList.remove('hidden');
  }

  el.submitBtn.classList.add('hidden');
  el.nextBtn.classList.remove('hidden');

  const earned = sessionTotal();
  const max = state.answers.length * 10;
  el.headerScore.textContent = `Score: ${earned}/${max} pts`;
}

function onNext() {
  state.currentIndex++;
  if (state.currentIndex >= state.carcasses.length) {
    renderSummary();
  } else {
    renderCarcass(state.currentIndex);
  }
}

// ------------------------------------------------------------------
//  IMAGE MODAL
// ------------------------------------------------------------------

function initImageModal() {
  el.carcassImage.addEventListener('click', () => {
    el.imageModalImg.src = el.carcassImage.src;
    el.imageModal.classList.remove('hidden');
  });
  el.imageModalClose.addEventListener('click', () => el.imageModal.classList.add('hidden'));
  el.imageModal.addEventListener('click', e => {
    if (e.target === el.imageModal) el.imageModal.classList.add('hidden');
  });
}

// ------------------------------------------------------------------
//  SUMMARY SCREEN
// ------------------------------------------------------------------

function renderSummary() {
  showScreen('summary');
  const earned = sessionTotal();
  const max = state.answers.length * 10;
  const p = pct(earned, max);

  el.summaryTotal.textContent = `${earned} / ${max} pts`;
  el.summaryPct.textContent = `${p}%`;
  el.summaryPct.className = 'summary-pct ' + (p >= 80 ? 'pct-green' : p >= 60 ? 'pct-yellow' : 'pct-red');

  let html = `
    <thead><tr>
      <th>#</th><th>Carcass</th><th>Your Grade</th><th>Correct Grade</th><th>Points</th>
    </tr></thead><tbody>`;

  state.answers.forEach((a, i) => {
    const cls = a.score === 10 ? 'row-good' : a.score >= 5 ? 'row-ok' : 'row-bad';
    html += `<tr class="${cls}">
      <td>${i + 1}</td>
      <td>${a.carcassName}</td>
      <td>${a.userQualityLabel}</td>
      <td>${a.correctQualityLabel}</td>
      <td><strong>${a.score}/10</strong></td>
    </tr>`;
  });

  el.summaryTable.innerHTML = html + '</tbody>';

  const history = JSON.parse(localStorage.getItem('bcd_sessionHistory') || '[]');
  history.unshift({ date: new Date().toISOString(), ruleSet: state.ruleSet, carcassCount: state.answers.length, earned, max, pct: p });
  if (history.length > 20) history.pop();
  localStorage.setItem('bcd_sessionHistory', JSON.stringify(history));
}

function onExport() {
  const blob = new Blob([JSON.stringify(state.answers, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `beef-grading-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------------
//  SETTINGS MODAL — Custom Image Sets with Edit
// ------------------------------------------------------------------

function getCustomList() {
  return JSON.parse(localStorage.getItem('bcd_customCarcasses') || '[]');
}

function saveCustomList(list) {
  localStorage.setItem('bcd_customCarcasses', JSON.stringify(list));
}

function renderCustomList() {
  const custom = getCustomList();
  if (!custom.length) {
    el.customList.innerHTML = '<p class="empty-msg">No custom carcasses added yet.</p>';
    return;
  }

  let html = '<ul>';
  custom.forEach((c, i) => {
    const qg = GRADE_MAP[c.correct.qualityGrade];
    const gradeLabel = qg ? qg.label : c.correct.qualityGrade;
    html += `<li>
      <span class="url-dot url-checking" data-url="${c.imageUrl}" title="Checking…">●</span>
      <span class="custom-item-info">
        <span class="custom-item-name">${c.imageName}</span>
        <span class="custom-item-grade">${gradeLabel}</span>
      </span>
      <span class="custom-item-actions">
        <button class="edit-btn" data-index="${i}" title="Edit">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Edit
        </button>
        <button class="delete-btn" data-index="${i}" title="Delete">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </span>
    </li>`;
  });
  html += '</ul>';
  el.customList.innerHTML = html;

  el.customList.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => startEdit(parseInt(btn.dataset.index, 10)));
  });

  el.customList.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const list = getCustomList();
      list.splice(parseInt(btn.dataset.index, 10), 1);
      saveCustomList(list);
      // If currently editing this record, reset the form
      if (parseInt(el.editIndex.value, 10) === parseInt(btn.dataset.index, 10)) {
        cancelEdit();
      }
      renderCustomList();
    });
  });

  attachUrlDotChecks(el.customList);
}

function startEdit(index) {
  const list = getCustomList();
  const c = list[index];

  el.editIndex.value = index;
  el.formSectionLabel.textContent = 'Edit Carcass';
  el.addCustomBtn.textContent = 'Save Changes';
  el.cancelEditBtn.classList.remove('hidden');

  el.customUrl.value = c.imageUrl || '';
  el.customName.value = c.imageName || '';
  el.customQuality.value = c.correct.qualityGrade || '';
  el.customNotes.value = c.notes || '';

  if (c.imageUrl) {
    el.customPreview.src = c.imageUrl;
    el.customPreview.classList.remove('hidden');
  }

  // Scroll form into view
  el.formSectionLabel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function cancelEdit() {
  el.editIndex.value = '-1';
  el.formSectionLabel.textContent = 'Add a Carcass';
  el.addCustomBtn.textContent = 'Add to My Set';
  el.cancelEditBtn.classList.add('hidden');
  el.customUrl.value = '';
  el.customName.value = '';
  el.customNotes.value = '';
  el.customPreview.src = '';
  el.customPreview.classList.add('hidden');
}

function onSaveCustom() {
  const url   = el.customUrl.value.trim();
  const name  = el.customName.value.trim() || 'Custom Carcass';
  const qKey  = el.customQuality.value;
  const notes = el.customNotes.value.trim();
  const editIdx = parseInt(el.editIndex.value, 10);

  if (!url)  { alert('Please enter an image URL.'); return; }
  if (!qKey) { alert('Please select a quality grade.'); return; }

  const list = getCustomList();

  if (editIdx >= 0) {
    // Update existing record — preserve id
    list[editIdx] = {
      ...list[editIdx],
      imageName: name,
      imageUrl: url,
      correct: { qualityGrade: qKey },
      notes,
    };
  } else {
    // New record
    list.push({
      id: 'custom-' + Date.now(),
      imageName: name,
      imageUrl: url,
      source: 'User-added',
      correct: { qualityGrade: qKey },
      notes,
    });
  }

  saveCustomList(list);
  renderCustomList();
  cancelEdit();
}

// ------------------------------------------------------------------
//  URL VALIDATION
// ------------------------------------------------------------------

function checkImageUrl(url) {
  return new Promise(resolve => {
    if (!url) { resolve(false); return; }
    const img = new Image();
    const timer = setTimeout(() => { img.src = ''; resolve(false); }, 5000);
    img.onload  = () => { clearTimeout(timer); resolve(true); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = url;
  });
}

function attachUrlDotChecks(container) {
  container.querySelectorAll('.url-dot').forEach(dot => {
    checkImageUrl(dot.dataset.url).then(ok => {
      dot.classList.remove('url-checking');
      dot.classList.add(ok ? 'url-ok' : 'url-broken');
      dot.title = ok ? 'Image loads OK' : 'Image URL is broken or blocked';
    });
  });
}

// ------------------------------------------------------------------
//  COMMUNITY SET
// ------------------------------------------------------------------

function updateCommunityLabel() {
  if (!el.communitySetSub) return;
  if (!COMMUNITY_CONFIG.BIN_ID) {
    el.communitySetSub.textContent = 'Not configured — see data.js to set up';
  } else if (!state.communitySet.length) {
    el.communitySetSub.textContent = 'No carcasses yet — be the first to submit!';
  } else {
    el.communitySetSub.textContent = state.communitySet.length + ' carcasses from the team';
  }
}

async function loadCommunitySet() {
  if (!COMMUNITY_CONFIG.BIN_ID || !COMMUNITY_CONFIG.MASTER_KEY) {
    updateCommunityLabel();
    renderCommunityList();
    return;
  }
  if (el.communityStatus) el.communityStatus.textContent = 'Loading…';
  try {
    const res = await fetch(
      'https://api.jsonbin.io/v3/b/' + COMMUNITY_CONFIG.BIN_ID + '/latest',
      { headers: { 'X-Master-Key': COMMUNITY_CONFIG.MASTER_KEY } }
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    state.communitySet = Array.isArray(data.record)
      ? data.record.filter(r => r.imageUrl && r.correct && r.correct.qualityGrade)
      : [];
  } catch (e) {
    state.communitySet = [];
    if (el.communityStatus) el.communityStatus.textContent = 'Could not load community set: ' + e.message;
  }
  updateCommunityLabel();
  renderCommunityList();
}

async function onSubmitToCommunity() {
  if (!COMMUNITY_CONFIG.BIN_ID || !COMMUNITY_CONFIG.MASTER_KEY) {
    alert('Community set is not configured.\nAsk your team admin to fill in COMMUNITY_CONFIG in data.js.');
    return;
  }
  const url   = el.customUrl.value.trim();
  const name  = el.customName.value.trim() || 'Community Carcass';
  const qKey  = el.customQuality.value;
  const notes = el.customNotes.value.trim();
  if (!url)  { alert('Please enter an image URL.'); return; }
  if (!qKey) { alert('Please select a quality grade.'); return; }

  const record = {
    id: 'community-' + Date.now(),
    imageName: name,
    imageUrl: url,
    source: 'Community',
    correct: { qualityGrade: qKey },
    notes,
  };

  el.submitCommunityBtn.disabled = true;
  el.submitCommunityBtn.textContent = 'Submitting…';
  try {
    const updated = [...state.communitySet, record];
    const res = await fetch(
      'https://api.jsonbin.io/v3/b/' + COMMUNITY_CONFIG.BIN_ID,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Master-Key': COMMUNITY_CONFIG.MASTER_KEY },
        body: JSON.stringify(updated),
      }
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.communitySet = updated;
    updateCommunityLabel();
    renderCommunityList();
    cancelEdit();
    alert('Submitted to community set! (' + state.communitySet.length + ' total)');
  } catch (e) {
    alert('Failed to submit: ' + e.message);
  } finally {
    el.submitCommunityBtn.disabled = false;
    el.submitCommunityBtn.textContent = 'Submit to Community';
  }
}

function renderCommunityList() {
  if (!el.communityList) return;
  if (!COMMUNITY_CONFIG.BIN_ID) {
    el.communityStatus.textContent = 'Not configured — fill in COMMUNITY_CONFIG in data.js to get started.';
    el.communityList.innerHTML = '';
    return;
  }
  if (!state.communitySet.length) {
    el.communityStatus.textContent = 'No community carcasses yet — use "Submit to Community" to add the first one!';
    el.communityList.innerHTML = '';
    return;
  }
  el.communityStatus.textContent = state.communitySet.length + ' carcasses in the community set.';
  let html = '<ul>';
  state.communitySet.forEach(c => {
    const qg = GRADE_MAP[c.correct.qualityGrade];
    const gradeLabel = qg ? qg.label : c.correct.qualityGrade;
    html += `<li>
      <span class="url-dot url-checking" data-url="${c.imageUrl}" title="Checking…">●</span>
      <span class="custom-item-info">
        <span class="custom-item-name">${c.imageName}</span>
        <span class="custom-item-grade">${gradeLabel}</span>
      </span>
    </li>`;
  });
  html += '</ul>';
  el.communityList.innerHTML = html;
  attachUrlDotChecks(el.communityList);
}

function buildCustomQualitySelector() {
  el.customQuality.innerHTML = '';
  QUALITY_GRADES.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.key;
    opt.textContent = g.label;
    el.customQuality.appendChild(opt);
  });
}

function openSettings() {
  cancelEdit();
  renderCustomList();
  renderCommunityList();
  el.settingsModal.classList.remove('hidden');
}

// ------------------------------------------------------------------
//  INITIALIZATION
// ------------------------------------------------------------------

function init() {
  cacheElements();
  loadPrefs();
  initImageModal();
  buildCustomQualitySelector();
  loadCommunitySet();

  // Image URL preview
  el.customUrl.addEventListener('input', () => {
    const url = el.customUrl.value.trim();
    el.customPreview.src = url || '';
    el.customPreview.classList.toggle('hidden', !url);
  });

  // Rule set
  el.ruleFFA.addEventListener('change',        () => { state.ruleSet = 'ffa'; });
  el.ruleCollegiate.addEventListener('change', () => { state.ruleSet = 'collegiate'; });

  // Start
  el.startBtn.addEventListener('click', () => {
    const setVal = document.querySelector('input[name="image-set"]:checked').value;
    const custom = getCustomList();
    let deck;
    if (setVal === 'default')         deck = DEFAULT_CARCASSES;
    else if (setVal === 'custom')     deck = custom.length ? custom : DEFAULT_CARCASSES;
    else if (setVal === 'community') {
      if (!state.communitySet.length) {
        alert('Community set is empty or not configured.\nSee data.js to set up COMMUNITY_CONFIG.');
        return;
      }
      deck = state.communitySet;
    }
    else                              deck = loadAllCarcasses();

    if (!deck.length) { alert('No carcasses available. Please add images in Manage Photos.'); return; }
    startSession(deck);
  });

  // Drill actions
  el.submitBtn.addEventListener('click', onSubmit);
  el.nextBtn.addEventListener('click', onNext);

  // Summary
  el.restartBtn.addEventListener('click', () => { state.sessionActive = false; renderHomeScreen(); });
  el.exportBtn.addEventListener('click', onExport);

  // Settings — open from both header gear and home "Manage Photos" button
  el.settingsBtn.addEventListener('click', openSettings);
  el.managePhotosBtn.addEventListener('click', openSettings);

  el.settingsClose.addEventListener('click', () => el.settingsModal.classList.add('hidden'));
  el.settingsModal.addEventListener('click', e => {
    if (e.target === el.settingsModal) el.settingsModal.classList.add('hidden');
  });

  el.addCustomBtn.addEventListener('click', onSaveCustom);
  el.cancelEditBtn.addEventListener('click', cancelEdit);
  el.submitCommunityBtn.addEventListener('click', onSubmitToCommunity);
  el.refreshCommunityBtn.addEventListener('click', loadCommunitySet);

  // Import / Export JSON
  el.importBtn.addEventListener('click', () => {
    try {
      const arr = JSON.parse(el.importJson.value);
      if (!Array.isArray(arr)) throw new Error('Must be a JSON array.');
      const list = getCustomList();
      arr.forEach(r => list.push(r));
      saveCustomList(list);
      renderCustomList();
      el.importJson.value = '';
      alert(`Imported ${arr.length} record(s).`);
    } catch (e) { alert('Invalid JSON: ' + e.message); }
  });

  el.exportJsonBtn.addEventListener('click', () => {
    el.importJson.value = JSON.stringify(getCustomList(), null, 2);
  });

  renderHomeScreen();
}

document.addEventListener('DOMContentLoaded', init);
