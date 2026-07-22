/* ============================================================
   POWER RANKINGS — powerrank.js
   Collegiate meat judging team power rankings (OWGR-style).

   Part 1: pure rating engine — computePowerRankings(contests, opts)
   Part 2: section controller — Firestore load of `meat_contests`
           (public read, no auth gating) + Rollmark UI rendering.

   Depends on: admin.html markup (#powerrank-screen, inside the Power
   Rankings tab's "Public Rankings Preview" — not currently linked from
   the public site while the ranking methodology is still being refined),
   auth.js (window._db). pageNavGo / renderHomeScreen (app.js) are
   optional globals guarded at call time, for when this eventually moves
   back to index.html.
   Self-test: open the page with location.hash === '#prtest' to
   render a hardcoded fixture instead of Firestore data.
   ============================================================ */

'use strict';

/* ════════════════════════════════════════════════════════════
   PART 1 — RATING ENGINE (pure functions)
   ════════════════════════════════════════════════════════════ */

// LSJ large-field placement table, places 1..10 (n >= 10)
const PR_LARGE_FIELD_TOP10 = [2.00, 1.90, 1.80, 1.70, 1.60, 1.50, 1.45, 1.40, 1.35, 1.30];

/* placementFactor(place, n)
   - n >= 10 : LSJ's large-field table, exactly.
   - 2..9    : smooth small-field curve. q = (place-1)/(n-1), clamped to
               [0,1] so bad data (place > n) degrades gracefully instead
               of poisoning the whole board — see NaN guard note below;
               pf = 1.10 + 0.80 * (1-q)^1.4  (winner ≈ 1.90, last = 1.10)
   - n == 1  : 1.0 (uncontested result carries no placement signal) */
function placementFactor(place, n) {
  if (!(n >= 2)) return 1.0;
  if (n >= 10) {
    if (place <= 10) return PR_LARGE_FIELD_TOP10[place - 1];
    if (place <= 20) return 1.275 - (place - 11) * 0.025; // 11 → 1.275 … 20 → 1.05
    if (place === 21) return 1.00;
    if (place <= 30) return 0.99 - (place - 22) * 0.01;   // 22 → 0.99 … 30 → 0.91
    return 0.90;
  }
  // NaN guard: malformed input (place > n, e.g. a bad teamCount) makes
  // q > 1, so (1-q) goes negative and Math.pow(negative, 1.4) is NaN,
  // which then poisons the mean-normalization step for every school in
  // that season/division. Clamping q to [0,1] makes a bad row degrade
  // to the small-field floor (pf = 1.10) instead of blanking the board.
  const q = _prClamp((place - 1) / (n - 1), 0, 1);
  return 1.10 + (1.90 - 1.10) * Math.pow(1 - q, 1.4);
}

function _prClamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// Days between an ISO yyyy-mm-dd date string and `today`.
function _prDaysSince(dateStr, today) {
  const d = new Date(String(dateStr) + 'T00:00:00');
  if (isNaN(d.getTime())) return 0;
  return (today.getTime() - d.getTime()) / 86400000;
}

/* Flatten contests into per-contest entry groups.
   Dedups defensively: keeps the best (lowest) place per school per
   contest. For category runs, uses categories[category].place where
   present and field size n = number of teams carrying that category;
   overall runs use `place` and `teamCount`. */
function _prBuildEntries(contests, category) {
  const groups = [];
  contests.forEach((contest) => {
    if (!contest || !Array.isArray(contest.results)) return;
    const bySchool = new Map();
    contest.results.forEach((r) => {
      if (!r || typeof r.school !== 'string' || !r.school.trim()) return;
      let place;
      let score = null;
      if (category) {
        const cat = r.categories && r.categories[category];
        if (!cat || typeof cat.place !== 'number' || !(cat.place >= 1)) return;
        place = cat.place;
        if (typeof cat.score === 'number') score = cat.score;
      } else {
        if (typeof r.place !== 'number' || !(r.place >= 1)) return;
        place = r.place;
        if (typeof r.score === 'number') score = r.score;
      }
      const school = r.school.trim();
      const prev = bySchool.get(school);
      if (!prev || place < prev.place) bySchool.set(school, { school, place, score });
    });
    if (bySchool.size === 0) return;
    const n = category
      ? bySchool.size
      : ((typeof contest.teamCount === 'number' && contest.teamCount > 0)
          ? contest.teamCount
          : bySchool.size);
    groups.push({ contest, n, results: Array.from(bySchool.values()) });
  });
  return groups;
}

/* Core solver. Returns rows sorted best-first (no movement yet):
   [{ school, rating (raw), contestsCounted, resultsUsed }]
   With wantDetail, each row also carries `detail`: the per-result
   breakdown from the final converged pass, sorted by date desc:
   [{ shortName, date, place, fieldSize, score, resultRating, counted }]

   A school's rating is the mean of its own top-5 real resultRatings this
   season (or however many it has, if fewer than 5) — no padding, no
   cross-season blending. A thin résumé simply gets whatever its own small
   sample says; see computePowerRankings for the separate participation
   threshold that keeps thin résumés out of the numbered ranking entirely
   rather than trying to estimate what they "would have" scored. */
function _prSolve(contests, category, today, wantDetail) {
  const groups = _prBuildEntries(contests, category);
  if (groups.length === 0) return [];

  // Static part of each result rating: pf * recency * fieldFactor.
  // `weight` is stored separately (NOT folded into base) — it amplifies
  // deviation from the centered 1.0 baseline after normalization, not
  // the raw value. See the amplification step in the iteration loop
  // below for why: a flat multiplier here would make merely ATTENDING a
  // weighted contest (International) worth more than winning elsewhere,
  // since placementFactor never drops much below ~0.90 even for a bad
  // placement, and ×2 on that floor rivals an unweighted great result.
  const results = []; // { school, place, score, groupIndex, base, weight }
  groups.forEach((g, gi) => {
    const w = (typeof g.contest.weight === 'number' && g.contest.weight >= 1 && g.contest.weight <= 2)
      ? g.contest.weight : 1;
    const recency = _prClamp(1.05 - _prDaysSince(g.contest.date, today) / 3650, 0.60, 1.05);
    const fieldFactor = 1 + 0.0025 * g.n;
    g.results.forEach((r) => {
      results.push({
        school: r.school,
        place: r.place,
        score: r.score,
        groupIndex: gi,
        base: placementFactor(r.place, g.n) * recency * fieldFactor,
        weight: w,
      });
    });
  });

  // Init every school rating at 1.00
  const ratings = new Map();
  results.forEach((r) => ratings.set(r.school, 1.0));

  // Contest strength pool: top-10-placed teams per contest (all if fewer)
  const topSchools = groups.map((g) =>
    g.results.slice().sort((a, b) => a.place - b.place).slice(0, 10).map((r) => r.school)
  );

  // Iterate to convergence (max 60 passes, stop when max |Δ| < 1e-6)
  for (let iter = 0; iter < 60; iter++) {
    const strengths = topSchools.map((list) =>
      list.reduce((s, sc) => s + ratings.get(sc), 0) / list.length
    );

    let resultRatings = results.map((r) => r.base * strengths[r.groupIndex]);

    // Normalize — re-center on 1.0 to prevent drift across iterations
    const mean1 = resultRatings.reduce((a, b) => a + b, 0) / resultRatings.length;
    if (mean1 > 0) resultRatings = resultRatings.map((v) => v / mean1);

    // Weight amplifies deviation from the centered baseline, not the raw
    // value — a great result at a 2x contest (International) gets pushed
    // further above 1.0, a bad one further below; a near-average result
    // barely moves either way. Re-normalize afterward: amplifying an
    // asymmetric spread of deviations can drift the mean slightly.
    resultRatings = resultRatings.map((v, i) => 1.0 + results[i].weight * (v - 1.0));
    const mean2 = resultRatings.reduce((a, b) => a + b, 0) / resultRatings.length;
    if (mean2 > 0) resultRatings = resultRatings.map((v) => v / mean2);

    // School rating = mean of its own top-5 real resultRatings this season
    // (or however many it has, if fewer than 5) — no padding. A school
    // with 1 real result is rated purely on that result; participation
    // eligibility for the numbered ranking is handled separately by
    // computePowerRankings, not by inflating/diluting this number.
    const perSchool = new Map();
    results.forEach((r, i) => {
      if (!perSchool.has(r.school)) perSchool.set(r.school, []);
      perSchool.get(r.school).push(resultRatings[i]);
    });

    let maxDelta = 0;
    perSchool.forEach((vals, school) => {
      vals.sort((a, b) => b - a);
      const used = vals.slice(0, 5);
      const rating = used.reduce((a, b) => a + b, 0) / used.length;
      maxDelta = Math.max(maxDelta, Math.abs(rating - ratings.get(school)));
      ratings.set(school, rating);
    });

    if (maxDelta < 1e-6) break;
  }

  const counts = new Map();
  results.forEach((r) => counts.set(r.school, (counts.get(r.school) || 0) + 1));

  // Optional per-result breakdown from the final converged pass:
  // recompute resultRatings once with the converged ratings, then mark
  // which top-5 results actually feed each school's rating.
  let detailBySchool = null;
  if (wantDetail) {
    const strengths = topSchools.map((list) =>
      list.reduce((s, sc) => s + ratings.get(sc), 0) / list.length
    );
    let finalRR = results.map((r) => r.base * strengths[r.groupIndex]);
    const dMean1 = finalRR.reduce((a, b) => a + b, 0) / finalRR.length;
    if (dMean1 > 0) finalRR = finalRR.map((v) => v / dMean1);
    // Same weight-amplification + re-normalize sequence as the main loop,
    // so the detail panel's numbers match exactly what fed the rating.
    finalRR = finalRR.map((v, i) => 1.0 + results[i].weight * (v - 1.0));
    const dMean2 = finalRR.reduce((a, b) => a + b, 0) / finalRR.length;
    if (dMean2 > 0) finalRR = finalRR.map((v) => v / dMean2);

    detailBySchool = new Map();
    results.forEach((r, i) => {
      const contest = groups[r.groupIndex].contest;
      if (!detailBySchool.has(r.school)) detailBySchool.set(r.school, []);
      detailBySchool.get(r.school).push({
        shortName: (typeof contest.shortName === 'string' && contest.shortName)
          ? contest.shortName
          : (typeof contest.name === 'string' && contest.name ? contest.name : 'Contest'),
        date: String(contest.date || ''),
        place: r.place,
        fieldSize: groups[r.groupIndex].n,
        score: (typeof r.score === 'number') ? r.score : null,
        resultRating: finalRR[i],
        counted: false,
      });
    });
    detailBySchool.forEach((list) => {
      list.slice().sort((a, b) => b.resultRating - a.resultRating)
        .slice(0, 5)
        .forEach((item) => { item.counted = true; });
      list.sort((a, b) => b.date.localeCompare(a.date)); // date descending
    });
  }

  const rows = Array.from(ratings.entries()).map(([school, rating]) => {
    const row = {
      school,
      rating,
      contestsCounted: counts.get(school),
      resultsUsed: Math.min(5, counts.get(school)),
    };
    if (detailBySchool) row.detail = detailBySchool.get(school) || [];
    return row;
  });
  rows.sort((a, b) => (b.rating - a.rating) || a.school.localeCompare(b.school));
  return rows;
}

/* Public entry point.
   computePowerRankings(contests, {
     category = null, detail = false, season = null, division = null,
     today = new Date(),
   } = {})
   → sorted array of { school, rating, contestsCounted, resultsUsed,
     movement, qualified }

   `season` selects which season to rank; defaults to the max season
   present in `contests`. `division` defaults to the first contest's
   `division` field; pass it explicitly when it can't be inferred (e.g.
   an empty scope for the requested season).

   Participation threshold — a school only counts as `qualified: true`
   (eligible for a numbered rank) once it has at least
   `min(3, maxContestsAnyoneInThisSeasonAndDivisionPlayed)` real results
   this season. The cap on the "3" is required, not optional: some early
   archive seasons never had more than 1-2 tracked contests at all, so a
   flat "need 3" would leave those seasons' boards completely empty — the
   relative cap lets the bar relax to whatever was actually achievable
   that season while still requiring real breadth once enough contests
   exist for it to matter. Unqualified schools are still returned (with
   their real rating and results) so callers can show them in a separate
   "not yet ranked" list, they just shouldn't be assigned a rank number or
   compared head-to-head against qualified schools.

   With { detail: true }, each row additionally carries `detail`: the
   school's per-result breakdown from the final converged pass, sorted by
   date desc — [{ shortName, date, place, fieldSize, score, resultRating,
   counted }] — `counted` marks the top-5 results that feed the rating.
   Default return shape (no detail) is unchanged.

   Movement (nfelo-inspired): re-run the solver with the most recent
   contest (by date, within the target season) excluded; positive
   movement = moved up the board, null = not present in the previous run
   (rendered "NEW"). Never computes detail. */
function computePowerRankings(contests, opts) {
  const options = opts || {};
  const category = options.category || null;
  const wantDetail = options.detail === true;
  const today = (options.today instanceof Date) ? options.today : new Date();

  const divisionContests = Array.isArray(contests) ? contests.slice() : [];
  if (divisionContests.length === 0) return [];

  let season = (typeof options.season === 'number') ? options.season : null;
  if (season === null) {
    let max = -Infinity;
    divisionContests.forEach((c) => {
      if (typeof c.season === 'number' && c.season > max) max = c.season;
    });
    season = isFinite(max) ? max : null;
  }

  const scope = (season === null)
    ? divisionContests
    : divisionContests.filter((c) => c.season === season);

  const current = _prSolve(scope, category, today, wantDetail);
  if (current.length === 0) return [];

  let maxCounted = 0;
  current.forEach((row) => { if (row.contestsCounted > maxCounted) maxCounted = row.contestsCounted; });
  const threshold = Math.min(3, maxCounted);

  // Previous run: drop the single most recent contest (by date) within
  // the target season's scope only.
  const byDate = scope.slice().sort((a, b) =>
    String(a.date).localeCompare(String(b.date)) ||
    String(a.name || '').localeCompare(String(b.name || ''))
  );
  const previous = (byDate.length > 1)
    ? _prSolve(byDate.slice(0, -1), category, today, false)
    : [];

  const prevRank = new Map();
  previous.forEach((row, i) => prevRank.set(row.school, i + 1));

  return current.map((row, i) => {
    const prev = prevRank.get(row.school);
    const out = {
      school: row.school,
      rating: Math.round(row.rating * 1000) / 1000, // display rounding, 3 decimals
      contestsCounted: row.contestsCounted,
      resultsUsed: row.resultsUsed,
      movement: (prev === undefined) ? null : prev - (i + 1), // positive = moved up
      qualified: row.contestsCounted >= threshold,
    };
    if (wantDetail) out.detail = row.detail || [];
    return out;
  });
}

/* ════════════════════════════════════════════════════════════
   PART 2 — SECTION CONTROLLER
   ════════════════════════════════════════════════════════════ */

// Category keys + leaderboard titles (order = display order)
const PR_CATEGORY_META = [
  { key: 'beefGrading',    title: 'Best on the Rail' },
  { key: 'overallBeef',    title: 'Best in Beef' },
  { key: 'porkJudging',    title: 'Best in Pork' },
  { key: 'lambJudging',    title: 'Best in Lamb' },
  { key: 'reasons',        title: 'Best in Reasons' },
  { key: 'totalPlacings',  title: 'Best in Placings' },
  { key: 'specifications', title: 'Best in Specs' },
];

const _prState = {
  contests: null,     // cached array of contest docs (module cache)
  loading: false,
  division: 'senior', // 'senior' | 'junior'
  season: null,       // int, default most recent in data
};

function _prEscapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _prFormatDate(dateStr) {
  const d = new Date(String(dateStr) + 'T00:00:00');
  if (isNaN(d.getTime())) return String(dateStr || '');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ── Self-test fixture (#prtest) ─────────────────────────────
   Three senior contests (so ≥3-contest category cards render)
   + one junior contest (division toggle + NEW movement path). */
function _prFixtureContests() {
  const mk = (school, place, cats) => ({ school, place, categories: cats });
  return [
    {
      id: 'fx-2026-01-18_national-western_senior',
      name: 'National Western Fixture', shortName: 'National Western',
      date: '2026-01-18', season: 2026, division: 'senior', weight: 1, teamCount: 8,
      results: [
        mk('Texas Tech University', 1, {
          beefGrading: { place: 2 }, overallBeef: { place: 1 }, reasons: { place: 1 },
          porkJudging: { place: 3 }, totalPlacings: { place: 1 } }),
        mk('Oklahoma State University', 2, {
          beefGrading: { place: 1 }, overallBeef: { place: 2 }, reasons: { place: 3 },
          porkJudging: { place: 1 }, totalPlacings: { place: 2 } }),
        mk('Texas A&M University', 3, {
          beefGrading: { place: 3 }, overallBeef: { place: 3 }, reasons: { place: 2 },
          porkJudging: { place: 2 }, totalPlacings: { place: 4 } }),
        mk('Kansas State University', 4, {
          beefGrading: { place: 5 }, overallBeef: { place: 4 }, reasons: { place: 4 },
          porkJudging: { place: 4 }, totalPlacings: { place: 3 } }),
        mk('West Texas A&M University', 5, {
          beefGrading: { place: 4 }, overallBeef: { place: 5 }, reasons: { place: 6 } }),
        mk('Colorado State University', 6, {
          beefGrading: { place: 6 }, overallBeef: { place: 6 }, reasons: { place: 5 } }),
        mk('South Dakota State University', 7, {
          beefGrading: { place: 7 }, overallBeef: { place: 7 }, reasons: { place: 7 } }),
        mk('University of Wyoming', 8, {
          beefGrading: { place: 8 }, overallBeef: { place: 8 }, reasons: { place: 8 } }),
      ],
    },
    {
      id: 'fx-2026-02-01_southwestern_senior',
      name: 'Southwestern Fixture', shortName: 'Southwestern',
      date: '2026-02-01', season: 2026, division: 'senior', weight: 1, teamCount: 7,
      results: [
        mk('Oklahoma State University', 1, {
          beefGrading: { place: 1 }, overallBeef: { place: 1 }, reasons: { place: 2 } }),
        mk('Texas A&M University', 2, {
          beefGrading: { place: 3 }, overallBeef: { place: 2 }, reasons: { place: 1 } }),
        mk('Texas Tech University', 3, {
          beefGrading: { place: 2 }, overallBeef: { place: 3 }, reasons: { place: 3 } }),
        mk('West Texas A&M University', 4, {
          beefGrading: { place: 4 }, overallBeef: { place: 4 }, reasons: { place: 5 } }),
        mk('Kansas State University', 5, {
          beefGrading: { place: 5 }, overallBeef: { place: 5 }, reasons: { place: 4 } }),
        mk('Colorado State University', 6, {
          beefGrading: { place: 6 }, overallBeef: { place: 6 }, reasons: { place: 6 } }),
        mk('University of Nebraska', 7, {
          beefGrading: { place: 7 }, overallBeef: { place: 7 }, reasons: { place: 7 } }),
      ],
    },
    {
      id: 'fx-2026-03-01_houston_senior',
      name: 'Houston Fixture', shortName: 'Houston',
      date: '2026-03-01', season: 2026, division: 'senior', weight: 1, teamCount: 8,
      results: [
        mk('Texas A&M University', 1, {
          beefGrading: { place: 2 }, overallBeef: { place: 1 }, reasons: { place: 1 } }),
        mk('Texas Tech University', 2, {
          beefGrading: { place: 1 }, overallBeef: { place: 2 }, reasons: { place: 3 } }),
        mk('Kansas State University', 3, {
          beefGrading: { place: 3 }, overallBeef: { place: 3 }, reasons: { place: 2 } }),
        mk('Oklahoma State University', 4, {
          beefGrading: { place: 4 }, overallBeef: { place: 4 }, reasons: { place: 4 } }),
        mk('Colorado State University', 5, {
          beefGrading: { place: 5 }, overallBeef: { place: 5 }, reasons: { place: 5 } }),
        mk('South Dakota State University', 6, {
          beefGrading: { place: 6 }, overallBeef: { place: 6 }, reasons: { place: 6 } }),
        mk('University of Nebraska', 7, {
          beefGrading: { place: 7 }, overallBeef: { place: 8 }, reasons: { place: 7 } }),
        mk('University of Wyoming', 8, {
          beefGrading: { place: 8 }, overallBeef: { place: 7 }, reasons: { place: 8 } }),
      ],
    },
    {
      id: 'fx-2026-01-18_national-western_junior',
      name: 'National Western Fixture (Junior)', shortName: 'National Western',
      date: '2026-01-18', season: 2026, division: 'junior', weight: 1, teamCount: 4,
      results: [
        mk('Blinn College', 1, { beefGrading: { place: 1 }, reasons: { place: 2 } }),
        mk('Butler Community College', 2, { beefGrading: { place: 3 }, reasons: { place: 1 } }),
        mk('Clarendon College', 3, { beefGrading: { place: 2 }, reasons: { place: 3 } }),
        mk('Connors State College', 4, { beefGrading: { place: 4 }, reasons: { place: 4 } }),
      ],
    },
  ];
}

function _prIsTestMode() {
  return window.location.hash === '#prtest';
}

/* ── Data load — one getDocs on meat_contests, cached ──────── */
function _prLoadContests() {
  if (_prIsTestMode()) {
    return Promise.resolve(_prFixtureContests());
  }
  if (Array.isArray(_prState.contests)) {
    return Promise.resolve(_prState.contests);
  }
  if (!window._db) {
    return Promise.resolve([]);
  }
  const collectionName = (typeof DB_COLLECTIONS !== 'undefined' && DB_COLLECTIONS.meat_contests)
    ? DB_COLLECTIONS.meat_contests
    : 'meat_contests';
  return window._db.collection(collectionName).get().then((snapshot) => {
    const contests = [];
    snapshot.forEach((doc) => {
      const d = doc.data();
      // Minimal shape validation — skip malformed docs defensively
      if (!d || !Array.isArray(d.results) || typeof d.date !== 'string' ||
          (d.division !== 'senior' && d.division !== 'junior')) return;
      contests.push({ id: doc.id, ...d });
    });
    _prState.contests = contests;
    return contests;
  }).catch((err) => {
    console.error('[powerrank] Firestore error:', err);
    return [];
  });
}

/* ── Screen show / hide (leaderboard-screen pattern) ───────── */
function showPowerRankScreen() {
  document.querySelectorAll('main.screen').forEach((s) => s.classList.add('hidden'));
  const drill = document.getElementById('drill-screen');
  if (drill) drill.classList.add('hidden');
  const header = document.getElementById('app-header');
  if (header) header.classList.add('hidden');
  const landing = document.getElementById('landing-hero');
  if (landing) landing.classList.add('hidden');

  const screen = document.getElementById('powerrank-screen');
  if (screen) screen.classList.remove('hidden');
  window.scrollTo(0, 0);

  const tbody = document.getElementById('powerrank-tbody');
  if (tbody && !Array.isArray(_prState.contests) && !_prIsTestMode()) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="leaderboard-empty"><strong>Loading rankings&hellip;</strong></div></td></tr>`;
  }

  _prLoadContests().then((contests) => {
    _prInitSeason(contests);
    _prRender(contests);
  });
}

function hidePowerRankScreen() {
  const screen = document.getElementById('powerrank-screen');
  if (screen) screen.classList.add('hidden');
  if (typeof renderHomeScreen === 'function') {
    renderHomeScreen();
  } else {
    const home = document.getElementById('home-screen');
    if (home) home.classList.remove('hidden');
  }
}

/* ── Season handling ───────────────────────────────────────── */
function _prSeasons(contests) {
  const set = new Set();
  contests.forEach((c) => {
    if (typeof c.season === 'number' && isFinite(c.season)) set.add(c.season);
  });
  return Array.from(set).sort((a, b) => b - a); // most recent first
}

function _prInitSeason(contests) {
  const seasons = _prSeasons(contests);
  if (_prState.season === null || !seasons.includes(_prState.season)) {
    _prState.season = seasons.length ? seasons[0] : null;
  }
  const select = document.getElementById('powerrank-season');
  if (!select) return;
  if (seasons.length === 0) {
    select.innerHTML = '<option value="">&mdash;</option>';
    select.disabled = true;
    return;
  }
  select.disabled = false;
  select.innerHTML = seasons
    .map((s) => `<option value="${s}"${s === _prState.season ? ' selected' : ''}>${s}</option>`)
    .join('');
}

/* ── Render ────────────────────────────────────────────────── */
// Full history for the current division (all seasons) — needed so the
// shrinkage filler's prior-season lookback has data to walk through.
function _prDivisionScope(contests) {
  return contests.filter((c) => c.division === _prState.division);
}

// Current division, current season only — used for the category
// eligibility threshold and the "Contests in Ranking" list, which are
// intentionally scoped to the displayed season, not all history.
function _prSeasonScope(divisionContests) {
  return divisionContests.filter((c) =>
    _prState.season === null || c.season === _prState.season
  );
}

function _prRender(contests) {
  const divisionContests = _prDivisionScope(contests);
  const seasonScope = _prSeasonScope(divisionContests);

  const rows = computePowerRankings(divisionContests, {
    season: _prState.season, division: _prState.division, detail: true,
  });
  _prRenderTable(rows.filter((r) => r.qualified));
  _prRenderProvisional(rows.filter((r) => !r.qualified));
  _prRenderCategories(divisionContests, seasonScope);
  _prRenderContestList(seasonScope);
}

function _prOrdinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return n + 'th';
  switch (n % 10) {
    case 1: return n + 'st';
    case 2: return n + 'nd';
    case 3: return n + 'rd';
    default: return n + 'th';
  }
}

function _prMovementCell(movement) {
  if (movement === null) {
    return '<span class="pr-new-badge">New</span>';
  }
  if (movement > 0) {
    return `<span class="pr-move pr-move-up" aria-label="Up ${movement}">&#9650;${movement}</span>`;
  }
  if (movement < 0) {
    return `<span class="pr-move pr-move-down" aria-label="Down ${-movement}">&#9660;${-movement}</span>`;
  }
  return '<span class="pr-move pr-move-flat" aria-label="No change">&mdash;</span>';
}

function _prRankCell(rank) {
  if (rank === 1) return '<span class="rank-badge pr-rank-1st">1st</span>';
  if (rank === 2) return '<span class="rank-badge rank-2nd">2nd</span>';
  if (rank === 3) return '<span class="rank-badge rank-3rd">3rd</span>';
  return `<span class="pr-rank-num">${rank}</span>`;
}

/* Detail roll-down panel for one school's per-result breakdown.
   All contest strings originate in Firestore — escaped. */
function _prDetailPanel(row) {
  const detail = Array.isArray(row.detail) ? row.detail : [];
  const missing = Math.max(0, 5 - detail.length);
  const showMarkers = detail.length > 5; // mark top-5 only when some results miss the cut
  const items = detail.map((d) => {
    const counted = showMarkers && d.counted;
    return `<li class="pr-detail-item${counted ? ' pr-detail-item-counted' : ''}">
      <div class="pr-detail-main">
        <span class="pr-detail-contest">${_prEscapeHtml(d.shortName)}</span>
        <span class="pr-detail-date">${_prEscapeHtml(_prFormatDate(d.date))}</span>
      </div>
      <div class="pr-detail-nums">
        <span class="pr-detail-place">${_prOrdinal(d.place)} of ${d.fieldSize}</span>
        ${typeof d.score === 'number' ? `<span class="pr-detail-score">${d.score.toLocaleString('en-US')} pts</span>` : ''}
        <span class="pr-detail-rr" title="Engine result rating">${d.resultRating.toFixed(3)}</span>
        ${showMarkers
          ? (d.counted
              ? '<span class="pr-detail-flag">Counted</span>'
              : '<span class="pr-detail-flag pr-detail-flag-off" aria-label="Not counted">&mdash;</span>')
          : ''}
      </div>
    </li>`;
  }).join('');
  const countedNote = showMarkers
    ? '<p class="pr-detail-note">Only the five best results (marked Counted) feed the rating.</p>'
    : '';

  const fillerNote = (missing > 0 && detail.length > 0)
    ? `<p class="pr-detail-note">
        Rated on these ${detail.length} real result${detail.length === 1 ? '' : 's'} only &mdash;
        no assumed or estimated results fill the remaining slot${missing === 1 ? '' : 's'}.
      </p>`
    : '';

  return `<div class="pr-detail-panel">
    <div class="pr-detail-head">Season results &middot; place &middot; result rating</div>
    <ul class="pr-detail-list">${items}</ul>
    ${countedNote}
    ${fillerNote}
  </div>`;
}

const PR_CHEVRON_SVG = '<svg class="pr-chevron" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m9 18 6-6-6-6"/></svg>';

/* rows must already be filtered to qualified-only — rank is the 1-based
   position within this array, not overall array position across the full
   (qualified + provisional) result set. */
function _prRenderTable(rows) {
  const tbody = document.getElementById('powerrank-tbody');
  if (!tbody) return;

  if (!rows || rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5">
          <div class="leaderboard-empty">
            <strong>No contests on the books yet</strong>
            Team power rankings appear here once enough teams have enough results posted for this division and season.
          </div>
        </td>
      </tr>`;
    return;
  }

  // Re-render collapses everything: rows rebuild with all panels hidden.
  tbody.innerHTML = rows.map((row, i) => {
    const rank = i + 1;
    return `<tr class="pr-row${rank <= 3 ? ' pr-row-top' : ''}${rank === 1 ? ' pr-row-first' : ''}" data-pr-index="${i}">
      <td class="col-rank">${_prRankCell(rank)}</td>
      <td class="pr-col-school">
        <button type="button" class="pr-expand-btn" aria-expanded="false" aria-controls="pr-detail-${i}">
          ${PR_CHEVRON_SVG}
          <span class="pr-expand-school">${_prEscapeHtml(row.school)}</span>
        </button>
      </td>
      <td class="pr-col-rating">${row.rating.toFixed(3)}</td>
      <td class="pr-col-move">${_prMovementCell(row.movement)}</td>
      <td class="pr-col-contests">${row.contestsCounted}</td>
    </tr>
    <tr class="pr-detail-row" id="pr-detail-${i}" hidden>
      <td colspan="5">${_prDetailPanel(row)}</td>
    </tr>`;
  }).join('');

  // Row click (button clicks bubble here too; button gives Enter/Space +
  // aria semantics, the row gives the larger hit target). One panel open
  // at a time — opening a row closes the rest.
  tbody.querySelectorAll('.pr-row[data-pr-index]').forEach((tr) => {
    tr.addEventListener('click', () => {
      const idx = tr.getAttribute('data-pr-index');
      const detailRow = document.getElementById('pr-detail-' + idx);
      const btn = tr.querySelector('.pr-expand-btn');
      if (!detailRow || !btn) return;
      const wasOpen = !detailRow.hidden;
      tbody.querySelectorAll('.pr-detail-row').forEach((r) => { r.hidden = true; });
      tbody.querySelectorAll('.pr-expand-btn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
      if (!wasOpen) {
        detailRow.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });
}

/* Schools below the participation threshold: no rank number, no movement,
   listed alphabetically with their real results expandable via the same
   detail-panel markup used on the main table. */
function _prRenderProvisional(rows) {
  const block = document.getElementById('powerrank-provisional-block');
  const listEl = document.getElementById('powerrank-provisional-list');
  if (!block || !listEl) return;

  if (!rows || rows.length === 0) {
    block.hidden = true;
    listEl.innerHTML = '';
    return;
  }

  const sorted = rows.slice().sort((a, b) => a.school.localeCompare(b.school));
  block.hidden = false;
  listEl.innerHTML = sorted.map((row, i) => `
    <li class="pr-contest-row pr-prov-row" data-pr-prov-index="${i}">
      <button type="button" class="pr-expand-btn" aria-expanded="false" aria-controls="pr-prov-detail-${i}">
        ${PR_CHEVRON_SVG}
        <span class="pr-expand-school">${_prEscapeHtml(row.school)}</span>
      </button>
      <span class="pr-contest-meta">${row.contestsCounted} contest${row.contestsCounted === 1 ? '' : 's'}</span>
    </li>
    <li class="pr-detail-row" id="pr-prov-detail-${i}" hidden>${_prDetailPanel(row)}</li>
  `).join('');

  listEl.querySelectorAll('.pr-prov-row[data-pr-prov-index]').forEach((li) => {
    li.addEventListener('click', () => {
      const idx = li.getAttribute('data-pr-prov-index');
      const detailRow = document.getElementById('pr-prov-detail-' + idx);
      const btn = li.querySelector('.pr-expand-btn');
      if (!detailRow || !btn) return;
      const wasOpen = !detailRow.hidden;
      listEl.querySelectorAll('.pr-detail-row').forEach((r) => { r.hidden = true; });
      listEl.querySelectorAll('.pr-expand-btn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
      if (!wasOpen) {
        detailRow.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });
}

function _prContestsCarrying(scope, categoryKey) {
  return scope.filter((c) =>
    Array.isArray(c.results) && c.results.some((r) =>
      r && r.categories && r.categories[categoryKey] &&
      typeof r.categories[categoryKey].place === 'number'
    )
  ).length;
}

function _prRenderCategories(divisionContests, seasonScope) {
  const block = document.getElementById('powerrank-categories');
  const cardsEl = document.getElementById('powerrank-cards');
  if (!block || !cardsEl) return;

  const cards = [];
  PR_CATEGORY_META.forEach((meta) => {
    // Only render a category board when ≥ 3 contests THIS SEASON carry it
    if (_prContestsCarrying(seasonScope, meta.key) < 3) return;
    // Same participation-threshold gating as the overall board, scoped to
    // this category's own contest count per school.
    const rows = computePowerRankings(divisionContests, {
      category: meta.key, season: _prState.season, division: _prState.division,
    }).filter((r) => r.qualified).slice(0, 3);
    if (rows.length === 0) return;
    const items = rows.map((row, i) => `
      <li class="pr-card-row">
        <span class="pr-card-rank">${i + 1}</span>
        <span class="pr-card-school">${_prEscapeHtml(row.school)}</span>
        <span class="pr-card-rating">${row.rating.toFixed(3)}</span>
      </li>`).join('');
    cards.push(`
      <article class="pr-card">
        <h3 class="pr-card-stamp">${_prEscapeHtml(meta.title)}</h3>
        <ol class="pr-card-list">${items}</ol>
      </article>`);
  });

  if (cards.length === 0) {
    block.hidden = true;
    cardsEl.innerHTML = '';
    return;
  }
  block.hidden = false;
  cardsEl.innerHTML = cards.join('');
}

function _prRenderContestList(scope) {
  const block = document.getElementById('powerrank-contests-block');
  const listEl = document.getElementById('powerrank-contest-list');
  if (!block || !listEl) return;

  if (!scope || scope.length === 0) {
    block.hidden = true;
    listEl.innerHTML = '';
    return;
  }

  const sorted = scope.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  block.hidden = false;
  listEl.innerHTML = sorted.map((c) => {
    let winner = null;
    (c.results || []).forEach((r) => {
      if (r && typeof r.place === 'number' && typeof r.school === 'string' &&
          (!winner || r.place < winner.place)) {
        winner = { place: r.place, school: r.school.trim() };
      }
    });
    const teams = (typeof c.teamCount === 'number' && c.teamCount > 0)
      ? c.teamCount : (c.results || []).length;
    return `<li class="pr-contest-row">
      <div class="pr-contest-main">
        <span class="pr-contest-name">${_prEscapeHtml(c.shortName || c.name || 'Contest')}</span>
        <span class="pr-contest-date">${_prEscapeHtml(_prFormatDate(c.date))}</span>
      </div>
      <div class="pr-contest-meta">
        <span>${teams} teams</span>
        ${winner ? `<span class="pr-contest-winner">Won by ${_prEscapeHtml(winner.school)}</span>` : ''}
      </div>
    </li>`;
  }).join('');
}

/* ── Division toggle ───────────────────────────────────────── */
function _prSetDivision(division) {
  _prState.division = division;
  const seniorBtn = document.getElementById('powerrank-tab-senior');
  const juniorBtn = document.getElementById('powerrank-tab-junior');
  if (seniorBtn) {
    seniorBtn.classList.toggle('active', division === 'senior');
    seniorBtn.setAttribute('aria-pressed', String(division === 'senior'));
  }
  if (juniorBtn) {
    juniorBtn.classList.toggle('active', division === 'junior');
    juniorBtn.setAttribute('aria-pressed', String(division === 'junior'));
  }
  _prLoadContests().then((contests) => _prRender(contests));
}

/* ── Wire-up ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const backBtn = document.getElementById('powerrank-back-btn');
  if (backBtn) backBtn.addEventListener('click', hidePowerRankScreen);

  const seniorBtn = document.getElementById('powerrank-tab-senior');
  if (seniorBtn) seniorBtn.addEventListener('click', () => _prSetDivision('senior'));

  const juniorBtn = document.getElementById('powerrank-tab-junior');
  if (juniorBtn) juniorBtn.addEventListener('click', () => _prSetDivision('junior'));

  const seasonSelect = document.getElementById('powerrank-season');
  if (seasonSelect) {
    seasonSelect.addEventListener('change', () => {
      const v = parseInt(seasonSelect.value, 10);
      _prState.season = isNaN(v) ? null : v;
      _prLoadContests().then((contests) => _prRender(contests));
    });
  }

  // Route the shared slash nav's "rankings" target through this section.
  // app.js resolves pageNavGo at call time, so wrapping the global works
  // without touching app.js.
  if (typeof window.pageNavGo === 'function' && !window._prNavPatched) {
    const _origPageNavGo = window.pageNavGo;
    window.pageNavGo = function (target) {
      const prScreen = document.getElementById('powerrank-screen');
      if (prScreen && !prScreen.classList.contains('hidden')) {
        prScreen.classList.add('hidden');
      }
      if (target === 'rankings') {
        const lb = document.getElementById('leaderboard-screen');
        if (lb && !lb.classList.contains('hidden') &&
            typeof hideLeaderboardScreen === 'function') hideLeaderboardScreen();
        const fg = document.getElementById('fieldguide-screen');
        if (fg && !fg.classList.contains('hidden') &&
            typeof hideFieldGuideScreen === 'function') hideFieldGuideScreen();
        showPowerRankScreen();
        return;
      }
      _origPageNavGo(target);
    };
    window._prNavPatched = true;
  }

  // Self-test mode: jump straight to the section with fixture data
  if (_prIsTestMode()) {
    showPowerRankScreen();
  }

  // Expose globally (same pattern as leaderboard.js)
  window.showPowerRankScreen = showPowerRankScreen;
  window.hidePowerRankScreen = hidePowerRankScreen;
  window.computePowerRankings = computePowerRankings;
});
