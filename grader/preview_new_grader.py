"""
preview_new_grader.py — visual sanity-check gallery for the redesigned grader.

Two samples, to address a real confound in the earlier eval run:
  Tier 1 (20 images): the already human-voted consensus set from Firestore.
    Caveat surfaced by the user: these are whatever the OLD grader happened
    to produce and get voted on, so they skew toward whatever narrow range
    the old grader outputs (CH_LO/SE_HI/SE_LO) — they do NOT necessarily
    span the full quality-grade range.
  Tier 3 (25 images): a fresh RANDOM sample drawn from the TTU dataset,
    explicitly EXCLUDING the first 100 files in sorted order — the user
    flagged that the first ~100 images in this corpus are disproportionately
    lower quality (different capture session/equipment), which could have
    quietly biased any sampling that wasn't deliberately randomized past
    that region.

For every image, grades ONCE at calibration_offset=0 (raw) and reports what
grade would result under two offsets: 0 (raw) and +90 (the interpolated
candidate from the two-point offset test in the prior eval round) — both
computed from the same single API call, no extra spend.

Produces a self-contained HTML gallery (embedded base64 images) so results
can be eyeballed directly, not just read as aggregate metrics.

Usage:
  python grader/preview_new_grader.py --sa grader/secrets/firebase-service-account.json --budget-usd 5
"""
import argparse
import base64
import html
import io
import json
import os
import random
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

CANDIDATE_OFFSET = 90.0

GRADE_LABELS = {
    'PR_HI': 'High Prime', 'PR_AVG': 'Avg Prime', 'PR_LO': 'Low Prime',
    'CH_HI': 'High Choice', 'CH_AVG': 'Avg Choice', 'CH_LO': 'Low Choice',
    'SE_HI': 'High Select', 'SE_LO': 'Low Select', 'STD': 'Standard',
}
GRADE_COLOR = {
    'PR_HI': '#a78bfa', 'PR_AVG': '#a78bfa', 'PR_LO': '#a78bfa',
    'CH_HI': '#4ade80', 'CH_AVG': '#4ade80', 'CH_LO': '#4ade80',
    'SE_HI': '#fbbf24', 'SE_LO': '#fbbf24', 'STD': '#9ca3af',
}


def img_to_b64_thumb(path_or_bytes, size=380):
    from PIL import Image
    if isinstance(path_or_bytes, (str, Path)):
        img = Image.open(path_or_bytes).convert('RGB')
    else:
        img = Image.open(io.BytesIO(path_or_bytes)).convert('RGB')
    img.thumbnail((size, size))
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=80)
    return base64.b64encode(buf.getvalue()).decode()


def grade_one(analyze_marbling, score_to_grade_key, path_or_url, from_url=False):
    res = analyze_marbling(path_or_url, from_url=from_url, k=1, calibration_offset=0.0)
    if res['needs_review'] or res['score'] is None:
        return res, None
    raw_score = res['score']
    res['grade_at_offset_90'] = score_to_grade_key(raw_score + CANDIDATE_OFFSET)
    return res, raw_score


def build_card(label_tag, name, b64, res, extra_meta=None):
    if res['needs_review']:
        grade_html = '<span style="color:#f87171">NEEDS REVIEW</span>'
        meta = f"k_valid={res['k_valid']} k_good={res['k_good']}"
    else:
        g0 = res['grade_key']
        g90 = res.get('grade_at_offset_90', '?')
        c0 = GRADE_COLOR.get(g0, '#fff')
        c90 = GRADE_COLOR.get(g90, '#fff')
        grade_html = (
            f'raw(+0): <span style="color:{c0};font-weight:bold">{html.escape(g0)}</span>'
            f'&nbsp;&nbsp;cand(+90): <span style="color:{c90};font-weight:bold">{html.escape(g90)}</span>'
        )
        sample = res['samples'][0]['raw'] if res['samples'] else {}
        meta = (
            f"score={res['score']:.0f} desc={sample.get('descriptor','?')} "
            f"subunit={sample.get('subunit','?')} fine={sample.get('fineness','?')} "
            f"quality={sample.get('image_quality','?')}"
        )
    extra = f'<div class="extra">{html.escape(extra_meta)}</div>' if extra_meta else ''
    return f'''
<div class="card">
  <div class="tag">{html.escape(label_tag)}</div>
  <img src="data:image/jpeg;base64,{b64}" alt="{html.escape(name)}">
  <div class="grade">{grade_html}</div>
  <div class="meta">{html.escape(meta)}</div>
  {extra}
  <div class="name">{html.escape(name)}</div>
</div>'''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sa', required=True)
    ap.add_argument('--images-dir', default=os.path.join(os.path.dirname(__file__), 'tmp', 'ribeyes', 'Ribeyes'))
    ap.add_argument('--exclude-first', type=int, default=100, help='Exclude the first N images (sorted order) from random sampling — flagged as lower quality')
    ap.add_argument('--n-random', type=int, default=25)
    ap.add_argument('--budget-usd', type=float, default=5.0)
    ap.add_argument('--out-html', default=os.path.join(os.path.dirname(__file__), 'output', 'preview_new_grader.html'))
    ap.add_argument('--out-json', default=os.path.join(os.path.dirname(__file__), 'output', 'preview_new_grader.json'))
    ap.add_argument('--seed', type=int, default=None, help='Optional random seed for reproducibility')
    args = ap.parse_args()

    from model_utils import analyze_marbling, score_to_grade_key, set_budget, get_spent, BudgetExceeded
    import firebase_admin
    from firebase_admin import credentials, firestore
    from eval_harness import load_tier1

    if args.seed is not None:
        random.seed(args.seed)

    set_budget(args.budget_usd)

    cred = credentials.Certificate(args.sa)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    print('=== Loading Tier 1 (20 consensus-voted images) ===')
    tier1 = load_tier1(db)
    print(f'{len(tier1)} loaded.')

    print(f'\n=== Sampling {args.n_random} random images, excluding the first {args.exclude_first} (sorted order) ===')
    all_files = sorted(f for f in os.listdir(args.images_dir) if f.lower().endswith('.jpg'))
    eligible = all_files[args.exclude_first:]
    sample_files = random.sample(eligible, min(args.n_random, len(eligible)))
    print(f'{len(all_files)} total images, {len(eligible)} eligible after exclusion, {len(sample_files)} sampled.')
    print('Sampled files:', sample_files)

    results = {'tier1': [], 'tier3_random': [], 'budget_cap_usd': args.budget_usd}
    cards_html = []

    print('\n=== Grading Tier 1 ===')
    cards_html.append('<h2>Tier 1 — previously voted / consensus set (20)</h2>'
                       '<p class="note">Caveat: these images are whatever the OLD grader happened to output and get voted on — '
                       'they skew toward the old grader\'s narrow CH_LO/SE_HI/SE_LO range and do NOT necessarily span '
                       'the full quality-grade spectrum.</p><div class="grid">')
    for t in tier1:
        try:
            res, raw_score = grade_one(analyze_marbling, score_to_grade_key, t['imageUrl'], from_url=True)
        except BudgetExceeded as e:
            print(f'BUDGET CAP HIT: {e}')
            break
        tag = res['grade_key'] if not res['needs_review'] else 'REVIEW'
        print(f"  {t['imageId']:24s} consensus={t['consensus_grade']:6s} old={t['old_ai_grade']:6s} new_raw={tag}")
        extra = f"consensus={t['consensus_grade']} (n={t['n_votes']})  old_ai={t['old_ai_grade']}"
        try:
            import requests
            img_bytes = requests.get(t['imageUrl'], timeout=20).content
            b64 = img_to_b64_thumb(img_bytes)
        except Exception:
            b64 = ''
        cards_html.append(build_card('TIER 1', t['imageId'], b64, res, extra))
        results['tier1'].append({
            'imageId': t['imageId'], 'consensus_grade': t['consensus_grade'], 'n_votes': t['n_votes'],
            'old_ai_grade': t['old_ai_grade'], 'result': {k: v for k, v in res.items() if k != 'samples'},
        })
    cards_html.append('</div>')

    print('\n=== Grading Tier 3 (random, excluding first 100) ===')
    cards_html.append(f'<h2>Tier 3 — random sample, first {args.exclude_first} excluded ({len(sample_files)})</h2>'
                       '<p class="note">No human label — for visual sanity-checking of grade plausibility and image-quality distribution only.</p>'
                       '<div class="grid">')
    for fname in sample_files:
        path = os.path.join(args.images_dir, fname)
        try:
            res, raw_score = grade_one(analyze_marbling, score_to_grade_key, path, from_url=False)
        except BudgetExceeded as e:
            print(f'BUDGET CAP HIT: {e}')
            break
        tag = res['grade_key'] if not res['needs_review'] else 'REVIEW'
        print(f'  {fname:30s} new_raw={tag}')
        b64 = img_to_b64_thumb(path)
        cards_html.append(build_card('RANDOM', fname, b64, res))
        results['tier3_random'].append({
            'filename': fname, 'result': {k: v for k, v in res.items() if k != 'samples'},
        })

    cards_html.append('</div>')

    results['estimated_spend_usd'] = round(get_spent(), 4)

    html_doc = f'''<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>New Grader — Visual Sanity Check</title>
<style>
body {{ font-family: -apple-system, Segoe UI, sans-serif; background: #111; color: #eee; margin: 0; padding: 24px; }}
h1 {{ color: #fff; border-bottom: 2px solid #444; padding-bottom: 10px; }}
h2 {{ color: #fff; margin-top: 36px; }}
.note {{ color: #aaa; font-size: 0.85em; max-width: 70ch; }}
.grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; margin-top: 12px; }}
.card {{ background: #1e1e1e; border: 2px solid #333; padding: 10px; font-family: ui-monospace, monospace; font-size: 0.82em; }}
.card img {{ width: 100%; display: block; border: 1px solid #444; margin-bottom: 6px; }}
.tag {{ display:inline-block; font-size: 0.7em; letter-spacing:.06em; color:#666; border:1px solid #444; padding:1px 6px; margin-bottom:4px; }}
.grade {{ font-size: 1.0em; margin: 6px 0 2px; }}
.meta {{ font-size: 0.85em; color: #999; }}
.extra {{ font-size: 0.85em; color: #7dd3fc; margin-top: 2px; }}
.name {{ font-size: 0.72em; color: #666; word-break: break-all; margin-top: 4px; }}
</style></head><body>
<h1>New Grader — Visual Sanity Check</h1>
<p class="note">Estimated spend: ${results['estimated_spend_usd']:.2f} of ${args.budget_usd:.2f} cap.
Each image graded once (k=1, raw). "cand(+90)" shows the grade under the untested candidate calibration offset
from the prior two-point interpolation — same API call, computed in code, no extra spend.</p>
{''.join(cards_html)}
</body></html>'''

    Path(args.out_html).write_text(html_doc, encoding='utf-8')
    with open(args.out_json, 'w') as f:
        json.dump(results, f, indent=2, default=str)

    print(f'\nWrote {args.out_html}')
    print(f'Wrote {args.out_json}')
    print(f'Estimated spend: ${results["estimated_spend_usd"]:.2f} of ${args.budget_usd:.2f} cap')


if __name__ == '__main__':
    main()
