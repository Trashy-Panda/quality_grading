#!/usr/bin/env python3
"""
ingest_historic.py — parse the "100 Years of Meat Judging" contest-results PDFs
into meat_contests docs (one JSON per contest per year per division).

The PDFs are wide Excel-style tables: one section per contest, teams as rows,
years as columns, split horizontally across pages (continuation pages repeat a
year-header row and the value cells in the same row order, without team names).
Cells: placement int, "10*" (tie — asterisk stripped), "-" (did not compete),
or blank (no data recorded that year).

Usage:
  python ingest_historic.py "C:/Users/gunny/Downloads/100YMJ_ContestResults_American.pdf" --division senior --out-dir historic
  python ingest_historic.py "C:/Users/gunny/Downloads/100YMJ_ContestResults_National.pdf" --division junior --out-dir historic

Then bulk-push with push_contests.py. No scores or category breakdowns exist in
this archive — docs carry overall placements only, which is all the rating
engine requires.
"""

import argparse
import json
import re
import sys
from pathlib import Path

try:
    import pdfplumber
except ImportError:
    sys.exit("Missing dep — run: pip install pdfplumber")

from ingest_judgingcard import kebab  # same slug convention as the scraper

# Approximate month-day per contest (real dates aren't in the archive; only the
# within-season ordering matters to the engine's recency term).
CONTESTS = {
    "National Western":      ("01-18", 1),
    "Southwestern":          ("02-01", 1),
    "South Plains":          ("02-14", 1),
    "Houston":               ("03-07", 1),
    "Eastern National":      ("04-15", 1),
    "Pacific International": ("10-10", 1),
    "High Plains":           ("10-01", 1),
    "American Royal":        ("10-20", 1),
    "International":         ("11-15", 2),  # marquee — 2x weight
}

# Archive short names -> the canonical names used by the judgingcard scrapes,
# so historic and modern results join onto the same schools.
HISTORIC_CANONICAL = {
    "Arizona": "University of Arizona",
    "Clarendon": "Clarendon College",
    "Colorado State": "Colorado State University",
    "Connors State": "Connors State College",
    "Eastern Oklahoma State": "Eastern Oklahoma State College",
    "Florida": "University of Florida",
    "Garden City": "Garden City Community College",
    "Georgia": "University of Georgia",
    "Illinois": "University of Illinois",
    "Iowa State": "Iowa State University",
    "Kansas State": "Kansas State University",
    "Michigan State": "Michigan State University",
    "Nebraska": "University of Nebraska",
    "New Mexico State": "New Mexico State University",
    "North Dakota State": "North Dakota State University",
    "Ohio State": "The Ohio State University",
    "Oklahoma State": "Oklahoma State University",
    "Purdue": "Purdue University",
    "South Dakota State": "South Dakota State University",
    "Tarleton": "Tarleton State University",
    "Tarleton State": "Tarleton State University",
    "Texas A&M": "Texas A&M University",
    "Texas A&M Kingsville": "Texas A&M Kingsville",
    "Texas Tech": "Texas Tech University",
    "West Texas A&M": "West Texas A&M University",
    "Western Texas": "Western Texas College",
    "Wyoming": "University of Wyoming",
    "Wisconsin- Madison": "Wisconsin-Madison",
    "Minnestoa": "Minnesota",  # typo in the archive
}

VALUE_RE = re.compile(r"^(\d{1,2})\*?$")
YEAR_RE = re.compile(r"^(19[2-9]\d|20[0-2]\d)$")


def canonical(name):
    name = re.sub(r"\s+", " ", name).strip(" .")
    return HISTORIC_CANONICAL.get(name, name)


def lines_from_page(page):
    """Group words into lines by y position; each word keeps its x center."""
    words = page.extract_words(x_tolerance=1.5, y_tolerance=2)
    lines = {}
    for w in words:
        key = round(w["top"] / 3)  # 3pt bucket
        lines.setdefault(key, []).append(w)
    out = []
    for key in sorted(lines):
        ws = sorted(lines[key], key=lambda w: w["x0"])
        out.append(ws)
    return out


def parse_pdf(pdf_path):
    """Return {contest: {year: [(team, place), ...]}} keeping table row order."""
    data = {}
    contest = None      # current section
    teams = []          # row-order team names for the current section
    year_cols = []      # [(year, x_center)] for the current page block
    row_idx = 0         # row cursor within the current page block

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            for ws in lines_from_page(page):
                texts = [w["text"] for w in ws]
                line_text = " ".join(texts)

                # Section start: a line that is exactly a known contest name.
                if line_text in CONTESTS:
                    contest = line_text
                    data.setdefault(contest, {})
                    teams, year_cols, row_idx = [], [], 0
                    continue
                if contest is None:
                    continue
                if line_text.startswith("(Replaced"):
                    continue

                # Header row: contains year numbers (with or without "Team Name").
                years_here = [(int(t), (w["x0"] + w["x1"]) / 2)
                              for t, w in zip(texts, ws) if YEAR_RE.match(t)]
                if years_here and all(YEAR_RE.match(t) or t in ("Team", "Name")
                                      for t in texts):
                    year_cols = years_here
                    for y, _ in years_here:
                        data[contest].setdefault(y, [])
                    row_idx = 0
                    continue
                if not year_cols:
                    continue

                # Data row: split into name words (left of first year column)
                # and value words, assigning values to the nearest year column.
                first_col_x = min(x for _, x in year_cols)
                name_words, values = [], []
                for t, w in zip(texts, ws):
                    xc = (w["x0"] + w["x1"]) / 2
                    if VALUE_RE.match(t) or t == "-":
                        if xc > first_col_x - 25:
                            values.append((t, xc))
                            continue
                    # Defensive: name word with a glued trailing value ("County5")
                    m = re.match(r"^(.*?[A-Za-z\).])(\d{1,2}\*?)$", t)
                    if m and xc > first_col_x - 25:
                        values.append((m.group(2), xc))
                        continue
                    name_words.append(t)

                if name_words:
                    team = canonical(" ".join(name_words))
                    if team not in teams:
                        teams.append(team)
                    row_team = team
                    row_idx = teams.index(team) + 1
                else:
                    # Continuation page: rows arrive in the same order as the
                    # section's team list.
                    if row_idx >= len(teams):
                        continue
                    row_team = teams[row_idx]
                    row_idx += 1

                for t, xc in values:
                    m = VALUE_RE.match(t)
                    if not m:
                        continue  # '-'
                    year = min(year_cols, key=lambda yc: abs(yc[1] - xc))[0]
                    data[contest][year].append((row_team, int(m.group(1))))
    return data


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pdf")
    ap.add_argument("--division", choices=["senior", "junior"], required=True)
    ap.add_argument("--out-dir", default="historic")
    ap.add_argument("--max-season", type=int, default=2025,
                    help="skip newer seasons (2026 spring meets already come "
                         "from judgingcard with full category data)")
    ap.add_argument("--min-teams", type=int, default=2,
                    help="skip contest-years with fewer placed teams")
    args = ap.parse_args()

    out_dir = Path(__file__).parent / args.out_dir
    out_dir.mkdir(exist_ok=True)

    data = parse_pdf(args.pdf)
    written = skipped = 0
    for contest, years in data.items():
        md, weight = CONTESTS[contest]
        for year, rows in sorted(years.items()):
            if year > args.max_season or not rows:
                continue
            # dedup (keep best place per school) + sort by place
            best = {}
            for team, place in sorted(rows, key=lambda r: r[1]):
                best.setdefault(team, place)
            results = [{"school": t, "place": p}
                       for t, p in sorted(best.items(), key=lambda kv: kv[1])]
            if len(results) < args.min_teams:
                skipped += 1
                continue
            date = f"{year}-{md}"
            # teamCount is NOT len(results): the archive only tracks a fixed
            # set of schools as rows over the decades, so a given year's true
            # field can include entrants who never got a row, and their
            # recorded place can exceed len(results). Use max place seen as a
            # defensible lower-bound estimate of the true field size instead
            # of silently understating it (which the engine's placementFactor
            # divides by and can NaN on when place > teamCount).
            team_count = max(len(results), max(r["place"] for r in results))
            doc = {
                "name": f"{contest} Meat Judging Contest — 100YMJ archive",
                "shortName": contest,
                "date": date,
                "season": year,
                "division": args.division,
                "weight": weight,
                "teamCount": team_count,
                "results": results,
            }
            slug = f"{date}_{kebab(contest)}_{args.division}"
            (out_dir / f"{slug}.json").write_text(
                json.dumps(doc, indent=1), encoding="utf-8")
            written += 1
    print(f"{Path(args.pdf).name} [{args.division}]: wrote {written} contest-year "
          f"docs to {out_dir}  ({skipped} skipped by --min-teams)")


if __name__ == "__main__":
    main()
