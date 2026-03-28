"""
grade_ribeyes.py — AI Ribeye Grading Pipeline
=============================================
Downloads TTU Ribeyes.zip, analyzes each image using color-based
intramuscular fat segmentation (no model file needed), then uploads
BOTH the image AND its predicted grade to Firebase.

Every Firestore document contains:
  imageUrl  → Cloudinary public URL (the actual image)
  correct   → { qualityGrade: 'CH_HI' }  (the AI-predicted grade)

Grading technique: measures intramuscular fat ratio via HSV pixel
segmentation, maps ratio to USDA marbling score (0–1100), then to
grade key. Same core approach as USDA's Computer Vision System.

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

import numpy as np
import requests
from tqdm import tqdm
from PIL import Image

warnings.filterwarnings('ignore')

RIBEYES_ZIP_URL = 'https://www.depts.ttu.edu/meatscience/judging/docs/Ribeyes.zip'
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff'}
CLOUDINARY_FOLDER = 'ribeyes'
FIRESTORE_COLLECTION = 'ai_carcasses'


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


def write_firestore_doc(db, image_name, image_url, grade_key, confidence, score, original_filename):
    from firebase_admin import firestore
    grade_label = _grade_label(grade_key)
    doc = {
        'imageName':    image_name,
        'imageUrl':     image_url,
        'source':       'AI Graded — Color Analysis',
        'correct':      {'qualityGrade': grade_key},
        'notes':        (
            f'AI predicted: {grade_label} | '
            f'Marbling score: ~{score:.0f} | '
            f'Confidence: {confidence * 100:.1f}%'
        ),
        'submittedBy':  'ai-pipeline',
        'submittedAt':  firestore.SERVER_TIMESTAMP,
        'aiScore':      float(score),
        'aiConfidence': float(confidence),
        'sourceFile':   original_filename,
        'voteCount':    0,
        'promoted':     False,
    }
    db.collection(FIRESTORE_COLLECTION).add(doc)


def _grade_label(key):
    return {
        'PR_HI': 'High Prime',    'PR_AVG': 'Average Prime', 'PR_LO': 'Low Prime',
        'CH_HI': 'High Choice',   'CH_AVG': 'Average Choice','CH_LO': 'Low Choice',
        'SE_HI': 'High Select',   'SE_AVG': 'Average Select','SE_LO': 'Low Select',
        'STD':   'Standard',      'COM':    'Commercial',
    }.get(key, key)


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
    parser.add_argument('--dry-run',     action='store_true',
                        help='Grade images but skip all uploads (for testing grades locally)')
    parser.add_argument('--anthropic-key', default=None,
                        help='Anthropic API key (overrides api_key.txt)')
    args = parser.parse_args()

    if args.anthropic_key:
        os.environ['ANTHROPIC_API_KEY'] = args.anthropic_key.strip()

    # Load Cloudinary creds from file if not passed on CLI
    script_dir = os.path.dirname(os.path.abspath(__file__))
    creds_file = os.path.join(script_dir, 'cloudinary_creds.txt')
    file_creds = _load_creds_file(creds_file)
    cloud_name = args.cloud_name or file_creds.get('cloud_name')
    api_key    = args.api_key    or file_creds.get('api_key')
    api_secret = args.api_secret or file_creds.get('api_secret')

    if not args.dry_run and not (cloud_name and api_key and api_secret):
        sys.exit('ERROR: Cloudinary credentials missing.\n'
                 'Edit grader/cloudinary_creds.txt with your cloud_name, api_key, api_secret.')

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

    print(f'{len(image_paths)} images to grade.\n')

    # --- Step 2: Init services (skip for dry-run) ---
    db = None
    if not args.dry_run:
        db = init_firebase(args.sa)
        init_cloudinary(cloud_name, api_key, api_secret)
    else:
        # Still need Firebase to fetch reference images
        if os.path.isfile(args.sa):
            db = init_firebase(args.sa)
        print('DRY RUN — no uploads.\n')

    # --- Step 2b: Fetch reference images from community_carcasses ---
    from model_utils import analyze_marbling, build_image_name, load_reference_images, set_api_key
    if args.anthropic_key:
        set_api_key(args.anthropic_key)
    reference_images = {}
    if db is not None:
        print('Loading reference images from community_carcasses...')
        reference_images = load_reference_images(db)
        if reference_images:
            print(f'Loaded {len(reference_images)} reference grades: {", ".join(sorted(reference_images.keys()))}\n')
        else:
            print('No reference images found — grading without examples.\n')

    print('Grading and uploading...')
    t0 = time.time()
    grade_counter = Counter()
    failed = 0
    sample_results = []

    for i, image_path in enumerate(tqdm(image_paths, desc='Processing', unit='img')):
        filename = os.path.basename(image_path)
        public_id = f'ribeye_{i:04d}_{os.path.splitext(filename)[0]}'
        image_name = build_image_name(filename, i)

        try:
            grade_key, confidence, score = analyze_marbling(image_path, reference_images)

            if args.dry_run:
                grade_counter[grade_key] += 1
                if i < 10:
                    sample_results.append(
                        f'  {filename[:40]:40s}  {grade_key:6s}  score={score:6.0f}  conf={confidence:.2f}'
                    )
                continue

            image_url = upload_image_cloudinary(image_path, public_id)
            write_firestore_doc(db, image_name, image_url, grade_key, confidence, score, filename)
            grade_counter[grade_key] += 1

        except Exception as e:
            tqdm.write(f'  ERROR: {filename}: {e}')
            failed += 1

    # --- Step 4: Summary ---
    elapsed = time.time() - t0
    total_done = len(image_paths) - failed
    print(f'\n{"=" * 52}')
    print(f'{"DRY RUN — " if args.dry_run else ""}DONE — {total_done}/{len(image_paths)} images processed')
    print(f'Time: {elapsed:.0f}s | Failed: {failed}')

    if sample_results:
        print('\nSample grades (first 10):')
        for line in sample_results:
            print(line)

    print(f'\nGrade distribution:')
    grade_order = ['PR_HI','PR_AVG','PR_LO','CH_HI','CH_AVG','CH_LO','SE_HI','SE_AVG','SE_LO','STD']
    for key in grade_order:
        count = grade_counter.get(key, 0)
        if count > 0:
            pct = count / total_done * 100
            bar = '#' * int(pct / 2)
            print(f'  {key:6s}  {count:4d}  ({pct:4.1f}%)  {bar}')

    if not args.dry_run:
        print(f'\nImages are live in ai_carcasses — available in the "Help Train the Grading Model" section on gradethismeat.xyz')
    print('=' * 52)


if __name__ == '__main__':
    main()
