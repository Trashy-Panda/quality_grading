# powerrankings/ — Collegiate Meat Judging Power Rankings tooling

Offline tooling for the **Power Rankings** display (rendered by root
`powerrank.js` from the Firestore collection `meat_contests`). Nothing in this
folder is served on the live site. As of 2026-07-21 the display itself also
isn't linked from the public site — it lives inside admin.html's Power
Rankings tab (behind a "Public Rankings Preview" toggle, admin-auth-gated)
while the ranking methodology is still being refined; only the underlying
`meat_contests` Firestore data is unaffected by that move.

## The system in one paragraph

Rankings are computed **in the browser** from raw contest results stored in
Firestore (one `meat_contests` doc per contest per division). The algorithm is an
adaptation of the Official World Golf Ranking approach used by
livestockjudging.com's collegiate rankings (reverse-engineered from
[LSJCollegiatePowerRanking](https://github.com/jeff01/LSJCollegiatePowerRanking)):
each contest's strength is the average rating of its top-10 finishers, placements
convert to convex points-factors (winning is weighted heavily), results get a
recency weight and a field-size bonus, and a team's rating is the mean of its
**top 5 real results** this season (or however many it has, if fewer than 5 —
no padding, no cross-season blending). Marquee contests (the International)
carry a 2× weight that amplifies deviation from the field's centered average
rather than flatly multiplying the raw value, so merely attending doesn't
outscore winning elsewhere. A school only gets a numbered rank once it has at
least `min(3, most contests anyone in that season/division played)` real
results — thinner résumés are shown separately with their actual results
instead of an estimated rating, rather than trying to guess what they "would
have" scored (an earlier carryover-based approach tried that and kept
producing new edge cases — see `docs/NOTES.md`). Category placements (beef
grading, beef judging, pork, lamb, specifications, overall beef, total
placings, reasons) run through the same engine to produce the "Best on the
Rail / Best in Reasons / …" leaderboards. Full methodology + schema: root
`powerrank.js` header and `docs/NOTES.md`.

## ingest_judgingcard.py

Scrapes a judgingcard.com contest (overall + all category standings) into a
ready-to-import `meat_contests` JSON doc.

```
pip install requests beautifulsoup4
python ingest_judgingcard.py "https://www.judgingcard.com/Results/Team.aspx?ID=27671&EID=166763"
python ingest_judgingcard.py <url> --division junior --weight 2 --out contest.json
```

Flags: `--division senior|junior` (default senior), `--weight` (2 = marquee, use
for the International), `--name/--short-name/--date/--season` overrides when the
page header parse gets something wrong, `--out file.json`.

Workflow:
1. Run the script against the contest's Team.aspx URL.
2. Eyeball the JSON (placements vs the source page; school-name spellings — the
   rankings engine joins on **exact** school-name strings across contests, and the
   `CANONICAL_SCHOOLS` map in the script is the place to add new spellings).
3. Paste the JSON into **admin.html → Power Rankings → Import** (it previews,
   warns on near-duplicate school names, then writes the doc). The admin panel
   also has a manual-entry form for contests that aren't on judgingcard.

**Squad clutter and alt-only entries:** contests with big fields (Houston in
particular) list dozens of alternate/practice squads per school on judgingcard
("Oklahoma State Alt 1".."Alt 14"). The script dedups these to one
best-place-per-school entry and **renumbers** the survivors into a clean
sequential 1..M ranking (`teamCount = M`) — without this, gapped raw ranks
(e.g. `1,2,3,5,6,7,8,14,15,58`) get misread by the rank-sensitive
placementFactor lookup as if the field were much bigger than it really is.
Separately, if *every* raw entry for a school was an "Alt" row (no real named
squad ever seen for them), the output JSON carries a top-level
`altOnlySchools: [...]` hint — the admin Import flow badges those rows so you
can verify/correct/exclude them (this is how the Houston-2026-senior
"University of Nebraska = 981 points, one competitor's score" case was
caught and gets resolved).

The `*2026-senior.json` / `*2026-junior.json` files are real scraped contests
(National Western, Southwestern, South Plains, Houston — American Division =
senior colleges, National Division = junior colleges; at Houston, B = senior,
A = junior), ready to import.

## ingest_historic.py — 100 Years of Meat Judging archive

Parses the two "100YMJ_ContestResults" PDFs (American = senior division,
National = junior colleges; team placements per contest per year, no scores or
categories) into one `meat_contests` doc per contest-year in `historic/`:

```
python ingest_historic.py "<path>/100YMJ_ContestResults_American.pdf" --division senior
python ingest_historic.py "<path>/100YMJ_ContestResults_National.pdf" --division junior
```

Dates are approximated per contest (only within-season ordering matters);
the International carries the 2× marquee weight; contest-years where only one
team's placement is recorded are skipped (`--min-teams`); seasons ≥ 2026 are
skipped by default (`--max-season`) since those come from judgingcard with full
category data. School names are canonicalized to match the judgingcard scrapes
so historic and modern results join onto the same schools.

**`teamCount`** here is `max(len(results), max place recorded that year)`, not
just `len(results)` — the archive only tracks a fixed set of schools as rows
across the decades, so a given year's true field can include entrants who
never got a row, and their recorded place can legitimately exceed the row
count. Without the `max(...)`, that produces `place > teamCount`, which the
engine's rank-sensitive placementFactor turns into `NaN` for the whole
season+division (this happened live on senior 1973 and a few other years
before the fix).

## push_contests.py — bulk upload

Pushes any set of contest JSONs to Firestore via the firebase-admin SDK
(service-account writes bypass rules; same pattern as `grader/`):

```
python push_contests.py --sa ../grader/secrets/firebase-service-account.json "historic/*.json" "*2026-*.json"
```

DocIds use the same slug as the admin import box, so re-pushing is idempotent.
The full 1926–2026 backlog (539 docs) was loaded on 2026-07-20 and re-pushed
on 2026-07-21 with the `teamCount`/renumbering fixes above.

Note: this script always strips any `altOnlySchools` hint before writing
(it's an admin-Import-only signal — bulk push bypasses that review UI, so the
field is dropped rather than left unresolved in Firestore).
