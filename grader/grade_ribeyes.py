"""
grade_ribeyes.py — AI Ribeye Grading Pipeline
=============================================
Downloads the TTU Ribeyes.zip, runs the 1st-place USDA hackathon model
(ResNet50 transfer learning) on each image, then uploads BOTH the image
AND the predicted grade to Firebase so they are permanently linked.

Each Firestore document in community_carcasses contains:
  imageUrl   → Firebase Storage public URL (the actual image)
  correct    → { qualityGrade: 'CH_HI' } (the AI-predicted grade)

Usage:
  python grade_ribeyes.py --model best_model.keras --sa firebase-service-account.json
  python grade_ribeyes.py --model best_model.keras --sa firebase-service-account.json --limit 5
  python grade_ribeyes.py --model best_model.keras --sa firebase-service-account.json --zip Ribeyes.zip
"""

import argparse
import os
import sys
import zipfile
import time
import io
from collections import Counter
from datetime import datetime, timezone

import numpy as np
import requests
from tqdm import tqdm
from PIL import Image

# ----------------------------------------------------------------
#  Lazy imports — only loaded after arg validation
# ----------------------------------------------------------------
tf = None
firebase_admin = None
firestore = None
storage = None

RIBEYES_ZIP_URL = 'https://www.depts.ttu.edu/meatscience/judging/docs/Ribeyes.zip'
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff'}
STORAGE_PREFIX = 'ribeyes'
FIRESTORE_COLLECTION = 'community_carcasses'


# ----------------------------------------------------------------
#  Download helpers
# ----------------------------------------------------------------

def download_zip(url, dest_path):
    """Download a ZIP file with a progress bar."""
    print(f'Downloading {url}...')
    r = requests.get(url, stream=True, timeout=60, verify=False)
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
    """Extract ZIP and return list of image file paths."""
    print(f'Extracting {zip_path}...')
    with zipfile.ZipFile(zip_path, 'r') as z:
        z.extractall(extract_dir)
    # Collect all image files recursively
    images = []
    for root, _, files in os.walk(extract_dir):
        for fname in sorted(files):
            ext = os.path.splitext(fname)[1].lower()
            if ext in IMAGE_EXTENSIONS:
                images.append(os.path.join(root, fname))
    print(f'Found {len(images)} images in archive.')
    return images


# ----------------------------------------------------------------
#  Inference helpers
# ----------------------------------------------------------------

def load_model_tf(model_path):
    global tf
    import tensorflow as tf_module
    tf = tf_module
    print(f'Loading model from {model_path}...')
    model = tf.keras.models.load_model(model_path)
    print(f'Model output shape: {model.output_shape}')
    return model


def run_batch(model, image_paths, batch_size, output_type):
    """
    Run inference on all images in batches.
    Returns list of (grade_key, confidence, approx_score) tuples.
    """
    from model_utils import preprocess_image, get_grade_and_confidence

    results = []
    total = len(image_paths)

    for start in tqdm(range(0, total, batch_size), desc='Grading', unit='batch'):
        batch_paths = image_paths[start:start + batch_size]
        batch_arrays = []

        for p in batch_paths:
            try:
                arr = preprocess_image(p)
                batch_arrays.append(arr)
            except Exception as e:
                print(f'\n  Warning: could not preprocess {p}: {e}')
                batch_arrays.append(np.zeros((224, 224, 3), dtype=np.float32))

        batch_np = np.stack(batch_arrays, axis=0)
        raw_outputs = model.predict(batch_np, verbose=0)

        for i, raw in enumerate(raw_outputs):
            grade_key, confidence, score = get_grade_and_confidence(raw, output_type)
            results.append((grade_key, confidence, score))

    return results


# ----------------------------------------------------------------
#  Firebase helpers
# ----------------------------------------------------------------

def init_firebase(sa_path, bucket_name):
    global firebase_admin, firestore, storage
    import firebase_admin as fa
    from firebase_admin import credentials, firestore as fs, storage as st
    firebase_admin = fa
    firestore = fs
    storage = st

    cred = credentials.Certificate(sa_path)
    fa.initialize_app(cred, {'storageBucket': bucket_name})
    db = fs.client()
    bucket = st.bucket()
    print(f'Firebase initialized. Bucket: {bucket_name}')
    return db, bucket


def upload_image(bucket, local_path, filename):
    """
    Upload image to Firebase Storage under ribeyes/{filename}.
    Returns the public HTTPS URL.
    """
    storage_path = f'{STORAGE_PREFIX}/{filename}'
    blob = bucket.blob(storage_path)

    # Convert to JPEG in-memory for consistent format + smaller size
    img = Image.open(local_path).convert('RGB')
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=85, optimize=True)
    buf.seek(0)

    blob.upload_from_file(buf, content_type='image/jpeg')
    blob.make_public()
    return blob.public_url


def write_firestore_doc(db, image_name, image_url, grade_key, confidence, score, original_filename):
    """Write a single document to community_carcasses."""
    grade_label = _grade_label(grade_key)
    doc = {
        'imageName':    image_name,
        'imageUrl':     image_url,
        'source':       'AI Graded — USDA ResNet50',
        'correct':      {'qualityGrade': grade_key},
        'notes':        (
            f'AI predicted grade: {grade_label} | '
            f'Marbling score: ~{score:.0f} | '
            f'Confidence: {confidence * 100:.1f}%'
        ),
        'submittedBy':  'ai-pipeline',
        'submittedAt':  firestore.SERVER_TIMESTAMP,
        'aiScore':      float(score),
        'aiConfidence': float(confidence),
        'sourceFile':   original_filename,
    }
    db.collection(FIRESTORE_COLLECTION).add(doc)


def _grade_label(key):
    labels = {
        'PR_HI':  'High Prime',    'PR_AVG': 'Average Prime', 'PR_LO':  'Low Prime',
        'CH_HI':  'High Choice',   'CH_AVG': 'Average Choice','CH_LO':  'Low Choice',
        'SE_HI':  'High Select',   'SE_AVG': 'Average Select','SE_LO':  'Low Select',
        'STD':    'Standard',      'COM':    'Commercial',
    }
    return labels.get(key, key)


# ----------------------------------------------------------------
#  Main
# ----------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description='Grade ribeye images with the USDA ResNet50 model.')
    parser.add_argument('--model',  required=True,  help='Path to best_model.keras')
    parser.add_argument('--sa',     required=True,  help='Path to firebase-service-account.json')
    parser.add_argument('--zip',    default=None,   help='Path to Ribeyes.zip (auto-downloads if omitted)')
    parser.add_argument('--bucket', default='beef-grading-drill.appspot.com',
                        help='Firebase Storage bucket name')
    parser.add_argument('--batch',  type=int, default=32, help='Inference batch size')
    parser.add_argument('--limit',  type=int, default=0,  help='Max images to process (0 = all)')
    args = parser.parse_args()

    # Validate required files
    if not os.path.isfile(args.model):
        sys.exit(f'ERROR: Model file not found: {args.model}\n'
                 f'Download from: https://drive.google.com/file/d/1suQxD6kJ8wviCNpbCZZRWIENzsGF6him/view')
    if not os.path.isfile(args.sa):
        sys.exit(f'ERROR: Service account file not found: {args.sa}\n'
                 f'Download from Firebase Console → Project Settings → Service Accounts')

    # --- Step 1: Get the images ---
    script_dir = os.path.dirname(os.path.abspath(__file__))
    tmp_dir = os.path.join(script_dir, 'tmp')
    os.makedirs(tmp_dir, exist_ok=True)

    zip_path = args.zip
    if zip_path is None:
        zip_path = os.path.join(tmp_dir, 'Ribeyes.zip')
        if not os.path.isfile(zip_path):
            download_zip(RIBEYES_ZIP_URL, zip_path)
        else:
            print(f'Using cached ZIP: {zip_path}')

    extract_dir = os.path.join(tmp_dir, 'ribeyes')
    if not os.path.isdir(extract_dir) or not os.listdir(extract_dir):
        os.makedirs(extract_dir, exist_ok=True)
        image_paths = extract_zip(zip_path, extract_dir)
    else:
        # Already extracted
        image_paths = []
        for root, _, files in os.walk(extract_dir):
            for fname in sorted(files):
                if os.path.splitext(fname)[1].lower() in IMAGE_EXTENSIONS:
                    image_paths.append(os.path.join(root, fname))
        print(f'Using {len(image_paths)} previously extracted images.')

    if not image_paths:
        sys.exit('ERROR: No images found after extraction.')

    if args.limit > 0:
        image_paths = image_paths[:args.limit]
        print(f'Limiting to first {args.limit} images.')

    print(f'\n{len(image_paths)} images to process.\n')

    # --- Step 2: Load model ---
    model = load_model_tf(args.model)

    from model_utils import detect_output_type, build_image_name
    output_type = detect_output_type(model)
    print(f'Output type detected: {output_type}\n')

    # --- Step 3: Run inference (all images, batched) ---
    print('Running inference...')
    t0 = time.time()
    inference_results = run_batch(model, image_paths, args.batch, output_type)
    elapsed_infer = time.time() - t0
    print(f'Inference done in {elapsed_infer:.1f}s ({elapsed_infer / len(image_paths) * 1000:.0f}ms/image)\n')

    # --- Step 4: Init Firebase ---
    db, bucket = init_firebase(args.sa, args.bucket)

    # --- Step 5: Upload images + write Firestore docs ---
    print('Uploading to Firebase Storage + Firestore...')
    grade_counter = Counter()
    failed = 0

    for i, (image_path, (grade_key, confidence, score)) in enumerate(
        tqdm(zip(image_paths, inference_results), total=len(image_paths), desc='Uploading')
    ):
        filename = os.path.basename(image_path)
        # Use index-padded filename so Storage filenames are unique and sortable
        storage_filename = f'ribeye_{i:04d}_{filename}'
        image_name = build_image_name(filename, i)

        try:
            image_url = upload_image(bucket, image_path, storage_filename)
            write_firestore_doc(db, image_name, image_url, grade_key, confidence, score, filename)
            grade_counter[grade_key] += 1
        except Exception as e:
            print(f'\n  ERROR on {filename}: {e}')
            failed += 1

    # --- Step 6: Summary ---
    total_uploaded = len(image_paths) - failed
    elapsed_total = time.time() - t0
    print(f'\n{"=" * 50}')
    print(f'DONE — {total_uploaded}/{len(image_paths)} images graded and uploaded')
    print(f'Total time: {elapsed_total:.0f}s | Failed: {failed}')
    print(f'\nGrade distribution:')
    grade_order = ['PR_HI','PR_AVG','PR_LO','CH_HI','CH_AVG','CH_LO',
                   'SE_HI','SE_AVG','SE_LO','STD','COM']
    for key in grade_order:
        count = grade_counter.get(key, 0)
        if count > 0:
            pct = count / total_uploaded * 100
            bar = '█' * int(pct / 2)
            print(f'  {key:6s}  {count:4d}  ({pct:4.1f}%)  {bar}')
    print(f'\nImages are live in the community carcasses pool on gradethismeat.xyz')
    print(f'="{"=" * 49}')


if __name__ == '__main__':
    main()
