"""
recalibrate.py — turn exported trainer corrections into a data-driven
calibration_offset, replacing ad hoc single-guess offsets (see
grader/AUDIT_AND_REDESIGN.md, Addendum 3).

Accepts one or more JSON files exported by grader/build_trainer.py's
"Export corrections" button (accumulate across sessions — point this at
every file you've downloaded so far; corrections are additive).

For each correction, computes the score-space target as the corrected
grade's band midpoint minus the AI's raw score, giving the offset that
would have made the AI's raw score land in the middle of the grade you
actually picked. Averages across all corrections (agreements count too,
as a zero-offset-needed data point, so agreement rate is reflected).

Usage:
  python grader/recalibrate.py grader_corrections_171234.json [more_files.json ...]
"""
import argparse
import json
import os
import statistics
import sys
from datetime import datetime, timezone

# Band midpoints — NOT uniform 100-wide bands: Select splits Slight (300-399)
# into two 50-point halves (SE_LO/SE_HI), everything else is a full 100-point band.
GRADE_TARGET_MIDPOINT = {
    'STD': 200, 'SE_LO': 325, 'SE_HI': 375, 'CH_LO': 450, 'CH_AVG': 550,
    'CH_HI': 650, 'PR_LO': 750, 'PR_AVG': 850, 'PR_HI': 950,
}
LOW_HALF = {'STD', 'SE_LO', 'SE_HI', 'CH_LO'}
HIGH_HALF = {'CH_AVG', 'CH_HI', 'PR_LO', 'PR_AVG', 'PR_HI'}

_CALIBRATION_FILE = os.path.join(os.path.dirname(__file__), 'calibration.json')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+', help='One or more corrections JSON files exported by build_trainer.py')
    ap.add_argument('--dry-run', action='store_true', help="Compute and print, but don't write calibration.json")
    args = ap.parse_args()

    all_corrections = []
    for path in args.files:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        all_corrections.extend(data)
        print(f'Loaded {len(data)} corrections from {path}')

    if not all_corrections:
        sys.exit('No corrections found in the given file(s).')

    offsets = []
    skipped = 0
    for c in all_corrections:
        target = GRADE_TARGET_MIDPOINT.get(c['user_grade'])
        ai_score = c.get('ai_score')
        if target is None or ai_score is None:
            skipped += 1
            continue
        offsets.append(target - ai_score)

    n = len(offsets)
    if n == 0:
        sys.exit('No usable corrections (missing ai_score or unrecognized grade).')

    mean_offset = statistics.mean(offsets)
    stdev = statistics.stdev(offsets) if n > 1 else 0.0
    print(f'\nn={n} usable corrections ({skipped} skipped — missing data)')
    print(f'Mean offset needed: {mean_offset:+.1f}  (stdev {stdev:.1f})')

    if n >= 40:
        low = [c for c in all_corrections if c['user_grade'] in LOW_HALF
               and GRADE_TARGET_MIDPOINT.get(c['user_grade']) is not None and c.get('ai_score') is not None]
        high = [c for c in all_corrections if c['user_grade'] in HIGH_HALF
                and GRADE_TARGET_MIDPOINT.get(c['user_grade']) is not None and c.get('ai_score') is not None]
        if low and high:
            low_offset = statistics.mean(GRADE_TARGET_MIDPOINT[c['user_grade']] - c['ai_score'] for c in low)
            high_offset = statistics.mean(GRADE_TARGET_MIDPOINT[c['user_grade']] - c['ai_score'] for c in high)
            print(f'\nLow-half (STD..CH_LO) offset:  {low_offset:+.1f}  (n={len(low)})')
            print(f'High-half (CH_AVG..PR_HI) offset: {high_offset:+.1f}  (n={len(high)})')
            if abs(low_offset - high_offset) > 30:
                print('NOTE: these differ by more than 30 points — the bias may not be uniform across the '
                      'scale (a single flat offset may not be sufficient). Not auto-applied; worth deciding '
                      'deliberately whether a scale-dependent correction is warranted once more data accumulates.')

    if args.dry_run:
        print('\n--dry-run: not writing calibration.json')
        return

    payload = {
        'calibration_offset': round(mean_offset, 1),
        'n': n,
        'stdev': round(stdev, 1),
        'computed_at': datetime.now(timezone.utc).isoformat(),
        'source_files': [os.path.basename(p) for p in args.files],
    }
    with open(_CALIBRATION_FILE, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2)
    print(f'\nWrote {_CALIBRATION_FILE}: calibration_offset={payload["calibration_offset"]}')
    print('This is now the default for every grader/*.py script unless explicitly overridden.')


if __name__ == '__main__':
    main()
