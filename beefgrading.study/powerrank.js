/* ============================================================
   POWER RANKINGS — powerrank.js
   Collegiate meat judging team power rankings (OWGR-style).

   Part 1:  pure rating engine - computePowerRankings(contests, opts)
   Part 1B: pure data helpers (stats, form, rank history, category
            boards, heat buckets) - prBuildModel()
   Part 2:  section controller - Firestore load of `meat_contests`
            (public read, no auth gating) + scoreboard UI rendering.

   Depends on: index.html #powerrank-screen markup, auth.js (window._db).
   pageNavGo / renderHomeScreen (app.js) are optional globals guarded at
   call time.
   Self-test: open the page with location.hash === '#prtest' to
   render a hardcoded fixture instead of Firestore data. On localhost
   only, '#prlocal' renders the powerrankings/*2026*.json files instead.
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

/* Individuals engine (opts.avg): a contestant's rating is the plain average
   of their raw scores (overall, or one category's score) across the
   contests in scope. No placement factor, field factor or recency: every
   contestant in a division judges the same contests, so raw points compare.
   Alternates and non-counting members are treated like everyone else. */
function _prSolveAvg(contests, category, wantDetail) {
  const acc = new Map();
  contests.forEach((c) => {
    if (!c || !Array.isArray(c.results)) return;
    const seen = new Set();
    const n = (typeof c.teamCount === 'number' && c.teamCount > 0) ? c.teamCount : c.results.length;
    c.results.forEach((r) => {
      if (!r || typeof r.school !== 'string' || !r.school.trim()) return;
      const key = r.school.trim();
      if (seen.has(key)) return;
      let score;
      let place = (typeof r.place === 'number') ? r.place : null;
      if (category) {
        const cat = r.categories && r.categories[category];
        if (!cat || typeof cat.score !== 'number' || !isFinite(cat.score)) return;
        score = cat.score;
        place = (typeof cat.place === 'number') ? cat.place : null;
      } else {
        if (typeof r.score !== 'number' || !isFinite(r.score)) return;
        score = r.score;
      }
      seen.add(key);
      if (!acc.has(key)) acc.set(key, { sum: 0, n: 0, detail: [] });
      const a = acc.get(key);
      a.sum += score;
      a.n += 1;
      if (wantDetail) {
        a.detail.push({
          shortName: (typeof c.shortName === 'string' && c.shortName) ? c.shortName
            : (typeof c.name === 'string' && c.name ? c.name : 'Contest'),
          date: String(c.date || ''), place, fieldSize: n, score,
          resultRating: score, counted: false,
        });
      }
    });
  });
  const rows = [];
  acc.forEach((a, school) => {
    const row = { school, rating: a.sum / a.n, contestsCounted: a.n, resultsUsed: a.n };
    if (wantDetail) row.detail = a.detail.sort((x, y) => y.date.localeCompare(x.date));
    rows.push(row);
  });
  rows.sort((x, y) => (y.rating - x.rating) || x.school.localeCompare(y.school));
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

  const avg = options.avg === true;
  const solve = avg
    ? (sc, cat, td, det) => _prSolveAvg(sc, cat, det)
    : _prSolve;
  const minContests = avg ? 2 : 3;
  const maxOf = (rows) => rows.reduce((m, r) => Math.max(m, r.contestsCounted), 0);

  const current = solve(scope, category, today, wantDetail);
  if (current.length === 0) return [];

  const threshold = Math.min(minContests, maxOf(current));

  // Previous run: drop the single most recent contest (by date) within
  // the target season's scope only.
  const byDate = scope.slice().sort((a, b) =>
    String(a.date).localeCompare(String(b.date)) ||
    String(a.name || '').localeCompare(String(b.name || ''))
  );
  let previous = (byDate.length > 1)
    ? solve(byDate.slice(0, -1), category, today, false)
    : [];
  // Averages: compare against the previous board's numbered ranks only, so
  // one-contest scores don't push everyone's movement around.
  if (avg) {
    const prevMin = Math.min(minContests, maxOf(previous));
    previous = previous.filter((row) => row.contestsCounted >= prevMin);
  }

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
   PART 1B — DATA HELPERS (pure functions, no DOM)
   Everything the board, charts, matrix and grid draw is computed
   here from the contests already loaded. Nothing is invented.
   ════════════════════════════════════════════════════════════ */

/* One label map for every category name the screen prints (view select,
   board heading, tiles, matrix titles, card rows, detail headers).
   label = full explicit name, short = compact header text, desc = one
   plain sentence about what it measures. */
const PR_CAT_INFO = {
  overall:        { label: 'Overall ranking', short: 'Overall', group: 'Overall',
    desc: 'Total contest score: beef judging and grading, pork, lamb and specifications.' },
  overallBeef:    { label: 'Overall beef (judging + grading)', short: 'Overall beef', group: 'Beef',
    desc: 'Beef judging points plus beef grading points.' },
  beefJudging:    { label: 'Beef judging (placings + reasons)', short: 'Beef judging', group: 'Beef',
    desc: 'Points from the beef placing classes plus the beef reasons.' },
  beefPlacing:    { label: 'Beef placings', short: 'Beef placings', group: 'Beef',
    desc: 'Points from the beef placing classes.' },
  beefReasons:    { label: 'Beef reasons', short: 'Beef reasons', group: 'Beef',
    desc: 'Points from the oral reasons given on beef classes.' },
  beefGrading:    { label: 'Beef grading', short: 'Grading', group: 'Beef',
    desc: 'Points from the beef carcass grading classes.' },
  porkJudging:    { label: 'Pork judging (placings + reasons)', short: 'Pork judging', group: 'Pork',
    desc: 'Points from the pork placing classes plus the pork reasons.' },
  porkPlacing:    { label: 'Pork placings', short: 'Pork placings', group: 'Pork',
    desc: 'Points from the pork placing classes.' },
  porkReasons:    { label: 'Pork reasons', short: 'Pork reasons', group: 'Pork',
    desc: 'Points from the oral reasons given on pork classes.' },
  lambJudging:    { label: 'Lamb judging (placings + reasons)', short: 'Lamb judging', group: 'Lamb',
    desc: 'Points from the lamb placing classes plus the lamb reasons.' },
  lambPlacing:    { label: 'Lamb placings', short: 'Lamb placings', group: 'Lamb',
    desc: 'Points from the lamb placing classes.' },
  lambReasons:    { label: 'Lamb reasons', short: 'Lamb reasons', group: 'Lamb',
    desc: 'Points from the oral reasons given on lamb classes.' },
  specifications: { label: 'Specifications', short: 'Specs', group: 'Other',
    desc: 'Points from the specifications classes.' },
  totalPlacings:  { label: 'Total placings (all species)', short: 'Total placings', group: 'Other',
    desc: 'Points from the placing classes across beef, pork and lamb.' },
  reasons:        { label: 'Total reasons (all species)', short: 'Total reasons', group: 'Other',
    desc: 'Points from the oral reasons across beef, pork and lamb.' },
};

// Order and grouping of the View select.
const PR_VIEW_GROUPS = [
  ['Overall', ['overall']],
  ['Beef', ['overallBeef', 'beefJudging', 'beefPlacing', 'beefReasons', 'beefGrading']],
  ['Pork', ['porkJudging', 'porkPlacing', 'porkReasons']],
  ['Lamb', ['lambJudging', 'lambPlacing', 'lambReasons']],
  ['Other', ['specifications', 'totalPlacings', 'reasons']],
];

function prCatLabel(key) { return PR_CAT_INFO[key] ? PR_CAT_INFO[key].label : String(key); }
function prCatShort(key) { return PR_CAT_INFO[key] ? PR_CAT_INFO[key].short : String(key); }

// Categories on the leaderboard tiles and the detail table (display order)
const PR_CATEGORY_META = [
  { key: 'beefGrading' }, { key: 'overallBeef' }, { key: 'porkJudging' }, { key: 'lambJudging' },
  { key: 'reasons' }, { key: 'totalPlacings' }, { key: 'specifications' },
];

/* Six extra per-contest categories derived from results[i].splits (points a
   team earned from one species' placing classes vs its reasons classes).
   They are ranked within each contest by prWithSplitCats() and then run
   through the same engine as every other category. */
const PR_SPLIT_META = [
  { key: 'beefPlacing', species: 'beef', part: 'placing' },
  { key: 'beefReasons', species: 'beef', part: 'reasons' },
  { key: 'porkPlacing', species: 'pork', part: 'placing' },
  { key: 'porkReasons', species: 'pork', part: 'reasons' },
  { key: 'lambPlacing', species: 'lamb', part: 'placing' },
  { key: 'lambReasons', species: 'lamb', part: 'reasons' },
];
// Every board the engine can build. viewOnly boards are selectable in the
// View select but get no tile or matrix column of their own.
const PR_BOARD_META = PR_CATEGORY_META
  .concat([{ key: 'beefJudging', viewOnly: true }])
  .concat(PR_SPLIT_META.map((m) => ({ key: m.key, split: true })));

const PR_SPECIES = [
  { id: 'beef', label: 'Beef', judging: 'beefJudging' },
  { id: 'pork', label: 'Pork', judging: 'porkJudging' },
  { id: 'lamb', label: 'Lamb', judging: 'lambJudging' },
];

/* Competition ranking (1, 2, 2, 4) of numbers, higher is better. */
function prCompetitionPlaces(values) {
  const sorted = values.slice().sort((a, b) => b - a);
  return values.map((v) => sorted.indexOf(v) + 1);
}

/* Returns contests whose results carry the six derived split categories.
   Contests without splits (historic) come back untouched. */
function prWithSplitCats(contests) {
  return contests.map((c) => {
    if (!c || !Array.isArray(c.results)) return c;
    const derived = {};
    PR_SPLIT_META.forEach((m) => {
      const idx = [];
      const vals = [];
      c.results.forEach((r, i) => {
        const sp = r && r.splits && r.splits[m.species];
        const v = sp ? sp[m.part] : null;
        if (typeof v === 'number' && isFinite(v)) { idx.push(i); vals.push(v); }
      });
      if (idx.length === 0) return;
      const places = prCompetitionPlaces(vals);
      idx.forEach((ri, k) => {
        if (!derived[ri]) derived[ri] = {};
        derived[ri][m.key] = { place: places[k], score: vals[k] };
      });
    });
    if (Object.keys(derived).length === 0) return c;
    return Object.assign({}, c, {
      results: c.results.map((r, i) => (derived[i]
        ? Object.assign({}, r, { categories: Object.assign({}, r.categories || {}, derived[i]) })
        : r)),
    });
  });
}

/* Individuals mode: one synthetic contest per real contest that carries
   `individuals`. Each contestant becomes a result keyed "name | school"
   (the engine keys on result.school); `meta` maps key -> {name, school}. */
function prIndividualContests(contests, meta) {
  const out = [];
  contests.forEach((c) => {
    if (!c || !Array.isArray(c.individuals) || c.individuals.length === 0) return;
    // International individuals are main-contest only: its alternates have no
    // reasons scored, so ingest_scorecards.py --no-alt-events leaves them out.
    const results = [];
    c.individuals.forEach((p) => {
      if (!p || typeof p.name !== 'string' || !p.name.trim() ||
          typeof p.school !== 'string' || typeof p.place !== 'number') return;
      const name = p.name.trim();
      const school = p.school.trim();
      const key = name + ' | ' + school;
      meta.set(key, { name, school });
      results.push({
        school: key, place: p.place, score: p.score,
        categories: p.categories || {}, splits: p.splits, alt: !!p.alt, counted: !!p.counted,
      });
    });
    if (results.length === 0) return;
    out.push(Object.assign({}, c, { teamCount: results.length, results, individuals: null }));
  });
  return out;
}

/* Counted on the team score, alternate, or on a squad but outside the top 4. */
function prStatus(raw) {
  if (raw && raw.counted) return 'Counted';
  if (raw && raw.alt) return 'Alternate';
  return 'Did not count';
}

/* One place for rating text: teams show the 3-decimal rating, contestants
   show average points with one decimal. */
function prFmtRating(model, v) {
  if (typeof v !== 'number' || !isFinite(v)) return '';
  return model.mode === 'individuals'
    ? v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : v.toFixed(3);
}

function prLabel(model, key) {
  const m = model.meta && model.meta.get(key);
  return m ? { name: m.name, sub: m.school } : { name: key, sub: '' };
}

function prShort(model, key) {
  const m = model.meta && model.meta.get(key);
  return m ? m.name : _prShortSchool(key);
}

function prUnit(model, n) {
  return model.mode === 'individuals'
    ? (n === 1 ? 'contestant' : 'contestants')
    : (n === 1 ? 'team' : 'teams');
}

function prContestName(c) {
  return (c && typeof c.shortName === 'string' && c.shortName) ? c.shortName
    : (c && typeof c.name === 'string' && c.name ? c.name : 'Contest');
}

function prTeamCount(c) {
  return (typeof c.teamCount === 'number' && c.teamCount > 0)
    ? c.teamCount : (c.results || []).length;
}

function prSortByDate(list) {
  return list.slice().sort((a, b) =>
    String(a.date).localeCompare(String(b.date)) ||
    String(a.name || '').localeCompare(String(b.name || '')));
}

function prContestWinner(c) {
  let winner = null;
  (c.results || []).forEach((r) => {
    if (r && typeof r.place === 'number' && typeof r.school === 'string' &&
        (!winner || r.place < winner.place)) {
      winner = { place: r.place, school: r.school.trim() };
    }
  });
  return winner;
}

/* school -> [{ contest, shortName, date, place, fieldSize, score, cats }]
   oldest first. One entry per contest (best place if duplicated). */
function prSchoolResults(scopeAsc, category, avg) {
  const map = new Map();
  scopeAsc.forEach((c) => {
    if (!c || !Array.isArray(c.results)) return;
    const best = new Map();
    // Value this result is ranked on: overall, or one category's place/score.
    const view = (r) => {
      if (!category) {
        return (typeof r.place === 'number' && r.place >= 1)
          ? { place: r.place, score: (typeof r.score === 'number') ? r.score : null } : null;
      }
      const cat = r.categories && r.categories[category];
      if (!cat) return null;
      const place = (typeof cat.place === 'number' && cat.place >= 1) ? cat.place : null;
      const score = (typeof cat.score === 'number') ? cat.score : null;
      if (avg ? score === null : place === null) return null;
      return { place, score };
    };
    let carrying = 0;
    c.results.forEach((r) => {
      if (!r || typeof r.school !== 'string' || !r.school.trim()) return;
      const v = view(r);
      if (!v) return;
      carrying += 1;
      const school = r.school.trim();
      const prev = best.get(school);
      const pv = prev ? prev.v : null;
      if (!prev || (v.place !== null && (pv.place === null || v.place < pv.place))) best.set(school, { r, v });
    });
    best.forEach(({ r, v }, school) => {
      const cats = {};
      PR_CATEGORY_META.forEach((m) => {
        const cat = r.categories && r.categories[m.key];
        cats[m.key] = (cat && typeof cat.place === 'number' && cat.place >= 1) ? cat.place : null;
      });
      if (!map.has(school)) map.set(school, []);
      map.get(school).push({
        contest: c,
        shortName: prContestName(c),
        date: String(c.date || ''),
        place: v.place,
        fieldSize: category ? carrying : prTeamCount(c),
        score: v.score,
        cats,
        raw: r,
      });
    });
  });
  return map;
}

/* Wins, top-3 finishes, average finish, last-5 form (oldest to newest). */
function prSchoolStats(results) {
  const places = results.map((r) => r.place).filter((p) => typeof p === 'number');
  const sum = places.reduce((a, b) => a + b, 0);
  return {
    contests: results.length,
    wins: places.filter((p) => p === 1).length,
    top3: places.filter((p) => p <= 3).length,
    avgFinish: places.length ? sum / places.length : null,
    form: places.slice(-5),
  };
}

function prContestsCarrying(scope, categoryKey) {
  return scope.filter((c) =>
    Array.isArray(c.results) && c.results.some((r) =>
      r && r.categories && r.categories[categoryKey] &&
      (typeof r.categories[categoryKey].place === 'number' ||
       typeof r.categories[categoryKey].score === 'number'))
  ).length;
}

/* Category boards: only when 3+ contests this season carry the category.
   rows = every qualified team on that board; rank = index + 1. */
function prCategoryBoards(seasonScope, season, avg) {
  const boards = [];
  PR_BOARD_META.forEach((meta) => {
    if (prContestsCarrying(seasonScope, meta.key) < (avg ? 2 : 3)) return;
    const rows = computePowerRankings(seasonScope, { category: meta.key, season, avg })
      .filter((r) => r.qualified);
    if (rows.length === 0) return;
    const rank = new Map();
    rows.forEach((r, i) => rank.set(r.school, i + 1));
    boards.push({ key: meta.key, title: prCatLabel(meta.key), short: prCatShort(meta.key), split: !!meta.split, viewOnly: !!meta.viewOnly, rows, rank });
  });
  return boards;
}

/* Rank history: after contest k (date order) the board is recomputed on the
   first k contests with `today` = contest k's date. The last point uses the
   live board so the chart ends where the table does. Returns
   { labels:[{shortName,date}], ranks: Map school -> [rank|null per point] }. */
function prRankHistory(scopeAsc, season, currentRanked, avg) {
  const labels = scopeAsc.map((c) => ({ shortName: prContestName(c), date: String(c.date || '') }));
  const ranks = new Map();
  const n = scopeAsc.length;
  for (let k = 1; k <= n; k++) {
    let ordered;
    if (k === n) {
      ordered = currentRanked.map((r) => r.school);
    } else {
      const today = new Date(String(scopeAsc[k - 1].date) + 'T00:00:00');
      ordered = computePowerRankings(scopeAsc.slice(0, k), {
        season, avg, today: isNaN(today.getTime()) ? new Date() : today,
      }).filter((r) => r.qualified).map((r) => r.school);
    }
    ordered.forEach((school, i) => {
      if (!ranks.has(school)) ranks.set(school, new Array(n).fill(null));
      ranks.get(school)[k - 1] = i + 1;
    });
  }
  return { labels, ranks };
}

/* Heat bucket for a rank: 1 | 2-3 | 4-6 | 7-10 | 11+  ->  1..5 */
function prRankBucket(rank) {
  if (rank <= 1) return 1;
  if (rank <= 3) return 2;
  if (rank <= 6) return 3;
  if (rank <= 10) return 4;
  return 5;
}

/* Heat bucket for a place in a field of n (1st = 1, then by fraction). */
function prPlaceBucket(place, n) {
  if (place <= 1) return 1;
  const f = n > 1 ? (place - 1) / (n - 1) : 1;
  if (f <= 0.2) return 2;
  if (f <= 0.45) return 3;
  if (f <= 0.75) return 4;
  return 5;
}

/* Everything the screen needs for one (division, season). */
/* Board set for one view ('overall' or a category key): ranked and not-yet-
   ranked rows with their per-contest results, plus the readout numbers.
   Cached on the model. */
function prBoardSet(model, viewKey) {
  if (model.viewCache.has(viewKey)) return model.viewCache.get(viewKey);
  const category = viewKey === 'overall' ? null : viewKey;
  const individuals = model.mode === 'individuals';
  const rows = computePowerRankings(model.divContests, {
    season: model.season, division: model.division, detail: true, avg: individuals, category,
  });
  const ranked = rows.filter((r) => r.qualified);
  const provisional = rows.filter((r) => !r.qualified)
    .sort((a, b) => a.school.localeCompare(b.school));

  const resultsBySchool = prSchoolResults(model.scopeAsc, category, individuals);
  const engineDetail = new Map();
  rows.forEach((r) => {
    const m = new Map();
    (r.detail || []).forEach((d) => m.set(d.shortName + '|' + d.date, d));
    engineDetail.set(r.school, m);
  });

  const entry = (row) => {
    const results = resultsBySchool.get(row.school) || [];
    const eng = engineDetail.get(row.school) || new Map();
    return {
      row,
      results: results.map((r) => {
        const d = eng.get(r.shortName + '|' + r.date);
        return Object.assign({}, r, {
          resultRating: d ? d.resultRating : null,
          counted: d ? d.counted : false,
        });
      }),
      stats: prSchoolStats(results),
    };
  };
  const scopeAsc = model.scopeAsc;
  const fieldSum = scopeAsc.reduce((s, c) => s + prTeamCount(c), 0);
  const set = {
    key: viewKey, rows, ranked, provisional,
    rankedEntries: ranked.map(entry),
    provisionalEntries: provisional.map(entry),
    readout: {
      contests: scopeAsc.length,
      rankedTeams: ranked.length,
      topRating: ranked.length ? ranked[0].rating : null,
      gap: ranked.length > 1 ? ranked[0].rating - ranked[1].rating : null,
      avgField: scopeAsc.length ? fieldSum / scopeAsc.length : null,
    },
  };
  model.viewCache.set(viewKey, set);
  return set;
}

/* Everything the screen needs for one (division, season, mode). The overall
   board set is built here; other views are built on demand by prBoardSet. */
function prBuildModel(contests, division, season, mode) {
  const individuals = mode === 'individuals';
  const meta = individuals ? new Map() : null;
  let divisionContests = contests.filter((c) => c.division === division);
  if (individuals) divisionContests = prIndividualContests(divisionContests, meta);
  divisionContests = prWithSplitCats(divisionContests);
  const scopeAsc = prSortByDate(divisionContests.filter((c) => season === null || c.season === season));

  const model = {
    mode: individuals ? 'individuals' : 'teams', meta,
    division, season, scopeAsc, divContests: divisionContests, viewCache: new Map(),
  };
  const base = prBoardSet(model, 'overall');
  const latest = scopeAsc.length ? scopeAsc[scopeAsc.length - 1] : null;
  return Object.assign(model, {
    ranked: base.ranked, provisional: base.provisional,
    rankedEntries: base.rankedEntries, provisionalEntries: base.provisionalEntries,
    boards: prCategoryBoards(scopeAsc, season, individuals),
    history: prRankHistory(scopeAsc, season, base.ranked, individuals),
    latest,
    latestWinner: latest ? prContestWinner(latest) : null,
    readout: base.readout,
  });
}

/* ════════════════════════════════════════════════════════════
   PART 2 — SECTION CONTROLLER
   ════════════════════════════════════════════════════════════ */

const _prState = {
  contests: null,     // cached array of contest docs (module cache)
  error: false,       // last Firestore load failed
  division: 'senior', // 'senior' | 'junior'
  mode: 'teams',      // 'teams' | 'individuals'
  school: '',         // individuals: school filter ('' = all schools)
  view: 'overall',    // the user's chosen view (remembered across switches)
  viewKey: 'overall', // view actually in effect (falls back to overall)
  gridAll: false,     // season grid: show every row (individuals cap at 30)
  provAll: false,     // not-yet-ranked list: show every row
  fixture: null,      // cached #prtest fixture (stable identity for the model cache)
  local: null,        // cached #prlocal contests
  rowEntries: new Map(), // detail panel id -> { entry, ranked } (panels build lazily)
  cardOpen: null,     // button the contest card is attached to
  cardPinned: false,  // card kept open by a click/tap
  cardCtx: null,      // { model, entries, cols } for the rendered grid
  season: null,       // int, default most recent in data
  model: null,        // cached prBuildModel() result
  modelKey: '',
  modelSource: null,  // contests array the cached model was built from
  histPinned: null,   // school highlighted on the rank history chart (click)
  histHover: null,    // school highlighted by hover/focus
  histLines: [],      // top teams drawn on the chart
  drawnWidth: 0,
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

function _prFormatDay(dateStr) {
  const d = new Date(String(dateStr) + 'T00:00:00');
  if (isNaN(d.getTime())) return String(dateStr || '');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function _prPlural(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
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

/* "University of Nebraska" -> "Nebraska", "Texas Tech University" -> "Texas Tech" */
function _prShortSchool(name) {
  return String(name)
    .replace(/^University of /i, '')
    .replace(/ (University|College)$/i, '')
    .replace(/^The /, '');
}

function _prEl(id) { return document.getElementById(id); }

function _prSetText(id, text) {
  const el = _prEl(id);
  if (el) el.textContent = text;
}

function _prEmptyMsg(text) {
  return '<p class="pr-empty">' + _prEscapeHtml(text) + '</p>';
}

/* ── Self-test fixture (#prtest) ─────────────────────────────
   Three senior contests (so >=3-contest category cards render)
   + one junior contest (division toggle + NEW movement path). */
function _prFixtureContests() {
  if (_prState.fixture) return _prState.fixture;
  const mk = (school, place, cats) => ({ school, place, categories: cats });
  const list = [
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
  _prFixtureAddSplits(list);
  _prState.fixture = list;
  return list;
}

/* Adds splits + individuals to the senior fixture contests so the self-test
   exercises the split categories and the Individuals mode. Numbers are
   deterministic and only meant to look plausible. */
function _prFixtureAddSplits(list) {
  const FIRST = ['Alex', 'Blake', 'Casey', 'Drew', 'Emery', 'Finley', 'Gray', 'Harper', 'Indy', 'Jules',
    'Kai', 'Logan', 'Morgan', 'Nico', 'Oakley', 'Parker', 'Quinn', 'Reese', 'Sage', 'Tatum'];
  const LAST = ['Adler', 'Briggs', 'Calloway', 'Dunn', 'Easton', 'Fischer', 'Garza', 'Holt', 'Ibarra', 'Jarvis',
    'Kemp', 'Lowell', 'Mercer', 'Nolan', 'Ortega', 'Pruitt', 'Quade', 'Ramsey', 'Sutter', 'Tibbs'];
  const schools = [];
  list.forEach((c) => c.results.forEach((r) => {
    if (c.division === 'senior' && schools.indexOf(r.school) < 0) schools.push(r.school);
  }));
  list.forEach((c, k) => {
    if (c.division !== 'senior') return;
    c.results.forEach((r, i) => {
      const sp = (a) => ({ placing: a, reasons: Math.round(a * 0.46) });
      r.splits = { beef: sp(740 - i * 22 + (k * 5) % 9), pork: sp(760 - i * 20 - (k * 4) % 7), lamb: sp(380 - i * 11) };
      r.score = 4200 - i * 180 + ((i * 7 + k * 3) % 5) * 12;
      r.categories.beefJudging = { place: r.place, score: r.splits.beef.placing + r.splits.beef.reasons };
      r.categories.lambJudging = { place: Math.min(c.results.length, r.place + (i % 2)), score: r.splits.lamb.placing + r.splits.lamb.reasons };
      if (r.categories.beefGrading) r.categories.beefGrading.score = 1040 - i * 18;
      r.categories.specifications = { place: Math.min(c.results.length, r.place + (k % 2)), score: 400 - i * 9 };
    });
    // Four counted contestants + one alternate per school
    const people = [];
    c.results.forEach((r, i) => {
      const si = schools.indexOf(r.school);
      for (let j = 0; j < 5; j++) {
        const n = si * 5 + j;
        const f = 1 + ((n * 3 + k) % 9) * 0.015 - j * 0.02;
        const total = Math.round((1200 - i * 45) * f - j * 14);
        const part = (x) => Math.round(total * x);
        const sp = (x) => ({ placing: part(x), reasons: Math.round(part(x) * 0.42) });
        people.push({
          name: FIRST[n % 20] + ' ' + LAST[(n * 7 + 3) % 20], school: r.school, alt: j === 4,
          score: total, counted: j < 4,
          categories: {
            beefGrading: { score: part(0.25) }, beefJudging: { score: part(0.26) },
            lambJudging: { score: part(0.13) }, porkJudging: { score: part(0.27) },
            specifications: { score: part(0.09) }, overallBeef: { score: part(0.51) },
            totalPlacings: { score: part(0.6) }, reasons: { score: part(0.4) },
          },
          splits: { beef: sp(0.18), pork: sp(0.19), lamb: sp(0.09) },
        });
      }
    });
    const overall = prCompetitionPlaces(people.map((p) => p.score));
    people.forEach((p, i) => { p.place = overall[i]; });
    Object.keys(people[0].categories).forEach((key) => {
      const pl = prCompetitionPlaces(people.map((p) => p.categories[key].score));
      people.forEach((p, i) => { p.categories[key].place = pl[i]; });
    });
    c.individuals = people.sort((a, b) => a.place - b.place);
  });
}

function _prIsTestMode() {
  return window.location.hash === '#prtest';
}

/* #prlocal: read powerrankings/*2026*.json straight from disk instead of
   Firestore. Only honoured on localhost / 127.0.0.1. */
const PR_LOCAL_FILES = [
  'american-royal2026-junior', 'american-royal2026-senior', 'eastern-national2026-senior',
  'high-plains2026-junior', 'high-plains2026-senior', 'houston2026-junior', 'houston2026-senior',
  'international2026-senior', 'nwss2026-junior', 'nwss2026-senior', 'south-plains2026-junior', 'south-plains2026-senior',
  'southwestern2026-junior', 'southwestern2026-senior',
];

function _prIsLocalMode() {
  const h = window.location.hostname;
  return window.location.hash === '#prlocal' && (h === 'localhost' || h === '127.0.0.1');
}

function _prLoadLocal() {
  if (_prState.local) return Promise.resolve(_prState.local);
  return Promise.all(PR_LOCAL_FILES.map((name) =>
    fetch('powerrankings/' + name + '.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => ((d && Array.isArray(d.results) && typeof d.date === 'string')
        ? Object.assign({ id: name }, d) : null))
      .catch(() => null)
  )).then((all) => {
    _prState.local = all.filter(Boolean);
    return _prState.local;
  });
}

/* ── Data load: one getDocs on meat_contests, cached ──────── */
function _prLoadContests() {
  if (_prIsTestMode()) {
    return Promise.resolve(_prFixtureContests());
  }
  if (_prIsLocalMode()) return _prLoadLocal();
  if (Array.isArray(_prState.contests)) {
    return Promise.resolve(_prState.contests);
  }
  if (!window._db) {
    return Promise.resolve([]);
  }
  _prState.error = false;
  const collectionName = (typeof DB_COLLECTIONS !== 'undefined' && DB_COLLECTIONS.meat_contests)
    ? DB_COLLECTIONS.meat_contests
    : 'meat_contests';
  return window._db.collection(collectionName).get().then((snapshot) => {
    const contests = [];
    snapshot.forEach((doc) => {
      const d = doc.data();
      // Minimal shape validation: skip malformed docs defensively
      if (!d || !Array.isArray(d.results) || typeof d.date !== 'string' ||
          (d.division !== 'senior' && d.division !== 'junior')) return;
      contests.push({ id: doc.id, ...d });
    });
    _prState.contests = contests;
    return contests;
  }).catch((err) => {
    console.error('[powerrank] Firestore error:', err);
    _prState.error = true;
    return [];
  });
}

/* ── Screen show / hide (leaderboard-screen pattern) ───────── */
// Where the screen was opened from. The landing nav hides #landing-hero
// before it calls pageNavGo, so a visible landing is not the only signal:
// no other screen showing at all also means the landing was the origin.
let _prFromLanding = false;
function _prLandingOrigin() {
  const landing = document.getElementById('landing-hero');
  if (landing && !landing.classList.contains('hidden')) return true;
  return !document.querySelector(
    'main.screen:not(.hidden), #drill-screen:not(.hidden), #app-header:not(.hidden)');
}

/* Screen-level status: loading skeleton, empty, or error. Content hides
   while a status shows. */
function _prShowStatus(kind) {
  const status = _prEl('powerrank-status');
  const content = _prEl('powerrank-content');
  if (!status || !content) return;
  content.hidden = true;
  status.hidden = false;
  status.removeAttribute('aria-busy');
  if (kind === 'loading') {
    status.setAttribute('aria-busy', 'true');
    status.innerHTML = '<p class="pr-notice-title">Loading rankings&hellip;</p>' +
      '<div class="pr-skel" aria-hidden="true">' +
      '<span class="pr-skel-row"></span><span class="pr-skel-row"></span>' +
      '<span class="pr-skel-row"></span><span class="pr-skel-row"></span>' +
      '<span class="pr-skel-row"></span><span class="pr-skel-row"></span></div>';
  } else if (kind === 'error') {
    status.innerHTML = '<p class="pr-notice-title">Rankings did not load</p>' +
      '<p class="pr-notice-text">Check your connection and try again.</p>' +
      '<button type="button" class="pr-retry" id="powerrank-retry">Try again</button>';
    const retry = _prEl('powerrank-retry');
    if (retry) retry.addEventListener('click', () => {
      _prState.error = false;
      _prShowStatus('loading');
      _prLoadContests().then((contests) => { _prInitSeason(contests); _prRender(contests); });
    });
  } else {
    status.innerHTML = _prState.mode === 'individuals'
      ? '<p class="pr-notice-title">No individual results yet</p>' +
        '<p class="pr-notice-text">Contestant rankings appear here once a contest in this division and season has posted individual scores.</p>'
      : '<p class="pr-notice-title">No contests on the books yet</p>' +
        '<p class="pr-notice-text">Team power rankings appear here once enough teams have enough results posted for this division and season.</p>';
  }
}

function showPowerRankScreen(fromLanding) {
  _prFromLanding = (typeof fromLanding === 'boolean') ? fromLanding : _prLandingOrigin();
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

  if (!Array.isArray(_prState.contests) && !_prIsTestMode() && !_prIsLocalMode()) _prShowStatus('loading');

  _prLoadContests().then((contests) => {
    _prInitSeason(contests);
    _prRender(contests);
  });
}

function hidePowerRankScreen() {
  const screen = document.getElementById('powerrank-screen');
  if (screen) screen.classList.add('hidden');
  if (_prFromLanding) {
    const landing = document.getElementById('landing-hero');
    if (landing) {
      landing.classList.remove('hidden', 'landing-exit');
      landing.style.opacity = '';
    }
    return;
  }
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
    select.innerHTML = '<option value="">n/a</option>';
    select.disabled = true;
    return;
  }
  select.disabled = false;
  select.innerHTML = seasons
    .map((s) => `<option value="${s}"${s === _prState.season ? ' selected' : ''}>${s}</option>`)
    .join('');
}

/* ── Render ────────────────────────────────────────────────── */
// Compute once per (contests, division, season) and cache.
function _prModel(contests) {
  const key = _prState.division + '|' + _prState.season + '|' + _prState.mode;
  if (_prState.modelSource !== contests || _prState.modelKey !== key || !_prState.model) {
    _prState.model = prBuildModel(contests, _prState.division, _prState.season, _prState.mode);
    _prState.modelKey = key;
    _prState.modelSource = contests;
  }
  return _prState.model;
}

/* School filter select (individuals mode). Keeps the choice when the school
   still exists in the current division and season. */
function _prFillSchools(model) {
  const sel = _prEl('powerrank-school');
  if (!sel) return;
  if (model.mode !== 'individuals' || !model.meta) { _prState.school = ''; sel.innerHTML = ''; return; }
  const schools = Array.from(new Set(Array.from(model.meta.values()).map((m) => m.school)))
    .sort((a, b) => a.localeCompare(b));
  if (schools.indexOf(_prState.school) < 0) _prState.school = '';
  sel.innerHTML = '<option value="">All schools</option>' + schools.map((sc) =>
    `<option value="${_prEscapeHtml(sc)}"${sc === _prState.school ? ' selected' : ''}>${_prEscapeHtml(sc)}</option>`).join('');
}

/* View select: "Overall ranking" always, plus every category that has a
   board for this division, season and mode. */
function _prFillViews(model) {
  const sel = _prEl('powerrank-view');
  const have = new Set(['overall']);
  model.boards.forEach((b) => have.add(b.key));
  _prState.viewKey = have.has(_prState.view) ? _prState.view : 'overall';
  if (!sel) return;
  sel.innerHTML = PR_VIEW_GROUPS.map(([group, keys]) => {
    const opts = keys.filter((k) => have.has(k)).map((k) =>
      `<option value="${_prEscapeHtml(k)}"${k === _prState.viewKey ? ' selected' : ''}>${_prEscapeHtml(prCatLabel(k))}</option>`).join('');
    return opts ? `<optgroup label="${_prEscapeHtml(group)}">${opts}</optgroup>` : '';
  }).join('');
}

function _prVS(model) {
  return prBoardSet(model, _prState.viewKey);
}

function _prSchoolFilter(model) {
  return model.mode === 'individuals' ? _prState.school : '';
}

/* One line above the board for a selected school: how many counted at the
   latest contest, and how many members who did not count outscored a
   counted teammate at the same contest. Straight from the results. */
function _prRenderSchoolNote(model) {
  const el = _prEl('powerrank-school-note');
  if (!el) return;
  const school = _prSchoolFilter(model);
  if (!school) { el.hidden = true; el.textContent = ''; return; }
  const inSchool = (r) => { const m = model.meta.get(r.school); return !!m && m.school === school; };
  let latest = null;
  const alts = new Set();
  const others = new Set();
  let anyCounted = false;
  model.scopeAsc.forEach((c) => {
    const mine = c.results.filter(inSchool);
    if (mine.length === 0) return;
    latest = { c, mine };
    const counted = mine.filter((r) => r.counted && typeof r.score === 'number');
    if (counted.length) anyCounted = true;
    mine.forEach((r) => {
      if (r.counted || typeof r.score !== 'number') return;
      if (counted.some((t) => r.score > t.score)) (r.alt ? alts : others).add(r.school);
    });
  });
  if (!latest) { el.hidden = true; return; }
  let text = school + ': ';
  if (anyCounted) {
    const n = latest.mine.filter((r) => r.counted).length;
    text += n + ' counted at the latest contest (' + prContestName(latest.c) + '). ';
    const parts = [];
    if (alts.size) parts.push(_prPlural(alts.size, 'alternate', 'alternates'));
    if (others.size) parts.push(_prPlural(others.size, 'member who did not count', 'members who did not count'));
    text += parts.length
      ? parts.join(' and ') + ' outscored a counted teammate at the same contest this season.'
      : 'No alternate or non-counting member outscored a counted teammate at the same contest this season.';
  } else {
    text += _prPlural(latest.mine.length, 'contestant', 'contestants') + ' at the latest contest (' + prContestName(latest.c) + ').';
  }
  el.textContent = text;
  el.hidden = false;
}

function _prRender(contests) {
  if (_prState.error) { _prShowStatus('error'); return; }
  const model = _prModel(contests);
  _prFillSchools(model);
  _prFillViews(model);
  const sub = (_prState.division === 'senior' ? 'Senior colleges' : 'Junior colleges') +
    (_prState.season !== null ? ', ' + _prState.season + ' season' : '');
  _prSetText('powerrank-sub', sub + (_prState.mode === 'individuals' ? ', individuals' : ''));
  _prApplyModeText(model);
  _prCloseCard();

  const vs = prBoardSet(model, _prState.viewKey);
  if (vs.ranked.length === 0 && vs.provisional.length === 0) {
    _prShowStatus('empty');
    return;
  }
  const status = _prEl('powerrank-status');
  const content = _prEl('powerrank-content');
  if (status) { status.hidden = true; status.removeAttribute('aria-busy'); }
  if (content) content.hidden = false;

  _prState.histPinned = null;
  _prState.histHover = null;

  _prRenderLatest(model);
  _prRenderReadout(model);
  _prRenderSchoolNote(model);
  _prRenderBoard(model);
  _prRenderCharts(model);
  _prRenderCategories(model);
  _prRenderMatrix(model);
  _prRenderGrid(model);
  _prRenderContestList(model);
  // Rows are built here at runtime, so the observer has to be told about
  // them after render. No-op if scroll.js isn't loaded on this page.
  if (typeof window.initScrollReveals === 'function') {
    window.initScrollReveals(document.getElementById('powerrank-screen'));
  }
}

/* Headings and captions that change between teams and contestants. */
function _prApplyModeText(model) {
  const ind = model.mode === 'individuals';
  const who = ind ? 'contestant' : 'team';
  const whos = ind ? 'contestants' : 'teams';
  const set = (id, t) => _prSetText(id, t);
  set('powerrank-sum-teams-label', ind ? 'Ranked contestants' : 'Ranked teams');
  set('powerrank-sum-field-label', 'Average field size');
  set('powerrank-sum-top-label', ind ? 'No. 1 average score' : 'No. 1 rating');
  set('powerrank-sum-gap-label', ind ? 'Gap, No. 1 to No. 2 (points)' : 'Gap, No. 1 to No. 2');
  set('powerrank-board-rating-head', ind ? 'Avg score' : 'Rating');
  set('powerrank-prov-sub', ind ? 'One contest so far. Score shown.'
    : 'Too few results this season for a fair rating. Actual results shown.');
  const screen = _prEl('powerrank-screen');
  if (screen) screen.setAttribute('data-pr-mode', model.mode);
  const sf = _prEl('powerrank-school-field');
  const mk = _prEl('powerrank-matrix-key');
  if (mk) mk.textContent = 'Grading is beef grading and Specs is specifications. Placings is points from a species\' placing classes, Reasons is points from its oral reasons, and Total placings and Total reasons add all three species. Hover a header for its full name.';
  if (sf) sf.hidden = !ind;
  set('powerrank-board-school-head', ind ? 'Contestant' : 'Team');
  const vk = _prState.viewKey;
  const vLabel = prCatLabel(vk);
  const vInfo = PR_CAT_INFO[vk];
  set('powerrank-board-heading', vk === 'overall' ? 'The board' : 'The board: ' + vLabel);
  set('powerrank-board-cap', vInfo.desc + ' ' + (ind
    ? 'Contestants, alternates included, are ranked by their average points on this measure.'
    : (vk === 'overall' ? 'Teams are rated from their place at each contest.'
      : 'Teams are rated like the overall board, but from their place on this measure at each contest.')));
  set('powerrank-grid-heading', vk === 'overall' ? 'Season results' : 'Season results: ' + vLabel);
  set('powerrank-spread-cap', ind
    ? 'Overall ranking. One dot per ranked contestant, alternates included. The further right, the higher the average score.'
    : 'Overall ranking. One dot per ranked team. The further right, the higher the rating.');
  set('powerrank-history-cap', 'Overall ranking. Where the current top ' + whos + ' stood on the board after each contest' +
    (ind ? ', ranked by average score' : '') + '. Pick a ' + who + ' to follow its line.');
  set('powerrank-cat-cap', ind
    ? 'Top three contestants by average score in each category. A board appears once two contests this season carry the category.'
    : 'Top three teams in each category. A board appears once three contests this season carry the category.');
  set('powerrank-matrix-cap', 'Each cell is the ' + who + "'s rank on that category's board" +
    (ind ? ', by average category score' : '') + '. Beef, pork and lamb are split into placing classes and reasons. Lighter is better.' +
    (ind ? ' Shows the top 30 ranked contestants unless a school is selected.' : ''));
  set('powerrank-grid-cap', 'Each cell is the ' + who + "'s " + (vk === 'overall' ? 'overall place' : 'place on ' + vLabel) +
    ' at that contest. Lighter is better, and a blank means the ' + who +
    (vk === 'overall' ? ' did not compete' : ' has no result on this measure there') +
    '. Hover, tap or tab to a cell for the full contest card.');
  const hist = _prEl('powerrank-history-legend');
  if (hist) hist.setAttribute('aria-label', (ind ? 'Contestants' : 'Teams') + ' on the chart');
  [['powerrank-mode-teams', 'teams'], ['powerrank-mode-people', 'individuals']].forEach(([id, m]) => {
    const b = _prEl(id);
    if (!b) return;
    b.classList.toggle('active', _prState.mode === m);
    b.setAttribute('aria-pressed', String(_prState.mode === m));
  });
}

/* The charts depend on the container width, so they are separate. */
function _prRenderCharts(model) {
  _prRenderSpread(model);
  _prRenderHistory(model);
}

/* ── Latest banner + readout ───────────────────────────────── */
function _prRenderLatest(model) {
  const bar = _prEl('powerrank-latest');
  const text = _prEl('powerrank-latest-text');
  if (!bar || !text) return;
  if (!model.latest) { bar.hidden = true; return; }
  const c = model.latest;
  const parts = [
    '<b>' + _prEscapeHtml(prContestName(c)) + '</b>',
  ];
  if (model.latestWinner) parts.push(', won by <b>' + _prEscapeHtml(prLabel(model, model.latestWinner.school).name) + '</b>');
  parts.push(', ' + _prPlural(prTeamCount(c), prUnit(model, 1), prUnit(model, 2)));
  text.innerHTML = parts.join('');
  _prSetText('powerrank-latest-date', _prFormatDate(c.date));
  bar.hidden = false;
}

function _prRenderReadout(model) {
  const band = _prEl('powerrank-summary');
  if (!band) return;
  const r = _prVS(model).readout;
  _prSetText('powerrank-sum-contests', String(r.contests));
  _prSetText('powerrank-sum-teams', String(r.rankedTeams));
  _prSetText('powerrank-sum-top', r.topRating === null ? 'n/a' : prFmtRating(model, r.topRating));
  _prSetText('powerrank-sum-gap', r.gap === null ? 'n/a' : prFmtRating(model, r.gap));
  _prSetText('powerrank-sum-field', r.avgField === null ? 'n/a' : r.avgField.toFixed(1));
  band.hidden = false;
}

/* ── The board ─────────────────────────────────────────────── */
// Unchanged renders nothing. When every row is New (single contest, no
// earlier board to compare with) the column stays empty too.
function _prMovementCell(movement, suppressNew) {
  if (movement === null) {
    return suppressNew ? '' : '<span class="pr-new-badge" aria-label="New">New</span>';
  }
  if (movement > 0) {
    return `<span class="pr-move pr-move-up" aria-label="Up ${movement}">&#9650;${movement}</span>`;
  }
  if (movement < 0) {
    return `<span class="pr-move pr-move-down" aria-label="Down ${-movement}">&#9660;${-movement}</span>`;
  }
  return '';
}

function _prFormChips(form) {
  if (!form || form.length === 0) return '';
  const label = 'Last ' + form.length + ' overall places, oldest to newest: ' + form.join(', ');
  return `<span class="pr-form" role="img" aria-label="${_prEscapeHtml(label)}">` +
    form.map((p) => `<span class="pr-chip${p === 1 ? ' pr-chip-win' : ''}" aria-hidden="true">${p}</span>`).join('') +
    '</span>';
}

function _prAvgText(stats) {
  return stats.avgFinish === null ? '' : stats.avgFinish.toFixed(1);
}

/* Compact rank-history sparkline for one school (pixel-sized SVG). */
function _prSparkline(school, history) {
  const ranks = history.ranks.get(school);
  if (!ranks) return '';
  const pts = ranks.filter((r) => r !== null);
  if (pts.length < 2) return '';
  const W = 200, H = 56, padX = 8, padY = 8;
  const maxR = Math.max(2, Math.max.apply(null, pts));
  const n = ranks.length;
  const xAt = (i) => padX + (n === 1 ? 0 : i * (W - 2 * padX) / (n - 1));
  const yAt = (r) => padY + (r - 1) * (H - 2 * padY) / (maxR - 1);
  let d = '';
  let pen = false;
  let lastI = -1;
  ranks.forEach((r, i) => {
    if (r === null) { pen = false; return; }
    d += (pen ? 'L' : 'M') + xAt(i).toFixed(1) + ' ' + yAt(r).toFixed(1) + ' ';
    pen = true;
    lastI = i;
  });
  const summary = 'Rank after each contest: ' + ranks.map((r, i) =>
    (r === null ? 'unranked' : _prOrdinal(r)) + ' after ' + history.labels[i].shortName).join(', ') + '.';
  return `<figure class="pr-spark">
    <figcaption class="pr-spark-cap">Rank history</figcaption>
    <svg class="pr-spark-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${_prEscapeHtml(summary)}">
      <path d="${d.trim()}" class="pr-spark-line" fill="none"/>
      <circle cx="${xAt(lastI).toFixed(1)}" cy="${yAt(ranks[lastI]).toFixed(1)}" r="4" class="pr-spark-dot"/>
    </svg>
    <span class="pr-spark-range">Best ${_prOrdinal(Math.min.apply(null, pts))}, now ${_prOrdinal(ranks[lastI])}</span>
  </figure>`;
}

/* Detail roll-down panel for one school. All contest strings originate in
   Firestore, so they are escaped. */
function _prDetailPanel(entry, model, ranked) {
  const results = entry.results.slice().reverse(); // newest first
  const showMarkers = results.length > 5 && model.mode !== 'individuals'; // mark top-5 only when some miss the cut
  const missing = Math.max(0, 5 - results.length);

  const ind = model.mode === 'individuals';
  const head = '<tr><th scope="col" class="pr-t-contest">Contest</th>' +
    '<th scope="col" class="pr-t-num">Place</th>' +
    '<th scope="col" class="pr-t-num">Score</th>' +
    (ind ? '<th scope="col" class="pr-t-flag">Status</th>'
      : '<th scope="col" class="pr-t-num">Result rating</th>') +
    (showMarkers && !ind ? '<th scope="col" class="pr-t-flag">Counted</th>' : '') +
    PR_CATEGORY_META.map((m) =>
      `<th scope="col" class="pr-t-cat" title="${_prEscapeHtml(prCatLabel(m.key))}">${_prEscapeHtml(prCatShort(m.key))}</th>`).join('') +
    '</tr>';

  const body = results.map((d) => {
    const counted = showMarkers && d.counted;
    return `<tr class="${counted ? 'pr-t-counted' : ''}">
      <th scope="row" class="pr-t-contest"><span class="pr-t-name">${_prEscapeHtml(d.shortName)}</span><span class="pr-t-date">${_prEscapeHtml(_prFormatDate(d.date))}</span></th>
      <td class="pr-t-num">${d.place !== null ? _prOrdinal(d.place) + ' of ' + d.fieldSize : ''}</td>
      <td class="pr-t-num">${d.score !== null ? d.score.toLocaleString('en-US') : ''}</td>
      ${ind
        ? `<td class="pr-t-flag">${_prEscapeHtml(prStatus(d.raw))}</td>`
        : `<td class="pr-t-num">${d.resultRating !== null ? d.resultRating.toFixed(3) : ''}</td>`}
      ${showMarkers && !ind ? `<td class="pr-t-flag">${d.counted ? 'Counted' : '<span class="pr-sr">Not counted</span>'}</td>` : ''}
      ${PR_CATEGORY_META.map((m) => {
        const p = d.cats[m.key];
        return p === null
          ? '<td class="pr-t-cat pr-t-none"><span class="pr-sr">no data</span></td>'
          : `<td class="pr-t-cat">${p}</td>`;
      }).join('')}
    </tr>`;
  }).join('');

  const notes = [];
  if (showMarkers) notes.push('Only the five best results (marked Counted) feed the rating.');
  if (model.mode === 'individuals') {
    notes.push(ranked
      ? 'The rating is the average of these contest scores. Alternates and non-counting members are rated the same way as team members.'
      : 'One contest so far. Score shown.');
  } else if (missing > 0 && results.length > 0 && ranked) {
    notes.push('Rated on these ' + results.length + ' real result' + (results.length === 1 ? '' : 's') +
      ' only. No assumed or estimated results fill the remaining slot' + (missing === 1 ? '' : 's') + '.');
  }
  const noteHtml = notes.map((n) => `<p class="pr-detail-note">${_prEscapeHtml(n)}</p>`).join('');

  const s = entry.stats;
  const mobileStats = `<dl class="pr-mstats">
      ${ranked ? `<div><dt>Move</dt><dd>${_prMovementCell(entry.row.movement, _prVS(model).ranked.every((r) => r.movement === null)) || 'none'}</dd></div>` : ''}
      <div><dt>Wins</dt><dd>${s.wins}</dd></div>
      <div><dt>Top 3</dt><dd>${s.top3}</dd></div>
      <div><dt>Avg finish</dt><dd>${_prAvgText(s)}</dd></div>
      <div><dt>Contests</dt><dd>${s.contests}</dd></div>
      <div class="pr-mstats-form"><dt>Form, last 5</dt><dd>${_prFormChips(s.form)}</dd></div>
    </dl>`;

  return `<div class="pr-detail-inner">
    ${mobileStats}
    <div class="pr-detail-grid">
      <div class="pr-detail-tablewrap">
        <table class="pr-detail-table">
          <caption class="pr-sr">Season results for ${_prEscapeHtml(prLabel(model, entry.row.school).name)}</caption>
          <thead>${head}</thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      ${ranked && _prState.viewKey === 'overall' ? _prSparkline(entry.row.school, model.history) : ''}
    </div>
    ${noteHtml}
  </div>`;
}

const PR_CHEVRON_SVG = '<svg class="pr-chevron" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m9 18 6-6-6-6"/></svg>';

function _prRowHtml(entry, idx, prefix, model, rank, topRating, allNew) {
  const row = entry.row;
  const s = entry.stats;
  const id = prefix + idx;
  const ranked = rank !== null;
  const label = prLabel(model, row.school);
  _prState.rowEntries.set(id, { entry, ranked });
  const scale = ranked && topRating > 0 ? _prClamp(row.rating / topRating, 0, 1) : 0;
  const cls = 'pr-row' + (ranked ? '' : ' pr-row-prov') + (rank === 1 ? ' pr-row-first' : '') +
    (ranked && rank <= 3 ? ' pr-row-top' : '');
  return `<li class="${cls}">
    <div class="pr-line">
      <span class="pr-c-rank">${ranked ? `<span class="pr-sr">Rank </span><span class="pr-rank-num">${rank}</span>` : ''}</span>
      <span class="pr-c-school">
        <button type="button" class="pr-expand-btn" aria-expanded="false" aria-controls="${id}">
          ${PR_CHEVRON_SVG}
          <span class="pr-expand-school">${_prEscapeHtml(label.name)}${label.sub ? `<span class="pr-expand-sub">${_prEscapeHtml(label.sub)}</span>` : ''}</span>
        </button>
      </span>
      <span class="pr-c-rating">${ranked ? `<span class="pr-bar" aria-hidden="true"><span class="pr-bar-fill" style="transform:scaleX(${scale.toFixed(4)})"></span></span><span class="pr-rating-num"><span class="pr-sr">${model.mode === 'individuals' ? 'Average score' : 'Rating'} </span>${prFmtRating(model, row.rating)}</span>`
        : (model.mode === 'individuals' ? `<span class="pr-rating-num"><span class="pr-sr">Score </span>${prFmtRating(model, row.rating)}</span>` : '')}</span>
      <span class="pr-c-move">${ranked ? _prMovementCell(row.movement, allNew) : ''}</span>
      <span class="pr-c-wins"><span class="pr-sr">Wins </span>${s.wins}</span>
      <span class="pr-c-top3"><span class="pr-sr">Top 3 finishes </span>${s.top3}</span>
      <span class="pr-c-avg"><span class="pr-sr">Average finish </span>${_prAvgText(s)}</span>
      <span class="pr-c-form">${_prFormChips(s.form)}</span>
      <span class="pr-c-contests"><span class="pr-sr">Contests </span>${s.contests}</span>
    </div>
    <div class="pr-detail" id="${id}" hidden></div>
  </li>`;
}

function _prRenderBoard(model) {
  const list = _prEl('powerrank-tbody');
  const provWrap = _prEl('powerrank-provisional');
  const provList = _prEl('powerrank-provisional-list');
  if (!list) return;

  // Re-render collapses everything: rows rebuild with all panels hidden.
  _prState.rowEntries = new Map();
  const vs = _prVS(model);
  const sel = _prSchoolFilter(model);
  const keep = (e) => !sel || prLabel(model, e.row.school).sub === sel;
  if (vs.rankedEntries.length === 0) {
    list.innerHTML = '<li class="pr-empty-row">' +
      _prEmptyMsg('No ' + prUnit(model, 1) + ' has enough results for a numbered ranking yet. Actual results are listed below.') + '</li>';
  } else {
    const topRating = vs.rankedEntries.reduce((m, e) => Math.max(m, e.row.rating), 0);
    const allNew = vs.rankedEntries.every((e) => e.row.movement === null);
    const rows = vs.rankedEntries.map((e, i) => ({ e, i })).filter((x) => keep(x.e));
    list.innerHTML = rows.length
      ? rows.map((x) => _prRowHtml(x.e, x.i, 'pr-detail-', model, x.i + 1, topRating, allNew)).join('')
      : '<li class="pr-empty-row">' + _prEmptyMsg('No ranked contestant from this school yet. See the not yet ranked list below.') + '</li>';
  }

  if (provWrap && provList) {
    const provAll = vs.provisionalEntries.filter(keep);
    if (provAll.length === 0) {
      provWrap.hidden = true;
      provList.innerHTML = '';
      const m0 = _prEl('powerrank-prov-more');
      if (m0) m0.innerHTML = '';
    } else {
      provWrap.hidden = false;
      const cap = 25;
      const shown = (sel || _prState.provAll || provAll.length <= cap + 5)
        ? provAll : provAll.slice(0, cap);
      provList.innerHTML = shown
        .map((e, i) => _prRowHtml(e, i, 'pr-prov-detail-', model, null, 0, true)).join('');
      const more = _prEl('powerrank-prov-more');
      if (more) {
        const hidden = provAll.length - shown.length;
        more.innerHTML = hidden > 0
          ? `<button type="button" class="pr-more-btn" id="powerrank-prov-all">Show all ${provAll.length}</button>` : '';
      }
    }
  }
}

/* One open panel at a time across the ranked and unranked groups. */
function _prToggleRow(line) {
  const li = line.closest('.pr-row');
  if (!li) return;
  const panel = li.querySelector('.pr-detail');
  const btn = li.querySelector('.pr-expand-btn');
  if (!panel || !btn) return;
  const wasOpen = !panel.hidden;
  document.querySelectorAll('#powerrank-screen .pr-detail').forEach((p) => { p.hidden = true; });
  document.querySelectorAll('#powerrank-screen .pr-expand-btn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  document.querySelectorAll('#powerrank-screen .pr-row.is-open').forEach((r) => r.classList.remove('is-open'));
  if (!wasOpen) {
    if (!panel.firstChild && _prState.model) {
      const info = _prState.rowEntries.get(panel.id);
      if (info) panel.innerHTML = _prDetailPanel(info.entry, _prState.model, info.ranked);
    }
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    li.classList.add('is-open');
  }
}

/* ── Rating spread (dot plot) ──────────────────────────────── */
function _prNiceTicks(lo, hi, points) {
  const steps = points ? [5, 10, 20, 25, 50, 100, 200, 500] : [0.01, 0.02, 0.05, 0.1, 0.2, 0.5];
  const range = hi - lo;
  let step = steps[steps.length - 1];
  for (let i = 0; i < steps.length; i++) {
    if (range / steps[i] <= 6) { step = steps[i]; break; }
  }
  const ticks = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) {
    ticks.push(Math.round(v * 1000) / 1000);
  }
  return ticks;
}

function _prRenderSpread(model) {
  const block = _prEl('powerrank-spread-block');
  const host = _prEl('powerrank-spread');
  if (!block || !host) return;
  const ranked = model.ranked;
  block.hidden = false;
  if (ranked.length < 2) {
    host.innerHTML = _prEmptyMsg('The rating spread appears once two ' + prUnit(model, 2) + ' are ranked.');
    return;
  }
  const ratings = ranked.map((r) => r.rating);
  const min = Math.min.apply(null, ratings);
  const max = Math.max.apply(null, ratings);
  const pad = Math.max((max - min) * 0.08, model.mode === 'individuals' ? 1 : 0.01);
  const lo = min - pad;
  const hi = max + pad;
  const xPct = (v) => ((v - lo) / (hi - lo)) * 100;

  const top3 = ranked.slice(0, 3);
  const dots = ranked.map((r, i) =>
    `<span class="pr-dot${i === 0 ? ' pr-dot-lead' : ''}" style="left:${xPct(r.rating).toFixed(2)}%" title="${_prEscapeHtml(prLabel(model, r.school).name)}, ${prFmtRating(model, r.rating)}"></span>`).join('');
  const labels = top3.map((r, i) => {
    const x = xPct(r.rating);
    const left = x < 30;
    return `<span class="pr-dot-label${left ? ' is-left' : ''}${i === 0 ? ' pr-dot-label-lead' : ''}" style="left:${x.toFixed(2)}%;--x:${x.toFixed(2)};--lvl:${2 - i}"><span class="pr-dot-name">${_prEscapeHtml(prLabel(model, r.school).name)}</span> <span class="pr-dot-val">${prFmtRating(model, r.rating)}</span></span>`;
  }).join('');
  const pts = model.mode === 'individuals';
  const ticks = _prNiceTicks(lo, hi, pts).map((v) =>
    `<span class="pr-tick" style="left:${xPct(v).toFixed(2)}%">${pts ? v.toLocaleString('en-US') : v.toFixed(2)}</span>`).join('');
  const summary = (pts ? 'Average scores run from ' : 'Ratings run from ') + prFmtRating(model, min) + ' to ' + prFmtRating(model, max) + ' across ' +
    _prPlural(ranked.length, 'ranked ' + prUnit(model, 1), 'ranked ' + prUnit(model, 2)) + '. ' +
    top3.map((r) => prLabel(model, r.school).name + ' ' + prFmtRating(model, r.rating)).join(', ') + ' lead.';

  host.innerHTML = `<p class="pr-sr">${_prEscapeHtml(summary)}</p>
    <div class="pr-spread" aria-hidden="true">
      <div class="pr-spread-plot">
        <span class="pr-spread-axis"></span>
        ${ticks}${dots}${labels}
      </div>
    </div>`;
}

/* ── Rank history (bump chart) ─────────────────────────────── */
function _prWrapLabel(name) {
  // Break a contest name into at most two lines at a space.
  const s = String(name);
  if (s.length <= 12 || s.indexOf(' ') < 0) return [s];
  const words = s.split(' ');
  let best = 1, bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ').length;
    const b = words.slice(i).join(' ').length;
    if (Math.abs(a - b) < bestDiff) { bestDiff = Math.abs(a - b); best = i; }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

function _prRenderHistory(model) {
  const block = _prEl('powerrank-history-block');
  const host = _prEl('powerrank-history');
  const legend = _prEl('powerrank-history-legend');
  if (!block || !host || !legend) return;
  block.hidden = false;
  const hist = model.history;
  const n = hist.labels.length;
  if (n < 2 || model.ranked.length === 0) {
    host.innerHTML = _prEmptyMsg('Rank history appears once two contests have been posted this season.');
    legend.innerHTML = '';
    _prState.histLines = [];
    return;
  }
  const lines = model.ranked.slice(0, 8).map((r) => r.school);
  _prState.histLines = lines;
  const lead = lines[0];

  // Axis fits the ranks actually drawn (at least as many rows as lines).
  let maxRank = Math.max(lines.length, 2);
  lines.forEach((s) => {
    (hist.ranks.get(s) || []).forEach((r) => { if (r !== null && r > maxRank) maxRank = r; });
  });
  maxRank = Math.min(maxRank, 40);

  const padL = 34, padR = 138, padT = 16, padB = 62;
  const stepMin = 92;
  const avail = Math.max(host.clientWidth, 300);
  const W = Math.max(avail, padL + padR + (n - 1) * stepMin);
  const rowH = 28;
  const H = padT + padB + (maxRank - 1) * rowH;
  const xAt = (i) => padL + i * (W - padL - padR) / (n - 1);
  const yAt = (r) => padT + (r - 1) * rowH;

  let svg = `<svg class="pr-hist-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="pr-hist-desc">`;
  // grid + rank labels
  const labelEvery = maxRank > 14 ? 2 : 1;
  for (let r = 1; r <= maxRank; r++) {
    svg += `<line class="pr-hist-grid" x1="${padL}" x2="${W - padR + 12}" y1="${yAt(r)}" y2="${yAt(r)}"/>`;
    if ((r - 1) % labelEvery === 0) {
      svg += `<text class="pr-hist-ylab" x="${padL - 12}" y="${yAt(r) + 4}" text-anchor="end">${r}</text>`;
    }
  }
  // column labels: "after <contest>"
  hist.labels.forEach((l, i) => {
    const x = xAt(i);
    const y0 = yAt(maxRank) + 26;
    const parts = _prWrapLabel(l.shortName);
    svg += `<text class="pr-hist-xlab" x="${x.toFixed(1)}" y="${y0}" text-anchor="middle">`;
    parts.forEach((p, k) => {
      svg += `<tspan x="${x.toFixed(1)}" dy="${k === 0 ? 0 : 14}">${_prEscapeHtml(p)}</tspan>`;
    });
    svg += `<tspan class="pr-hist-xdate" x="${x.toFixed(1)}" dy="14">${_prEscapeHtml(_prFormatDay(l.date))}</tspan></text>`;
  });
  // series: non-leaders first so the leader draws on top
  const order = lines.slice(1).reverse().concat([lead]);
  order.forEach((school) => {
    const ranks = hist.ranks.get(school) || [];
    let d = '';
    let pen = false;
    let dots = '';
    let lastI = -1;
    ranks.forEach((r, i) => {
      if (r === null) { pen = false; return; }
      d += (pen ? 'L' : 'M') + xAt(i).toFixed(1) + ' ' + yAt(r).toFixed(1) + ' ';
      pen = true;
      lastI = i;
      dots += `<circle class="pr-hist-pt" cx="${xAt(i).toFixed(1)}" cy="${yAt(r)}" r="4"/>`;
    });
    if (lastI < 0) return;
    const nowRank = ranks[lastI];
    svg += `<g class="pr-hist-series${school === lead ? ' is-lead' : ''}" data-school="${_prEscapeHtml(school)}">` +
      `<title>${_prEscapeHtml(prLabel(model, school).name)}</title>` +
      `<path class="pr-hist-hit" d="${d.trim()}" fill="none"/>` +
      `<path class="pr-hist-line" d="${d.trim()}" fill="none"/>${dots}` +
      `<text class="pr-hist-end" x="${(xAt(lastI) + 12).toFixed(1)}" y="${yAt(nowRank) + 4}">${_prEscapeHtml(prShort(model, school))}</text></g>`;
  });
  svg += '</svg>';

  const summary = 'Rank after each contest for the top ' + lines.length + ' ' + prUnit(model, 2) + '. ' +
    lines.map((s) => {
      const rk = hist.ranks.get(s) || [];
      const now = rk[rk.length - 1];
      const first = rk.find((r) => r !== null);
      return prLabel(model, s).name + ' started ' + _prOrdinal(first) + (now ? ' and sits ' + _prOrdinal(now) : '');
    }).join('; ') + '.';

  host.innerHTML = `<p class="pr-sr" id="pr-hist-desc">${_prEscapeHtml(summary)}</p>` +
    `<div class="pr-hist-scroll" tabindex="0" role="region" aria-label="Rank history chart, scrolls sideways on narrow screens">${svg}</div>`;

  legend.innerHTML = lines.map((s) =>
    `<button type="button" class="pr-legend-btn${s === lead ? ' is-lead' : ''}" aria-pressed="false" data-school="${_prEscapeHtml(s)}" aria-label="${_prEscapeHtml(prLabel(model, s).name)}">${_prEscapeHtml(prShort(model, s))}</button>`).join('');

  _prApplyHistoryHighlight();
}

/* Highlight state: pinned (click) wins over hover/focus preview. */
function _prApplyHistoryHighlight() {
  const host = _prEl('powerrank-history');
  const legend = _prEl('powerrank-history-legend');
  if (!host || !legend) return;
  const active = _prState.histHover || _prState.histPinned;
  const svg = host.querySelector('.pr-hist-svg');
  if (svg) {
    svg.classList.toggle('has-active', !!active);
    svg.querySelectorAll('.pr-hist-series').forEach((g) => {
      const on = !!active && g.getAttribute('data-school') === active;
      g.classList.toggle('is-active', on);
      if (on) svg.appendChild(g); // bring the chosen line to the front
    });
  }
  legend.querySelectorAll('.pr-legend-btn').forEach((b) => {
    const s = b.getAttribute('data-school');
    b.setAttribute('aria-pressed', String(_prState.histPinned === s));
    b.classList.toggle('is-active', active === s);
  });
}

function _prBindHistory() {
  const legend = _prEl('powerrank-history-legend');
  const host = _prEl('powerrank-history');
  if (legend) {
    legend.addEventListener('click', (e) => {
      const b = e.target.closest('.pr-legend-btn');
      if (!b) return;
      const s = b.getAttribute('data-school');
      _prState.histPinned = (_prState.histPinned === s) ? null : s;
      _prApplyHistoryHighlight();
    });
    const preview = (e, on) => {
      const b = e.target.closest ? e.target.closest('.pr-legend-btn') : null;
      if (!b) return;
      _prState.histHover = on ? b.getAttribute('data-school') : null;
      _prApplyHistoryHighlight();
    };
    legend.addEventListener('mouseover', (e) => preview(e, true));
    legend.addEventListener('mouseout', (e) => preview(e, false));
    legend.addEventListener('focusin', (e) => preview(e, true));
    legend.addEventListener('focusout', (e) => preview(e, false));
  }
  if (host) {
    host.addEventListener('mouseover', (e) => {
      const g = e.target.closest ? e.target.closest('.pr-hist-series') : null;
      if (!g) return;
      _prState.histHover = g.getAttribute('data-school');
      _prApplyHistoryHighlight();
    });
    host.addEventListener('mouseout', (e) => {
      const g = e.target.closest ? e.target.closest('.pr-hist-series') : null;
      if (!g) return;
      _prState.histHover = null;
      _prApplyHistoryHighlight();
    });
  }
}

/* ── Category leaders (tiles) ──────────────────────────────── */
function _prRenderCategories(model) {
  const block = _prEl('powerrank-categories');
  const grid = _prEl('powerrank-cat-grid');
  if (!block || !grid) return;
  block.hidden = false;
  const tiles = model.boards.filter((b) => !b.split && !b.viewOnly);
  if (tiles.length === 0) {
    grid.innerHTML = _prEmptyMsg('No category has three contests this season yet, so no category board is shown.');
    return;
  }
  grid.innerHTML = tiles.map((b) => {
    const top = b.rows.slice(0, 3);
    const lead = top[0];
    const rest = top.slice(1).map((r, i) => `<li class="pr-tile-row">
        <span class="pr-tile-rk">${i + 2}</span>
        <span class="pr-tile-school">${_prEscapeHtml(prLabel(model, r.school).name)}</span>
        <span class="pr-tile-rating">${prFmtRating(model, r.rating)}</span>
      </li>`).join('');
    return `<article class="pr-tile">
      <h3 class="pr-tile-title">${_prEscapeHtml(b.title)}</h3>
      <p class="pr-tile-lead"><span class="pr-tile-rk pr-tile-rk-lead" aria-label="Number 1">1</span>
        <span class="pr-tile-name">${_prEscapeHtml(prLabel(model, lead.school).name)}</span></p>
      <p class="pr-tile-leadrating"><span class="pr-sr">${model.mode === 'individuals' ? 'Average score' : 'Rating'} </span>${prFmtRating(model, lead.rating)}</p>
      <ol class="pr-tile-rest" start="2">${rest}</ol>
    </article>`;
  }).join('');
}

/* ── Category strength matrix (heatmap) ────────────────────── */
function _prRenderMatrix(model) {
  const block = _prEl('powerrank-matrix-block');
  const host = _prEl('powerrank-matrix');
  if (!block || !host) return;
  block.hidden = false;
  if (model.boards.length === 0 || model.ranked.length === 0) {
    host.innerHTML = _prEmptyMsg('The strength matrix appears once a category board is available.');
    return;
  }
  const byKey = new Map();
  model.boards.forEach((b) => byKey.set(b.key, b));

  // Column plan: single columns span both header rows; species with split
  // boards get a two-level header (Placings, Reasons). A species without
  // split data (older contests) falls back to its judging total.
  const cols = [];   // leaf columns in order: { board }
  const top = [];    // first header row cells
  const sub = [];    // second header row cells
  const single = (board, label) => {
    if (!board) return;
    cols.push(board);
    top.push(`<th scope="col" class="pr-h-col" rowspan="2" title="${_prEscapeHtml(board.title)}">${_prEscapeHtml(label)}</th>`);
  };
  single(byKey.get('beefGrading'), prCatShort('beefGrading'));
  single(byKey.get('specifications'), prCatShort('specifications'));
  PR_SPECIES.forEach((sp) => {
    const pl = byKey.get(sp.id + 'Placing');
    const rs = byKey.get(sp.id + 'Reasons');
    if (pl || rs) {
      const parts = [[pl, 'Placings'], [rs, 'Reasons']].filter((x) => x[0]);
      top.push(`<th scope="colgroup" class="pr-h-col pr-h-group" colspan="${parts.length}" title="${_prEscapeHtml(prCatLabel(sp.judging))}">${sp.label}</th>`);
      parts.forEach(([b, t]) => {
        cols.push(b);
        sub.push(`<th scope="col" class="pr-h-col pr-h-sub" title="${_prEscapeHtml(b.title)}">${t}</th>`);
      });
    } else {
      single(byKey.get(sp.judging), prCatShort(sp.judging));
    }
  });
  single(byKey.get('totalPlacings'), prCatShort('totalPlacings'));
  single(byKey.get('reasons'), prCatShort('reasons'));
  if (cols.length === 0) {
    host.innerHTML = _prEmptyMsg('The strength matrix appears once a category board is available.');
    return;
  }

  const msel = _prSchoolFilter(model);
  let rows = model.ranked.map((r, i) => ({ r, i }));
  if (msel) rows = rows.filter((x) => prLabel(model, x.r.school).sub === msel);
  else if (model.mode === 'individuals') rows = rows.slice(0, 30);
  if (rows.length === 0) {
    host.innerHTML = _prEmptyMsg('No ranked contestant from this school on the category boards yet.');
    return;
  }
  const teamHead = '<th scope="col" class="pr-h-team" rowspan="2">' + (model.mode === 'individuals' ? 'Contestant' : 'Team') + '</th>';
  const head = '<tr>' + teamHead + top.join('') + '</tr><tr>' + sub.join('') + '</tr>';
  const body = rows.map((x) => {
    const r = x.r;
    const label = prLabel(model, r.school);
    return '<tr>' +
      `<th scope="row" class="pr-h-team"><span class="pr-h-rk">${x.i + 1}</span><span class="pr-h-name">${_prEscapeHtml(label.name)}${label.sub ? `<span class="pr-h-sub-school">${_prEscapeHtml(label.sub)}</span>` : ''}</span></th>` +
      cols.map((b) => {
        const rk = b.rank.get(r.school);
        return rk === undefined
          ? '<td class="pr-cell pr-cell-empty" aria-label="no data"></td>'
          : `<td class="pr-cell pr-heat-${prRankBucket(rk)}">${rk}</td>`;
      }).join('') + '</tr>';
  }).join('');
  host.innerHTML = `<div class="pr-scroll" tabindex="0" role="region" aria-label="Category strength matrix, scrolls sideways on narrow screens">
    <table class="pr-heat"><caption class="pr-sr">Rank of each ${model.mode === 'individuals' ? 'contestant' : 'team'} on each category board</caption>
    <thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

/* ── Season results grid ───────────────────────────────────── */
function _prRenderGrid(model) {
  const block = _prEl('powerrank-grid-block');
  const host = _prEl('powerrank-grid');
  if (!block || !host) return;
  block.hidden = false;
  const cols = model.scopeAsc;
  const ind = model.mode === 'individuals';
  const gsel = _prSchoolFilter(model);
  const gvs = _prVS(model);
  const nRanked = gvs.rankedEntries.length;
  const all = gvs.rankedEntries.concat(gvs.provisionalEntries)
    .map((e, i) => ({ e, rank: i < nRanked ? i + 1 : null }))
    .filter((x) => !gsel || prLabel(model, x.e.row.school).sub === gsel);
  if (cols.length === 0 || all.length === 0) {
    host.innerHTML = _prEmptyMsg('Results appear here once contests have been posted.');
    _prState.cardCtx = null;
    return;
  }
  // Individuals: top 30 rows until "Show all".
  const CAP = 30;
  const capped = ind && !gsel && !_prState.gridAll && all.length > CAP;
  const shownRows = capped ? all.slice(0, CAP) : all;
  const entries = shownRows.map((x) => x.e);
  const unit = prUnit(model, 2);
  _prState.cardCtx = { model, entries, cols };

  const head = '<tr><th scope="col" class="pr-h-team">' + (ind ? 'Contestant' : 'Team') + '</th>' + cols.map((c) =>
    `<th scope="col" class="pr-g-col"><span class="pr-g-name">${_prEscapeHtml(prContestName(c))}</span>` +
    `<span class="pr-g-meta">${_prEscapeHtml(_prFormatDay(c.date))}</span>` +
    `<span class="pr-g-meta">${prTeamCount(c)} ${unit}</span></th>`).join('') + '</tr>';
  const rowHtml = (e, ei, rankLabel) => {
    const byContest = new Map();
    e.results.forEach((r) => byContest.set(r.contest, r));
    const label = prLabel(model, e.row.school);
    return '<tr>' +
      `<th scope="row" class="pr-h-team"><span class="pr-h-rk">${rankLabel}</span><span class="pr-h-name">${_prEscapeHtml(label.name)}${label.sub ? `<span class="pr-h-sub-school">${_prEscapeHtml(label.sub)}</span>` : ''}</span></th>` +
      cols.map((c, ci) => {
        const r = byContest.get(c);
        return (r && r.place !== null)
          ? `<td class="pr-gtd"><button type="button" class="pr-cell pr-cellbtn pr-heat-${prPlaceBucket(r.place, r.fieldSize)}${r.place === 1 ? ' is-won' : ''}" data-e="${ei}" data-c="${ci}" aria-expanded="false" aria-label="${_prEscapeHtml(label.name + ', ' + prContestName(c) + (_prState.viewKey === 'overall' ? '' : ', ' + prCatLabel(_prState.viewKey)) + ': ' + _prOrdinal(r.place) + ' of ' + r.fieldSize)}">${r.place}</button></td>`
          : '<td class="pr-gtd"><span class="pr-cell pr-cell-empty"><span class="pr-sr">did not compete</span></span></td>';
      }).join('') + '</tr>';
  };
  let body = '';
  let sepDone = false;
  shownRows.forEach((x, ei) => {
    if (x.rank === null && !sepDone) {
      body += `<tr class="pr-g-sep"><th scope="colgroup" colspan="${cols.length + 1}">Not yet ranked</th></tr>`;
      sepDone = true;
    }
    body += rowHtml(x.e, ei, x.rank === null ? '' : x.rank);
  });
  const more = capped
    ? `<div class="pr-more"><button type="button" class="pr-more-btn" id="powerrank-grid-all">Show all ${all.length}</button><span class="pr-more-note">Showing the top ${CAP} of ${all.length} ${unit}.</span></div>`
    : '';
  host.innerHTML = `<div class="pr-scroll" tabindex="0" role="region" aria-label="Season results grid, scrolls sideways on narrow screens">
    <table class="pr-heat pr-grid"><caption class="pr-sr">${_prEscapeHtml(prCatLabel(_prState.viewKey))}: place of each ${ind ? 'contestant' : 'team'} at each contest. Each place is a button that opens the contest card.</caption>
    <thead>${head}</thead><tbody>${body}</tbody></table></div>${more}`;
}

/* ── Contest card (hover, focus, tap) on the season grid ────── */
function _prCardRow(label, place, pts, active) {
  if (typeof place !== 'number' && typeof pts !== 'number') return '';
  const on = active ? ' is-view' : '';
  return `<dt class="${on.trim()}">${_prEscapeHtml(label)}</dt><dd class="${on.trim()}">${typeof pts === 'number' ? pts.toLocaleString('en-US') : ''}</dd>` +
    `<dd class="pr-card-pl${place <= 3 ? ' is-top' : ''}${on}">${typeof place === 'number' ? _prOrdinal(place) : ''}</dd>`;
}

function _prCardHtml(model, entry, res) {
  const raw = res.raw || {};
  const cats = raw.categories || {};
  const label = prLabel(model, entry.row.school);
  const c = res.contest;
  const unit = prUnit(model, 2);
  const vk = _prState.viewKey;
  const cell = (key) => {
    const k = cats[key];
    const on = vk === key ? ' class="is-view"' : '';
    if (!k || (typeof k.score !== 'number' && typeof k.place !== 'number')) return `<td${on}><span class="pr-sr">no data</span></td>`;
    return `<td${on}><b>${typeof k.score === 'number' ? k.score.toLocaleString('en-US') : ''}</b>` +
      (typeof k.place === 'number' ? `<span class="pr-card-pl${k.place <= 3 ? ' is-top' : ''}">${_prOrdinal(k.place)}</span>` : '') + '</td>';
  };
  const hasSplits = PR_SPECIES.some((sp) => cats[sp.id + 'Placing'] || cats[sp.id + 'Reasons']);
  const shown = new Set(['beefGrading', 'specifications']);
  let species;
  if (hasSplits) {
    PR_SPECIES.forEach((sp) => { shown.add(sp.judging); shown.add(sp.id + 'Placing'); shown.add(sp.id + 'Reasons'); });
    species = `<table class="pr-card-split"><caption class="pr-sr">Points and place within the contest, by species</caption>
      <thead><tr><th scope="col"><span class="pr-sr">Species</span></th><th scope="col">Placings</th><th scope="col">Reasons</th></tr></thead>
      <tbody>${PR_SPECIES.map((sp) => `<tr${vk === sp.judging ? ' class="is-view"' : ''}><th scope="row" title="${_prEscapeHtml(prCatLabel(sp.judging))}">${sp.label}</th>${cell(sp.id + 'Placing')}${cell(sp.id + 'Reasons')}</tr>`).join('')}</tbody></table>`;
  } else {
    PR_SPECIES.forEach((sp) => shown.add(sp.judging));
    const rows = PR_SPECIES.map((sp) => _prCardRow(prCatShort(sp.judging), cats[sp.judging] && cats[sp.judging].place, cats[sp.judging] && cats[sp.judging].score, vk === sp.judging)).join('');
    species = rows ? `<dl class="pr-card-dl">${rows}</dl>` : '';
  }
  const g = cats.beefGrading || {};
  const sp = cats.specifications || {};
  let other = _prCardRow(prCatLabel('beefGrading'), g.place, g.score, vk === 'beefGrading') +
    _prCardRow(prCatLabel('specifications'), sp.place, sp.score, vk === 'specifications');
  // A view with no row above (overall beef, total placings, ...) gets its own row.
  if (vk !== 'overall' && !shown.has(vk) && cats[vk]) {
    other += _prCardRow(prCatLabel(vk), cats[vk].place, cats[vk].score, true);
  }
  const overallPlace = (typeof raw.place === 'number') ? raw.place : res.place;
  const overallScore = (typeof raw.score === 'number') ? raw.score : res.score;
  return `<p class="pr-card-title">${_prEscapeHtml(label.name)}</p>
    <p class="pr-card-meta">${label.sub ? _prEscapeHtml(label.sub) + '. ' : ''}${_prEscapeHtml(prContestName(c))}, ${_prEscapeHtml(_prFormatDay(c.date))}, ${prTeamCount(c)} ${unit}</p>
    <p class="pr-card-big"><b>${_prOrdinal(overallPlace)}</b><span>${overallScore !== null && overallScore !== undefined ? overallScore.toLocaleString('en-US') + ' pts overall' : 'overall'}</span></p>
    ${model.mode === 'individuals' ? `<p class="pr-card-status">Status: <b>${_prEscapeHtml(prStatus(raw))}</b></p>` : ''}
    ${species}${other ? `<dl class="pr-card-dl">${other}</dl>` : ''}`;
}

function _prOpenCard(btn) {
  const card = _prEl('powerrank-card');
  const ctx = _prState.cardCtx;
  if (!card || !ctx) return;
  const entry = ctx.entries[+btn.dataset.e];
  const col = ctx.cols[+btn.dataset.c];
  const res = entry && entry.results.find((r) => r.contest === col);
  if (!res) return;
  if (_prState.cardOpen && _prState.cardOpen !== btn) _prState.cardOpen.setAttribute('aria-expanded', 'false');
  card.innerHTML = _prCardHtml(ctx.model, entry, res);
  card.hidden = false;
  card.classList.remove('is-on');
  const rc = btn.getBoundingClientRect();
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  let x = rc.left + rc.width / 2 - w / 2;
  let y = rc.bottom + 10;
  x = Math.max(16, Math.min(x, window.innerWidth - w - 16));
  if (y + h > window.innerHeight - 16) y = rc.top - h - 10;
  card.style.left = x + 'px';
  card.style.top = Math.max(16, y) + 'px';
  card.classList.add('is-on');
  btn.setAttribute('aria-expanded', 'true');
  btn.setAttribute('aria-describedby', 'powerrank-card');
  _prState.cardOpen = btn;
}

function _prCloseCard() {
  const card = _prEl('powerrank-card');
  const btn = _prState.cardOpen;
  _prState.cardPinned = false;
  _prState.cardOpen = null;
  if (btn) {
    btn.setAttribute('aria-expanded', 'false');
    btn.removeAttribute('aria-describedby');
  }
  if (card) {
    card.classList.remove('is-on');
    card.hidden = true;
  }
}

function _prBindCard() {
  const host = _prEl('powerrank-grid');
  if (!host) return;
  const btnOf = (e) => (e.target.closest ? e.target.closest('.pr-cellbtn') : null);
  host.addEventListener('mouseover', (e) => {
    const b = btnOf(e);
    if (b && !_prState.cardPinned && b !== _prState.cardOpen) _prOpenCard(b);
  });
  host.addEventListener('mouseout', (e) => {
    const b = btnOf(e);
    if (b && !_prState.cardPinned && b === _prState.cardOpen && !b.contains(e.relatedTarget)) _prCloseCard();
  });
  host.addEventListener('focusin', (e) => {
    const b = btnOf(e);
    if (b && b !== _prState.cardOpen) { _prState.cardPinned = false; _prOpenCard(b); }
  });
  host.addEventListener('focusout', (e) => {
    const b = btnOf(e);
    if (b && !_prState.cardPinned && b === _prState.cardOpen) _prCloseCard();
  });
  host.addEventListener('click', (e) => {
    const more = e.target.closest ? e.target.closest('#powerrank-grid-all') : null;
    if (more) {
      _prState.gridAll = true;
      if (_prState.model) _prRenderGrid(_prState.model);
      return;
    }
    const b = btnOf(e);
    if (!b) return;
    if (_prState.cardPinned && _prState.cardOpen === b) { _prCloseCard(); return; }
    _prOpenCard(b);
    _prState.cardPinned = true;
  });
  // Escape closes; a press outside the grid closes a pinned card; page
  // scrolling gestures close it too (no scroll listener: wheel/touchmove).
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _prState.cardOpen) _prCloseCard();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!_prState.cardOpen) return;
    if (e.target.closest && e.target.closest('.pr-cellbtn')) return;
    _prCloseCard();
  });
  document.addEventListener('wheel', () => { if (_prState.cardOpen) _prCloseCard(); }, { passive: true });
  document.addEventListener('touchmove', () => { if (_prState.cardOpen) _prCloseCard(); }, { passive: true });
  window.addEventListener('resize', () => { if (_prState.cardOpen) _prCloseCard(); });
}

/* ── Contests in ranking ───────────────────────────────────── */
function _prRenderContestList(model) {
  const block = _prEl('powerrank-contests-block');
  const listEl = _prEl('powerrank-contest-list');
  if (!block || !listEl) return;
  const scope = model.scopeAsc;
  if (!scope || scope.length === 0) {
    block.hidden = true;
    listEl.innerHTML = '';
    return;
  }
  block.hidden = false;
  listEl.innerHTML = scope.slice().reverse().map((c) => {
    const winner = prContestWinner(c);
    const w = (typeof c.weight === 'number' && c.weight !== 1) ? c.weight : null;
    return `<li class="pr-contest-row">
      <span class="pr-contest-date">${_prEscapeHtml(_prFormatDate(c.date))}</span>
      <span class="pr-contest-name">${_prEscapeHtml(prContestName(c))}</span>
      <span class="pr-contest-teams">${_prPlural(prTeamCount(c), prUnit(model, 1), prUnit(model, 2))}</span>
      <span class="pr-contest-winner">${winner ? _prEscapeHtml(prLabel(model, winner.school).name) : ''}</span>
      <span class="pr-contest-weight">${w !== null ? _prEscapeHtml(String(w)) + 'x weight' : ''}</span>
    </li>`;
  }).join('');
}

/* ── Division toggle ───────────────────────────────────────── */
function _prSetDivision(division) {
  _prState.division = division;
  _prState.gridAll = false;
  _prState.provAll = false;
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

/* ── Teams / Individuals toggle ────────────────────────────── */
function _prSetMode(mode) {
  if (_prState.mode === mode) return;
  _prState.mode = mode;
  _prState.gridAll = false;
  _prState.provAll = false;
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

  const modeTeams = document.getElementById('powerrank-mode-teams');
  if (modeTeams) modeTeams.addEventListener('click', () => _prSetMode('teams'));
  const modePeople = document.getElementById('powerrank-mode-people');
  if (modePeople) modePeople.addEventListener('click', () => _prSetMode('individuals'));

  const provHost = document.getElementById('powerrank-provisional');
  if (provHost) provHost.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('#powerrank-prov-all')) {
      _prState.provAll = true;
      if (_prState.model) _prRenderBoard(_prState.model);
    }
  });

  _prBindCard();

  const viewSelect = document.getElementById('powerrank-view');
  if (viewSelect) {
    viewSelect.addEventListener('change', () => {
      _prState.view = viewSelect.value;
      _prState.gridAll = false;
      _prState.provAll = false;
      _prLoadContests().then((contests) => _prRender(contests));
    });
  }

  const schoolSelect = document.getElementById('powerrank-school');
  if (schoolSelect) {
    schoolSelect.addEventListener('change', () => {
      _prState.school = schoolSelect.value;
      _prState.gridAll = false;
      _prState.provAll = false;
      _prLoadContests().then((contests) => _prRender(contests));
    });
  }

  const seasonSelect = document.getElementById('powerrank-season');
  if (seasonSelect) {
    seasonSelect.addEventListener('change', () => {
      _prState.gridAll = false;
      _prState.provAll = false;
      const v = parseInt(seasonSelect.value, 10);
      _prState.season = isNaN(v) ? null : v;
      _prLoadContests().then((contests) => _prRender(contests));
    });
  }

  // Row expand: one delegated handler for the ranked and unranked lists.
  ['powerrank-tbody', 'powerrank-provisional-list'].forEach((id) => {
    const list = document.getElementById(id);
    if (!list) return;
    list.addEventListener('click', (e) => {
      const line = e.target.closest('.pr-line');
      if (line) _prToggleRow(line);
    });
  });

  _prBindHistory();

  // Charts are drawn at pixel size, so redraw them when the width changes.
  const wrap = document.querySelector('#powerrank-screen .pr-wrap');
  if (wrap && typeof ResizeObserver === 'function') {
    let frame = 0;
    new ResizeObserver(() => {
      const w = Math.round(wrap.clientWidth);
      if (!w || w === _prState.drawnWidth) return;
      const first = _prState.drawnWidth === 0;
      _prState.drawnWidth = w;
      if (first || !_prState.model) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (_prState.model) _prRenderCharts(_prState.model);
      });
    }).observe(wrap);
  }

  // Route the shared slash nav's "rankings" target through this section.
  // app.js resolves pageNavGo at call time, so wrapping the global works
  // without touching app.js.
  if (typeof window.pageNavGo === 'function' && !window._prNavPatched) {
    const _origPageNavGo = window.pageNavGo;
    window.pageNavGo = function (target) {
      const prScreen = document.getElementById('powerrank-screen');
      const prWasOpen = !!(prScreen && !prScreen.classList.contains('hidden'));
      const fromLanding = (target === 'rankings')
        ? (prWasOpen ? _prFromLanding : _prLandingOrigin()) : false;
      if (prWasOpen) {
        prScreen.classList.add('hidden');
      }
      if (target === 'rankings') {
        const lb = document.getElementById('leaderboard-screen');
        if (lb && !lb.classList.contains('hidden') &&
            typeof hideLeaderboardScreen === 'function') hideLeaderboardScreen();
        const fg = document.getElementById('fieldguide-screen');
        if (fg && !fg.classList.contains('hidden') &&
            typeof hideFieldGuideScreen === 'function') hideFieldGuideScreen();
        showPowerRankScreen(fromLanding);
        return;
      }
      _origPageNavGo(target);
    };
    window._prNavPatched = true;
  }

  // Self-test mode: jump straight to the section with fixture / local data
  if (_prIsTestMode() || _prIsLocalMode()) {
    showPowerRankScreen();
  }
  window.addEventListener('hashchange', () => {
    if (_prIsTestMode() || _prIsLocalMode()) {
      _prState.model = null;
      showPowerRankScreen();
    }
  });

  // Expose globally (same pattern as leaderboard.js)
  window.showPowerRankScreen = showPowerRankScreen;
  window.hidePowerRankScreen = hidePowerRankScreen;
  window.computePowerRankings = computePowerRankings;
});
