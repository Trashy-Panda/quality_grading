"""
preview.py — Grade a small batch and open an HTML viewer showing each image + grade.
Usage: python grader/preview.py --anthropic-key "YOUR_KEY" --limit 20
"""
import argparse, os, sys, base64, io, html
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--anthropic-key', default=None)
    parser.add_argument('--limit', type=int, default=10)
    args = parser.parse_args()

    sys.path.insert(0, str(Path(__file__).parent))
    from model_utils import analyze_marbling, load_reference_images, set_api_key
    if args.anthropic_key:
        set_api_key(args.anthropic_key)

    # Find images
    img_dir = Path(__file__).parent / 'tmp' / 'ribeyes'
    exts = {'.jpg', '.jpeg', '.png'}
    images = sorted([p for p in img_dir.rglob('*') if p.suffix.lower() in exts])[:args.limit]

    if not images:
        sys.exit(f'No images found in {img_dir}')

    # Load reference images from Firestore
    reference_images = {}
    sa = Path(__file__).parent / 'firebase-service-account.json'
    if sa.exists():
        try:
            import firebase_admin
            from firebase_admin import credentials, firestore
            if not firebase_admin._apps:
                firebase_admin.initialize_app(credentials.Certificate(str(sa)))
            db = firestore.client()
            print('Loading reference images from community_carcasses...')
            reference_images = load_reference_images(db)
            if reference_images:
                print(f'Loaded {len(reference_images)} reference grades: {", ".join(sorted(reference_images.keys()))}')
            else:
                print('No reference images found — grading without examples.')
        except Exception as e:
            print(f'Could not load references: {e}')
    else:
        print('No firebase-service-account.json found — grading without reference images.')

    print(f'Grading {len(images)} images...')

    GRADE_LABELS = {
        'PR_HI':'High Prime','PR_AVG':'Avg Prime','PR_LO':'Low Prime',
        'CH_HI':'High Choice','CH_AVG':'Avg Choice','CH_LO':'Low Choice',
        'SE_HI':'High Select','SE_AVG':'Avg Select','SE_LO':'Low Select',
        'STD':'Standard',
    }
    GRADE_COLOR = {
        'PR_HI':'#7c3aed','PR_AVG':'#7c3aed','PR_LO':'#7c3aed',
        'CH_HI':'#16a34a','CH_AVG':'#16a34a','CH_LO':'#16a34a',
        'SE_HI':'#d97706','SE_AVG':'#d97706','SE_LO':'#d97706',
        'STD':'#6b7280',
    }

    cards = []
    for i, path in enumerate(images):
        print(f'  [{i+1}/{len(images)}] {path.name}', end=' ... ', flush=True)
        try:
            grade_key, conf, score = analyze_marbling(str(path), reference_images)
            label = GRADE_LABELS.get(grade_key, grade_key)
            color = GRADE_COLOR.get(grade_key, '#000')
            from PIL import Image as PILImage
            img = PILImage.open(path).convert('RGB')
            img.thumbnail((400, 400))
            buf = io.BytesIO()
            img.save(buf, format='JPEG', quality=80)
            b64 = base64.b64encode(buf.getvalue()).decode()
            cards.append((path.name, b64, grade_key, label, color, conf, score))
            print(f'{grade_key} ({label}) conf={conf:.0%}')
        except Exception as e:
            print(f'ERROR: {e}')

    # Build HTML
    html_parts = ['''<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Ribeye Grade Preview</title>
<style>
body { font-family: monospace; background: #111; color: #eee; margin: 0; padding: 20px; }
h1 { color: #fff; border-bottom: 2px solid #444; padding-bottom: 10px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
.card { background: #1e1e1e; border: 2px solid #333; padding: 10px; }
.card img { width: 100%; display: block; border: 1px solid #444; }
.grade { font-size: 1.2em; font-weight: bold; margin: 8px 0 2px; }
.meta { font-size: 0.8em; color: #999; }
.name { font-size: 0.7em; color: #666; word-break: break-all; margin-top: 4px; }
</style></head><body>
<h1>Ribeye Grade Preview</h1>
<div class="grid">''']

    for name, b64, grade_key, label, color, conf, score in cards:
        html_parts.append(f'''
<div class="card">
  <img src="data:image/jpeg;base64,{b64}" alt="{html.escape(name)}">
  <div class="grade" style="color:{color}">{html.escape(grade_key)} — {html.escape(label)}</div>
  <div class="meta">Score: {score:.0f} &nbsp;|&nbsp; Conf: {conf:.0%}</div>
  <div class="name">{html.escape(name)}</div>
</div>''')

    html_parts.append('</div></body></html>')

    out = Path(__file__).parent / 'preview.html'
    out.write_text(''.join(html_parts), encoding='utf-8')
    print(f'\nDone. Open this file in your browser:')
    print(f'  {out}')

if __name__ == '__main__':
    main()
