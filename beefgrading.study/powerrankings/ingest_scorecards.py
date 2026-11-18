#!/usr/bin/env python3
"""
ingest_scorecards.py - add individual results and placings/reasons splits to
meat_contests JSON files that ingest_judgingcard.py already produced.

For each contest file it reads `sourceUrl` (a judgingcard Team.aspx URL), then:
  1. Fetches Individual.aspx (same ID/EID) and every category variant (VID) for
     official individual places.
  2. Fetches each contestant's ScoreCard.aspx and sums class scores into
     beef / pork / lamb placings and reasons.
  3. Writes `individuals` (top level) and `splits` on each team result. A team's
     split is the sum of the squad members whose scores add up to the official
     team score, and every category total is checked against the team table.

Usage:
    python ingest_scorecards.py american-royal2026-senior.json
    python ingest_scorecards.py *2026*.json --delay 0.5
    python ingest_scorecards.py international2026-senior.json --no-alt-events
      (International alternates have no reasons scored, so they are left out)

Files are updated in place. Requires: requests, beautifulsoup4.
"""

import argparse
import html
import itertools
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

from ingest_judgingcard import CATEGORY_LINK_MAP, UA, normalize_school

import requests

HOST = "www.judgingcard.com"
BASE = f"https://{HOST}/Results/"

# Scorecard total rows -> category keys (same keys as team `categories`)
TOTAL_ROWS = {
    "Beef Grading Total": "beefGrading",
    "Beef Judging Total": "beefJudging",
    "Lamb Judging Total": "lambJudging",
    "Pork Judging Total": "porkJudging",
    "Specifications Total": "specifications",
    "Overall Beef Total": "overallBeef",
    "Placing Total": "totalPlacings",
    "Reasons Total": "reasons",
}
SPECIES = ("beef", "pork", "lamb")
ALT_RE = re.compile(r"\bAlt\.?\s*\d*$", re.I)

session = requests.Session()
session.headers.update(UA)


def get(url, delay):
    if urlparse(url).netloc.lower() != HOST:
        raise ValueError(f"refusing off-host URL {url}")
    for attempt in range(3):
        try:
            r = session.get(url, timeout=30)
            r.raise_for_status()
            time.sleep(delay)
            return r.text
        except requests.RequestException as e:
            if attempt == 2:
                raise
            print(f"    retry {url} ({e})", file=sys.stderr)
            time.sleep(3)


def clean(s):
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def parse_individual_rows(page):
    """[(cid, name, rawTeam, score, place)] from an Individual.aspx table."""
    rows = re.findall(
        r"<a href='ScoreCard\.aspx\?CID=(\d+)'>([^<]+)</a>\s*</td>"
        r"<td>([^<]*)</td><td>(\d*)</td><td>(\d*)</td>", page)
    return [(cid, clean(n), clean(t), int(s) if s else None, int(p) if p else None)
            for cid, n, t, s, p in rows]


def all_individual_rows(url, delay, first_page=None):
    """Every row of a paged Individual.aspx grid (100 per page).

    Later pages need an ASP.NET postback: the page's hidden form fields plus a
    Telerik grid "Page;N" command, posted back to the same URL.
    """
    page = first_page or get(url, delay)
    rows = parse_individual_rows(page)
    m = re.search(r'\\"PageCount\\":(\d+)', page)
    pages = int(m.group(1)) if m else 1
    grid = re.search(r'"UniqueID":"([^"]*rg_IndRanking)"', page)
    if pages > 1 and not grid:
        raise ValueError(f"{url}: {pages} pages but no grid id found")
    form = {k: html.unescape(v) for k, v in re.findall(
        r'<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"', page)}
    for n in range(2, pages + 1):
        data = dict(form, __EVENTTARGET=grid.group(1),
                    __EVENTARGUMENT=f"FireCommand:{grid.group(1)}$ctl00;Page;{n}")
        r = session.post(url, data=data, timeout=30)
        r.raise_for_status()
        time.sleep(delay)
        more = parse_individual_rows(r.text)
        if not more:
            raise ValueError(f"{url}: page {n} came back empty")
        rows.extend(more)
    return rows


def category_links(page, page_url):
    found = {}
    for href, text in re.findall(r'href="(Individual\.aspx\?[^"]*VID=\d+)"[^>]*>([^<]+)<', page):
        key = clean(text).lower()
        if key in CATEGORY_LINK_MAP and CATEGORY_LINK_MAP[key]:
            found[CATEGORY_LINK_MAP[key]] = urljoin(page_url, html.unescape(href))
    return found


def species_of(label):
    low = label.lower()
    if "beef" in low:
        return "beef"
    if "pork" in low:
        return "pork"
    if "lamb" in low or "veal" in low:
        return "lamb"
    return None


def parse_scorecard(page):
    names = re.findall(r'font-weight:bold;">([^<]+)</td><td style="border-color:SteelBlue', page)
    scores = re.findall(r'font-size:12pt;font-weight:bold;">([^<]*)</td>', page)
    if len(names) != len(scores) or not names:
        raise ValueError(f"scorecard layout changed ({len(names)} names, {len(scores)} scores)")
    totals, split = {}, {s: {"placing": 0, "reasons": 0} for s in SPECIES}
    for n, s in zip(names, scores):
        label, val = clean(n), clean(s)
        if not val.lstrip("-").isdigit():
            continue
        val = int(val)
        if label in ("Reasons Total", "Questions Total"):
            # junior contests use questions in place of written reasons
            totals["reasons"] = totals.get("reasons", 0) + val
        elif label in TOTAL_ROWS:
            totals[TOTAL_ROWS[label]] = val
        elif label == "Overall Score":
            totals["overall"] = val
        elif label.startswith("Placing") and "Penalty" not in label:
            sp = species_of(label)
            if sp:
                split[sp]["placing"] += val
        elif label.startswith(("Reasons", "Questions")):
            sp = species_of(label)
            if sp:
                split[sp]["reasons"] += val
    # sanity: species placings + reasons must equal the species judging totals
    for sp in SPECIES:
        key = f"{sp}Judging"
        if key in totals and sum(split[sp].values()) != totals[key]:
            raise ValueError(f"{sp} split {split[sp]} != {key} {totals[key]}")
    return totals, split


def add_splits(a, b):
    return {sp: {k: a[sp][k] + b[sp][k] for k in ("placing", "reasons")} for sp in SPECIES}


def counting_members(members, team):
    """Pick the squad members whose scores reproduce the official team totals."""
    cats = team.get("categories", {})
    best = None
    for size in (4, 3, 5):
        for combo in itertools.combinations(members, min(size, len(members))):
            if sum(m["score"] or 0 for m in combo) != team["score"]:
                continue
            if all(sum(m["categories"].get(k, {}).get("score", 0) for m in combo) == v["score"]
                   for k, v in cats.items()):
                return list(combo), True
            best = best or list(combo)
        if len(members) <= size:
            break
    return best, False


def log(msg):
    print(msg, file=sys.stderr)


def _event_base(name):
    """'American Royal - American Division - Alt.' -> 'americanroyalamericandivision'."""
    name = re.sub(r"\balt(ernates?)?\b\.?", "", name.lower())
    return re.sub(r"[^a-z0-9]", "", name)


def alt_events(contest_id, main_eid, delay):
    """EIDs of the alternate events that pair with the main event.

    Most contests post alternates as a sibling event named like the division
    plus "Alt" (e.g. "Southwestern - American Division - Alt."). Houston-style
    contests keep alternates inside the main event and have no sibling.
    """
    page = get(f"{BASE}Events.aspx?ID={contest_id}", delay)
    events = {}
    for row in re.findall(r'<tr[^>]*class="rg(?:Alt)?Row[^>]*>(.*?)</tr>', page, re.S):
        eid = re.search(r"EID=(\d+)", row)
        cells = [clean(re.sub("<[^>]+>", "", c)) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if eid and cells:
            events[eid.group(1)] = next(c for c in cells if c)
    main = events.get(main_eid)
    if not main:
        raise ValueError(f"event {main_eid} not on the events page")
    return [e for e, n in events.items()
            if e != main_eid and re.search(r"\balt", n, re.I)
            and _event_base(n) == _event_base(main)]


def school_of(raw_team):
    """Alt-event team names come as 'Texas Tech University - ' or
    'The Ohio State University-Alt'; trim that before the canonical lookup."""
    name = re.sub(r"[\s\-–]*(\balt(ernates?)?\.?\s*\d*)?[\s\-–]*$", "", raw_team, flags=re.I)
    return normalize_school(name or raw_team)


def rank_by_score(items, score_of, set_place):
    """Competition ranking, highest score first; ties share a place."""
    ranked = sorted((p for p in items if score_of(p) is not None), key=score_of, reverse=True)
    prev, place = None, 0
    for i, p in enumerate(ranked, 1):
        if score_of(p) != prev:
            place, prev = i, score_of(p)
        set_place(p, place)


def enrich(doc, delay=0.4, with_alts=True):
    """Add `individuals` and per-team `splits` to a contest doc in place.

    with_alts=False skips the sibling alt events (the International: its
    alternates have no reasons scored, so their totals are not comparable).
    Returns a list of problems (teams whose totals could not be reproduced).
    Raises on a missing sourceUrl or a changed page layout.
    """
    src = doc.get("sourceUrl", "")
    m = re.search(r"ID=(\d+)&EID=(\d+)", src)
    if not m:
        raise ValueError("no judgingcard sourceUrl")
    contest_id, main_eid = m.group(1), m.group(2)
    alt_eids = alt_events(contest_id, main_eid, delay) if with_alts else []

    people = {}
    for eid in [main_eid] + alt_eids:
        ind_url = f"{BASE}Individual.aspx?ID={contest_id}&EID={eid}"
        rows = all_individual_rows(ind_url, delay)
        in_alt_event = eid != main_eid
        log(f"  {len(rows)} contestants in {'alt' if in_alt_event else 'main'} event {eid}")
        for cid, name, raw_team, score, place in rows:
            people[cid] = {
                "name": name.title() if name.isupper() else name,
                "school": school_of(raw_team),
                "squad": raw_team,
                "main": not in_alt_event,
                "alt": in_alt_event or bool(ALT_RE.search(raw_team)),
                "officialPlace": place, "score": score, "categories": {},
            }

    # Every category total is on the scorecard, so read scores from there.
    for i, (cid, p) in enumerate(people.items(), 1):
        totals, split = parse_scorecard(get(f"{BASE}ScoreCard.aspx?CID={cid}", delay))
        p["splits"] = split
        if p["score"] is None and "overall" in totals:
            p["score"] = totals["overall"]
        for key, val in totals.items():
            if key != "overall":
                p["categories"][key] = {"place": None, "score": val}
        if i % 10 == 0:
            log(f"    {i}/{len(people)} scorecards")

    # Main and alt events judge the same classes, so rank everyone together by
    # score (official places only rank within each event). Ties share a place.
    rank_by_score(people.values(), lambda p: p["score"],
                  lambda p, n: p.__setitem__("place", n))
    for key in TOTAL_ROWS.values():
        have = [p for p in people.values() if key in p["categories"]]
        rank_by_score(have, lambda p: p["categories"][key]["score"],
                      lambda p, n: p["categories"][key].__setitem__("place", n))

    # team splits: members of the squad that produced the school's result
    by_squad = {}
    for p in people.values():
        if p["main"]:  # alt-event squads never count toward team scores
            by_squad.setdefault(p["squad"], []).append(p)
    problems = []
    for team in doc["results"]:
        found = None
        for squad, members in by_squad.items():
            if members[0]["school"] != team["school"]:
                continue
            combo, exact = counting_members(members, team)
            if combo and (exact or not found):
                found = (combo, exact)
                if exact:
                    break
        if not found:
            problems.append(f"{team['school']}: no squad sums to {team['score']}")
            continue
        combo, exact = found
        if not exact:
            problems.append(f"{team['school']}: overall matches, a category total does not")
        total = {sp: {"placing": 0, "reasons": 0} for sp in SPECIES}
        for mbr in combo:
            total = add_splits(total, mbr["splits"])
            mbr["counted"] = True
        team["splits"] = total

    doc["individuals"] = [
        {k: v for k, v in p.items() if k not in ("squad", "main")}
        for p in sorted(people.values(), key=lambda p: (p["place"] or 9999, p["name"]))
    ]
    n_split = sum(1 for t in doc["results"] if "splits" in t)
    log(f"  {len(people)} individuals, splits for {n_split}/{len(doc['results'])} teams")
    for msg in problems:
        log(f"  CHECK {msg}")
    return problems


def process(path, delay, with_alts=True):
    doc = json.loads(Path(path).read_text(encoding="utf-8"))
    log(f"{path}:")
    problems = enrich(doc, delay, with_alts)
    Path(path).write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return not problems


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--delay", type=float, default=0.4, help="seconds between requests")
    ap.add_argument("--no-alt-events", action="store_true",
                    help="skip sibling alt events (use for the International: alternates' reasons are unscored)")
    args = ap.parse_args()
    ok = True
    for p in args.paths:
        try:
            ok = process(p, args.delay, not args.no_alt_events) and ok
        except Exception as e:  # keep going so one bad contest doesn't stop the batch
            ok = False
            print(f"{p}: FAILED {e}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
