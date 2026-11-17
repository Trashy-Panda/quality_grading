// Coarse warp: the rough quad, grown by GRID.grow, drawn at CW x CH. The lattice fit does the precise work afterwards.
export async function coarseWarp(srcCanvas, corners) {
  const cv = await loadCV(); const [TL, TR, BR, BL] = corners, g = GRID.grow;
  const at = (u, v) => ({ x: (TL.x * (1 - u) + TR.x * u) * (1 - v) + (BL.x * (1 - u) + BR.x * u) * v, y: (TL.y * (1 - u) + TR.y * u) * (1 - v) + (BL.y * (1 - u) + BR.y * u) * v });
  const q = [at(-g.l, -g.t), at(1 + g.r, -g.t), at(1 + g.r, 1 + g.b), at(-g.l, 1 + g.b)];
  const src = cv.imread(srcCanvas), dst = new cv.Mat();
  const s = cv.matFromArray(4, 1, cv.CV_32FC2, q.flatMap(p => [p.x, p.y])), d = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, GRID.CW, 0, GRID.CW, GRID.CH, 0, GRID.CH]);
  const M = cv.getPerspectiveTransform(s, d);
  cv.warpPerspective(src, dst, M, new cv.Size(GRID.CW, GRID.CH), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
  const canvas = document.createElement('canvas'); canvas.width = GRID.CW; canvas.height = GRID.CH; cv.imshow(canvas, dst);
  [src, dst, s, d, M].forEach(m => m.delete());
  return canvas;
}

