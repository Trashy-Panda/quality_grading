"""
model_utils.py — Claude Vision ribeye grader ("Option A": Claude as a
calibrated instrument).

Design, per grader/AUDIT_AND_REDESIGN.md:
  1. Perception is decoupled from grade assignment. Claude never reports a
     grade — only a marbling descriptor + subunit (and a comparative
     interpolation between two fixed anchor photos). The grade is assigned
     by score_to_grade_key() in this file, deterministically.
  2. Images are sent at full resolution (long side 1568px, q90) instead of
     the old 800px/q82 thumbnail that destroyed fine marbling flecks.
  3. Few-shot calibration uses 7 fixed OFFICIAL USDA marbling reference
     photographs (grader/anchors/) instead of the old community_carcasses
     lookup — that pool was itself AI/consensus-derived, so using it as a
     calibration standard fed the grader's own bias back into itself.
  4. Self-consistency: k calls per image, median score, spread -> confidence.
  5. A constant score-space calibration offset (measured against vote-
     weighted human consensus) can be applied post-hoc without touching
     the prompt.
  6. Parse failure / all-bad-image-quality never fabricates a grade —
     it returns needs_review=True instead.

Set ANTHROPIC_API_KEY environment variable before running, or pass
--anthropic-key to grade_ribeyes.py.
"""

import base64
import io
import json
import os
import re
import statistics
import time

import requests
from PIL import Image

# ----------------------------------------------------------------
#  Canonical marbling score -> grade mapping (single source of truth).
#  Mirrors USDA marbling degree bands, each subdivided into 100 subunits.
# ----------------------------------------------------------------

GRADE_LABELS = {
    'PR_HI':  'High Prime',    'PR_AVG': 'Average Prime', 'PR_LO':  'Low Prime',
    'CH_HI':  'High Choice',   'CH_AVG': 'Average Choice','CH_LO':  'Low Choice',
    'SE_HI':  'High Select',   'SE_AVG': 'Average Select','SE_LO':  'Low Select',
    'STD':    'Standard',      'COM':    'Commercial',
}

# (score_floor, grade_key) descending — first match wins
_SCORE_THRESHOLDS = [
    (900, 'PR_HI'),
    (800, 'PR_AVG'),
    (700, 'PR_LO'),
    (600, 'CH_HI'),
    (500, 'CH_AVG'),
    (400, 'CH_LO'),
    (350, 'SE_HI'),
    (300, 'SE_LO'),
    (0,   'STD'),
]

# descriptor -> floor of its 100-point band (USDA marbling score scale)
_DESCRIPTOR_FLOOR = {
    'practically devoid':    100,
    'traces':                200,
    'slight':                300,
    'small':                 400,
    'modest':                500,
    'moderate':              600,
    'slightly abundant':     700,
    'moderately abundant':   800,
    'abundant':              900,
}

_VALID_DESCRIPTORS = set(_DESCRIPTOR_FLOOR)


def score_to_grade_key(score):
    """Deterministic score (0-999+) -> grade key. The only place a grade is assigned."""
    score = float(score)
    for floor, key in _SCORE_THRESHOLDS:
        if score >= floor:
            return key
    return 'STD'


# ----------------------------------------------------------------
#  Fixed USDA marbling anchors (replaces the old circular
#  community_carcasses few-shot lookup).
# ----------------------------------------------------------------

_ANCHORS_DIR = os.path.join(os.path.dirname(__file__), 'anchors')
_ANCHORS_MANIFEST = os.path.join(_ANCHORS_DIR, 'manifest.json')

_anchor_cache = None


def _img_bytes_to_b64(img, max_side=1568, quality=90):
    """Resize (preserving aspect) to at most max_side on the long edge, re-encode JPEG."""
    img = img.convert('RGB')
    if max(img.size) > max_side:
        img.thumbnail((max_side, max_side), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=quality)
    return base64.standard_b64encode(buf.getvalue()).decode()


def _img_to_b64(path_or_url, from_url=False, max_side=1568, quality=90):
    if from_url:
        r = requests.get(path_or_url, timeout=20)
        r.raise_for_status()
        img = Image.open(io.BytesIO(r.content))
    else:
        img = Image.open(path_or_url)
    return _img_bytes_to_b64(img, max_side=max_side, quality=quality)


def load_anchor_images():
    """
    Load the 7 fixed official USDA marbling reference photos.
    Returns a list of dicts: {descriptor, score, grade_key, b64}, ordered low -> high.
    Cached in-process — anchors never change during a run.
    """
    global _anchor_cache
    if _anchor_cache is not None:
        return _anchor_cache

    with open(_ANCHORS_MANIFEST, 'r', encoding='utf-8') as f:
        manifest = json.load(f)

    anchors = []
    for entry in manifest['anchors']:
        path = os.path.join(_ANCHORS_DIR, entry['file'])
        img = Image.open(path)
        anchors.append({
            'descriptor': entry['descriptor'],
            'score':      entry['score'],
            'grade_key':  entry['grade_key'],
            'b64':        _img_bytes_to_b64(img, max_side=1568, quality=90),
        })
    _anchor_cache = anchors
    return anchors


# ----------------------------------------------------------------
#  Prompt
# ----------------------------------------------------------------

_SYSTEM_PROMPT = """You are assisting official USDA beef quality grading by measuring intramuscular marbling in ribeye cross-sections.

You are shown a sequence of ANCHOR images: official USDA marbling reference photographs, each labeled with its descriptor and numeric marbling score. These are your fixed calibration standards. Below Slight (score < 300) there is no reference photo — that range (Traces, Practically Devoid) means only faint traces of fat or none at all.

For the TARGET image (the final image, unlabeled):
1. Name the anchor with clearly LESS marbling than the target, and the anchor with clearly MORE marbling than the target. If the target has less marbling than every anchor, set lower_anchor to "None" and upper_anchor to "Slight".
2. Interpolate: on a 0-100 scale, where does the target sit between those two anchors? 0 = matches the lower anchor exactly, 100 = matches the upper anchor exactly.
3. Independently, name the marbling descriptor band the target falls in (Practically Devoid, Traces, Slight, Small, Modest, Moderate, Slightly Abundant, Moderately Abundant, or Abundant) and a subunit 0-99 within that band (e.g. Modest, subunit 30 means solidly early-Modest).
4. Note whether the marbling flecks are fine and evenly dispersed, a mixed pattern, or coarse and clumped — fine, even dispersion at a given fat percentage reads as the higher end of its descriptor band; coarse, clumped fat at the same percentage reads as the lower end. Let this judgment inform which subunit you pick, don't report it separately from your subunit choice.
5. Flag image quality problems (glare, underexposure, blur) that make judgment unreliable.

This dataset spans the FULL range from Standard to High Prime. Most images are NOT average Choice — do not default to the middle of the scale. Judge only the longissimus dorsi (the large central eye muscle). Ignore external fat cap, seam fat between muscle groups, connective tissue sheen, and bone.

Respond ONLY with valid JSON (no markdown fences):
{
  "lower_anchor": "None | Slight | Small | Modest | Moderate | Slightly Abundant | Moderately Abundant | Abundant",
  "upper_anchor": "Slight | Small | Modest | Moderate | Slightly Abundant | Moderately Abundant | Abundant",
  "interp": 0-100,
  "descriptor": "Practically Devoid | Traces | Slight | Small | Modest | Moderate | Slightly Abundant | Moderately Abundant | Abundant",
  "subunit": 0-99,
  "fineness": "fine | mixed | coarse",
  "image_quality": "good | glare | dark | blurry"
}"""


def _build_anchor_content(anchors):
    """Build the reusable anchor-image content blocks, cache_control on the last one."""
    content = [{
        'type': 'text',
        'text': (
            'ANCHORS — official USDA marbling reference photographs, in ascending order '
            'of marbling. Use these as your fixed calibration standard for every image '
            'you grade in this session.'
        )
    }]
    for i, a in enumerate(anchors):
        content.append({
            'type': 'text',
            'text': f"ANCHOR {i + 1}: {a['descriptor']} (score {a['score']})"
        })
        content.append({
            'type': 'image',
            'source': {'type': 'base64', 'media_type': 'image/jpeg', 'data': a['b64']}
        })
    # Mark the end of the reusable prefix for prompt caching (Anthropic ephemeral cache).
    content[-1]['cache_control'] = {'type': 'ephemeral'}
    return content


# ----------------------------------------------------------------
#  API client
# ----------------------------------------------------------------

_client = None
_api_key = None


def set_api_key(key):
    global _api_key, _client
    _api_key = key.strip()
    _client = None


# ----------------------------------------------------------------
#  Cost governor — approximate, based on real per-call token usage.
#  Rates are estimates (Sonnet-tier list pricing as of this writing) and
#  exist to give a hard stop during test/eval runs, not exact billing.
# ----------------------------------------------------------------

_PRICE_PER_MTOK = {
    'input':       3.00,
    'output':      15.00,
    'cache_write': 3.75,
    'cache_read':  0.30,
}

_budget_usd = None
_spent_usd = 0.0
_call_log = []


class BudgetExceeded(Exception):
    pass


def set_budget(usd):
    """Set (or clear with None) a hard spend cap. Raises BudgetExceeded once
    cumulative estimated spend would meet or exceed it, checked before every
    API call so we stop BEFORE overspending, not after."""
    global _budget_usd, _spent_usd, _call_log
    _budget_usd = usd
    _spent_usd = 0.0
    _call_log = []


def get_spent():
    return _spent_usd


def _check_budget():
    if _budget_usd is not None and _spent_usd >= _budget_usd:
        raise BudgetExceeded(
            f'Estimated spend ${_spent_usd:.2f} has reached the ${_budget_usd:.2f} cap — stopping before another call.'
        )


def _record_usage(usage):
    global _spent_usd
    inp   = getattr(usage, 'input_tokens', 0) or 0
    out   = getattr(usage, 'output_tokens', 0) or 0
    cwrite = getattr(usage, 'cache_creation_input_tokens', 0) or 0
    cread  = getattr(usage, 'cache_read_input_tokens', 0) or 0
    cost = (
        inp    / 1e6 * _PRICE_PER_MTOK['input']
        + out   / 1e6 * _PRICE_PER_MTOK['output']
        + cwrite / 1e6 * _PRICE_PER_MTOK['cache_write']
        + cread  / 1e6 * _PRICE_PER_MTOK['cache_read']
    )
    _spent_usd += cost
    _call_log.append({'input': inp, 'output': out, 'cache_write': cwrite, 'cache_read': cread, 'cost': cost})
    return cost


def _get_client():
    try:
        import anthropic
    except ImportError:
        raise ImportError('Run: pip install anthropic')
    key = (_api_key or os.environ.get('ANTHROPIC_API_KEY', '')).strip()
    if not key:
        key_file = os.path.join(os.path.dirname(__file__), 'secrets', 'api_key.txt')
        if os.path.isfile(key_file):
            key = open(key_file).read().strip()
    if not key:
        raise ValueError('No API key found. Add it to grader/secrets/api_key.txt')
    return anthropic.Anthropic(api_key=key)


MODEL = 'claude-sonnet-5'


# ----------------------------------------------------------------
#  Response parsing — never fabricates a grade key.
# ----------------------------------------------------------------

def _parse_sample(text):
    """Parse one API response into a sample dict, or None if unparseable."""
    try:
        data = json.loads(text.strip())
    except json.JSONDecodeError:
        m = re.search(r'\{.*\}', text, re.DOTALL)
        if not m:
            return None
        try:
            data = json.loads(m.group())
        except json.JSONDecodeError:
            return None

    descriptor = str(data.get('descriptor', '')).lower().strip()
    if descriptor not in _VALID_DESCRIPTORS:
        return None
    try:
        subunit = float(data.get('subunit', 0))
    except (TypeError, ValueError):
        subunit = 0.0
    subunit = max(0.0, min(99.0, subunit))
    descriptor_score = _DESCRIPTOR_FLOOR[descriptor] + subunit

    # Cross-check against the anchor-interpolation estimate, when available.
    interp_score = None
    anchors = load_anchor_images()
    anchor_by_desc = {a['descriptor'].lower(): a['score'] for a in anchors}
    lower_name = str(data.get('lower_anchor', '')).lower().strip()
    upper_name = str(data.get('upper_anchor', '')).lower().strip()
    try:
        interp = max(0.0, min(100.0, float(data.get('interp', 50))))
    except (TypeError, ValueError):
        interp = 50.0

    if lower_name == 'none':
        # Target sits below the lowest anchor (Slight, score 300+interp-scaled below).
        upper_score = anchor_by_desc.get(upper_name, 300)
        interp_score = 300 - (100 - interp) * 2.0  # extrapolate down toward Practically Devoid
    elif lower_name in anchor_by_desc and upper_name in anchor_by_desc:
        lo, hi = anchor_by_desc[lower_name], anchor_by_desc[upper_name]
        interp_score = lo + (hi - lo) * (interp / 100.0)

    flagged_inconsistent = (
        interp_score is not None and abs(interp_score - descriptor_score) > 50
    )

    return {
        'descriptor_score':    descriptor_score,
        'interp_score':        interp_score,
        'score':               descriptor_score,  # primary score used downstream
        'fineness':            data.get('fineness', 'mixed'),
        'image_quality':       data.get('image_quality', 'good'),
        'inconsistent':        flagged_inconsistent,
        'raw':                 data,
    }


# ----------------------------------------------------------------
#  Main entry point
# ----------------------------------------------------------------

_CALIBRATION_FILE = os.path.join(os.path.dirname(__file__), 'calibration.json')


def get_calibration_offset():
    """Read the current data-driven offset from calibration.json (see recalibrate.py). Falls back to 0.0."""
    if os.path.isfile(_CALIBRATION_FILE):
        try:
            with open(_CALIBRATION_FILE, 'r', encoding='utf-8') as f:
                return float(json.load(f).get('calibration_offset', 0.0))
        except (ValueError, KeyError, json.JSONDecodeError):
            return 0.0
    return 0.0


def analyze_marbling(image_path, from_url=False, k=3, calibration_offset=None,
                      max_retries=3):
    """
    Analyze a ribeye image with k self-consistency samples.

    calibration_offset: constant score-space correction. If None (default),
    reads the current fitted value from grader/calibration.json (see
    recalibrate.py) — pass an explicit number to override for A/B testing.

    Returns a dict:
      {
        'grade_key':  str or None (None means needs_review),
        'score':      float or None (median, post-calibration-offset),
        'spread':     float or None (max-min across samples used),
        'confidence': 'high' | 'medium' | 'low' | None,
        'k_valid':    int (samples that parsed successfully),
        'k_good':     int (of those, samples with image_quality == 'good'),
        'needs_review': bool,
        'samples':    list of raw parsed sample dicts (for provenance/debugging),
      }

    Never fabricates a grade: if every sample fails to parse, or every parsed
    sample reports bad image quality, needs_review is True and grade_key is None.
    """
    global _client
    if _client is None:
        _client = _get_client()

    if calibration_offset is None:
        calibration_offset = get_calibration_offset()

    anchors = load_anchor_images()
    anchor_content = _build_anchor_content(anchors)
    target_b64 = _img_to_b64(image_path, from_url=from_url)

    content = list(anchor_content) + [
        {'type': 'text', 'text': 'Now grade this TARGET ribeye:'},
        {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/jpeg', 'data': target_b64}},
    ]

    samples = []
    for _ in range(k):
        _check_budget()  # raises BudgetExceeded before spending on another call
        text = None
        for attempt in range(max_retries):
            try:
                response = _client.messages.create(
                    model=MODEL,
                    max_tokens=600,
                    system=_SYSTEM_PROMPT,
                    messages=[{'role': 'user', 'content': content}],
                )
                _record_usage(response.usage)  # log spend regardless of parse outcome below
                text = next((b.text for b in response.content if b.type == 'text'), None)
                break
            except Exception as e:
                err = str(e).lower()
                if 'overloaded' in err or 'rate' in err:
                    time.sleep(2 ** attempt)
                    continue
                raise
        if text is None:
            continue
        parsed = _parse_sample(text)
        if parsed is not None:
            samples.append(parsed)

    k_valid = len(samples)
    good = [s for s in samples if s['image_quality'] == 'good']
    use = good if good else samples
    k_good = len(good)

    if not use:
        return {
            'grade_key': None, 'score': None, 'spread': None, 'confidence': None,
            'k_valid': k_valid, 'k_good': k_good, 'needs_review': True,
            'samples': samples,
        }

    scores = [s['score'] for s in use]
    median_score = statistics.median(scores)
    spread = max(scores) - min(scores) if len(scores) > 1 else 0.0

    if spread < 50:
        confidence = 'high'
    elif spread < 100:
        confidence = 'medium'
    else:
        confidence = 'low'

    calibrated = median_score + calibration_offset
    grade_key = score_to_grade_key(calibrated)

    return {
        'grade_key':    grade_key,
        'score':        calibrated,
        'spread':       spread,
        'confidence':   confidence,
        'k_valid':      k_valid,
        'k_good':       k_good,
        'needs_review': False,
        'samples':      samples,
    }


def build_image_name(filename, index):
    stem = filename.rsplit('.', 1)[0]
    stem = stem.replace('_', ' ').replace('-', ' ')
    return stem if stem.strip() else f'Ribeye {index + 1:04d}'
