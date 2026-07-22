"""
build_trainer.py — generates an interactive, self-contained HTML "trainer" page
for actively correcting the grader's calls (see grader/AUDIT_AND_REDESIGN.md,
Addendum 3 for full rationale).

Adapts blind_grade.py's proven UI pattern (fully client-side: images embedded
as base64, all state in JS, zero backend — so the output is a plain HTML file
you can open directly, or that gets published as a shareable Artifact link).

What's different from blind_grade.py:
  - The AI's raw grade is shown (not hidden) and pre-highlighted on the grade
    grid, so correcting it is a single click to a different button — "higher
    or lower" — rather than picking blind from scratch.
  - Image selection is a MIXED strategy: ~80% of the batch is drawn from
    images where the AI's grade and the free cv_marbling.py HSV heuristic
    disagree most (highest information value per correction you make),
    ~20% random for coverage/sanity, excluding the first 100 dataset files
    (identified this session as disproportionately lower quality).
  - A persistent "Export corrections" button (usable any time, not just at
    the end) downloads a JSON file of every correction made so far via a
    client-side Blob — no server needed. Feed that file to recalibrate.py.
  - Previously-used images are tracked in grader/trainer_seen.json so
    re-running this script always surfaces fresh, unseen images.

Usage:
  python grader/build_trainer.py --n 50
"""
import argparse
import base64
import csv
import html
import io
import json
import os
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

GRADE_KEYS = ['PR_HI', 'PR_AVG', 'PR_LO', 'CH_HI', 'CH_AVG', 'CH_LO', 'SE_HI', 'SE_LO', 'STD']
GRADE_LABELS = {
    'PR_HI': 'High Prime', 'PR_AVG': 'Avg Prime', 'PR_LO': 'Low Prime',
    'CH_HI': 'High Choice', 'CH_AVG': 'Avg Choice', 'CH_LO': 'Low Choice',
    'SE_HI': 'High Select', 'SE_LO': 'Low Select', 'STD': 'Standard',
}
# Ascending quality rung — STD=0 (worst) ... PR_HI=8 (best). NOTE: this is deliberately
# NOT derived from GRADE_KEYS (which lists PR_HI-first for the button grid's visual
# layout) — an earlier version used enumerate(GRADE_KEYS) here, which silently produced
# the opposite ordering (PR_HI=0...STD=8) and corrupted both the delta_rungs sign shown
# to the user and the AI-vs-CV disagreement ranking used to pick which images to show.
GRADE_RUNG = {'STD': 0, 'SE_LO': 1, 'SE_HI': 2, 'CH_LO': 3, 'CH_AVG': 4,
              'CH_HI': 5, 'PR_LO': 6, 'PR_AVG': 7, 'PR_HI': 8}
GRADE_COLOR = {
    'PR_HI': '#7c3aed', 'PR_AVG': '#7c3aed', 'PR_LO': '#7c3aed',
    'CH_HI': '#16a34a', 'CH_AVG': '#16a34a', 'CH_LO': '#16a34a',
    'SE_HI': '#d97706', 'SE_LO': '#d97706', 'STD': '#6b7280',
}

_SEEN_FILE = os.path.join(os.path.dirname(__file__), 'trainer_seen.json')


def _load_seen():
    if os.path.isfile(_SEEN_FILE):
        with open(_SEEN_FILE, 'r', encoding='utf-8') as f:
            return set(json.load(f))
    return set()


def _save_seen(seen):
    with open(_SEEN_FILE, 'w', encoding='utf-8') as f:
        json.dump(sorted(seen), f, indent=2)


def _load_fat_ratios(csv_path):
    rows = []
    with open(csv_path, newline='') as f:
        for r in csv.DictReader(f):
            if r['ok'] == 'True' and r['fat_ratio']:
                rows.append((r['filename'], float(r['fat_ratio'])))
    return rows


def _percentile_lookup(rows):
    """filename -> percentile (0-1) of its fat_ratio within the full dataset."""
    sorted_ratios = sorted(r for _, r in rows)
    n = len(sorted_ratios)
    out = {}
    for fname, ratio in rows:
        import bisect
        idx = bisect.bisect_left(sorted_ratios, ratio)
        out[fname] = idx / max(1, n - 1)
    return out


def img_to_b64(path, size=460):
    from PIL import Image
    img = Image.open(path).convert('RGB')
    img.thumbnail((size, size))
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=82)
    return base64.b64encode(buf.getvalue()).decode()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--n', type=int, default=50, help='Final batch size shown in the trainer')
    ap.add_argument('--pool-multiplier', type=float, default=2.5,
                    help='Pre-grade n*multiplier candidates to select the most-disagreeing subset from')
    ap.add_argument('--frac-disagreement', type=float, default=0.8,
                    help='Fraction of the final batch drawn from highest AI-vs-CV disagreement (rest random)')
    ap.add_argument('--images-dir', default=os.path.join(os.path.dirname(__file__), 'tmp', 'ribeyes', 'Ribeyes'))
    ap.add_argument('--cv-csv', default=os.path.join(os.path.dirname(__file__), 'output', 'cv_fat_ratios.csv'))
    ap.add_argument('--exclude-first', type=int, default=100)
    ap.add_argument('--budget-usd', type=float, default=3.0)
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), 'output', 'trainer.html'))
    args = ap.parse_args()

    from model_utils import analyze_marbling, set_budget, get_spent, BudgetExceeded, get_calibration_offset

    set_budget(args.budget_usd)
    offset = get_calibration_offset()
    print(f'Using calibration_offset={offset} (from grader/calibration.json, or 0.0 if not yet created)')

    # --- Build candidate pool: unseen, excluding first N files ---
    seen = _load_seen()
    all_files = sorted(f for f in os.listdir(args.images_dir) if f.lower().endswith('.jpg'))
    eligible = [f for f in all_files[args.exclude_first:] if f not in seen]
    print(f'{len(all_files)} total images, {len(eligible)} eligible (unseen, first {args.exclude_first} excluded).')

    pool_size = min(len(eligible), int(args.n * args.pool_multiplier))
    candidates = random.sample(eligible, pool_size)
    print(f'Grading a candidate pool of {pool_size} images to select the {args.n} most informative...')

    fat_ratio_rows = _load_fat_ratios(args.cv_csv)
    percentile = _percentile_lookup(fat_ratio_rows)
    fat_ratio_by_file = dict(fat_ratio_rows)

    graded = []
    for i, fname in enumerate(candidates):
        path = os.path.join(args.images_dir, fname)
        try:
            res = analyze_marbling(path, k=1)
        except BudgetExceeded as e:
            print(f'BUDGET CAP HIT at {i}/{len(candidates)}: {e}')
            break
        if res['needs_review'] or res['grade_key'] not in GRADE_RUNG:
            continue
        ai_rung = GRADE_RUNG[res['grade_key']]
        ai_percentile = ai_rung / (len(GRADE_KEYS) - 1)
        cv_pct = percentile.get(fname)
        disagreement = abs(cv_pct - ai_percentile) if cv_pct is not None else -1
        graded.append({
            'file': fname, 'path': path, 'result': res,
            'fat_ratio': fat_ratio_by_file.get(fname), 'disagreement': disagreement,
        })
        if (i + 1) % 20 == 0:
            print(f'  {i+1}/{len(candidates)} graded, spend so far ${get_spent():.2f}')

    print(f'Graded {len(graded)} candidates, ${get_spent():.2f} spent.')

    # --- Select final batch: mixed disagreement + random ---
    n_disagree = int(round(args.n * args.frac_disagreement))
    n_random = args.n - n_disagree
    by_disagreement = sorted([g for g in graded if g['disagreement'] >= 0], key=lambda g: -g['disagreement'])
    picked = by_disagreement[:n_disagree]
    remaining_pool = [g for g in graded if g not in picked]
    picked += random.sample(remaining_pool, min(n_random, len(remaining_pool)))
    random.shuffle(picked)
    print(f'Final batch: {len(picked)} images ({min(n_disagree, len(by_disagreement))} disagreement-prioritized, '
          f'{len(picked) - min(n_disagree, len(by_disagreement))} random).')

    if not picked:
        sys.exit('No images selected — nothing to build. Try a larger --pool-multiplier or check budget.')

    # --- Mark these as seen for future batches ---
    seen.update(g['file'] for g in picked)
    _save_seen(seen)

    # --- Build cards ---
    cards = []
    for g in picked:
        res = g['result']
        sample = res['samples'][0]['raw'] if res['samples'] else {}
        cards.append({
            'file': g['file'],
            'b64': img_to_b64(g['path']),
            'aiGrade': res['grade_key'],
            'aiScore': round(res['score']),
            'aiDescriptor': sample.get('descriptor', '?'),
            'aiSubunit': sample.get('subunit', '?'),
            'aiConfidence': res['confidence'],
            'fatRatio': round(g['fat_ratio'], 3) if g['fat_ratio'] is not None else None,
        })

    cards_js = json.dumps(cards)
    grade_keys_js = json.dumps(GRADE_KEYS)
    grade_labels_js = json.dumps(GRADE_LABELS)
    grade_colors_js = json.dumps(GRADE_COLOR)
    grade_rung_js = json.dumps(GRADE_RUNG)

    html_doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Grader Trainer — Active Correction</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:#0f0f0f;color:#eee;font-family:'Courier New',monospace;min-height:100vh}}
#screen-grade{{display:flex;flex-direction:column;align-items:center;padding:20px;gap:14px}}
#screen-results{{display:none;padding:20px;max-width:1100px;margin:0 auto}}
.topbar{{display:flex;justify-content:space-between;align-items:center;width:100%;max-width:560px}}
.progress{{font-size:.85em;color:#666;letter-spacing:.1em}}
.export-btn{{padding:6px 14px;border:2px solid #0ea5e9;background:transparent;color:#0ea5e9;
  font-family:'Courier New',monospace;font-size:.75em;cursor:pointer;letter-spacing:.05em}}
.export-btn:hover{{background:#0ea5e9;color:#000}}
.img-wrap{{border:3px solid #333;background:#1a1a1a;display:flex;align-items:center;justify-content:center;width:100%;max-width:560px}}
.img-wrap img{{width:100%;display:block}}
.ai-info{{width:100%;max-width:560px;background:#1a1a1a;border:2px solid #333;padding:10px 14px;font-size:.8em;color:#aaa}}
.ai-info b{{color:#fff}}
.filename{{font-size:.7em;color:#555;letter-spacing:.05em}}
.grade-grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;width:100%;max-width:560px}}
.grade-btn{{padding:14px 8px;border:2px solid #444;background:#1a1a1a;color:#ccc;
  font-family:'Courier New',monospace;font-size:.95em;font-weight:bold;cursor:pointer;
  transition:background 150ms,border-color 150ms,transform 100ms;letter-spacing:.05em}}
.grade-btn:hover{{background:#2a2a2a;border-color:#888;transform:translateY(-1px)}}
.grade-btn.ai-said{{border-style:dashed}}
.grade-btn.selected{{border-color:#fff;color:#fff;background:#2a2a2a;border-style:solid}}
.nav{{display:flex;gap:12px}}
.nav-btn{{padding:10px 24px;border:2px solid #555;background:transparent;color:#ccc;
  font-family:'Courier New',monospace;font-size:.9em;cursor:pointer}}
.nav-btn:hover{{border-color:#fff;color:#fff}}
.nav-btn.primary{{border-color:#cc0000;color:#cc0000}}
.nav-btn.primary:hover{{background:#cc0000;color:#fff}}
h1{{font-size:1.4em;border-bottom:2px solid #333;padding-bottom:12px;margin-bottom:20px}}
.summary{{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px}}
.stat{{background:#1a1a1a;border:2px solid #333;padding:16px;text-align:center}}
.stat-val{{font-size:2em;font-weight:bold;color:#fff}}
.stat-lbl{{font-size:.75em;color:#666;margin-top:4px;letter-spacing:.08em}}
.export-panel{{display:none;width:100%;max-width:560px;background:#1a1a1a;border:2px solid #0ea5e9;padding:10px 14px}}
.export-panel.show{{display:block}}
.export-status{{font-size:.72em;color:#0ea5e9;margin-bottom:6px;line-height:1.4}}
.export-textarea{{width:100%;height:110px;background:#000;color:#0f0;border:1px solid #333;
  font-family:'Courier New',monospace;font-size:.65em;padding:6px;resize:vertical;box-sizing:border-box}}
</style>
</head>
<body>

<div id="screen-grade">
  <div class="topbar">
    <div class="progress" id="progress">Image 1 of {len(cards)}</div>
    <button class="export-btn" onclick="exportCorrections()">⬇ Export corrections</button>
  </div>
  <div class="export-panel" id="export-panel-grade">
    <div class="export-status" id="export-status-grade"></div>
    <textarea class="export-textarea" id="export-textarea-grade" readonly onclick="this.select()"></textarea>
  </div>
  <div class="img-wrap"><img id="main-img" src="" alt="ribeye"></div>
  <div class="ai-info" id="ai-info"></div>
  <div class="filename" id="filename"></div>
  <div class="grade-grid" id="grade-grid"></div>
  <div class="nav">
    <button class="nav-btn" id="btn-prev" onclick="nav(-1)">&#8592; Back</button>
    <button class="nav-btn primary" id="btn-next" onclick="nav(1)">Next &#8594;</button>
  </div>
</div>

<div id="screen-results">
  <h1>Correction Session Results</h1>
  <div class="summary">
    <div class="stat"><div class="stat-val" id="s-agree">—</div><div class="stat-lbl">AGREED W/ AI</div></div>
    <div class="stat"><div class="stat-val" id="s-corrected">—</div><div class="stat-lbl">CORRECTED</div></div>
    <div class="stat"><div class="stat-val" id="s-avgdelta">—</div><div class="stat-lbl">AVG CORRECTION (RUNGS)</div></div>
  </div>
  <p style="color:#999;margin-bottom:16px">Click "Export corrections" to copy your corrections as JSON (to clipboard, or selected text below if clipboard access is blocked). Paste into a text file, save as .json, and feed it to <code>python grader/recalibrate.py &lt;file&gt;</code>.</p>
  <button class="export-btn" onclick="exportCorrections()">⬇ Export corrections</button>
  <div class="export-panel" id="export-panel-results" style="margin-top:12px">
    <div class="export-status" id="export-status-results"></div>
    <textarea class="export-textarea" id="export-textarea-results" readonly onclick="this.select()"></textarea>
  </div>
</div>

<script>
const CARDS = {cards_js};
const GRADE_KEYS = {grade_keys_js};
const GRADE_LABELS = {grade_labels_js};
const GRADE_COLORS = {grade_colors_js};
const GRADE_RUNG = {grade_rung_js};  // ascending: STD=0 ... PR_HI=8

let current = 0;
const userGrades = {{}};

function buildGradeGrid() {{
  const grid = document.getElementById('grade-grid');
  grid.innerHTML = '';
  GRADE_KEYS.forEach(k => {{
    const btn = document.createElement('button');
    btn.className = 'grade-btn';
    btn.dataset.grade = k;
    btn.style.borderColor = GRADE_COLORS[k] + '88';
    btn.innerHTML = `<span style="color:${{GRADE_COLORS[k]}}">${{k}}</span><br><span style="font-size:.75em;font-weight:normal">${{GRADE_LABELS[k]}}</span>`;
    btn.addEventListener('click', () => selectGrade(k));
    grid.appendChild(btn);
  }});
}}

function selectGrade(k) {{
  userGrades[current] = k;
  renderGridState();
  document.getElementById('btn-next').textContent = current === CARDS.length - 1 ? 'See Results →' : 'Next →';
}}

function renderGridState() {{
  const card = CARDS[current];
  const saved = userGrades[current];
  document.querySelectorAll('.grade-btn').forEach(b => {{
    b.classList.toggle('ai-said', b.dataset.grade === card.aiGrade && b.dataset.grade !== saved);
    b.classList.toggle('selected', b.dataset.grade === saved);
  }});
}}

function render() {{
  const card = CARDS[current];
  document.getElementById('progress').textContent = `Image ${{current+1}} of ${{CARDS.length}}`;
  document.getElementById('main-img').src = `data:image/jpeg;base64,${{card.b64}}`;
  document.getElementById('filename').textContent = card.file;
  document.getElementById('ai-info').innerHTML =
    `AI says: <b style="color:${{GRADE_COLORS[card.aiGrade]}}">${{card.aiGrade}}</b> (${{GRADE_LABELS[card.aiGrade]}}) ` +
    `&nbsp;|&nbsp; score ${{card.aiScore}} &nbsp;|&nbsp; ${{card.aiDescriptor}} subunit ${{card.aiSubunit}} ` +
    `&nbsp;|&nbsp; confidence ${{card.aiConfidence}}` +
    (card.fatRatio !== null ? ` &nbsp;|&nbsp; free CV fat-ratio ${{card.fatRatio}}` : '') +
    `<br><span style="color:#666">Dashed border = what the AI said. Click a different grade to correct it higher or lower — click the dashed one to confirm it's right.</span>`;
  document.getElementById('btn-prev').style.opacity = current === 0 ? '0.3' : '1';
  renderGridState();
  document.getElementById('btn-next').textContent = current === CARDS.length - 1 ? 'See Results →' : 'Next →';
}}

function nav(dir) {{
  if (dir === 1 && current === CARDS.length - 1) {{ showResults(); return; }}
  current = Math.max(0, Math.min(CARDS.length - 1, current + dir));
  render();
}}

function showResults() {{
  document.getElementById('screen-grade').style.display = 'none';
  document.getElementById('screen-results').style.display = 'block';

  let agree = 0, corrected = 0, deltaSum = 0, deltaN = 0;
  CARDS.forEach((card, i) => {{
    const userGrade = userGrades[i];
    if (!userGrade) return;
    if (userGrade === card.aiGrade) {{ agree++; }}
    else {{
      corrected++;
      deltaSum += GRADE_RUNG[userGrade] - GRADE_RUNG[card.aiGrade];
      deltaN++;
    }}
  }});
  document.getElementById('s-agree').textContent = agree + ' / ' + CARDS.length;
  document.getElementById('s-corrected').textContent = corrected + ' / ' + CARDS.length;
  document.getElementById('s-avgdelta').textContent = deltaN ? (deltaSum/deltaN).toFixed(2) : '—';
}}

function exportCorrections() {{
  const out = [];
  CARDS.forEach((card, i) => {{
    const userGrade = userGrades[i];
    if (!userGrade) return;
    out.push({{
      file: card.file,
      ai_grade: card.aiGrade,
      ai_score: card.aiScore,
      ai_descriptor: card.aiDescriptor,
      ai_subunit: card.aiSubunit,
      user_grade: userGrade,
      delta_rungs: GRADE_RUNG[userGrade] - GRADE_RUNG[card.aiGrade],
      timestamp: new Date().toISOString(),
    }});
  }});
  if (!out.length) {{ alert('No corrections made yet — grade at least one image first.'); return; }}
  const json = JSON.stringify(out, null, 2);

  // NOTE: deliberately not using the blob-URL + hidden-<a download> + click() trick —
  // Artifacts render inside a sandboxed iframe that intercepts <a href> clicks to route
  // navigation through the parent frame, which silently swallows that download pattern.
  // Clipboard API (no anchor involved) with a visible, auto-selected textarea fallback
  // (no anchor, no special permissions) works regardless of sandbox restrictions.
  const panels = document.querySelectorAll('.export-panel');
  const statuses = document.querySelectorAll('.export-status');
  const textareas = document.querySelectorAll('.export-textarea');
  panels.forEach(p => p.classList.add('show'));
  textareas.forEach(t => {{ t.value = json; }});

  const showFallback = () => {{
    textareas.forEach(t => t.select());
    statuses.forEach(s => s.textContent =
      `Clipboard blocked — text below is selected: press Ctrl+C / Cmd+C to copy (${{out.length}} corrections), then paste into a text file and save as .json`);
  }};

  if (navigator.clipboard && navigator.clipboard.writeText) {{
    navigator.clipboard.writeText(json).then(() => {{
      statuses.forEach(s => s.textContent =
        `✓ Copied ${{out.length}} corrections to clipboard — paste into a text file and save as .json`);
    }}).catch(showFallback);
  }} else {{
    showFallback();
  }}
}}

buildGradeGrid();
render();
</script>
</body>
</html>"""

    with open(args.out, 'w', encoding='utf-8') as f:
        f.write(html_doc)

    print(f'\nWrote {args.out}')
    print(f'Total spend: ${get_spent():.2f} of ${args.budget_usd:.2f} cap')
    print(f'{len(seen)} images now marked seen (won\'t repeat in future batches).')


if __name__ == '__main__':
    main()
