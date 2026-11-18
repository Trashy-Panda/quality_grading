---
paths:
  - "beefgrading.study/**/*.html"
  - "beefgrading.study/**/*.css"
  - "beefgrading.study/**/*.js"
---
# Frontend rules
- Before renaming/removing an id or class, grep the .js files and the inline
  script in index.html: app.js, weekly.js, leaderboard.js, powerrank.js bind many.
- Three duplicated screen routers (app.js, leaderboard.js, powerrank.js) toggle
  `.hidden`; scroll.js watches screens with a MutationObserver. Don't break them.
- A `both`-fill animation that ends on opacity must end on the element's resting
  opacity (`p-inkSoak` + `--rest-opacity`), or it silently overrides the stylesheet.
- Banned: side-stripe accents (border-left or inset box-shadow spines), gradient
  text, em dashes in copy, pure #000/#fff literals (the white ground is the `--ui-board`/`--ui-ground`/`--ui-sheet` tokens), cards nested in cards.
- Contrast: body 4.5:1, large 3:1. Over photography, measure against the actual
  composited pixels, not the flat token.
- `aria-label` on icon-only buttons; visible `:focus-visible` on every control;
  44px minimum touch targets on the drill.
- After edits: preflight exits 0, `node --check` on touched JS,
  `grep -n "onerror=\|onclick=" *.html *.js` returns nothing.
- UI test hooks: `?wktest=notsetup|signedout|nottaken|submitted|past`,
  `#prtest`, `#prlocal`; reach setup via `#landing-setup-btn`. Shots:
  `.claude/tools/cdp-shot.mjs` (each call is a fresh profile; `--reload` tests persistence).
- v3 UI (docs/DESIGN.md): app screens size in rem (the root scales above 1500px); px-designed landing and Power rankings boxes use `calc(var(--u) * N)`. Radii come from `--ui-r-*` tokens (inner = outer minus gap), never literals; box edges are translucent `--ui-edge*` ink; new colour in `oklch()`.
