"""
eval_harness.py — validate the redesigned grader (Option A) before committing
to a full 2,857-image regrade. See grader/AUDIT_AND_REDESIGN.md §6.

Runs:
  Tier 1 (consensus set): the 20 already human-voted images. Re-grades them
    with the NEW analyze_marbling() at k=1, computes exact/adjacent/bias/
    MAE/quadratic-weighted-kappa against vote-weighted consensus labels,
    then k=3 self-consistency on the worst disagreements.
  Tier 2 (coverage/distribution check): images sampled across cv_marbling.py
    fat-ratio deciles (free, no gold labels yet) — reports grade coverage,
    prediction-distribution entropy, and Spearman rank correlation between
    the new grader's continuous score and the free CV fat-ratio heuristic.

Budget: ~20 (Tier1 k=1) + ~45 (15 worst @ k=3) + ~30 (Tier2 k=1) = ~95 calls.

Usage:
  python grader/eval_harness.py --sa grader/secrets/firebase-service-account.json
"""

import argparse
import csv
import json
import math
import os
import sys
from collections import Counter, defaultdict

RUNG = {'STD': 0, 'SE_LO': 1, 'SE_HI': 2, 'CH_LO': 3, 'CH_AVG': 4,
        'CH_HI': 5, 'PR_LO': 6, 'PR_AVG': 7, 'PR_HI': 8}
N_RUNGS = 9


def weighted_metrics(pairs):
    """pairs: list of (pred_rung, label_rung, weight). Returns a metrics dict."""
    if not pairs:
        return None
    wsum = sum(w for _, _, w in pairs)
    exact = sum(w for p, l, w in pairs if p == l) / wsum
    adjacent = sum(w for p, l, w in pairs if abs(p - l) <= 1) / wsum
    bias = sum((p - l) * w for p, l, w in pairs) / wsum
    mae = sum(abs(p - l) * w for p, l, w in pairs) / wsum

    # Quadratic-weighted kappa (unweighted-N version over rungs, using integer pairs;
    # for small eval sets we compute it on the *unweighted* pair list for stability).
    n = len(pairs)
    preds = [p for p, l, w in pairs]
    labels = [l for p, l, w in pairs]
    O = [[0] * N_RUNGS for _ in range(N_RUNGS)]
    for p, l in zip(preds, labels):
        O[p][l] += 1
    pred_hist = Counter(preds)
    label_hist = Counter(labels)
    E = [[pred_hist[i] * label_hist[j] / n for j in range(N_RUNGS)] for i in range(N_RUNGS)]
    W = [[((i - j) ** 2) / ((N_RUNGS - 1) ** 2) for j in range(N_RUNGS)] for i in range(N_RUNGS)]
    num = sum(W[i][j] * O[i][j] for i in range(N_RUNGS) for j in range(N_RUNGS))
    den = sum(W[i][j] * E[i][j] for i in range(N_RUNGS) for j in range(N_RUNGS))
    kappa = 1 - num / den if den > 0 else float('nan')

    return {
        'n': n, 'exact': exact, 'adjacent': adjacent,
        'bias': bias, 'mae': mae, 'qwk': kappa,
    }


def spearman(xs, ys):
    n = len(xs)
    if n < 2:
        return None
    def rank(vals):
        order = sorted(range(len(vals)), key=lambda i: vals[i])
        ranks = [0.0] * len(vals)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and vals[order[j + 1]] == vals[order[i]]:
                j += 1
            avg_rank = (i + j) / 2.0 + 1
            for k in range(i, j + 1):
                ranks[order[k]] = avg_rank
            i = j + 1
        return ranks
    rx, ry = rank(xs), rank(ys)
    d2 = sum((a - b) ** 2 for a, b in zip(rx, ry))
    return 1 - (6 * d2) / (n * (n ** 2 - 1))


def load_tier1(db):
    """Build the 20-image consensus eval set from Firestore."""
    votes_by_image = defaultdict(list)
    for d in db.collection('grading_votes').stream():
        v = d.to_dict()
        votes_by_image[v.get('imageId')].append(v.get('grade'))

    ai_docs = {}
    for d in db.collection('ai_carcasses').stream():
        ai_docs[d.id] = d.to_dict()

    tier1 = []
    for image_id, grades in votes_by_image.items():
        doc = ai_docs.get(image_id)
        if not doc:
            continue
        tally = Counter(grades)
        consensus_grade, votes_for_consensus = tally.most_common(1)[0]
        if consensus_grade not in RUNG:
            continue
        old_grade = (doc.get('correct') or {}).get('qualityGrade')
        weight = min(len(grades), 5) / 5.0
        tier1.append({
            'imageId': image_id,
            'imageUrl': doc.get('imageUrl'),
            'consensus_grade': consensus_grade,
            'consensus_rung': RUNG[consensus_grade],
            'n_votes': len(grades),
            'weight': weight,
            'old_ai_grade': old_grade,
            'tally': dict(tally),
        })
    return tier1


def sample_tier2(cv_csv_path, images_dir, n_per_decile=3):
    """Stratified sample across free-CV fat-ratio deciles (no gold labels yet)."""
    rows = []
    with open(cv_csv_path, newline='') as f:
        for r in csv.DictReader(f):
            if r['ok'] == 'True' and r['fat_ratio']:
                rows.append((r['filename'], float(r['fat_ratio'])))
    if not rows:
        return []
    rows.sort(key=lambda x: x[1])
    n = len(rows)
    decile_size = max(1, n // 10)
    sample = []
    for d in range(10):
        chunk = rows[d * decile_size: (d + 1) * decile_size] if d < 9 else rows[d * decile_size:]
        if not chunk:
            continue
        step = max(1, len(chunk) // n_per_decile)
        picks = chunk[::step][:n_per_decile]
        for fname, ratio in picks:
            sample.append({'filename': fname, 'path': os.path.join(images_dir, fname), 'fat_ratio': ratio})
    return sample


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sa', required=True)
    ap.add_argument('--cv-csv', default=os.path.join(os.path.dirname(__file__), 'output', 'cv_fat_ratios.csv'))
    ap.add_argument('--images-dir', default=os.path.join(os.path.dirname(__file__), 'tmp', 'ribeyes', 'Ribeyes'))
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), 'output', 'eval_results.json'))
    ap.add_argument('--skip-tier2', action='store_true')
    ap.add_argument('--budget-usd', type=float, default=10.0,
                    help='Hard stop: abort remaining API calls once estimated cumulative spend reaches this (default $10)')
    ap.add_argument('--calibration-offset', type=float, default=None,
                    help='Constant score-space correction. Default: read grader/calibration.json (see recalibrate.py); pass a number to override for an explicit A/B test.')
    ap.add_argument('--skip-k3', action='store_true', help='Skip the k=3 self-consistency phase (fast recalibration checks)')
    args = ap.parse_args()

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import firebase_admin
    from firebase_admin import credentials, firestore
    from model_utils import analyze_marbling, set_budget, get_spent, BudgetExceeded, get_calibration_offset

    set_budget(args.budget_usd)
    budget_stopped = False
    resolved_offset = args.calibration_offset if args.calibration_offset is not None else get_calibration_offset()
    print(f'Using calibration_offset={resolved_offset} '
          f'({"explicit override" if args.calibration_offset is not None else "from grader/calibration.json"})')

    cred = credentials.Certificate(args.sa)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    print('=== Loading Tier 1 (consensus-voted images) ===')
    tier1 = load_tier1(db)
    print(f'{len(tier1)} Tier-1 images loaded.')

    print('\n=== Baseline: OLD grader vs consensus (already-stored ai_carcasses grades) ===')
    old_pairs = [(RUNG[t['old_ai_grade']], t['consensus_rung'], t['weight'])
                 for t in tier1 if t['old_ai_grade'] in RUNG]
    old_metrics = weighted_metrics(old_pairs)
    print(json.dumps(old_metrics, indent=2))

    print(f'\n=== Running NEW grader (Option A, k=1, calibration_offset={resolved_offset}) on Tier 1 (~20 calls, budget cap ${args.budget_usd:.2f}) ===')
    new_results = {}
    for t in tier1:
        try:
            res = analyze_marbling(t['imageUrl'], from_url=True, k=1, calibration_offset=resolved_offset)
        except BudgetExceeded as e:
            print(f'  BUDGET CAP HIT: {e}')
            budget_stopped = True
            break
        new_results[t['imageId']] = res
        tag = res['grade_key'] if not res['needs_review'] else 'NEEDS_REVIEW'
        print(f"  {t['imageId']:24s}  consensus={t['consensus_grade']:6s} (n={t['n_votes']})  "
              f"new={tag}  old={t['old_ai_grade']}")

    new_pairs_k1 = []
    disagreement_size = []
    for t in tier1:
        res = new_results.get(t['imageId'])
        if res is None or res['needs_review']:
            continue
        pred_rung = RUNG.get(res['grade_key'])
        if pred_rung is None:
            continue
        new_pairs_k1.append((pred_rung, t['consensus_rung'], t['weight']))
        disagreement_size.append((abs(pred_rung - t['consensus_rung']), t['imageId']))

    metrics_k1 = weighted_metrics(new_pairs_k1)
    print('\n=== NEW grader (k=1) metrics vs consensus ===')
    print(json.dumps(metrics_k1, indent=2))

    sc_results = {}
    if budget_stopped or args.skip_k3:
        print('\n=== Skipping k=3 self-consistency phase ===')
    else:
        print('\n=== Self-consistency (k=3) on the 15 worst k=1 disagreements ===')
        disagreement_size.sort(key=lambda x: -x[0])
        worst_ids = [iid for _, iid in disagreement_size[:15]]
        for t in tier1:
            if t['imageId'] not in worst_ids:
                continue
            try:
                res = analyze_marbling(t['imageUrl'], from_url=True, k=3, calibration_offset=resolved_offset)
            except BudgetExceeded as e:
                print(f'  BUDGET CAP HIT: {e}')
                budget_stopped = True
                break
            sc_results[t['imageId']] = res
            tag = res['grade_key'] if not res['needs_review'] else 'NEEDS_REVIEW'
            print(f"  {t['imageId']:24s}  consensus={t['consensus_grade']:6s}  k3={tag}  spread={res.get('spread')}")

    # Blended metrics: k=3 result where available, else k=1.
    blended_pairs = []
    for t in tier1:
        res = sc_results.get(t['imageId']) or new_results.get(t['imageId'])
        if res is None or res['needs_review']:
            continue
        pred_rung = RUNG.get(res['grade_key'])
        if pred_rung is None:
            continue
        blended_pairs.append((pred_rung, t['consensus_rung'], t['weight']))
    metrics_blended = weighted_metrics(blended_pairs)
    print('\n=== Blended (k=3 on worst 15 + k=1 elsewhere) metrics vs consensus ===')
    print(json.dumps(metrics_blended, indent=2))

    # Free B2 check: Spearman between CV fat_ratio and human consensus rung, on Tier 1.
    print('\n=== Free B2 (HSV fat-ratio) sanity check on Tier 1 ===')
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from cv_marbling import estimate_fat_ratio
    cv_pairs = []
    for t in tier1:
        cv = estimate_fat_ratio(t['imageUrl'], from_url=True)
        if cv['ok']:
            cv_pairs.append((cv['fat_ratio'], t['consensus_rung']))
    if cv_pairs:
        rho = spearman([p[0] for p in cv_pairs], [p[1] for p in cv_pairs])
        print(f'  Free HSV fat_ratio vs consensus rung: Spearman rho = {rho:.3f}  (n={len(cv_pairs)})')
    else:
        rho = None
        print('  Could not compute — CV heuristic failed on all Tier-1 images.')

    tier2_summary = None
    if budget_stopped:
        print('\n=== Skipping Tier 2 — budget cap already hit ===')
    elif not args.skip_tier2 and os.path.isfile(args.cv_csv):
        print('\n=== Tier 2: stratified coverage/distribution check (~30 calls, no gold labels yet) ===')
        tier2 = sample_tier2(args.cv_csv, args.images_dir, n_per_decile=3)
        print(f'{len(tier2)} images sampled across fat-ratio deciles.')
        t2_results = []
        for item in tier2:
            if not os.path.isfile(item['path']):
                continue
            try:
                res = analyze_marbling(item['path'], k=1, calibration_offset=resolved_offset)
            except BudgetExceeded as e:
                print(f'  BUDGET CAP HIT: {e}')
                budget_stopped = True
                break
            t2_results.append((item, res))
            tag = res['grade_key'] if not res['needs_review'] else 'NEEDS_REVIEW'
            print(f"  {item['filename']:30s}  fat_ratio={item['fat_ratio']:.3f}  new={tag}  score={res.get('score')}")

        grade_dist = Counter(r['grade_key'] for _, r in t2_results if not r['needs_review'])
        scores = [r['score'] for _, r in t2_results if not r['needs_review']]
        ratios = [item['fat_ratio'] for item, r in t2_results if not r['needs_review']]
        rho2 = spearman(ratios, scores) if len(scores) > 1 else None
        distinct_grades = len(grade_dist)
        total = sum(grade_dist.values())
        entropy = -sum((c / total) * math.log2(c / total) for c in grade_dist.values()) if total else 0
        tier2_summary = {
            'n': len(t2_results),
            'grade_distribution': dict(grade_dist),
            'distinct_grades': distinct_grades,
            'entropy_bits': entropy,
            'spearman_score_vs_cv_fat_ratio': rho2,
        }
        print('\nTier 2 summary:')
        print(json.dumps(tier2_summary, indent=2))

    out = {
        'calibration_offset_used': resolved_offset,
        'old_grader_vs_consensus': old_metrics,
        'new_grader_k1_vs_consensus': metrics_k1,
        'new_grader_blended_vs_consensus': metrics_blended,
        'free_cv_spearman_tier1': rho,
        'tier2_coverage': tier2_summary,
        'budget_stopped_early': budget_stopped,
        'estimated_spend_usd': round(get_spent(), 4),
        'budget_cap_usd': args.budget_usd,
    }
    with open(args.out, 'w') as f:
        json.dump(out, f, indent=2)
    print(f'\nWrote {args.out}')

    print(f'\n=== Estimated spend: ${get_spent():.2f} of ${args.budget_usd:.2f} cap ===')
    if budget_stopped:
        print('NOTE: this run stopped early because the budget cap was reached — metrics above are partial.')

    print('\n=== GO/NO-GO ===')
    if metrics_blended and metrics_blended['adjacent'] >= 0.70 and abs(metrics_blended['bias']) <= 0.25:
        print('PASS — adjacent >= 70% and |bias| <= 0.25. Proceed to full regrade (with user sign-off on cost).')
    else:
        print('NOT YET — see metrics above. Consider tuning calibration_offset or prompt before a full regrade.')


if __name__ == '__main__':
    main()
