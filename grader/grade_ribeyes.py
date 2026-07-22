"""
grade_ribeyes.py — AI Ribeye Grading Pipeline ("Option A")
===========================================================
Downloads TTU Ribeyes.zip, grades each image with Claude Vision calibrated
against fixed official USDA marbling reference photographs (grader/anchors/),
then uploads BOTH the image AND its predicted grade to Firebase.

See grader/AUDIT_AND_REDESIGN.md for the full design rationale. In short:
  - The model never reports a grade directly — only a marbling descriptor/
    subunit, cross-checked against interpolation between two anchor photos.
    The grade is assigned by score_to_grade_key() in model_utils.py.
  - k self-consistency samples per image; median score used.
  - No few-shot images are read from community_carcasses anymore (that
    pool is AI/consensus-derived and created a circular bias-reinforcement
    loop — see the audit doc, root cause #2).
  - Images that fail to parse or come back with uniformly bad image
    quality are written with correct.qualityGrade omitted and
    needsReview: true — never a fabricated grade.

Every Firestore document contains:
  imageUrl  → Cloudinary public URL (the actual image)
  correct   → { qualityGrade: 'CH_HI' }  (the AI-predicted grade; absent if needsReview)

Usage:
  python grader/grade_ribeyes.py --sa grader/firebase-service-account.json --cloud-name NAME --api-key KEY --api-secret SECRET
  python grader/grade_ribeyes.py --sa grader/firebase-service-account.json --cloud-name NAME --api-key KEY --api-secret SECRET --limit 5
  python grader/grade_ribeyes.py --sa grader/firebase-service-account.json --cloud-name NAME --api-key KEY --api-secret SECRET --zip Ribeyes.zip
"""

import argparse
import os
import sys
import zipfile
import time
import io
import warnings
from collections import Counter

import requests
from tqdm import tqdm
from PIL import Image

warnings.filterwarnings('ignore')

RIBEYES_ZIP_URL = 'https://www.depts.ttu.edu/meatscience/judging/docs/Ribeyes.zip'
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff'}
CLOUDINARY_FOLDER = 'ribeyes'
FIRESTORE_COLLECTION = 'ai_carcasses'
PROMPT_VERSION = 'optionA-v1-2026-07-15'


# ----------------------------------------------------------------
#  Download helpers
# ----------------------------------------------------------------

def download_zip(url, dest_path):
    print(f'Downloading {url}...')
    r = requests.get(url, stream=True, timeout=120, verify=False)
    r.raise_for_status()
    total = int(r.headers.get('content-length', 0))
    with open(dest_path, 'wb') as f, tqdm(
        total=total, unit='B', unit_scale=True, desc='Ribeyes.zip'
    ) as bar:
        for chunk in r.iter_content(chunk_size=65536):
            f.write(chunk)
            bar.update(len(chunk))
    print(f'Saved to {dest_path}')


def extract_zip(zip_path, extract_dir):
    print(f'Extracting {zip_path}...')
    with zipfile.ZipFile(zip_path, 'r') as z:
        z.extractall(extract_dir)
    images = []
    for root, _, files in os.walk(extract_dir):
        for fname in sorted(files):
            if os.path.splitext(fname)[1].lower() in IMAGE_EXTENSIONS:
                images.append(os.path.join(root, fname))
    print(f'Found {len(images)} images.')
    return images


def collect_images(directory):
    images = []
    for root, _, files in os.walk(directory):
        for fname in sorted(files):
            if os.path.splitext(fname)[1].lower() in IMAGE_EXTENSIONS:
                images.append(os.path.join(root, fname))
    return images


# ----------------------------------------------------------------
#  Cloudinary helpers
# ----------------------------------------------------------------

def init_cloudinary(cloud_name, api_key, api_secret):
    import cloudinary
    import cloudinary.uploader
    cloudinary.config(
        cloud_name=cloud_name,
        api_key=api_key,
        api_secret=api_secret,
        secure=True,
    )
    print(f'Cloudinary initialized. Cloud: {cloud_name}')


def upload_image_cloudinary(local_path, public_id):
    """Upload to Cloudinary, return secure public URL."""
    import cloudinary.uploader
    img = Image.open(local_path).convert('RGB')
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=85, optimize=True)
    buf.seek(0)

    result = cloudinary.uploader.upload(
        buf,
        public_id=f'{CLOUDINARY_FOLDER}/{public_id}',
        resource_type='image',
        overwrite=False,
    )
    return result['secure_url']


# ----------------------------------------------------------------
#  Firebase helpers
# ----------------------------------------------------------------

def init_firebase(sa_path):
    import firebase_admin
    from firebase_admin import credentials, firestore
    cred = credentials.Certificate(sa_path)
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print('Firebase (Firestore) initialized.')
    return db


def write_firestore_doc(db, image_name, image_url, result, original_filename, k, calibration_offset):
    from firebase_admin import firestore

    doc = {
        'imageName':   image_name,
        'imageUrl':    image_url,
        'source':      'AI Graded — Claude Vision (calibrated instrument, see AUDIT_AND_REDESIGN.md)',
        'submittedBy': 'ai-pipeline',
        'submittedAt': firestore.SERVER_TIMESTAMP,
        'sourceFile':  original_filename,
        'voteCount':   0,
        'promoted':    False,
        # Provenance — pipeline-only fields, written via admin SDK (bypasses rules).
        'aiModel':          _model_name(),
        'promptVersion':    PROMPT_VERSION,
        'k':                k,
        'calibrationOffset': calibration_offset,
        'needsReview':      result['needs_review'],
    }

    if result['needs_review']:
        # Never fabricate a grade — leave `correct` absent and flag for human review.
        doc['notes'] = (
            f"AI could not confidently grade this image "
            f"(k_valid={result['k_valid']}, k_good={result['k_good']}) — needs manual review."
        )
    else:
        grade_key = result['grade_key']
        grade_label = _grade_label(grade_key)
        doc['correct'] = {'qualityGrade': grade_key}
        doc['aiScore'] = float(result['score'])
        doc['aiConfidence'] = result['confidence']
        doc['scoreSpread'] = float(result['spread'])
        doc['notes'] = (
            f'AI predicted: {grade_label} | '
            f'Marbling score: ~{result["score"]:.0f} | '
            f'Confidence: {result["confidence"]} (spread {result["spread"]:.0f}, '
            f'{result["k_good"]}/{result["k_valid"]} good samples)'
        )

    db.collection(FIRESTORE_COLLECTION).add(doc)


def _model_name():
    from model_utils import MODEL
    return MODEL


def _grade_label(key):
    from model_utils import GRADE_LABELS
    return GRADE_LABELS.get(key, key)


# ----------------------------------------------------------------
#  Main
# ----------------------------------------------------------------

def _load_creds_file(path):
    """Load key=value pairs from a credentials file."""
    creds = {}
    if os.path.isfile(path):
        for line in open(path).read().splitlines():
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                creds[k.strip()] = v.strip()
    return creds


def main():
    parser = argparse.ArgumentParser(description='Grade ribeye images and upload to Cloudinary + Firestore.')
    parser.add_argument('--sa',          required=True,  help='Path to firebase-service-account.json')
    parser.add_argument('--cloud-name',  default=None,   help='Cloudinary cloud name (or set in cloudinary_creds.txt)')
    parser.add_argument('--api-key',     default=None,   help='Cloudinary API key (or set in cloudinary_creds.txt)')
    parser.add_argument('--api-secret',  default=None,   help='Cloudinary API secret (or set in cloudinary_creds.txt)')
    parser.add_argument('--zip',         default=None,   help='Path to Ribeyes.zip (auto-downloads if omitted)')
    parser.add_argument('--images',      default=None,   help='Path to a folder of extracted images (skips ZIP)')
    parser.add_argument('--limit',       type=int, default=0, help='Max images (0 = all)')
    parser.add_argument('--k',           type=int, default=3, help='Self-consistency samples per image (default 3)')
    parser.add_argument('--calibration-offset', type=float, default=None,
                        help='Constant score-space bias correction. Default: read the current fitted value from grader/calibration.json (see recalibrate.py); pass a number to override.')
    parser.add_argument('--dry-run',     action='store_true',
                        help='Grade images but skip all uploads (for testing grades locally)')
    parser.add_argument('--anthropic-key', default=None,
                        help='Anthropic API key (overrides api_key.txt)')
    args = parser.parse_args()

    if args.anthropic_key:
        os.environ['ANTHROPIC_API_KEY'] = args.anthropic_key.strip()

    # Load Cloudinary creds from file if not passed on CLI
    script_dir = os.path.dirname(os.path.abspath(__file__))
    creds_file = os.path.join(script_dir, 'secrets', 'cloudinary_creds.txt')
    file_creds = _load_creds_file(creds_file)
    cloud_name = args.cloud_name or file_creds.get('cloud_name')
    api_key    = args.api_key    or file_creds.get('api_key')
    api_secret = args.api_secret or file_creds.get('api_secret')

    if not args.dry_run and not (cloud_name and api_key and api_secret):
        sys.exit('ERROR: Cloudinary credentials missing.\n'
                 'Edit grader/secrets/cloudinary_creds.txt with your cloud_name, api_key, api_secret.')

    if not args.dry_run and not os.path.isfile(args.sa):
        sys.exit(f'ERROR: Service account not found: {args.sa}\n'
                 f'Download from Firebase Console → Project Settings → Service Accounts')

    # --- Step 1: Get images ---
    script_dir = os.path.dirname(os.path.abspath(__file__))
    tmp_dir = os.path.join(script_dir, 'tmp')
    os.makedirs(tmp_dir, exist_ok=True)

    if args.images:
        image_paths = collect_images(args.images)
        print(f'Using images from: {args.images} ({len(image_paths)} found)')
    else:
        zip_path = args.zip
        if zip_path is None:
            zip_path = os.path.join(tmp_dir, 'Ribeyes.zip')
            if not os.path.isfile(zip_path):
                download_zip(RIBEYES_ZIP_URL, zip_path)
            else:
                print(f'Using cached ZIP: {zip_path}')

        extract_dir = os.path.join(tmp_dir, 'ribeyes')
        if os.path.isdir(extract_dir) and os.listdir(extract_dir):
            image_paths = collect_images(extract_dir)
            print(f'Using {len(image_paths)} previously extracted images.')
        else:
            os.makedirs(extract_dir, exist_ok=True)
            image_paths = extract_zip(zip_path, extract_dir)

    if not image_paths:
        sys.exit('ERROR: No images found.')

    if args.limit > 0:
        image_paths = image_paths[:args.limit]
        print(f'Limiting to first {args.limit} images.\n')

    print(f'{len(image_paths)} images to grade (k={args.k} samples/image).\n')

    # --- Step 2: Init services (skip for dry-run) ---
    db = None
    if not args.dry_run:
        db = init_firebase(args.sa)
        init_cloudinary(cloud_name, api_key, api_secret)
    else:
        print('DRY RUN — no uploads.\n')

    from model_utils import analyze_marbling, build_image_name, set_api_key, load_anchor_images
    if args.anthropic_key:
        set_api_key(args.anthropic_key)

    print('Loading fixed USDA marbling anchors...')
    anchors = load_anchor_images()
    print(f'Loaded {len(anchors)} anchors: {", ".join(a["descriptor"] for a in anchors)}\n')

    from model_utils import get_calibration_offset
    resolved_offset = args.calibration_offset if args.calibration_offset is not None else get_calibration_offset()
    print(f'Using calibration_offset={resolved_offset} '
          f'({"explicit override" if args.calibration_offset is not None else "from grader/calibration.json"})\n')

    print('Grading and uploading...')
    t0 = time.time()
    grade_counter = Counter()
    needs_review_count = 0
    failed = 0
    sample_results = []

    for i, image_path in enumerate(tqdm(image_paths, desc='Processing', unit='img')):
        filename = os.path.basename(image_path)
        public_id = f'ribeye_{i:04d}_{os.path.splitext(filename)[0]}'
        image_name = build_image_name(filename, i)

        try:
            result = analyze_marbling(
                image_path, k=args.k, calibration_offset=resolved_offset
            )

            if result['needs_review']:
                needs_review_count += 1
            else:
                grade_counter[result['grade_key']] += 1

            if args.dry_run:
                if i < 10:
                    if result['needs_review']:
                        sample_results.append(f'  {filename[:40]:40s}  NEEDS REVIEW (k_valid={result["k_valid"]})')
                    else:
                        sample_results.append(
                            f'  {filename[:40]:40s}  {result["grade_key"]:6s}  '
                            f'score={result["score"]:6.0f}  conf={result["confidence"]:6s}  '
                            f'spread={result["spread"]:.0f}'
                        )
                continue

            image_url = upload_image_cloudinary(image_path, public_id)
            write_firestore_doc(db, image_name, image_url, result, filename, args.k, resolved_offset)

        except Exception as e:
            tqdm.write(f'  ERROR: {filename}: {e}')
            failed += 1

    # --- Step 4: Summary ---
    elapsed = time.time() - t0
    total_done = len(image_paths) - failed
    print(f'\n{"=" * 52}')
    print(f'{"DRY RUN — " if args.dry_run else ""}DONE — {total_done}/{len(image_paths)} images processed')
    print(f'Time: {elapsed:.0f}s | Failed: {failed} | Needs review: {needs_review_count}')

    if sample_results:
        print('\nSample grades (first 10):')
        for line in sample_results:
            print(line)

    print(f'\nGrade distribution:')
    grade_order = ['PR_HI', 'PR_AVG', 'PR_LO', 'CH_HI', 'CH_AVG', 'CH_LO', 'SE_HI', 'SE_LO', 'STD']
    graded_total = sum(grade_counter.values())
    for key in grade_order:
        count = grade_counter.get(key, 0)
        if count > 0:
            pct = count / graded_total * 100 if graded_total else 0
            bar = '#' * int(pct / 2)
            print(f'  {key:6s}  {count:4d}  ({pct:4.1f}%)  {bar}')

    if not args.dry_run:
        print(f'\nImages are live in ai_carcasses — available in the "Help Train the Grading Model" section on beefgrading.study')
    print('=' * 52)


if __name__ == '__main__':
    main()
