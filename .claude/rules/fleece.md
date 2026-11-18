---
paths:
  - "beefgrading.study/fleece/**"
  - "fleece-grader/**"
---
# Fleece grader rules
- Fixtures: `fleece-grader/assets/test/` (synth*.jpg + truth.json tracked; `real/`
  13 student sheets, `keys/` official-key photos, `excluded/` are gitignored and private).
  truth.json labels bubbles for only 3 real sheets; hand-truth.json = Written + margin digits;
  the `keys/` sample rail's truth lives in dev/keyscan-check.js.
- Regression drivers (run via `.claude/tools/cdp-shot.mjs`): dev/eval.html (bubbles),
  hand-eval.html, list-eval.html, keyscan-check.js, hand-review-check.js, rails-app-check.js.
  Re-run the ones your change could touch and compare numbers with the last commit message.
- UI hooks: manual key buttons use `data-act="key"`; the service worker registers on
  localhost only with `?sw=1` (needed for offline checks).
- Handwriting (digits.js) is advisory: bubbles count; OCR never changes an answer without a tap.
- Precache every new shipped file in `fleece/sw.js`; bump its cache version once per release.
