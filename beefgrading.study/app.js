// ============================================================
//  BEEF CARCASS GRADING DRILL — Application Logic
//  app.js
// ============================================================

'use strict';

// ------------------------------------------------------------------
//  XSS ESCAPE UTILITIES
// ------------------------------------------------------------------
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ------------------------------------------------------------------
//  GRADE POSITION MAP
// ------------------------------------------------------------------
const GRADE_POSITIONS = {};
QUALITY_GRADES.forEach(g => { GRADE_POSITIONS[g.key] = g.position; });

// ------------------------------------------------------------------
//  APPLICATION STATE
// ------------------------------------------------------------------
const state = {
  ruleSet: 'collegiate',
  currentIndex: 0,
  carcasses: [],
  answers: [],
  sessionActive: false,
  selectedFamily: null,
  selectedKey: null,
  communitySet: [],
  aiSet: [],
};

// ------------------------------------------------------------------
//  SCORING
// ------------------------------------------------------------------

function scoreQuality(userKey, correctKey) {
  if (userKey === correctKey) return 10;
  // Average Select (collegiateOnly) is excluded — Low Choice ↔ Low Select = 2 steps (7 pts).
  const activeGrades = QUALITY_GRADES
    .filter(g => !g.collegiateOnly)
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

function savePrefs() {
  localStorage.setItem('bcd_preferences', JSON.stringify({ ruleSet: state.ruleSet }));
}

function loadPrefs() {
  // ruleSet is always 'collegiate' — do not restore from prefs
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
  return QUALITY_GRADES.filter(g => g.family === family && !g.collegiateOnly);
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
  el.startBtn       = document.getElementById('start-btn');
  el.startError     = document.getElementById('start-error');
  el.managePhotosBtn= document.getElementById('manage-photos-btn');
  el.useCustomSetToggle = document.getElementById('use-custom-set-toggle');
  el.openContributeLink  = document.getElementById('open-contribute-link');

  // Drill
  el.drillScore     = document.getElementById('drill-score');
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
  el.summaryExact   = document.getElementById('summary-exact');
  el.summaryNear    = document.getElementById('summary-near');
  el.summarySub     = document.getElementById('summary-sub');
  el.summaryStrip   = document.getElementById('summary-strip');
  el.summaryLegend  = document.getElementById('summary-legend');
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
  el.aiSetSub            = document.getElementById('ai-set-sub');
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
  window._isWeeklySession = false;
  // weekly.js re-renders the setup weekly panel when this screen becomes visible
}

// ------------------------------------------------------------------
//  GRADE SELECTOR
// ------------------------------------------------------------------

function renderFamilyButtons() {
  el.familyBtns.innerHTML = '';
  const families = GRADE_FAMILIES;

  families.forEach(fam => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dr-seg-btn family-btn';
    btn.textContent = fam;
    btn.dataset.family = fam;
    const on = state.selectedFamily === fam;
    if (on) btn.classList.add('active');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.addEventListener('click', () => onFamilyClick(fam));
    el.familyBtns.appendChild(btn);
  });
}

function renderSubButtons(family) {
  el.subBtns.innerHTML = '';
  const subs = getSubsForFamily(family);

  if (!subs.length || subs[0].sub === null) {
    // No subdivisions (Standard): the one call is made, show it as a settled row
    state.selectedKey = resolveKey(family);
    const solo = state.selectedKey ? GRADE_MAP[state.selectedKey] : null;
    if (solo) {
      el.subRow.classList.remove('is-idle');
      el.subBtns.appendChild(buildChoiceRow(solo.label, 'No subdivisions', true, 'is-on'));
    } else {
      el.subRow.classList.add('is-idle');
    }
    updateGradeDisplay();
    return;
  }

  el.subRow.classList.remove('is-idle');
  subs.forEach(g => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gr-row sub-btn';
    btn.dataset.key = g.key;
    const on = state.selectedKey === g.key;
    if (on) btn.classList.add('active');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.innerHTML = '<span class="gr-t"></span>' + CHECK_ICON;
    btn.firstChild.textContent = g.label;
    btn.addEventListener('click', () => onSubClick(g.key));
    el.subBtns.appendChild(btn);
  });
}

const CHECK_ICON = '<svg class="ic gr-ck" aria-hidden="true" focusable="false"><use href="#i-check"/></svg>';

// A row that is not a control: the settled call, or a result row. Same anatomy
// as the choice rows so the pick and the answer read as one list.
function buildChoiceRow(title, note, withCheck, extraCls) {
  const row = document.createElement('div');
  row.className = 'gr-row gr-row--static' + (extraCls ? ' ' + extraCls : '');
  const txt = document.createElement('span');
  txt.className = 'gr-tx';
  const t = document.createElement('span');
  t.className = 'gr-t';
  t.textContent = title;
  txt.appendChild(t);
  if (note) {
    const n = document.createElement('span');
    n.className = 'gr-n';
    n.textContent = note;
    txt.appendChild(n);
  }
  row.appendChild(txt);
  if (withCheck) row.insertAdjacentHTML('beforeend', CHECK_ICON);
  return row;
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
    const on = btn.dataset.key === key;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  updateGradeDisplay();
}

function setDockSub(text) {
  const sub = document.getElementById('dr-dock-sub');
  if (sub) sub.textContent = text;
}

function updateGradeDisplay() {
  setDockSub('Your call');
  if (!state.selectedKey) {
    el.gradeDisplay.textContent = 'Select a grade';
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
  el.subRow.classList.add('is-idle');
  el.subBtns.innerHTML = '';
  updateGradeDisplay();
}

// ------------------------------------------------------------------
//  RESULT HELPERS (drill feedback + summary)
// ------------------------------------------------------------------

// 'ok' = exact, 'near' = within one third (9 or 7 pts), 'miss' = everything else
function resultTier(score) {
  return score === 10 ? 'ok' : (score === 9 || score === 7) ? 'near' : 'miss';
}

function resultVerdict(score) {
  if (score === 10) return 'Exact';
  if (score === 9)  return 'One subdivision off';
  if (score === 7)  return 'Two subdivisions off';
  if (score === 4)  return 'One full grade off';
  return 'More than one grade off';
}

// The run so far: one cell per carcass, scored ones take their tier, the
// current one is marked. Real data only; shown on the desktop rail.
function renderRunStrip() {
  const strip = document.getElementById('dr-run-strip');
  if (!strip) return;
  const n = state.carcasses.length;
  const cells = [];
  for (let i = 0; i < n; i++) {
    const a = state.answers[i];
    if (a) cells.push('<i class="' + resultTier(a.score) + '"><b>' + a.score + '</b></i>');
    else cells.push('<i' + (i === state.currentIndex ? ' class="now"' : '') + '><b></b></i>');
  }
  strip.style.setProperty('--n', String(Math.max(n, 1)));
  strip.classList.toggle('sm-strip--dense', n > 18);
  strip.setAttribute('aria-label', state.answers.length + ' of ' + n + ' carcasses scored');
  strip.innerHTML = cells.join('');
}

function updateDrillScore() {
  const earned = sessionTotal();
  const max = state.answers.length * 10;
  el.drillScore.textContent = earned + ' / ' + max;
}

// Callable grades, best to worst (Average Select and Commercial are collegiate-only
// and not on the drill's buttons, so they sit between neighbours on the scale).
function ladderGrades() {
  return QUALITY_GRADES.filter(g => !g.collegiateOnly).sort((a, b) => b.position - a.position);
}

// Fractional index of a grade on the ladder (0 = High Prime).
function ladderIndex(key) {
  const list = ladderGrades();
  const pos = GRADE_POSITIONS[key];
  for (let i = 0; i < list.length; i++) {
    if (list[i].position === pos) return i;
    if (list[i].position < pos) {
      if (i === 0) return 0;
      return i - (pos - list[i].position) / (list[i - 1].position - list[i].position);
    }
  }
  return list.length - 1;
}

// Prime-to-Standard scale with your mark above and the official-call mark below.
function buildLadderHtml(userKey, correctKey) {
  const list = ladderGrades();
  const n = list.length;
  const u = ladderIndex(userKey);
  const c = ladderIndex(correctKey);
  const lo = Math.round(Math.min(u, c));
  const hi = Math.round(Math.max(u, c));
  const x = i => ((i + 0.5) / n).toFixed(4);

  let cells = '';
  for (let i = 0; i < n; i++) {
    cells += '<i' + (i >= lo && i <= hi ? ' class="on"' : '') + '></i>';
  }

  const fams = [];
  list.forEach(g => {
    const last = fams[fams.length - 1];
    if (last && last.name === g.family) last.span++;
    else fams.push({ name: g.family, span: 1 });
  });
  const famHtml = fams.map(f =>
    '<span style="grid-column: span ' + f.span + '">' + escapeHtml(f.name) + '</span>'
  ).join('');

  const label = 'Grade scale from ' + list[0].family + ' to ' + list[n - 1].family +
    '. You called ' + GRADE_MAP[userKey].label + ', official call ' + GRADE_MAP[correctKey].label + '.';

  return '<div class="fb-scale" role="img" aria-label="' + escapeAttr(label) + '" style="--n:' + n + '">' +
    '<div class="fb-row"><span class="fb-mk fb-mk--you' + (u / (n - 1) > 0.6 ? ' fb-mk--end' : '') + '" style="--x:' + x(u) + '"><i></i><b>You</b></span></div>' +
    '<div class="fb-track">' + cells + '</div>' +
    '<div class="fb-row"><span class="fb-mk fb-mk--key' + (c / (n - 1) > 0.6 ? ' fb-mk--end' : '') + '" style="--x:' + x(c) + '"><i></i><b>Official&nbsp;call</b></span></div>' +
    '<div class="fb-fams">' + famHtml + '</div>' +
    '</div>';
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
  renderCarcass(0);
}

function renderCarcass(index) {
  const c = state.carcasses[index];
  const total = state.carcasses.length;

  el.progressText.textContent = `${index + 1} of ${total}`;
  // scaleX fraction, not width %: see #progress-bar in style.css
  el.progressBar.style.setProperty('--progress', total ? index / total : 0);

  updateDrillScore();
  renderRunStrip();

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

  delete el.drillScreen.dataset.result;
  el.feedbackPanel.className = 'feedback-panel hidden';
  el.feedbackQuality.innerHTML = '';
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
    userKey: state.selectedKey,
    correctKey: c.correct.qualityGrade,
    userQualityLabel: userLabel,
    correctQualityLabel: correctLabel,
    score,
    maxPossible: 10,
  });

  el.feedbackPanel.classList.remove('hidden', 'feedback-perfect', 'feedback-partial', 'feedback-zero');
  const tierCls = { ok: 'feedback-perfect', near: 'feedback-partial', miss: 'feedback-zero' };
  el.feedbackPanel.classList.add(tierCls[resultTier(score)]);

  // The answer takes the place of the choices: your row, then the right row
  // beside it (one row when the call was exact). Tone, not an error state.
  el.drillScreen.dataset.result = resultTier(score);
  el.feedbackQuality.innerHTML =
    `<div class="fb-line"><strong class="fb-pts">${score}/10</strong><span class="fb-verdict">${escapeHtml(resultVerdict(score))}</span></div>` +
    `<div class="fb-rows"></div>` +
    buildLadderHtml(state.selectedKey, c.correct.qualityGrade);
  const fbRows = el.feedbackQuality.querySelector('.fb-rows');
  if (score === 10) {
    fbRows.appendChild(buildChoiceRow(correctLabel, 'Right answer, your call', true, 'is-key'));
  } else {
    fbRows.appendChild(buildChoiceRow(userLabel, 'Your call', false, 'is-you'));
    fbRows.appendChild(buildChoiceRow(correctLabel, 'Right answer', true, 'is-key'));
  }

  if (c.notes && score < 10) {
    el.feedbackNotes.textContent = c.notes;
    el.feedbackNotes.classList.remove('hidden');
  }

  el.submitBtn.classList.add('hidden');
  const last = state.currentIndex + 1 >= state.carcasses.length;
  el.nextBtn.firstElementChild.textContent = last ? 'See results' : 'Next carcass';
  el.nextBtn.classList.remove('hidden');

  updateDrillScore();
  renderRunStrip();

  // The dock stops repeating the pick: it carries the run instead
  const earnedNow = sessionTotal();
  const maxNow = state.answers.length * 10;
  el.gradeDisplay.className = 'grade-display';
  if (last) {
    el.gradeDisplay.textContent = 'Total ' + earnedNow + '/' + maxNow;
    setDockSub(state.carcasses.length + ' of ' + state.carcasses.length + ' graded');
  } else {
    el.gradeDisplay.textContent = (state.currentIndex + 2) + ' of ' + state.carcasses.length + ' next';
    setDockSub('Total ' + earnedNow + '/' + maxNow);
  }
}

function onNext() {
  window.scrollTo(0, 0);
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

let _imageModalReturnFocus = null;

// Shared full-screen image viewer — used by the drill's carcass image and
// by any clickable reference photo (e.g. field guide marbling specimens).
function openImageModal(src, alt) {
  _imageModalReturnFocus = document.activeElement;
  el.imageModalImg.src = src;
  el.imageModalImg.alt = alt || '';
  el.imageModal.classList.remove('hidden');
  el.imageModalClose.focus();
}

function closeImageModal() {
  el.imageModal.classList.add('hidden');
  if (_imageModalReturnFocus && typeof _imageModalReturnFocus.focus === 'function') {
    _imageModalReturnFocus.focus();
  }
  _imageModalReturnFocus = null;
}

function initImageModal() {
  el.carcassImage.addEventListener('click', () => {
    openImageModal(el.carcassImage.src, el.carcassImage.alt);
  });
  const zoomBtn = document.querySelector('.zoom-hint');
  if (zoomBtn) zoomBtn.addEventListener('click', () => {
    openImageModal(el.carcassImage.src, el.carcassImage.alt);
  });
  el.imageModalClose.addEventListener('click', closeImageModal);
  el.imageModal.addEventListener('click', e => {
    if (e.target === el.imageModal) closeImageModal();
  });
  // Field guide specimen photos
  document.querySelectorAll('.fg-specimen-view').forEach(btn => {
    btn.addEventListener('click', () => {
      openImageModal(btn.dataset.fullSrc, btn.dataset.fullAlt);
    });
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

  const n = state.answers.length;
  const exact = state.answers.filter(a => a.score === 10).length;
  const near = state.answers.filter(a => resultTier(a.score) === 'near').length;
  const miss = n - exact - near;

  el.summaryTotal.innerHTML = `${earned}<span class="sm-of"> / ${max}</span>`;
  el.summaryPct.textContent = `${p}%`;
  el.summaryExact.textContent = `${exact} of ${n}`;
  el.summaryNear.textContent = String(near);
  el.summarySub.textContent = `${n} ${n === 1 ? 'carcass' : 'carcasses'} graded. Each call below is scored against the official call.`;

  // One cell per carcass, same read as the Weekly "Your result" panel
  el.summaryStrip.style.setProperty('--n', String(Math.max(n, 1)));
  el.summaryStrip.setAttribute('aria-label',
    'Carcass by carcass: ' + exact + ' exact, ' + near + ' within a third, ' + miss + (miss === 1 ? ' miss' : ' misses'));
  el.summaryStrip.classList.toggle('sm-strip--dense', n > 18);
  el.summaryStrip.innerHTML = state.answers.map(a =>
    `<i class="${resultTier(a.score)}"><b>${a.score}</b></i>`).join('');
  el.summaryLegend.textContent = n ? `Carcass 1 to ${n}, points each: exact, within a third, miss` : '';

  // Perfect session: Certified Prime badge
  const certStamp = document.getElementById('summary-cert-stamp');
  if (certStamp) certStamp.classList.toggle('hidden', !(max > 0 && earned === max));

  let html = `
    <thead><tr>
      <th class="num c-n">#</th><th class="c-name">Carcass</th><th class="c-you">Your call</th><th class="c-key">Correct</th><th class="num c-pts">Pts</th>
    </tr></thead><tbody>`;

  state.answers.forEach((a, i) => {
    const cls = { ok: 'row-good', near: 'row-ok', miss: 'row-bad' }[resultTier(a.score)];
    html += `<tr class="${cls}">
      <td class="num c-n">${i + 1}</td>
      <td class="c-name">${escapeHtml(a.carcassName)}</td>
      <td class="c-you" data-k="You">${escapeHtml(a.userQualityLabel)}</td>
      <td class="c-key" data-k="Official call">${escapeHtml(a.correctQualityLabel)}</td>
      <td class="num c-pts">${a.score}</td>
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
      <span class="url-dot url-checking" data-url="${escapeAttr(c.imageUrl)}" title="Checking…">●</span>
      <span class="custom-item-info">
        <span class="custom-item-name">${escapeHtml(c.imageName)}</span>
        <span class="custom-item-grade">${escapeHtml(gradeLabel)}</span>
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
  el.formSectionLabel.textContent = 'Edit carcass';
  el.addCustomBtn.textContent = 'Save changes';
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
  el.addCustomBtn.textContent = 'Add to my set';
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
  if (!state.communitySet.length) {
    el.communitySetSub.textContent = 'No community carcasses yet';
  } else {
    const n = state.communitySet.length;
    el.communitySetSub.textContent = n + (n === 1 ? ' carcass, shuffled' : ' carcasses, shuffled');
  }
}

async function loadCommunitySet() {
  if (!window._db) {
    updateCommunityLabel();
    renderCommunityList();
    return;
  }
  if (el.communityStatus) el.communityStatus.textContent = 'Loading…';
  try {
    const snap = await window._db
      .collection(DB_COLLECTIONS.community_carcasses)
      .orderBy('submittedAt', 'desc')
      .limit(100)
      .get();
    state.communitySet = snap.docs
      .map(d => Object.assign({ id: d.id }, d.data()))
      // Legacy docs may carry grades no longer offered in the drill
      // (Commercial, Average Select) — those can't be answered, skip them.
      .filter(r => r.imageUrl && r.correct && r.correct.qualityGrade &&
        GRADE_MAP[r.correct.qualityGrade] && !GRADE_MAP[r.correct.qualityGrade].collegiateOnly);
  } catch (e) {
    state.communitySet = [];
    if (el.communityStatus) el.communityStatus.textContent = 'Could not load community set: ' + e.message;
  }
  updateCommunityLabel();
  renderCommunityList();
}

// ------------------------------------------------------------------
//  AI SET
// ------------------------------------------------------------------

function updateAiLabel() {
  if (!el.aiSetSub) return;
  if (!state.aiSet.length) {
    el.aiSetSub.textContent = 'No AI-graded carcasses available';
  } else {
    el.aiSetSub.textContent = state.aiSet.length + ' AI-graded carcasses';
  }
}

async function loadAiSet() {
  if (!window._db) {
    updateAiLabel();
    return;
  }
  try {
    const snap = await window._db
      .collection(DB_COLLECTIONS.ai_carcasses)
      .orderBy('submittedAt', 'desc')
      .limit(500)
      .get();
    state.aiSet = snap.docs
      .map(d => Object.assign({ id: d.id }, d.data()))
      .filter(r => r.imageUrl && r.correct && r.correct.qualityGrade);
  } catch (e) {
    state.aiSet = [];
    if (el.aiSetSub) el.aiSetSub.textContent = 'Could not load AI set';
    return;
  }
  updateAiLabel();
}

async function onSubmitToCommunity() {
  if (!window._currentUser) {
    alert('Please sign in to submit to the community set.');
    return;
  }
  if (!window._db) {
    alert('Database not available. Please refresh and try again.');
    return;
  }
  const url   = el.customUrl.value.trim();
  const name  = el.customName.value.trim() || 'Community Carcass';
  const qKey  = el.customQuality.value;
  const notes = el.customNotes.value.trim();
  if (!url)  { alert('Please enter an image URL.'); return; }
  if (!url.startsWith('https://')) { alert('Image URL must start with https://'); return; }
  if (!qKey) { alert('Please select a quality grade.'); return; }

  const record = {
    id: 'community-' + Date.now(),
    imageName: name,
    imageUrl: url,
    source: 'Community',
    correct: { qualityGrade: qKey },
    notes: notes,
    submittedBy: window._currentUser.uid,
    submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  el.submitCommunityBtn.disabled = true;
  el.submitCommunityBtn.textContent = 'Submitting…';
  try {
    await window._db.collection(DB_COLLECTIONS.community_carcasses).add(record);
    await loadCommunitySet();
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
  if (!state.communitySet.length) {
    el.communityStatus.textContent = 'No community carcasses yet. Use "Submit to Community" to add the first one!';
    el.communityList.innerHTML = '';
    return;
  }
  el.communityStatus.textContent = state.communitySet.length + ' carcasses in the community set.';
  let html = '<ul>';
  state.communitySet.forEach(c => {
    const qg = GRADE_MAP[c.correct.qualityGrade];
    const gradeLabel = qg ? qg.label : c.correct.qualityGrade;
    html += `<li>
      <span class="url-dot url-checking" data-url="${escapeAttr(c.imageUrl)}" title="Checking…">●</span>
      <span class="custom-item-info">
        <span class="custom-item-name">${escapeHtml(c.imageName)}</span>
        <span class="custom-item-grade">${escapeHtml(gradeLabel)}</span>
      </span>
    </li>`;
  });
  html += '</ul>';
  el.communityList.innerHTML = html;
  attachUrlDotChecks(el.communityList);
}

function buildCustomQualitySelector() {
  el.customQuality.innerHTML = '';
  QUALITY_GRADES.filter(g => !g.collegiateOnly).forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.key;
    opt.textContent = g.label;
    el.customQuality.appendChild(opt);
  });
}

let _settingsReturnFocus = null;

function openSettings() {
  cancelEdit();
  renderCustomList();
  renderCommunityList();
  _settingsReturnFocus = document.activeElement;
  el.settingsModal.classList.remove('hidden');
  el.settingsClose.focus();
}

function closeSettings() {
  el.settingsModal.classList.add('hidden');
  if (_settingsReturnFocus && typeof _settingsReturnFocus.focus === 'function') {
    _settingsReturnFocus.focus();
  }
  _settingsReturnFocus = null;
}

// ------------------------------------------------------------------
//  CONTRIBUTE — Crowdsource Grading Feature
// ------------------------------------------------------------------

// Grade definitions for the contribute grid (all 9 grades shown always)
const CONTRIBUTE_GRADES = [
  { key: 'PR_HI',  label: 'High Prime',    family: 'prime'    },
  { key: 'PR_AVG', label: 'Avg Prime',     family: 'prime'    },
  { key: 'PR_LO',  label: 'Low Prime',     family: 'prime'    },
  { key: 'CH_HI',  label: 'High Choice',   family: 'choice'   },
  { key: 'CH_AVG', label: 'Avg Choice',    family: 'choice'   },
  { key: 'CH_LO',  label: 'Low Choice',    family: 'choice'   },
  { key: 'SE_HI',  label: 'High Select',   family: 'select'   },
  { key: 'SE_LO',  label: 'Low Select',    family: 'select'   },
  { key: 'STD',    label: 'Standard',      family: 'standard' },
];

// Tracks current image in the modal
const _contributeState = {
  currentImageId:  null,
  currentImageUrl: null,
  sessionCount:    0,
};

function _buildContributeGradeGrid() {
  const grid = document.getElementById('contribute-grade-grid');
  if (!grid) return;
  grid.innerHTML = '';
  CONTRIBUTE_GRADES.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'contribute-grade-btn';
    btn.dataset.key = g.key;
    btn.dataset.family = g.family;
    btn.setAttribute('aria-label', g.label);
    btn.tabIndex = 0;

    const keyEl = document.createElement('span');
    keyEl.className = 'contribute-grade-key';
    keyEl.textContent = g.key;

    const nameEl = document.createElement('span');
    nameEl.className = 'contribute-grade-name';
    nameEl.textContent = g.label;

    btn.appendChild(keyEl);
    btn.appendChild(nameEl);
    grid.appendChild(btn);

    btn.addEventListener('click', () => {
      if (!_contributeState.currentImageId) return;
      submitContributeGrade(
        _contributeState.currentImageId,
        _contributeState.currentImageUrl,
        g.key
      );
    });
  });
}

function openContributeModal() {
  const modal = document.getElementById('contribute-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  const authPrompt   = document.getElementById('contribute-auth-prompt');
  const gradingArea  = document.getElementById('contribute-grading-area');
  const emptyState   = document.getElementById('contribute-empty');

  if (!window._currentUser) {
    authPrompt.classList.remove('hidden');
    gradingArea.classList.add('hidden');
    emptyState.classList.add('hidden');
  } else {
    authPrompt.classList.add('hidden');
    emptyState.classList.add('hidden');
    gradingArea.classList.remove('hidden');
    _buildContributeGradeGrid();
    loadContributeImage();
  }
}

function closeContributeModal() {
  const modal = document.getElementById('contribute-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  document.body.style.overflow = '';
}

async function loadContributeImage() {
  if (!window._db) return;

  const loadingEl = document.getElementById('contribute-img-loading');
  const img       = document.getElementById('contribute-img');
  const emptyEl   = document.getElementById('contribute-empty');
  const gradingEl = document.getElementById('contribute-grading-area');

  if (loadingEl) loadingEl.style.display = 'flex';
  if (img)       img.style.opacity = '0';

  try {
    // Fetch up to 20 lowest-vote images, then pick a random one
    const snap = await window._db
      .collection(DB_COLLECTIONS.ai_carcasses)
      .orderBy('voteCount', 'asc')
      .limit(20)
      .get();

    if (snap.empty) {
      if (gradingEl)  gradingEl.classList.add('hidden');
      if (emptyEl)    emptyEl.classList.remove('hidden');
      if (loadingEl)  loadingEl.style.display = 'none';
      return;
    }

    const docs = snap.docs;
    const randomDoc = docs[Math.floor(Math.random() * docs.length)];
    const data = randomDoc.data();

    _contributeState.currentImageId  = randomDoc.id;
    _contributeState.currentImageUrl = data.imageUrl;

    if (img && data.imageUrl) {
      img.onload = () => {
        img.style.opacity = '1';
        if (loadingEl) loadingEl.style.display = 'none';
      };
      img.onerror = () => {
        img.style.opacity = '0.3';
        if (loadingEl) {
          loadingEl.textContent = 'Image could not be loaded';
          loadingEl.style.display = 'flex';
        }
      };
      img.src = data.imageUrl;
      img.alt = 'Ribeye carcass for grading';
    } else {
      if (loadingEl) loadingEl.style.display = 'none';
    }

  } catch (e) {
    if (loadingEl) {
      loadingEl.textContent = 'Could not load image: ' + escapeHtml(e.message);
      loadingEl.style.display = 'flex';
    }
  }
}

async function submitContributeGrade(imageId, imageUrl, gradeKey) {
  if (!window._currentUser) return;
  if (!window._db) return;

  // Disable all grade buttons while submitting
  const grid = document.getElementById('contribute-grade-grid');
  const btns = grid ? grid.querySelectorAll('.contribute-grade-btn') : [];
  btns.forEach(b => { b.disabled = true; });

  try {
    await window._db.collection(DB_COLLECTIONS.grading_votes).add({
      imageId:     imageId,
      imageUrl:    imageUrl,
      userId:      window._currentUser.uid,
      grade:       gradeKey,
      submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    // Bump voteCount so this image rotates out of the low-vote pool.
    // The vote above is already recorded and is the source of truth, so a
    // failure here should never block the user's grade from having counted.
    try {
      await window._db.collection(DB_COLLECTIONS.ai_carcasses).doc(imageId).update({
        voteCount: firebase.firestore.FieldValue.increment(1)
      });
    } catch (voteCountErr) {
      // Non-fatal: image ordering is a display aid, not the source of truth.
    }

    _contributeState.sessionCount++;
    const progressEl = document.getElementById('contribute-progress-text');
    if (progressEl) {
      progressEl.textContent =
        'You\u2019ve graded ' + _contributeState.sessionCount +
        ' image' + (_contributeState.sessionCount === 1 ? '' : 's');
    }

    // Update the home card counter optimistically
    const numEl = document.getElementById('contribute-counter-num');
    if (numEl && !isNaN(parseInt(numEl.textContent, 10))) {
      numEl.textContent = String(parseInt(numEl.textContent, 10) + 1);
    }

    // Load next image then re-enable buttons
    await loadContributeImage();
    btns.forEach(b => { b.disabled = false; });

  } catch (e) {
    // Re-enable buttons on failure so user can retry
    btns.forEach(b => { b.disabled = false; });
    alert('Could not save grade: ' + e.message);
  }
}

async function loadContributeStats() {
  if (!window._db) return;
  const numEl = document.getElementById('contribute-counter-num');
  if (!numEl) return;
  try {
    // Count all documents in grading_votes using a lightweight query
    const snap = await window._db
      .collection(DB_COLLECTIONS.grading_votes)
      .get();
    numEl.textContent = String(snap.size);
  } catch (e) {
    numEl.textContent = '—';
  }
}

// ------------------------------------------------------------------
//  SLASH NAV — shared page-nav links (every screen but the landing)
// ------------------------------------------------------------------

function pageNavGo(target) {
  const lbScreen = document.getElementById('leaderboard-screen');
  const fgScreen = document.getElementById('fieldguide-screen');
  const lbOpen = lbScreen && !lbScreen.classList.contains('hidden');
  const toWeekly = target === 'weekly' || target === 'leaderboard';
  // Leaving the weekly page via the nav drops the live listener without
  // restoring the screen it was opened from.
  if (lbOpen && !toWeekly && typeof hideLeaderboardScreen === 'function') {
    hideLeaderboardScreen({ restore: false });
  }
  if (fgScreen && !fgScreen.classList.contains('hidden')) {
    hideFieldGuideScreen();
  }
  if (target === 'practice') {
    renderHomeScreen();
  } else if ((target === 'weekly' || target === 'leaderboard') && typeof showLeaderboardScreen === 'function') {
    showLeaderboardScreen();
  } else if (target === 'fieldguide') {
    showFieldGuideScreen();
  }
}

// Mark the current page's link in the shared nav. Watches the four screens'
// class changes, so none of the routers need to know about it.
function initSiteNavCurrent() {
  const map = {
    'home-screen': 'practice',
    'leaderboard-screen': 'weekly',
    'powerrank-screen': 'rankings',
    'fieldguide-screen': 'fieldguide'
  };
  const links = document.querySelectorAll('#site-nav .pnav-link');
  const update = () => {
    let current = null;
    Object.keys(map).forEach(id => {
      const node = document.getElementById(id);
      if (node && !node.classList.contains('hidden')) current = map[id];
    });
    links.forEach(a => {
      if (a.dataset.nav === current) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  };
  const obs = new MutationObserver(update);
  Object.keys(map).forEach(id => {
    const node = document.getElementById(id);
    if (node) obs.observe(node, { attributes: true, attributeFilter: ['class'] });
  });
  update();
}

// ------------------------------------------------------------------
//  FIELD GUIDE SCREEN
// ------------------------------------------------------------------

let _fieldGuideReturn = 'landing'; // 'landing' or 'home'

// fromLanding: pass true when invoked from the landing nav (the landing
// exit animation hides the hero before this runs, so it can't be detected).
function showFieldGuideScreen(fromLanding) {
  const landing = document.getElementById('landing-hero');
  _fieldGuideReturn = (fromLanding === true ||
    (landing && !landing.classList.contains('hidden'))) ? 'landing' : 'home';

  document.querySelectorAll('main.screen').forEach(s => s.classList.add('hidden'));
  const drill = document.getElementById('drill-screen');
  if (drill) drill.classList.add('hidden');
  const header = document.getElementById('app-header');
  if (header) header.classList.add('hidden');
  if (landing) landing.classList.add('hidden');

  const fg = document.getElementById('fieldguide-screen');
  if (fg) fg.classList.remove('hidden');
  window.scrollTo(0, 0);
}

function hideFieldGuideScreen() {
  const fg = document.getElementById('fieldguide-screen');
  if (fg) fg.classList.add('hidden');
  if (_fieldGuideReturn === 'landing') {
    const landing = document.getElementById('landing-hero');
    if (landing) {
      landing.classList.remove('hidden', 'landing-exit');
      landing.style.opacity = '';
    }
  } else {
    const home = document.getElementById('home-screen');
    if (home) home.classList.remove('hidden');
  }
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

  // Start
  el.startBtn.addEventListener('click', () => {
    // No silent fallback to DEFAULT_CARCASSES — placeholders never enter a deck.
    let deck, emptyMsg;
    if (el.useCustomSetToggle.checked) {
      deck = getCustomList();
      emptyMsg = 'Your personal set is empty. Add images in Manage Photos, or uncheck the toggle to use community carcasses.';
    } else {
      deck = state.communitySet;
      emptyMsg = 'No practice carcasses are available right now. Try Refresh in Manage Photos, or check back soon.';
    }
    if (!deck.length) {
      if (el.startError) {
        el.startError.textContent = emptyMsg;
        el.startError.classList.remove('hidden');
      }
      return;
    }
    if (el.startError) el.startError.classList.add('hidden');
    startSession(deck);
  });

  // Clear the start error when the deck source changes
  el.useCustomSetToggle.addEventListener('change', () => {
    if (el.startError) el.startError.classList.add('hidden');
  });

  // Field guide back / practice buttons
  const fgBackBtn = document.getElementById('fieldguide-back-btn');
  if (fgBackBtn) fgBackBtn.addEventListener('click', hideFieldGuideScreen);
  // "Review the Field Guide" links on the setup views
  document.querySelectorAll('.setup-fieldguide-link').forEach(btn => {
    btn.addEventListener('click', () => showFieldGuideScreen());
  });

  // Slash nav — same links row on setup, leaderboard, and field guide
  document.querySelectorAll('.pnav-link').forEach(btn => {
    btn.addEventListener('click', () => pageNavGo(btn.dataset.nav));
  });
  initSiteNavCurrent();
  const fgDrillBtn = document.getElementById('fieldguide-drill-btn');
  if (fgDrillBtn) {
    fgDrillBtn.addEventListener('click', () => {
      document.getElementById('fieldguide-screen').classList.add('hidden');
      renderHomeScreen();
    });
  }

  // Drill actions
  el.submitBtn.addEventListener('click', onSubmit);
  el.nextBtn.addEventListener('click', onNext);

  // Summary
  el.restartBtn.addEventListener('click', () => { state.sessionActive = false; renderHomeScreen(); });
  el.exportBtn.addEventListener('click', onExport);

  // Settings — open from both header gear and home "Manage Photos" button
  el.settingsBtn.addEventListener('click', openSettings);
  el.managePhotosBtn.addEventListener('click', openSettings);

  el.settingsClose.addEventListener('click', closeSettings);
  el.settingsModal.addEventListener('click', e => {
    if (e.target === el.settingsModal) closeSettings();
  });

  // Escape closes whichever modal is open (topmost first)
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!el.imageModal.classList.contains('hidden')) { closeImageModal(); return; }
    if (!el.settingsModal.classList.contains('hidden')) closeSettings();
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

  // ── Contribute feature ──────────────────────────────────────
  const contributeStartBtn = document.getElementById('contribute-start-btn');
  if (contributeStartBtn) {
    contributeStartBtn.addEventListener('click', openContributeModal);
  }

  const contributeCloseBtn = document.getElementById('contribute-modal-close');
  if (contributeCloseBtn) {
    contributeCloseBtn.addEventListener('click', closeContributeModal);
  }

  const contributeModal = document.getElementById('contribute-modal');
  if (contributeModal) {
    // Close on Escape key
    contributeModal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeContributeModal();
    });
  }

  const contributeSigninBtn = document.getElementById('contribute-signin-btn');
  if (contributeSigninBtn) {
    contributeSigninBtn.addEventListener('click', () => {
      closeContributeModal();
      if (typeof openAuthModal === 'function') openAuthModal();
    });
  }

  const contributeSkipBtn = document.getElementById('contribute-skip-btn');
  if (contributeSkipBtn) {
    contributeSkipBtn.addEventListener('click', loadContributeImage);
  }

  // Re-check auth in modal when auth state changes (user signs in while modal open)
  document.addEventListener('authStateChanged', () => {
    const modal = document.getElementById('contribute-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    const authPrompt  = document.getElementById('contribute-auth-prompt');
    const gradingArea = document.getElementById('contribute-grading-area');
    const emptyEl     = document.getElementById('contribute-empty');
    if (window._currentUser) {
      if (authPrompt)  authPrompt.classList.add('hidden');
      if (emptyEl)     emptyEl.classList.add('hidden');
      if (gradingArea) gradingArea.classList.remove('hidden');
      _buildContributeGradeGrid();
      loadContributeImage();
    }
  });

  // Load the community grade count for the home card
  loadContributeStats();

  renderHomeScreen();
}

document.addEventListener('DOMContentLoaded', init);

// Landing nav slab: [data-proxy] buttons forward to the existing landing buttons;
// [data-nav] opens a section through the shared pageNavGo (powerrank.js wraps it).
document.addEventListener('click', (e) => {
  if (!e.target.closest) return;
  const proxy = e.target.closest('[data-proxy]');
  if (proxy) { document.getElementById(proxy.dataset.proxy)?.click(); return; }
  const nav = e.target.closest('.landing-nav [data-nav], .landing-footer [data-nav]');
  if (nav) {
    const landing = document.getElementById('landing-hero');
    if (landing && !landing.classList.contains('hidden')) landing.classList.add('hidden');
    if (typeof window.pageNavGo === 'function') window.pageNavGo(nav.dataset.nav);
    else if (nav.dataset.nav === 'rankings' && typeof window.showPowerRankScreen === 'function') window.showPowerRankScreen();
    return;
  }
  // Plate view: marbling map (default) or photo.
  const view = e.target.closest('.landing-view-btn');
  if (view) {
    const plate = document.getElementById('landing-plate');
    if (!plate) return;
    plate.classList.toggle('is-photo', view.dataset.view === 'photo');
    view.parentElement.querySelectorAll('.landing-view-btn').forEach((b) => {
      b.setAttribute('aria-pressed', String(b === view));
    });
  }
});

// The view control is inert without script, so it stays hidden until now.
document.querySelector('.landing-view')?.removeAttribute('hidden');
