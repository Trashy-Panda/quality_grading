"""Trace a USDA reference ribeye into a survey plate SVG.

Masks: background (flood from the edges), lean (red), fat (the rest of the cut).
Marbling = fat inside the closed lean "eye"; outer fat = fat outside it.
Contours = marbling density, blurred, traced with marching squares.
Usage: python survey.py <in.jpg> <out.svg> <out.json>
"""
import json, sys
import numpy as np
from PIL import Image, ImageFilter

src, out_svg, out_json = sys.argv[1:4]
im = Image.open(src).convert('RGB')
W, H = im.size
S = 3  # work at 1/3 scale for speed and smoother lines
w, h = W // S, H // S
a = np.asarray(im.resize((w, h), Image.LANCZOS)).astype(np.float32) / 255
r, g, b = a[..., 0], a[..., 1], a[..., 2]
mx, mn = a.max(-1), a.min(-1)
sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)

# background: very light, very low saturation, connected to the border
bgish = (mn > 0.90) & (sat < 0.06)
bg = np.zeros_like(bgish)
stack = [(0, x) for x in range(w)] + [(h - 1, x) for x in range(w)] + \
        [(y, 0) for y in range(h)] + [(y, w - 1) for y in range(h)]
while stack:
    y, x = stack.pop()
    if 0 <= y < h and 0 <= x < w and bgish[y, x] and not bg[y, x]:
        bg[y, x] = True
        stack += [(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)]
cut = ~bg

lean = cut & (r > 0.45) & (g < 0.45) & (r - g > 0.25)
fat = cut & ~lean


def blur(m, rad):
    img = Image.fromarray((m * 255).astype(np.uint8))
    return np.asarray(img.filter(ImageFilter.GaussianBlur(rad))).astype(np.float32) / 255


# the eye: lean closed over its flecks (blur + threshold acts as a closing)
eye = blur(lean.astype(np.float32), 9) > 0.55
eye_core = blur(eye.astype(np.float32), 6) > 0.85      # eroded: keep off the eye edge


def components(m):
    lab = np.zeros(m.shape, np.int32)
    sizes = [0]
    n = 0
    for y0, x0 in zip(*np.nonzero(m)):
        if lab[y0, x0]:
            continue
        n += 1
        lab[y0, x0] = n
        st = [(y0, x0)]
        c = 0
        while st:
            y, x = st.pop()
            c += 1
            for yy2, xx2 in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy2 < h and 0 <= xx2 < w and m[yy2, xx2] and not lab[yy2, xx2]:
                    lab[yy2, xx2] = n
                    st.append((yy2, xx2))
        sizes.append(c)
    return lab, np.array(sizes)


lab, sizes = components(fat)
big_px = cut.sum() * 0.004                      # a fleck is small; seam and cap are big
small = sizes[lab] < big_px
marbling = fat & small & eye_core
big_fat = fat & ~small

dens = blur(marbling.astype(np.float32), 9)
dens[~eye] = 0
outer_fat = big_fat


def march(field, level):
    """Marching squares -> list of polylines (in work-pixel coords)."""
    f = field
    segs = []
    for y in range(f.shape[0] - 1):
        row0, row1 = f[y], f[y + 1]
        for x in range(f.shape[1] - 1):
            tl, tr, br, bl = row0[x], row0[x + 1], row1[x + 1], row1[x]
            idx = (tl > level) * 8 + (tr > level) * 4 + (br > level) * 2 + (bl > level)
            if idx in (0, 15):
                continue

            def lerp(p, q, vp, vq):
                t = (level - vp) / (vq - vp) if vq != vp else 0.5
                return (p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]))
            T = lerp((x, y), (x + 1, y), tl, tr)
            R = lerp((x + 1, y), (x + 1, y + 1), tr, br)
            B = lerp((x, y + 1), (x + 1, y + 1), bl, br)
            L = lerp((x, y), (x, y + 1), tl, bl)
            table = {1: [(L, B)], 2: [(B, R)], 3: [(L, R)], 4: [(T, R)], 5: [(L, T), (B, R)],
                     6: [(T, B)], 7: [(L, T)], 8: [(L, T)], 9: [(T, B)], 10: [(T, R), (L, B)],
                     11: [(T, R)], 12: [(L, R)], 13: [(B, R)], 14: [(L, B)]}
            segs += table[idx]
    # join segments into polylines
    key = lambda p: (round(p[0], 3), round(p[1], 3))
    ends = {}
    for i, (p, q) in enumerate(segs):
        ends.setdefault(key(p), []).append(i)
        ends.setdefault(key(q), []).append(i)
    used = [False] * len(segs)
    lines = []
    for i in range(len(segs)):
        if used[i]:
            continue
        used[i] = True
        line = [segs[i][0], segs[i][1]]
        for direction in (1, 0):
            while True:
                tip = line[-1] if direction else line[0]
                nxt = None
                for j in ends.get(key(tip), []):
                    if not used[j]:
                        nxt = j
                        break
                if nxt is None:
                    break
                used[nxt] = True
                p, q = segs[nxt]
                other = q if key(p) == key(tip) else p
                if direction:
                    line.append(other)
                else:
                    line.insert(0, other)
        if len(line) >= 8:
            lines.append(line)
    return lines


def path(lines, step=3):
    d = []
    for ln in lines:
        pts = ln[::step] + [ln[-1]]
        d.append('M' + ' L'.join(f'{x * S:.0f},{y * S:.0f}' for x, y in pts))
    return ' '.join(d)


cut_f = blur(cut.astype(np.float32), 1.5)
eye_f = blur(eye.astype(np.float32), 2)
top = float(dens.max())
levels = [top * k / 9 for k in range(1, 9)]
contours = [(lv, path(march(dens, lv))) for lv in levels]

# pins: densest marbling, biggest seam-fat blob inside the cut but outside the eye, fat cap = outer fat on the cut edge
yy, xx = np.unravel_index(np.argmax(dens), dens.shape)
edge = blur(cut.astype(np.float32), 4) < 0.98           # near the cut's outline
touch = set(np.unique(lab[big_fat & edge]).tolist()) - {0}
cap_lab = np.isin(lab, list(touch)) & big_fat
cap = cap_lab & (blur(cut.astype(np.float32), 10) > 0.9)          # thick part of the cap, off the very rim
seam = big_fat & ~cap_lab & eye                                    # big fat inside, not on the rim
if seam.sum() == 0:
    seam = big_fat & eye_core


def centroid(m):
    ys, xs = np.nonzero(m)
    if len(xs) == 0:
        return None
    cy, cx = ys.mean(), xs.mean()
    k = np.argmin((ys - cy) ** 2 + (xs - cx) ** 2)   # snap to a real pixel of the mask
    return round(float(xs[k] * S / W * 100), 1), round(float(ys[k] * S / H * 100), 1)


pins = {
    'marbling': (round(float(xx * S / W * 100), 1), round(float(yy * S / H * 100), 1)),
    'seam': centroid(seam),
    'cap': centroid(cap),
}
stats = {
    'marbling_pct_of_eye': round(float(marbling.sum() / max(eye_core.sum(), 1) * 100), 2),
    'pins_pct': pins,
}

svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" fill="none" stroke-linecap="round" stroke-linejoin="round">',
       f'<path class="sv-cut" d="{path(march(cut_f, 0.5))}"/>',
       f'<path class="sv-eye" d="{path(march(eye_f, 0.5))}"/>']
for i, (lv, d) in enumerate(contours):
    svg.append(f'<path class="sv-c sv-c{i + 1}" d="{d}"/>')
svg.append('</svg>')
open(out_svg, 'w').write('\n'.join(svg))
json.dump(stats, open(out_json, 'w'), indent=1)
print(json.dumps(stats), 'contours', len(contours), 'svg bytes', sum(len(s) for s in svg))
