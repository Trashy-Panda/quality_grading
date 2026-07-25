#!/usr/bin/env python3
"""
ingest_judgingcard.py — scrape a judgingcard.com collegiate meat judging contest
into a `meat_contests` Firestore doc (JSON), ready to paste into the admin panel's
Power Rankings → Import box on beefgrading.study/admin.html.

Usage:
    python ingest_judgingcard.py "https://www.judgingcard.com/Results/Team.aspx?ID=27671&EID=166763"
    python ingest_judgingcard.py <url> --division junior --weight 2 --out contest.json

The base Team.aspx page is the "Overall" team standings. Category standings
(Beef Grading, Beef Judging, Lamb Judging, Pork Judging, Specifications,
Overall Beef, Total Placing, Total Reas/Quest) live at the same URL with a
&VID=<n> parameter, discovered from the page's own nav links by link text.

Output JSON shape matches the schema documented in docs/NOTES.md ("meat_contests").

Requires: requests, beautifulsoup4  (pip install requests beautifulsoup4)
"""

import argparse
import datetime as dt
import json
import re
import sys
from urllib.parse import urljoin, urlparse, parse_qs, urlencode, urlunparse

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit("Missing deps — run: pip install requests beautifulsoup4")

UA = {"User-Agent": "Mozilla/5.0 (beefgrading.study rankings ingest; contact admin)"}

# judgingcard nav-link text  ->  meat_contests category key
# (None = the Overall standings, which become the doc's top-level results)
CATEGORY_LINK_MAP = {
    "overall": None,
    "beef grading": "beefGrading",
    "beef judging": "beefJudging",
    "lamb judging": "lambJudging",
    "pork judging": "porkJudging",
    "specifications": "specifications",
    "overall beef": "overallBeef",
    "total placing": "totalPlacings",
    "total placings": "totalPlacings",
    "total reas/quest": "reasons",
    "total reasons": "reasons",
}

# Squad/color suffixes used when a school fields multiple teams at one contest
# ("Texas Tech Black", "Tarleton State Purple", "Eastern Oklahoma State Blue").
# Stripped before canonical lookup so all squads collapse onto one school, then
# deduped keeping the best place.
SQUAD_COLORS = {
    "black", "red", "white", "blue", "yellow", "green", "gold", "purple",
    "maroon", "orange", "silver", "gray", "grey", "navy", "crimson", "scarlet",
    "brown",
}

# Mascot squad tokens seen on judgingcard ("Kansas State Wild" + "Kansas State
# Cats" = Wildcats split across two squads; "West Texas A&M Go" + "Buffs").
# One trailing token from this combined set is stripped, then the canonical map
# is consulted again. NEVER add a token that ends a real school's name (e.g.
# "Kingsville" — Texas A&M Kingsville is its own university).
SQUAD_MASCOTS = {"cats", "wild", "go", "buffs", "broncs", "busters"}
SQUAD_SUFFIXES = SQUAD_COLORS | SQUAD_MASCOTS

# Canonical school-name fixups. The rankings engine joins on EXACT strings across
# contests, so every contest must spell a school the same way. Keys are compared
# lowercase with periods removed. Mascot-suffixed squad names ("Kansas State
# Cats") need their own entries — extend as new ones appear (the scraper warns
# on stderr when a deduped school count differs from the raw row count, and the
# admin importer warns on near-duplicate spellings).
CANONICAL_SCHOOLS = {
    "west texas a&m buffs": "West Texas A&M University",
    "kansas state cats": "Kansas State University",
    "garden city community college busters": "Garden City Community College",
    "eastern oklahoma state": "Eastern Oklahoma State College",
    "eastern oklahoma state college": "Eastern Oklahoma State College",
    "new mexico state": "New Mexico State University",
    "univ of georgia": "University of Georgia",
    "univ of arizona": "University of Arizona",
    "oklahoma state univ": "Oklahoma State University",
    "oklahoma state": "Oklahoma State University",
    "texas tech": "Texas Tech University",
    "texas tech univ": "Texas Tech University",
    "texas a&m": "Texas A&M University",
    "texas a&m univ": "Texas A&M University",
    "west texas a&m": "West Texas A&M University",
    "kansas state": "Kansas State University",
    "kansas state univ": "Kansas State University",
    "k-state": "Kansas State University",
    "colorado state": "Colorado State University",
    "south dakota state": "South Dakota State University",
    "iowa state": "Iowa State University",
    "univ of wyoming": "University of Wyoming",
    "univ of illinois": "University of Illinois",
    "univ of nebraska": "University of Nebraska",
    "university of nebraska-lincoln": "University of Nebraska",
    "tarleton state": "Tarleton State University",
    "iowa state": "Iowa State University",
    "texas a&m kingsville": "Texas A&M Kingsville",
    "texas a&m-kingsville": "Texas A&M Kingsville",
}

MONTHS = ("january february march april may june july august "
          "september october november december").split()
# Matches full or 3-letter month names: "January 18, 2026" or "Jan 18, 2026"
DATE_RE = re.compile(
    r"\b(%s)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b" % "|".join(m[:3] for m in MONTHS),
    re.I)


def date_to_iso(m):
    month = [x[:3] for x in MONTHS].index(m.group(1).lower()[:3]) + 1
    return "%04d-%02d-%02d" % (int(m.group(3)), month, int(m.group(2)))


def normalize_school(raw):
    """Trim, collapse whitespace, strip squad suffixes, apply canonical map.

    Squad suffixes seen on judgingcard: "Alt"/"Alt 3" (alternates), a trailing
    standalone A/B letter, and color/mascot squad tokens ("Texas Tech Black",
    "Kansas State Wild"). All squads collapse onto the school; dedup later keeps
    the best-placing one.
    """
    name = re.sub(r"\s+", " ", (raw or "")).strip()
    # alternates: "Oklahoma State Alt 14", "Clarendon College Alt"
    name = re.sub(r"\s+Alt\.?\s*\d*$", "", name, flags=re.I)
    # trailing standalone team letter: "Some School B", "Some School (A)",
    # "Some School - B". Never strips real name endings like "Texas A&M" because
    # the letter must be its own token after a space/dash/paren.
    name = re.sub(r"\s*[-–]\s*[AB]$", "", name)
    name = re.sub(r"\s+\(([AB])\)$", "", name)
    m = re.match(r"^(.*\S)\s+([AB])$", name)
    if m and not re.search(r"A\s*&\s*M$", m.group(1), re.I):
        name = m.group(1)
    key = re.sub(r"\.", "", name).lower().strip()
    # full-name canonical entries win before any suffix stripping
    if key in CANONICAL_SCHOOLS:
        return CANONICAL_SCHOOLS[key]
    # strip one trailing squad color/mascot token ("Texas Tech Black" ->
    # "Texas Tech", "West Texas A&M Go" -> "West Texas A&M")
    parts = name.rsplit(" ", 1)
    if len(parts) == 2 and parts[1].lower() in SQUAD_SUFFIXES:
        name = parts[0]
        key = re.sub(r"\.", "", name).lower().strip()
    return CANONICAL_SCHOOLS.get(key, name)


def fetch(url):
    r = requests.get(url, headers=UA, timeout=30)
    r.raise_for_status()
    return BeautifulSoup(r.text, "html.parser")


def base_overall_url(url):
    """Strip any VID param so we always start from the Overall page."""
    p = urlparse(url)
    q = {k: v for k, v in parse_qs(p.query).items() if k.upper() != "VID"}
    return urlunparse(p._replace(query=urlencode(q, doseq=True)))


def find_category_links(soup, page_url):
    """Map category key -> absolute URL, from nav anchors linking Team.aspx?...VID=.

    Followed links are pinned to the same host as the input URL so a hostile or
    compromised page can't redirect the scraper's GETs to arbitrary hosts.
    """
    host = urlparse(page_url).netloc.lower()
    found = {}
    for a in soup.find_all("a", href=True):
        if "team.aspx" not in a["href"].lower() or "vid=" not in a["href"].lower():
            continue
        target = urljoin(page_url, a["href"])
        if urlparse(target).netloc.lower() != host:
            continue
        text = re.sub(r"\s+", " ", a.get_text(" ", strip=True)).lower()
        if text in CATEGORY_LINK_MAP:
            found[CATEGORY_LINK_MAP[text]] = target
    return found


ALT_ROW_RE = re.compile(r"\bAlt\.?\s*\d*$", re.I)


def parse_team_table(soup):
    """Parse a judgingcard team standings table.

    Rows look like: Team # | St | Team Name | Score | Rank | ...
    Header positions are located by header text rather than fixed indexes,
    defensively.

    judgingcard's raw rank numbers count every alternate/practice squad as a
    separate entry (e.g. Houston fields "Oklahoma State Alt 1".."Alt 14"
    alongside "Oklahoma State Black"), so after collapsing squads down to one
    best-place-per-school, the surviving places are NOT a clean 1..M ranking
    — they can jump straight from 8 to 14 to 58. Since placementFactor's
    lookup tables are rank-sensitive (rank 8 and rank 14 carry meaningfully
    different weight), we renumber the deduped survivors into a clean
    sequential field here rather than leaving raw-with-gaps places for the
    engine to misinterpret against an inflated field size.

    Returns (deduped_rows, alt_only_schools) where deduped_rows is
    [{school, score, place}] with place renumbered 1..len(deduped_rows), and
    alt_only_schools is the set of schools whose EVERY raw entry was an
    alternate-squad row ("... Alt", "... Alt 3") — i.e. no plain-name or
    color/mascot-squad entry was ever seen for them, so their placement may
    reflect a single competitor or a JV squad rather than the real team.
    """
    def col(headers, needle):
        for i, h in enumerate(headers):
            if needle in h:
                return i
        return None

    best_rows = []
    for table in soup.find_all("table"):
        trs = table.find_all("tr")
        if not trs:
            continue
        headers = [re.sub(r"\s+", " ", th.get_text(" ", strip=True)).lower()
                   for th in trs[0].find_all(["th", "td"])]
        i_name, i_rank, i_score = col(headers, "team name"), col(headers, "rank"), col(headers, "score")
        if i_name is None or i_rank is None:
            continue
        rows = []
        for tr in table.find_all("tr")[1:]:
            cells = tr.find_all(["td", "th"])
            if len(cells) <= max(i_name, i_rank):
                continue
            raw_name = cells[i_name].get_text(" ", strip=True)
            rank_txt = cells[i_rank].get_text(strip=True)
            if not raw_name or not re.fullmatch(r"\d+", rank_txt):
                continue
            row = {
                "school": normalize_school(raw_name),
                "place": int(rank_txt),
                "is_alt": bool(ALT_ROW_RE.search(raw_name)),
            }
            if i_score is not None and len(cells) > i_score:
                s = cells[i_score].get_text(strip=True).replace(",", "")
                if re.fullmatch(r"-?\d+(\.\d+)?", s):
                    row["score"] = float(s) if "." in s else int(s)
            rows.append(row)
        if len(rows) > len(best_rows):
            best_rows = rows

    # Group by school: keep the best (lowest) place per school, and track
    # whether every raw entry for that school was an alternate-squad row.
    by_school = {}
    for r in sorted(best_rows, key=lambda r: r["place"]):
        g = by_school.setdefault(r["school"], {"best": r, "all_alt": True})
        g["all_alt"] = g["all_alt"] and r["is_alt"]
        if r["place"] < g["best"]["place"]:
            g["best"] = r

    ordered = sorted(by_school.items(), key=lambda kv: kv[1]["best"]["place"])
    alt_only_schools = {school for school, g in ordered if g["all_alt"]}
    deduped = []
    for rank, (school, g) in enumerate(ordered, start=1):
        row = {"school": school, "place": rank}
        if "score" in g["best"]:
            row["score"] = g["best"]["score"]
        deduped.append(row)

    if len(deduped) != len(best_rows):
        print(f"  note: {len(best_rows)} rows collapsed to {len(deduped)} schools "
              f"(multi-squad dedup, renumbered 1-{len(deduped)})", file=sys.stderr)
    if alt_only_schools:
        print(f"  note: alt-squad-only (unverified) schools: {sorted(alt_only_schools)}",
              file=sys.stderr)
    return deduped, alt_only_schools


def parse_contest_meta(soup):
    """Best-effort contest name + ISO date from the page header text.

    judgingcard renders a header blob like:
      "National Western in Honor of R. Paul Clayton  Jan 18, 2026
       National Western- American Division"
    and separately a server-generated current date in the footer — so the date
    must come from the header blob (near the contest name), never the page at
    large first.
    """
    name, date_iso = None, None
    for tag in soup.find_all(["h1", "h2", "h3", "span", "td"]):
        t = re.sub(r"\s+", " ", tag.get_text(" ", strip=True))
        if not (5 < len(t) < 300):
            continue
        if re.search(r"(contest|classic|western|royal|exposition|invitational|national|meat)", t, re.I):
            m = DATE_RE.search(t)
            if m:
                date_iso = date_to_iso(m)
                t = t[:m.start()].strip(" -–,")
            name = t[:200]
            break
    if not date_iso:  # fallback: first date anywhere (header appears before footer)
        m = DATE_RE.search(soup.get_text(" ", strip=True))
        if m:
            date_iso = date_to_iso(m)
    return name, date_iso


def kebab(s):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s.lower())).strip("-")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("url", help="judgingcard.com Team.aspx results URL")
    ap.add_argument("--division", choices=["senior", "junior"], default="senior")
    ap.add_argument("--weight", type=float, default=1.0, help="1 = normal, 2 = marquee (International)")
    ap.add_argument("--name", help="override contest name")
    ap.add_argument("--short-name", dest="short_name", help="short display name, e.g. 'National Western'")
    ap.add_argument("--date", help="override date, yyyy-mm-dd")
    ap.add_argument("--season", type=int, help="override season year (default: from date)")
    ap.add_argument("--out", help="write JSON to this file instead of stdout")
    args = ap.parse_args()

    url = base_overall_url(args.url)
    print(f"Fetching overall standings: {url}", file=sys.stderr)
    soup = fetch(url)

    name, date_iso = parse_contest_meta(soup)
    name = args.name or name
    date_iso = args.date or date_iso
    if not name:
        sys.exit("Could not detect contest name — pass --name")
    if not date_iso or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_iso):
        sys.exit("Could not detect contest date — pass --date yyyy-mm-dd")
    short = args.short_name or re.sub(r"\s+in honor of.*$", "", name, flags=re.I).strip()[:60]
    season = args.season or int(date_iso[:4])

    overall, alt_only_schools = parse_team_table(soup)
    if not overall:
        sys.exit("No team standings table found on the overall page.")
    print(f"  {len(overall)} teams in overall standings", file=sys.stderr)

    results = {r["school"]: dict(r) for r in overall}

    for cat_key, cat_url in sorted(find_category_links(soup, url).items(), key=lambda kv: str(kv[0])):
        if cat_key is None:
            continue  # the Overall link — already parsed
        print(f"Fetching {cat_key}: {cat_url}", file=sys.stderr)
        try:
            rows, _ = parse_team_table(fetch(cat_url))
        except Exception as e:
            print(f"  WARNING: failed to fetch/parse {cat_key}: {e}", file=sys.stderr)
            continue
        matched = 0
        for row in rows:
            team = results.get(row["school"])
            if team is None:
                print(f"  WARNING: {cat_key} school not in overall standings: {row['school']!r}", file=sys.stderr)
                continue
            entry = {"place": row["place"]}
            if "score" in row:
                entry["score"] = row["score"]
            team.setdefault("categories", {})[cat_key] = entry
            matched += 1
        print(f"  {matched} teams matched", file=sys.stderr)

    doc = {
        "name": name[:200],
        "shortName": short,
        "date": date_iso,
        "season": season,
        "division": args.division,
        "weight": args.weight if args.weight != int(args.weight) else int(args.weight),
        "sourceUrl": url,
        "teamCount": len(overall),
        "results": sorted(results.values(), key=lambda r: r["place"]),
    }
    if alt_only_schools:
        # Import-time hint only — NOT part of the meat_contests schema.
        # admin.js reads this to badge/offer-exclude on affected rows in the
        # import preview, then strips it before writing to Firestore.
        doc["altOnlySchools"] = sorted(alt_only_schools)
        print(f"  ALT-ONLY (unverified) schools carried into output: {sorted(alt_only_schools)}",
              file=sys.stderr)

    slug = f"{date_iso}_{kebab(short)}_{args.division}"
    out = json.dumps(doc, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(out + "\n")
        print(f"Wrote {args.out}", file=sys.stderr)
    else:
        print(out)
    print(f"\nSuggested docId: {slug}", file=sys.stderr)
    print("Paste the JSON into admin.html → Power Rankings → Import.", file=sys.stderr)
    print(f"Generated on {dt.date.today().isoformat()} — verify placements against the source page.", file=sys.stderr)


if __name__ == "__main__":
    main()
