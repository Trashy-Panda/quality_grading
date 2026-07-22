"""
cv_marbling.py — free, model-free HSV heuristic for a rough marbling/fat-ratio
signal. This is Option B2 from grader/AUDIT_AND_REDESIGN.md.

HONEST SCOPE: this is NOT a calibrated grader. It estimates, per image, the
fraction of "fat-like" pixels within the largest "lean-like" (deep red)
connected blob — a proxy for intramuscular fat percentage. On uncontrolled
contest photography (varying lighting/flash/angle) this signal is noisy and
NOT proven to correlate tightly with true marbling score. Its two legitimate
uses in this project are:
  1. Stratified sampling — pick eval images spanning the apparent fat-ratio
     range so the eval set isn't accidentally all mid-range (§6 of the audit).
  2. A free Spearman-rank check: does Claude's continuous score at least
     move in the same direction as this heuristic across many images?
It is explicitly NOT used as a grader, a calibration input, or a bias
correction in the redesigned pipeline (model_utils.py never imports this).

No scipy/OpenCV dependency — connected components via a plain BFS flood fill
on a downsampled image (fast enough at ~256px).
"""

import os
from collections import deque

import numpy as np
from PIL import Image


def _to_hsv_array(img, max_side=256):
    img = img.convert('RGB')
    if max(img.size) > max_side:
        img.thumbnail((max_side, max_side), Image.LANCZOS)
    hsv = np.array(img.convert('HSV'), dtype=np.float32)
    h = hsv[:, :, 0] / 255.0 * 360.0   # 0-360
    s = hsv[:, :, 1] / 255.0            # 0-1
    v = hsv[:, :, 2]                    # 0-255
    return h, s, v


def _largest_component(mask):
    """Return a boolean mask of the largest 4-connected True region, via BFS."""
    visited = np.zeros_like(mask, dtype=bool)
    best_mask = None
    best_size = 0
    rows, cols = mask.shape

    it = np.argwhere(mask & ~visited)
    for start in it:
        r0, c0 = int(start[0]), int(start[1])
        if visited[r0, c0]:
            continue
        # BFS this component
        q = deque([(r0, c0)])
        visited[r0, c0] = True
        comp_cells = [(r0, c0)]
        while q:
            r, c = q.popleft()
            for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                nr, nc = r + dr, c + dc
                if 0 <= nr < rows and 0 <= nc < cols and mask[nr, nc] and not visited[nr, nc]:
                    visited[nr, nc] = True
                    q.append((nr, nc))
                    comp_cells.append((nr, nc))
        if len(comp_cells) > best_size:
            best_size = len(comp_cells)
            best_mask = comp_cells

    if best_mask is None:
        return np.zeros_like(mask, dtype=bool), 0

    out = np.zeros_like(mask, dtype=bool)
    rs, cs = zip(*best_mask)
    out[np.array(rs), np.array(cs)] = True
    return out, best_size


def estimate_fat_ratio(image_path_or_url, from_url=False, max_side=256):
    """
    Returns:
      {
        'ok': bool,
        'fat_ratio': float or None,   # fraction of fat-like px within the eye ROI bbox
        'roi_pixels': int,            # size of the largest lean-blob (sanity check)
        'bbox': (r0, r1, c0, c1) or None,
      }
    """
    try:
        if from_url:
            import requests
            import io
            r = requests.get(image_path_or_url, timeout=20)
            r.raise_for_status()
            img = Image.open(io.BytesIO(r.content))
        else:
            img = Image.open(image_path_or_url)
    except Exception:
        return {'ok': False, 'fat_ratio': None, 'roi_pixels': 0, 'bbox': None}

    h, s, v = _to_hsv_array(img, max_side=max_side)

    # Background: near-white (bright, desaturated) or near-black (very dark).
    background = ((v > 210) & (s < 0.18)) | (v < 20)

    # Lean (deep red muscle): hue near 0/360 (wraps), reasonably saturated, mid-bright.
    hue_red = (h <= 25) | (h >= 335)
    lean = hue_red & (s > 0.30) & (v > 40) & (v < 210) & ~background

    if lean.sum() < 200:  # too little detected muscle to be meaningful
        return {'ok': False, 'fat_ratio': None, 'roi_pixels': int(lean.sum()), 'bbox': None}

    roi_mask, roi_size = _largest_component(lean)
    if roi_size < 200:
        return {'ok': False, 'fat_ratio': None, 'roi_pixels': roi_size, 'bbox': None}

    rows_idx, cols_idx = np.where(roi_mask)
    r0, r1 = rows_idx.min(), rows_idx.max()
    c0, c1 = cols_idx.min(), cols_idx.max()

    box_h = h[r0:r1 + 1, c0:c1 + 1]
    box_s = s[r0:r1 + 1, c0:c1 + 1]
    box_v = v[r0:r1 + 1, c0:c1 + 1]
    box_bg = background[r0:r1 + 1, c0:c1 + 1]

    fat = (box_s < 0.35) & (box_v > 140) & ~box_bg
    lean_in_box = ((box_h <= 25) | (box_h >= 335)) & (box_s > 0.30) & (box_v > 40) & (box_v < 210) & ~box_bg

    fat_px = int(fat.sum())
    lean_px = int(lean_in_box.sum())
    denom = fat_px + lean_px
    fat_ratio = (fat_px / denom) if denom > 0 else None

    return {
        'ok': fat_ratio is not None,
        'fat_ratio': fat_ratio,
        'roi_pixels': roi_size,
        'bbox': (int(r0), int(r1), int(c0), int(c1)),
    }


if __name__ == '__main__':
    import sys
    import glob

    paths = sys.argv[1:] if len(sys.argv) > 1 else []
    if not paths:
        print('Usage: python cv_marbling.py <image_path> [image_path ...]')
        sys.exit(1)

    for p in paths:
        for f in sorted(glob.glob(p)):
            res = estimate_fat_ratio(f)
            name = os.path.basename(f)
            if res['ok']:
                print(f'{name:40s}  fat_ratio={res["fat_ratio"]:.4f}  roi_px={res["roi_pixels"]}')
            else:
                print(f'{name:40s}  FAILED (roi_px={res["roi_pixels"]})')
