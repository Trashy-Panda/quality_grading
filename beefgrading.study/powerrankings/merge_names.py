#!/usr/bin/env python3
"""
merge_names.py - fix scantron "bubble errors" in contestant names across contests.

judgingcard names come from bubbled cards, so one student can show up as
"Aaron Morales" at six contests and "Aaron Morale S" at a seventh. Each
variant would rank as a separate person. This script merges variants so a
contestant's whole season sits under one name.

Two names merge when, at the same school:
  - they match ignoring spaces and case ("Morale S" / "Morales"), or they are
    near-identical (similarity >= 0.85, e.g. "Pfarson" / "Pearson"), AND
  - they never appear at the same contest (one person can't compete twice in
    one contest, so this keeps similarly named teammates apart).
The most frequent spelling wins; ties go to the cleanest-looking spelling.
NAME_OVERRIDES below pins a spelling by hand when the vote is wrong.
Original spellings are kept on each record as `rawName`.

Usage (run over every contest file of a season after adding one):
    python merge_names.py *2026*.json            # rewrite files in place
    python merge_names.py *2026*.json --dry-run  # just list the merges
"""

import argparse
import collections
import difflib
import json
import re
import sys
from pathlib import Path

SIMILARITY = 0.85

# (school, spelling as scraped) -> correct spelling. Applied before the vote,
# for ties the vote gets wrong, truncated names, and variants too garbled for
# the similarity check. Add a line here when a merge comes out wrong.
NAME_OVERRIDES = {
    ("New Mexico State University", "Brvsen Soiles"): "Brysen Soiles",
    ("University of Florida", "Leydiali Aviles"): "Leydializ Aviles",
    ("University of Nebraska", "Iaire Scheideier C"): "Claire Scheideler",
    ("University of Nebraska", "Ciaire Scheideier"): "Claire Scheideler",
}


def squash(name):
    return re.sub(r"\s+", "", name.lower())


def similar(a, b):
    return squash(a) == squash(b) or \
        difflib.SequenceMatcher(None, a.lower(), b.lower()).ratio() >= SIMILARITY


def cleanliness(name):
    """Higher is cleaner: no stray symbols, no lone letters, no split tokens."""
    tokens = name.split()
    return (
        -sum(not re.fullmatch(r"[A-Za-z'\-]+", t) for t in tokens),
        -sum(len(t) == 1 for t in tokens),
        -len(tokens),
    )


def plan(docs):
    """{(school, variant): canonical} for every variant that should change."""
    # school -> name -> set of contest indexes, and occurrence counts
    where = collections.defaultdict(lambda: collections.defaultdict(set))
    count = collections.defaultdict(collections.Counter)
    raw_to_name = {}  # (school, raw) -> name after overrides
    for i, doc in enumerate(docs):
        for p in doc.get("individuals", []):
            raw = p.get("rawName", p["name"])
            name = NAME_OVERRIDES.get((p["school"], raw), raw)
            raw_to_name[(p["school"], raw)] = name
            where[p["school"]][name].add(i)
            count[p["school"]][name] += 1

    canonical = {}  # (school, name after overrides) -> winning spelling
    for school, names in where.items():
        # greedy clustering, most frequent names first so they anchor clusters
        order = sorted(names, key=lambda n: (-count[school][n], cleanliness(n)), reverse=False)
        clusters = []  # [names list, contests set]
        for n in order:
            for cl in clusters:
                if names[n] & cl[1]:
                    continue  # shares a contest with this cluster: different person
                if any(similar(n, m) for m in cl[0]):
                    cl[0].append(n)
                    cl[1] |= names[n]
                    break
            else:
                clusters.append([[n], set(names[n])])
        for members, _ in clusters:
            best = max(members, key=lambda n: (count[school][n], cleanliness(n)))
            for n in members:
                canonical[(school, n)] = best

    # keyed by the scraped spelling so re-runs stay idempotent
    return {(school, raw): canonical[(school, name)]
            for (school, raw), name in raw_to_name.items()
            if canonical[(school, name)] != raw}


def apply(docs, changes):
    touched = set()
    for i, doc in enumerate(docs):
        for p in doc.get("individuals", []):
            raw = p.get("rawName", p["name"])
            fixed = changes.get((p["school"], raw))
            if fixed and p["name"] != fixed:
                p["rawName"] = raw
                p["name"] = fixed
                touched.add(i)
    return touched


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    paths = [Path(p) for p in args.paths]
    docs = [json.loads(p.read_text(encoding="utf-8")) for p in paths]
    changes = plan(docs)
    for (school, old), new in sorted(changes.items()):
        print(f"{school}: {old!r} -> {new!r}")
    if not changes:
        print("No name variants to merge.")
    if args.dry_run:
        return
    for i in apply(docs, changes):
        paths[i].write_text(json.dumps(docs[i], indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"  rewrote {paths[i].name}", file=sys.stderr)


if __name__ == "__main__":
    main()
