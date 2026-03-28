"""
model_utils.py — Claude Vision API ribeye grader + grade mapping helpers.

Uses Claude claude-sonnet-4-6 vision to analyze ribeye cross-section images and assign
USDA quality grades. When reference images (from community_carcasses) are
available they are included as few-shot examples so Claude grades relative
to known-good human-graded samples rather than from text descriptions alone.

Set ANTHROPIC_API_KEY environment variable before running, or pass
--anthropic-key to grade_ribeyes.py.
"""

import base64
import io
import json
import os
import re
import time

import requests
from PIL import Image

# ----------------------------------------------------------------
#  Grade mapping
# ----------------------------------------------------------------

GRADE_LABELS = {
    'PR_HI':  'High Prime',    'PR_AVG': 'Average Prime', 'PR_LO':  'Low Prime',
    'CH_HI':  'High Choice',   'CH_AVG': 'Average Choice','CH_LO':  'Low Choice',
    'SE_HI':  'High Select',   'SE_AVG': 'Average Select','SE_LO':  'Low Select',
    'STD':    'Standard',      'COM':    'Commercial',
}

_GRADE_MAP = {
    'high prime':           'PR_HI',
    'average prime':        'PR_AVG',
    'low prime':            'PR_LO',
    'prime':                'PR_AVG',
    'high choice':          'CH_HI',
    'average choice':       'CH_AVG',
    'low choice':           'CH_LO',
    'upper 2/3 choice':     'CH_HI',
    'choice':               'CH_AVG',
    'high select':          'SE_HI',
    'average select':       'SE_HI',  # map old SE_AVG → SE_HI (upper slight)
    'low select':           'SE_LO',
    'select':               'SE_HI',
    'standard':             'STD',
    'commercial':           'COM',
}

_DESCRIPTOR_SCORE = {
    'abundant':               950,
    'moderately abundant':    850,
    'slightly abundant':      750,
    'moderate':               650,
    'modest':                 550,
    'small':                  450,
    'slight+':                385,   # upper half of Slight → SE_HI
    'slight':                 350,   # midpoint — defaults to SE_HI boundary
    'slight-':                315,   # lower half of Slight → SE_LO
    'traces':                 250,
    'practically devoid':     150,
}

# Which grades to try to fetch as reference examples (one per tier)
_REFERENCE_GRADES = ['PR_AVG', 'CH_HI', 'CH_AVG', 'CH_LO', 'SE_HI', 'SE_LO', 'STD']

_SYSTEM_PROMPT_BASE = """You are a certified USDA beef grader with 20 years of experience grading ribeye cross-sections.

Grade the LAST image in this message using official USDA quality grade standards.

GRADE SCALE (8 grades, highest to lowest):
- Abundant (900-999)           → High Prime
- Moderately Abundant (800-899) → Average Prime
- Slightly Abundant (700-799)  → Low Prime
- Moderate (600-699)           → High Choice
- Modest (500-599)             → Average Choice
- Small (400-499)              → Low Choice
- Slight upper half (350-399)  → High Select   ← USE THIS, it is a real grade
- Slight lower half (300-349)  → Low Select
- Traces/Practically Devoid (<300) → Standard

CRITICAL — FINE vs COARSE MARBLING:
- Fine marbling = many small, diffuse flecks distributed evenly across the entire muscle = HIGHER grade
- Coarse marbling = fewer large clumps or streaks = LOWER grade for same apparent percentage
- A ribeye with fine, evenly distributed marbling grades ONE LEVEL HIGHER than one with the same fat percentage in coarse deposits
- Look at fleck SIZE (small dots vs large blobs), DISTRIBUTION (even vs patchy), and DENSITY (count of flecks per cm²)

WHAT TO IGNORE: external fat cap, seam fat between muscle groups, bone. Grade ONLY the longissimus dorsi (the large central eye muscle).

Respond ONLY with valid JSON (no markdown):
{
  "grade": "High Choice",
  "marbling_descriptor": "Moderate",
  "marbling_score": 650,
  "confidence": "high",
  "reasoning": "one sentence describing fleck size, distribution, and density"
}

grade must be EXACTLY one of: High Prime, Average Prime, Low Prime, High Choice, Average Choice, Low Choice, High Select, Low Select, Standard
confidence must be one of: high, medium, low"""

_SYSTEM_PROMPT_NO_REF = _SYSTEM_PROMPT_BASE.replace(
    'Grade the LAST image in this message',
    'Grade the image'
)


def _img_to_b64(path_or_url, from_url=False):
    """Load an image from a local path or URL, resize to max 800px, return base64 JPEG."""
    if from_url:
        r = requests.get(path_or_url, timeout=15)
        r.raise_for_status()
        img = Image.open(io.BytesIO(r.content)).convert('RGB')
    else:
        img = Image.open(path_or_url).convert('RGB')

    img.thumbnail((800, 800), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=82)
    return base64.standard_b64encode(buf.getvalue()).decode()


def load_reference_images(db):
    """
    Fetch one example image per grade tier from community_carcasses.
    Returns dict: { 'CH_HI': <base64_str>, 'SE_AVG': <base64_str>, ... }
    """
    refs = {}
    try:
        snap = db.collection('community_carcasses').limit(200).get()
        docs = [d.to_dict() for d in snap]
    except Exception as e:
        print(f'  Warning: could not fetch community_carcasses: {e}')
        return refs

    # Build a pool of docs per grade
    by_grade = {}
    for doc in docs:
        grade = (doc.get('correct') or {}).get('qualityGrade')
        url = doc.get('imageUrl', '')
        if grade and url.startswith('https://'):
            by_grade.setdefault(grade, []).append(url)

    for grade in _REFERENCE_GRADES:
        if grade not in by_grade:
            continue
        url = by_grade[grade][0]
        try:
            refs[grade] = _img_to_b64(url, from_url=True)
        except Exception as e:
            print(f'  Warning: could not load reference for {grade}: {e}')

    return refs


def _get_client():
    try:
        import anthropic
    except ImportError:
        raise ImportError('Run: pip install anthropic')
    key = (_api_key or os.environ.get('ANTHROPIC_API_KEY', '')).strip()
    # Fall back to api_key.txt next to this file
    if not key:
        key_file = os.path.join(os.path.dirname(__file__), 'api_key.txt')
        if os.path.isfile(key_file):
            key = open(key_file).read().strip()
    if not key:
        raise ValueError('No API key found. Add it to grader/api_key.txt')
    return anthropic.Anthropic(api_key=key)


_client = None
_api_key = None


def set_api_key(key):
    """Call this before analyze_marbling to set the key directly."""
    global _api_key, _client
    _api_key = key.strip()
    _client = None  # force re-init with new key


def _parse_grade_response(text):
    try:
        data = json.loads(text.strip())
    except json.JSONDecodeError:
        m = re.search(r'\{.*\}', text, re.DOTALL)
        if m:
            data = json.loads(m.group())
        else:
            return 'SE_AVG', 0.4, 350.0

    grade_key = _GRADE_MAP.get(data.get('grade', '').lower().strip(), 'SE_HI')
    confidence = {'high': 0.90, 'medium': 0.70, 'low': 0.50}.get(
        data.get('confidence', 'medium').lower(), 0.70
    )
    score = float(data.get('marbling_score', 0))
    if score == 0:
        score = float(_DESCRIPTOR_SCORE.get(
            data.get('marbling_descriptor', '').lower().strip(), 350
        ))
    return grade_key, confidence, score


def analyze_marbling(image_path, reference_images=None, max_retries=3):
    """
    Analyze a ribeye image and return (grade_key, confidence, marbling_score).

    reference_images: dict of { grade_key: base64_jpeg_str } from load_reference_images().
    When provided, they are prepended to the prompt as few-shot examples.
    """
    global _client
    if _client is None:
        _client = _get_client()

    target_b64 = _img_to_b64(image_path)

    # Build message content
    content = []

    if reference_images:
        content.append({
            'type': 'text',
            'text': (
                'Below are reference ribeye images with their known USDA grades. '
                'Use these as your calibration standard, then grade the FINAL image.\n'
            )
        })
        for grade_key, b64 in reference_images.items():
            label = GRADE_LABELS.get(grade_key, grade_key)
            content.append({'type': 'text', 'text': f'REFERENCE — {label} ({grade_key}):'})
            content.append({
                'type': 'image',
                'source': {'type': 'base64', 'media_type': 'image/jpeg', 'data': b64}
            })
        content.append({'type': 'text', 'text': '\nNow grade this ribeye:'})
    else:
        content.append({'type': 'text', 'text': 'Grade this ribeye cross-section.'})

    content.append({
        'type': 'image',
        'source': {'type': 'base64', 'media_type': 'image/jpeg', 'data': target_b64}
    })

    system = _SYSTEM_PROMPT_BASE if reference_images else _SYSTEM_PROMPT_NO_REF

    for attempt in range(max_retries):
        try:
            import anthropic
            response = _client.messages.create(
                model='claude-sonnet-4-6',
                max_tokens=250,
                system=system,
                messages=[{'role': 'user', 'content': content}]
            )
            return _parse_grade_response(response.content[0].text)
        except Exception as e:
            err = str(e)
            if 'overloaded' in err.lower() or 'rate' in err.lower():
                time.sleep(2 ** attempt)
                continue
            raise

    return 'SE_AVG', 0.4, 350.0


def preprocess_image(image_path, target_size=(224, 224)):
    img = Image.open(image_path).convert('RGB')
    img = img.resize(target_size, Image.LANCZOS)
    import numpy as np
    return np.array(img, dtype=float) / 255.0


def build_image_name(filename, index):
    stem = filename.rsplit('.', 1)[0]
    stem = stem.replace('_', ' ').replace('-', ' ')
    return stem if stem.strip() else f'Ribeye {index + 1:04d}'
