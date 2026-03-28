"""
blind_grade.py — Blind grading calibration tool.

Step 1: Computer grades 20 images with Claude Vision (results hidden).
Step 2: Opens a browser page showing each image — you pick the grade.
Step 3: After all 20, shows side-by-side comparison with agreement score.

Usage:
  python grader/blind_grade.py --limit 20
"""
import argparse, base64, io, json, os, sys
from pathlib import Path

GRADE_KEYS = ['PR_HI','PR_AVG','PR_LO','CH_HI','CH_AVG','CH_LO','SE_HI','SE_LO','STD']
GRADE_LABELS = {
    'PR_HI':'High Prime','PR_AVG':'Avg Prime','PR_LO':'Low Prime',
    'CH_HI':'High Choice','CH_AVG':'Avg Choice','CH_LO':'Low Choice',
    'SE_HI':'High Select','SE_LO':'Low Select','STD':'Standard',
}
GRADE_ORDER = {k: i for i, k in enumerate(GRADE_KEYS)}
GRADE_COLOR = {
    'PR_HI':'#7c3aed','PR_AVG':'#7c3aed','PR_LO':'#7c3aed',
    'CH_HI':'#16a34a','CH_AVG':'#16a34a','CH_LO':'#16a34a',
    'SE_HI':'#d97706','SE_LO':'#d97706','STD':'#6b7280',
}

def img_b64(path, size=500):
    from PIL import Image
    img = Image.open(path).convert('RGB')
    img.thumbnail((size, size))
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=82)
    return base64.b64encode(buf.getvalue()).decode()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=20)
    parser.add_argument('--offset', type=int, default=0, help='Skip first N images')
    args = parser.parse_args()

    img_dir = Path(__file__).parent / 'tmp' / 'ribeyes'
    exts = {'.jpg','.jpeg','.png'}
    all_images = sorted([p for p in img_dir.rglob('*') if p.suffix.lower() in exts])
    images = all_images[args.offset : args.offset + args.limit]

    if not images:
        sys.exit(f'No images found in {img_dir}')

    # ── Step 1: Computer grades (hidden from user) ──────────────────
    sys.path.insert(0, str(Path(__file__).parent))
    from model_utils import analyze_marbling, load_reference_images

    # Load references
    reference_images = {}
    sa = Path(__file__).parent / 'firebase-service-account.json'
    if sa.exists():
        try:
            import firebase_admin
            from firebase_admin import credentials, firestore
            if not firebase_admin._apps:
                firebase_admin.initialize_app(credentials.Certificate(str(sa)))
            db = firestore.client()
            print('Loading reference images...')
            reference_images = load_reference_images(db)
            if reference_images:
                print(f'  Loaded {len(reference_images)} reference grades.')
        except Exception as e:
            print(f'  No references: {e}')

    print(f'\nComputer grading {len(images)} images (this takes ~{len(images)*5}s)...')
    computer_grades = []
    for i, path in enumerate(images):
        print(f'  [{i+1}/{len(images)}] {path.name}', end=' ... ', flush=True)
        try:
            grade_key, conf, score = analyze_marbling(str(path), reference_images)
            computer_grades.append({'file': path.name, 'grade': grade_key,
                                    'conf': round(conf, 2), 'score': round(score)})
            print(f'{grade_key} ({GRADE_LABELS[grade_key]}) conf={conf:.0%}')
        except Exception as e:
            computer_grades.append({'file': path.name, 'grade': 'SE_HI', 'conf': 0.5, 'score': 350})
            print(f'ERROR: {e}')

    # ── Step 2: Build blind grading HTML ────────────────────────────
    print('\nBuilding blind grading page...')
    cards_json = []
    for i, (path, cg) in enumerate(zip(images, computer_grades)):
        cards_json.append({
            'index': i,
            'file': path.name,
            'b64': img_b64(path),
            'computer': cg['grade'],
            'computerLabel': GRADE_LABELS[cg['grade']],
            'computerConf': cg['conf'],
            'computerScore': cg['score'],
        })

    cards_js = json.dumps(cards_json)
    grade_keys_js = json.dumps(GRADE_KEYS)
    grade_labels_js = json.dumps(GRADE_LABELS)
    grade_colors_js = json.dumps(GRADE_COLOR)
    grade_order_js = json.dumps(GRADE_ORDER)

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blind Grading Calibration</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:#0f0f0f;color:#eee;font-family:'Courier New',monospace;min-height:100vh}}
#screen-grade{{display:flex;flex-direction:column;align-items:center;padding:20px;gap:16px}}
#screen-results{{display:none;padding:20px;max-width:1100px;margin:0 auto}}
.progress{{font-size:.85em;color:#666;letter-spacing:.1em}}
.img-wrap{{border:3px solid #333;background:#1a1a1a;display:flex;align-items:center;justify-content:center;width:100%;max-width:560px}}
.img-wrap img{{width:100%;display:block}}
.filename{{font-size:.75em;color:#555;letter-spacing:.05em}}
.grade-grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;width:100%;max-width:560px}}
.grade-btn{{padding:14px 8px;border:2px solid #444;background:#1a1a1a;color:#ccc;
  font-family:'Courier New',monospace;font-size:.95em;font-weight:bold;cursor:pointer;
  transition:background 150ms,border-color 150ms,transform 100ms;letter-spacing:.05em}}
.grade-btn:hover{{background:#2a2a2a;border-color:#888;transform:translateY(-1px)}}
.grade-btn.selected{{border-color:#fff;color:#fff;background:#2a2a2a}}
.nav{{display:flex;gap:12px}}
.nav-btn{{padding:10px 24px;border:2px solid #555;background:transparent;color:#ccc;
  font-family:'Courier New',monospace;font-size:.9em;cursor:pointer}}
.nav-btn:hover{{border-color:#fff;color:#fff}}
.nav-btn.primary{{border-color:#cc0000;color:#cc0000}}
.nav-btn.primary:hover{{background:#cc0000;color:#fff}}
/* Results */
h1{{font-size:1.4em;border-bottom:2px solid #333;padding-bottom:12px;margin-bottom:20px}}
.summary{{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px}}
.stat{{background:#1a1a1a;border:2px solid #333;padding:16px;text-align:center}}
.stat-val{{font-size:2em;font-weight:bold;color:#fff}}
.stat-lbl{{font-size:.75em;color:#666;margin-top:4px;letter-spacing:.08em}}
.results-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}}
.result-card{{background:#1a1a1a;border:2px solid #333;overflow:hidden}}
.result-card.exact{{border-color:#16a34a}}
.result-card.close{{border-color:#d97706}}
.result-card.off{{border-color:#cc0000}}
.result-card img{{width:100%;display:block}}
.result-body{{padding:10px}}
.result-row{{display:flex;justify-content:space-between;align-items:center;margin:4px 0;font-size:.8em}}
.result-label{{color:#666}}
.result-val{{font-weight:bold}}
.badge{{display:inline-block;padding:2px 8px;font-size:.7em;font-weight:bold;letter-spacing:.08em}}
.badge.exact{{background:#16a34a;color:#fff}}
.badge.close{{background:#d97706;color:#fff}}
.badge.off{{background:#cc0000;color:#fff}}
.result-file{{font-size:.65em;color:#555;margin-top:6px;word-break:break-all}}
</style>
</head>
<body>

<!-- GRADING SCREEN -->
<div id="screen-grade">
  <div class="progress" id="progress">Image 1 of {len(images)}</div>
  <div class="img-wrap"><img id="main-img" src="" alt="ribeye"></div>
  <div class="filename" id="filename"></div>
  <div class="grade-grid" id="grade-grid"></div>
  <div class="nav">
    <button class="nav-btn" id="btn-prev" onclick="nav(-1)">&#8592; Back</button>
    <button class="nav-btn primary" id="btn-next" onclick="nav(1)">Next &#8594;</button>
  </div>
</div>

<!-- RESULTS SCREEN -->
<div id="screen-results">
  <h1>Grading Calibration Results</h1>
  <div class="summary">
    <div class="stat"><div class="stat-val" id="s-exact">—</div><div class="stat-lbl">EXACT MATCH</div></div>
    <div class="stat"><div class="stat-val" id="s-close">—</div><div class="stat-lbl">OFF BY ONE</div></div>
    <div class="stat"><div class="stat-val" id="s-off">—</div><div class="stat-lbl">DISAGREEMENT</div></div>
  </div>
  <div class="results-grid" id="results-grid"></div>
</div>

<script>
const CARDS = {cards_js};
const GRADE_KEYS = {grade_keys_js};
const GRADE_LABELS = {grade_labels_js};
const GRADE_COLORS = {grade_colors_js};
const GRADE_ORDER = {grade_order_js};

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
  document.querySelectorAll('.grade-btn').forEach(b => b.classList.toggle('selected', b.dataset.grade === k));
  document.getElementById('btn-next').textContent = current === CARDS.length - 1 ? 'See Results →' : 'Next →';
}}

function render() {{
  const card = CARDS[current];
  document.getElementById('progress').textContent = `Image ${{current+1}} of ${{CARDS.length}}`;
  document.getElementById('main-img').src = `data:image/jpeg;base64,${{card.b64}}`;
  document.getElementById('filename').textContent = card.file;
  document.getElementById('btn-prev').style.opacity = current === 0 ? '0.3' : '1';
  const saved = userGrades[current];
  document.querySelectorAll('.grade-btn').forEach(b => b.classList.toggle('selected', b.dataset.grade === saved));
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

  let exact=0, close=0, off=0;
  const grid = document.getElementById('results-grid');
  grid.innerHTML = '';

  CARDS.forEach((card, i) => {{
    const userGrade = userGrades[i] || '?';
    const compGrade = card.computer;
    const userOrd = GRADE_ORDER[userGrade] ?? 99;
    const compOrd = GRADE_ORDER[compGrade] ?? 99;
    const diff = Math.abs(userOrd - compOrd);
    let match, badgeClass;
    if (diff === 0)      {{ match='EXACT'; badgeClass='exact'; exact++; }}
    else if (diff === 1) {{ match='OFF BY 1'; badgeClass='close'; close++; }}
    else                 {{ match='OFF BY '+diff; badgeClass='off'; off++; }}

    const div = document.createElement('div');
    div.className = `result-card ${{badgeClass}}`;
    div.innerHTML = `
      <img src="data:image/jpeg;base64,${{card.b64}}" alt="">
      <div class="result-body">
        <div class="result-row">
          <span class="result-label">YOU</span>
          <span class="result-val" style="color:${{GRADE_COLORS[userGrade]||'#fff'}}">${{userGrade === '?' ? '—' : userGrade + ' · ' + (GRADE_LABELS[userGrade]||'')}}</span>
        </div>
        <div class="result-row">
          <span class="result-label">AI</span>
          <span class="result-val" style="color:${{GRADE_COLORS[compGrade]}}">${{compGrade}} · ${{card.computerLabel}}</span>
        </div>
        <div class="result-row">
          <span class="result-label">AI SCORE</span>
          <span class="result-val">${{card.computerScore}} (${{Math.round(card.computerConf*100)}}% conf)</span>
        </div>
        <div style="margin-top:8px"><span class="badge ${{badgeClass}}">${{match}}</span></div>
        <div class="result-file">${{card.file}}</div>
      </div>`;
    grid.appendChild(div);
  }});

  const n = CARDS.length;
  document.getElementById('s-exact').textContent = exact + ' / ' + n;
  document.getElementById('s-close').textContent = close + ' / ' + n;
  document.getElementById('s-off').textContent = off + ' / ' + n;
}}

buildGradeGrid();
render();
</script>
</body>
</html>"""

    out = Path(__file__).parent / 'blind_grade.html'
    out.write_text(html, encoding='utf-8')
    print(f'\nDone. Open this file in your browser:')
    print(f'  {out}')
    print(f'\nGrade all {len(images)} images, then click "See Results" for the comparison.')

if __name__ == '__main__':
    main()
