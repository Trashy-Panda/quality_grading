# beefgrading.study design system (locked, v2 "Lab")

Chosen 2026-11-03 from three comps. Reference comps (static, not the site):
`.hallmark/comps/b-lab.html` (the base system) and the rankings half of
`.hallmark/comps/a-scoreboard.html` (the Power rankings variant).

Idea: **every score is a reading on a calibrated scale.** The app reads like a
precise grading instrument: light, exact, figures set as measurements, data drawn
as charts, not described in sentences. Power rankings is the one place that turns
up the volume: a scoreboard.

Tokens live in `style.css` `:root`, the single source of truth. Never a literal
colour or font-family below it. **The landing page and hero are kept as they are**
(the user likes them): Lab tokens are new names (`--lab-*`, `--sb-*`); never
repoint the existing landing tokens (`--paper`, `--band-*`, `--poster-*`, ...).

## Retired (Furrow v1)
Notebook `.entry` cards with ink head bars, the 8px notebook grid, moulded keys
with lit top edges, ruled-list-only screens, cards floating in an empty page.
Do not reintroduce them on app screens.

## Material (Lab, all app screens)
- Ground `--lab-bg` (near-white warm). Panels `--lab-panel`: 1px `--lab-rule`
  border, `--lab-radius` (12px), no shadow. Panels sit on the ground, never
  inside each other. Inner divisions are 1px `--lab-rule-2` hairlines.
- Ink `--ink` for type and for the one dark panel per screen (`--ink` fill,
  `--on-ink` text): the "your result" readout. On ink, accents use `--red-lift`.
- One signal: scarlet `--red`: the primary action, the current selection, and
  **you** (your dot, your row, your rank). Never decoration, never body type.
- Data colours: `--lab-ok` green = exact / up, `--lab-near` straw = close,
  `--red-lift` / `--red` = miss / down, `--lab-dot` grey = everyone else.
  Rank shading for heatmaps: `--lab-heat-1` (best) to `--lab-heat-5` (worst),
  a single-hue ink ramp, so scarlet stays meaning "you" and "act".
- Readouts: a row of 2 to 4 measured values (label 13px over a mono figure) in
  one panel split by hairlines. This replaces stat cards.

## Material (Scoreboard, Power rankings only)
- The screen is an ink stage (`--sb-bg` = `--ink`, `--sb-panel`, `--sb-panel-2`,
  hairlines `--sb-hair`), `--on-ink` type, `--on-ink-dim` secondary.
- Display type Red Hat Display 900, tight (-0.045em). Rank numerals huge (44px
  rows, 32px from 4th down); No. 1 carries the scarlet (`--red` slab or
  `--red-lift` bar).
- Rows are lower-thirds: tall, ruled by `--sb-hair`, big rank, bold name,
  bar, mono figure. Movement in `--sb-up` / `--sb-down`.
- Charts on the stage use `--on-ink` marks, `--sb-grid` gridlines, scarlet for
  the leader or the highlighted school.

## Type
- Display: Red Hat Display. Lab heads 600, -0.035em. Scoreboard heads 900.
  Sentence case. Heads one weight and one colour.
- Body: Red Hat Text 400/500/600, 16px minimum for reading text.
- Labels, table heads, tabs, nav: Red Hat Text 500, 13 to 14px, sentence case,
  untracked, never uppercase.
- Figures: Red Hat Mono, `tabular-nums`, right-aligned in columns: scores,
  points, percents, ranks in tables, ratings, dates, counts, axis tick labels.
- Wordmark only: Yellowtail for "Grading".

## Charts (drawn in SVG/CSS from real data, never images)
- Every chart: a visible title (h2/h3), an `aria-label` or visually hidden
  summary sentence, axis ticks in mono 12px, no gridline heavier than a hairline.
- Bars are a track + inner element sized with `transform: scaleX()`.
- Dot plots: one dot per entity on a single axis; label only the top three and
  you (or the selected school); stagger labels so none overlap.
- Never invent a number. Anything a chart shows is computed from Firestore data
  already loaded on the page.

## Controls
- Buttons: 48px tall, 8px radius, flat fill. Primary = `--red` fill,
  `--lab-panel` text, hover darkens, active `translateY(1px)`. Secondary =
  `--lab-panel` fill, 1px `--lab-rule` border. On the scoreboard, secondary =
  `--sb-panel` fill.
- Segmented control: a 3px-padded `--lab-panel` track with a 1px border;
  selected segment = `--ink` fill, `--on-ink` text (on the scoreboard, selected =
  `--on-ink` fill, `--ink` text).
- Tabs (category switchers): `role="tablist"`, arrow keys, selected = ink fill.
- States on every control: rest, hover, focus-visible (2px `--red` outline,
  offset 2px, instant; `--red-lift` on ink), active, disabled (fill + text +
  cursor + `disabled` attribute), loading where it applies. 44px touch targets.
- Links: ink text, scarlet underline.

## Motion
State only: hover tints, presses, opacity crossfades at `--dur-base`.
`transform` and `opacity` only, never `transition: all`, reduced-motion path for
everything, no scroll-driven effects, no load-in choreography on data.

## Layout
- App screens: `--lab-measure` (1200px) centred, 16px gutters on phones
  (`width: min(1200px, 100% - 32px)`, never `100vw`).
- Header pattern: title + one-line sub on the left, the readout on the right;
  under it an action row (segmented control, status sentence, primary button).
- Stack to one column under 860px; the dark result readout moves above tables.
- Every data region has four states: loading (skeleton in its shape), empty
  (what goes here + the one action), error, full.
- No eyebrows, no "01 /" numbering, no arrows glued to labels, no middle-dot
  meta strings, no em dashes in copy.
