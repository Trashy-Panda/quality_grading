#!/usr/bin/env python3
"""
push_contests.py — bulk-upload meat_contests JSON docs to Firestore via the
firebase-admin SDK (service-account writes bypass security rules, same as the
grader pipeline).

Usage:
  python push_contests.py --sa ../grader/secrets/firebase-service-account.json historic/*.json *.json
  python push_contests.py --sa <key.json> --dry-run historic/*.json

DocId = {date}_{kebab(shortName)}_{division} — same slug the admin panel's
import box generates, so re-pushing overwrites the same docs (idempotent).
"""

import argparse
import glob
import json
import sys
from pathlib import Path

from ingest_judgingcard import kebab

REQUIRED = ("name", "shortName", "date", "season", "division", "weight",
            "teamCount", "results")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("paths", nargs="+", help="JSON files or globs")
    ap.add_argument("--sa", required=True, help="service-account key path")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    files = []
    for p in args.paths:
        files.extend(sorted(glob.glob(p)))
    docs = {}
    for f in files:
        d = json.loads(Path(f).read_text(encoding="utf-8"))
        missing = [k for k in REQUIRED if k not in d]
        if missing:
            sys.exit(f"{f}: missing fields {missing}")
        slug = f"{d['date']}_{kebab(d['shortName'])}_{d['division']}"
        if slug in docs:
            sys.exit(f"duplicate slug {slug} (from {f})")
        docs[slug] = d
    print(f"{len(docs)} docs to push")
    if args.dry_run:
        for s in list(docs)[:5]:
            print(" ", s)
        return

    import firebase_admin
    from firebase_admin import credentials, firestore
    firebase_admin.initialize_app(credentials.Certificate(args.sa))
    db = firestore.client()

    batch, count = db.batch(), 0
    for slug, d in docs.items():
        d = dict(d)
        # altOnlySchools is an import-time-only hint for the admin UI's
        # badge/exclude flow (see docs/NOTES.md) — not part of the stored
        # schema. This bulk pusher bypasses that UI, so strip it here rather
        # than leave it sitting in Firestore unresolved; the source JSON file
        # on disk still has it for whoever re-imports through admin.html.
        d.pop("altOnlySchools", None)
        d["createdAt"] = firestore.SERVER_TIMESTAMP
        d["updatedAt"] = firestore.SERVER_TIMESTAMP
        batch.set(db.collection("meat_contests").document(slug), d)
        count += 1
        if count % 400 == 0:  # Firestore batch limit is 500 ops
            batch.commit()
            batch = db.batch()
            print(f"  committed {count}")
    batch.commit()
    print(f"Done — {count} docs written to meat_contests.")


if __name__ == "__main__":
    main()
