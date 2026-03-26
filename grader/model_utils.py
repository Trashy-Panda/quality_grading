"""
model_utils.py — preprocessing and grade mapping helpers
for the USDA ribeye grading pipeline.
"""

import numpy as np
from PIL import Image

# ----------------------------------------------------------------
#  Grade mapping: marbling score (0–1100) → website grade key
#  Based on USDA marbling score scale:
#    Practically Devoid: 100–199  → STD
#    Traces:             200–299  → SE_LO
#    Slight:             300–399  → SE range
#    Small:              400–499  → CH_LO
#    Modest:             500–599  → CH_AVG
#    Moderate:           600–699  → CH_HI
#    Slightly Abundant:  700–799  → PR_LO
#    Moderately Abundant:800–899  → PR_AVG
#    Abundant:           900–1100 → PR_HI
# ----------------------------------------------------------------
SCORE_THRESHOLDS = [
    (900, 'PR_HI'),
    (800, 'PR_AVG'),
    (700, 'PR_LO'),
    (600, 'CH_HI'),
    (500, 'CH_AVG'),
    (400, 'CH_LO'),
    (350, 'SE_HI'),
    (300, 'SE_AVG'),
    (200, 'SE_LO'),
    (0,   'STD'),
]

# ----------------------------------------------------------------
#  Classification model label mapping
#
#  best_model.py uses: label_mapping = {label: idx for idx, label in
#    enumerate(df['Grade Category'].unique())}
#  The order depends on which grade appears FIRST in the CSV.
#
#  The most common CSV orderings observed in the hackathon data:
#    Option A (grades appear in ascending quality order):
#      0=Select, 1=Low Choice, 2=Upper 2/3 Choice, 3=Prime
#    Option B (grades appear in descending order):
#      0=Prime, 1=Upper 2/3 Choice, 2=Low Choice, 3=Select
#
#  We default to Option A. If grades look wrong after a test run,
#  pass --class-order reverse on the CLI to flip to Option B.
# ----------------------------------------------------------------
CLASS_INDEX_TO_GRADE_A = {
    0: 'SE_AVG',   # Select
    1: 'CH_LO',    # Low Choice
    2: 'CH_HI',    # Upper 2/3 Choice
    3: 'PR_AVG',   # Prime
}

CLASS_INDEX_TO_GRADE_B = {
    0: 'PR_AVG',   # Prime
    1: 'CH_HI',    # Upper 2/3 Choice
    2: 'CH_LO',    # Low Choice
    3: 'SE_AVG',   # Select
}

# Default
CLASS_INDEX_TO_GRADE = CLASS_INDEX_TO_GRADE_A

GRADE_LABELS = {
    'PR_HI':  'High Prime',
    'PR_AVG': 'Average Prime',
    'PR_LO':  'Low Prime',
    'CH_HI':  'High Choice',
    'CH_AVG': 'Average Choice',
    'CH_LO':  'Low Choice',
    'SE_HI':  'High Select',
    'SE_AVG': 'Average Select',
    'SE_LO':  'Low Select',
    'STD':    'Standard',
    'COM':    'Commercial',
}


def score_to_grade_key(score):
    """Convert a predicted marbling score (0–1100) to a website grade key."""
    score = float(score)
    for threshold, key in SCORE_THRESHOLDS:
        if score >= threshold:
            return key
    return 'STD'


def detect_output_type(model):
    """
    Return 'regression' if the model outputs a single scalar per image,
    or 'classification' if it outputs class probabilities.
    """
    output_shape = model.output_shape
    # output_shape is (batch, units) for Dense layers
    if len(output_shape) == 2 and output_shape[-1] == 1:
        return 'regression'
    if len(output_shape) == 2 and output_shape[-1] > 1:
        return 'classification'
    # Fallback: treat flat output as regression
    return 'regression'


def get_grade_and_confidence(raw_output, output_type):
    """
    Given raw model output for a single image, return (grade_key, confidence).
    - regression:     raw_output is a scalar score
    - classification: raw_output is a probability array
    """
    if output_type == 'regression':
        score = float(raw_output)
        grade_key = score_to_grade_key(score)
        # Map score to a rough confidence: distance from nearest boundary
        # Clamp score to valid range first
        score = max(0.0, min(1100.0, score))
        confidence = _regression_confidence(score)
        return grade_key, round(confidence, 4), round(score, 1)
    else:
        probs = np.array(raw_output)
        idx = int(np.argmax(probs))
        confidence = float(probs[idx])
        grade_key = CLASS_INDEX_TO_GRADE.get(idx, 'SE_AVG')
        # Approximate marbling score from class midpoints
        approx_scores = {0: 350, 1: 450, 2: 600, 3: 800}
        approx_score = approx_scores.get(idx, 500)
        return grade_key, round(confidence, 4), approx_score


def _regression_confidence(score):
    """
    Estimate confidence for a regression prediction based on how far the
    predicted score is from the nearest grade boundary.
    Boundaries at 200, 300, 350, 400, 500, 600, 700, 800, 900.
    Returns a value in [0.5, 1.0].
    """
    boundaries = [200, 300, 350, 400, 500, 600, 700, 800, 900]
    min_dist = min(abs(score - b) for b in boundaries)
    # Each grade band is ~50–100 pts wide; normalize distance to [0, 1]
    band_half = 50.0
    confidence = 0.5 + 0.5 * min(min_dist / band_half, 1.0)
    return confidence


def preprocess_image(image_path, target_size=(224, 224)):
    """
    Load and preprocess a single image for model inference.
    Matches the coenpetto hackathon pipeline:
      - Open with PIL
      - Convert to RGB (handles grayscale, RGBA, etc.)
      - Resize to target_size
      - Normalize pixel values to [0, 1]
    Returns a numpy array of shape (H, W, 3).
    """
    img = Image.open(image_path)
    img = img.convert('RGB')
    img = img.resize(target_size, Image.LANCZOS)
    arr = np.array(img, dtype=np.float32)
    arr /= 255.0
    return arr


def build_image_name(filename, index):
    """Generate a human-readable image name from the filename."""
    stem = filename.rsplit('.', 1)[0]  # strip extension
    # Clean up underscores/hyphens for display
    stem = stem.replace('_', ' ').replace('-', ' ')
    return stem if stem else f'Ribeye {index + 1:04d}'
