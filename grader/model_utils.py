"""
model_utils.py — color-analysis marbling grader + grade mapping helpers.

No training data or model file required. Uses pixel-level fat/lean
segmentation in HSV color space to estimate intramuscular fat ratio,
then maps it to a USDA marbling score and website grade key.

Technique: same core approach as USDA's Computer Vision System (CVS)
and MatthewSchimmel's hackathon entry — identify fat pixels vs lean
pixels, compute ratio, convert to grade.
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

GRADE_LABELS = {
    'PR_HI':  'High Prime',    'PR_AVG': 'Average Prime', 'PR_LO':  'Low Prime',
    'CH_HI':  'High Choice',   'CH_AVG': 'Average Choice','CH_LO':  'Low Choice',
    'SE_HI':  'High Select',   'SE_AVG': 'Average Select','SE_LO':  'Low Select',
    'STD':    'Standard',      'COM':    'Commercial',
}


def score_to_grade_key(score):
    """Convert a marbling score (0–1100) to a website grade key."""
    score = float(score)
    for threshold, key in SCORE_THRESHOLDS:
        if score >= threshold:
            return key
    return 'STD'


def _marbling_ratio_to_score(ratio):
    """
    Map intramuscular fat ratio (0.0–1.0) to USDA marbling score (0–1100).
    Piecewise linear interpolation calibrated to USDA marbling descriptions.
    """
    breakpoints = [
        (0.00,  100),   # Practically devoid
        (0.02,  200),   # Traces
        (0.045, 300),   # Slight—
        (0.07,  400),   # Slight+  / Small—
        (0.10,  500),   # Small+   / Modest—
        (0.145, 600),   # Modest+  / Moderate—
        (0.185, 700),   # Moderate+/ Slightly Abundant—
        (0.245, 800),   # Slightly Abundant+ / Mod. Abundant—
        (0.305, 900),   # Mod. Abundant+ / Abundant—
        (0.40,  1100),  # Abundant+
    ]
    for i in range(len(breakpoints) - 1):
        r0, s0 = breakpoints[i]
        r1, s1 = breakpoints[i + 1]
        if ratio <= r1:
            t = (ratio - r0) / (r1 - r0)
            return round(s0 + t * (s1 - s0), 1)
    return 1100.0


def analyze_marbling(image_path):
    """
    Analyze a ribeye image and return (grade_key, confidence, marbling_score).

    Algorithm:
    1. Load image → convert to both RGB and HSV
    2. Remove background: dark pixels (V < 35) and very bright background (V > 240, S < 20)
    3. Within the ribeye area:
       - Lean meat: red-pink pixels (Hue 0–20, S > 50)
       - Intramuscular fat: cream/white pixels (S < 55, V > 140)
    4. Marbling ratio = fat / (fat + lean)
    5. Map ratio → score → grade key
    """
    try:
        pil_img = Image.open(image_path).convert('RGB')
    except Exception as e:
        raise ValueError(f'Cannot open image {image_path}: {e}')

    img_rgb = np.array(pil_img, dtype=np.float32)

    # Convert to HSV using numpy (avoid cv2 dependency)
    img_hsv = _rgb_to_hsv(img_rgb)
    H = img_hsv[:, :, 0]   # 0–360
    S = img_hsv[:, :, 1]   # 0–1
    V = img_hsv[:, :, 2]   # 0–255

    # --- Step 1: foreground mask (exclude background) ---
    # Dark background: V < 35
    dark_bg = V < 35
    # Very bright / desaturated background (white backdrop, if any): V > 235 and S < 0.08
    bright_bg = (V > 235) & (S < 0.08)
    foreground = ~(dark_bg | bright_bg)

    # --- Step 2: lean meat mask ---
    # Red-pink: Hue 0–22 or 340–360 (wraps), moderate-high saturation, moderate value
    red_hue = ((H <= 22) | (H >= 340))
    lean_mask = foreground & red_hue & (S > 0.18) & (V > 50) & (V < 235)

    # --- Step 3: intramuscular fat mask ---
    # Cream/white: low saturation, high brightness, within foreground
    # Slightly warm (yellow-cream): Hue 15–55, S 0.05–0.40, V > 140
    fat_hue = (H >= 10) & (H <= 60)
    fat_mask = foreground & (
        ((S < 0.38) & (V > 140) & fat_hue) |       # cream/yellow fat
        ((S < 0.22) & (V > 155))                    # near-white fat
    ) & ~lean_mask  # don't double-count

    fat_pixels  = int(np.sum(fat_mask))
    lean_pixels = int(np.sum(lean_mask))
    total_muscle = fat_pixels + lean_pixels

    if total_muscle < 200:
        # Too few pixels found — image may be background-only or very dark
        return 'SE_AVG', 0.3, 350.0

    ratio = fat_pixels / total_muscle
    score = _marbling_ratio_to_score(ratio)
    grade_key = score_to_grade_key(score)

    # Confidence: how far the ratio is from the nearest grade boundary
    confidence = _ratio_confidence(ratio)

    return grade_key, round(confidence, 4), round(score, 1)


def _ratio_confidence(ratio):
    """Estimate confidence 0.5–1.0 based on distance from nearest grade boundary."""
    # Boundaries in ratio space (correspond to score thresholds)
    boundaries = [0.02, 0.045, 0.07, 0.10, 0.145, 0.185, 0.245, 0.305]
    if not boundaries:
        return 0.7
    min_dist = min(abs(ratio - b) for b in boundaries)
    band = 0.025  # typical half-bandwidth between boundaries
    return round(0.5 + 0.5 * min(min_dist / band, 1.0), 4)


def _rgb_to_hsv(img_rgb):
    """
    Convert an (H, W, 3) float32 RGB array (0–255) to HSV.
    Returns H: 0–360, S: 0–1, V: 0–255.
    Pure numpy — no OpenCV required.
    """
    r = img_rgb[:, :, 0] / 255.0
    g = img_rgb[:, :, 1] / 255.0
    b = img_rgb[:, :, 2] / 255.0

    cmax = np.maximum(np.maximum(r, g), b)
    cmin = np.minimum(np.minimum(r, g), b)
    delta = cmax - cmin

    # Value
    V = cmax * 255.0

    # Saturation
    S = np.where(cmax > 0, delta / cmax, 0.0)

    # Hue
    H = np.zeros_like(r)
    mask_r = (cmax == r) & (delta > 0)
    mask_g = (cmax == g) & (delta > 0)
    mask_b = (cmax == b) & (delta > 0)
    H[mask_r] = 60.0 * (((g[mask_r] - b[mask_r]) / delta[mask_r]) % 6)
    H[mask_g] = 60.0 * (((b[mask_g] - r[mask_g]) / delta[mask_g]) + 2)
    H[mask_b] = 60.0 * (((r[mask_b] - g[mask_b]) / delta[mask_b]) + 4)

    return np.stack([H, S, V], axis=2)


def preprocess_image(image_path, target_size=(224, 224)):
    """Load and resize image for display/storage use (not needed for analysis)."""
    img = Image.open(image_path).convert('RGB')
    img = img.resize(target_size, Image.LANCZOS)
    return np.array(img, dtype=np.float32) / 255.0


def build_image_name(filename, index):
    """Generate a human-readable image name from the filename."""
    stem = filename.rsplit('.', 1)[0]
    stem = stem.replace('_', ' ').replace('-', ' ')
    return stem if stem.strip() else f'Ribeye {index + 1:04d}'
