# beefgrading.study design system (locked, v3 "Field Guide Stage")

Chosen 2026-11-17 from two comps. The reference comp (static, not the site) is
`.hallmark/v3/comp-a.html`; its fleece screens (key, scan, review, results) are
approved as drawn. Its language is the body UI for every app screen on the site
and in the fleece grader.

Idea: **the thing you are judging is the stage.** The photo, the sheet or the
number fills the screen. Controls sit on one surface at thumb height (the sheet).
Choices are rows, not chips. What you picked and what was right highlight in
place, on the row and on the photo, with no modal and no toast.

This file defines the shared language only. The setup screen layout is decided
in a separate comp (`.hallmark/v3/comp-setup.html`) and is not described here.

Tokens live in `style.css` `:root`, the single source of truth. Never a literal
colour or font-family below it. **The landing page, hero and Power rankings
scoreboard are kept as they are**: v3 tokens are new names (`--ui-*`); never
repoint the landing tokens (`--paper`, `--band-*`, `--poster-*`, ...) or the
`--lab-*` / `--sb-*` names they still use.

## Materials
- **Ground** `--ui-ground`: the screen. **Board** `--ui-board`: the page behind a
  phone-width column on wide screens. **Sheet** `--ui-sheet`: the one raised
  surface (bottom sheet, rail). White is the only app ground; these three are its tokens.
- **Ink** `--ink` for type, marks and the active control fill; `--on-ink` on it.
  Secondary text `--ink-soft`; tertiary `--ink-faint`.
- **Scarlet** `--red`: the primary action, once per screen. Never decoration, never
  body type, never a second use on the same screen. Focus ring is the exception
  (2px `--red`, offset 2px).
- **State colours**: `--ui-ok` (green) with `--ui-ok-wash` = the right answer, an
  exact read, a confirmed row. `--ui-warn` with `--ui-warn-wash` = needs a look
  (amber). A wrong answer is a tone shift plus a short explanation, never a red
  error screen. `--ui-sel` = selected, pressed and recessed fill (ink at 8%).
- **Edges** `--ui-edge` (ink 12%) and `--ui-edge-strong` (ink 28%). **Every edge is
  translucent OKLCH**: box borders, 1px and 2px rules, dividers, underlines and
  rings, so they sit correctly on bone, white and fills. No opaque tinted greys
  and no `--ink` as a border colour. A mark that must read strongly (a 2px active
  rule, a ring on a photo) is `color-mix(in oklch, var(--ink) 80%, transparent)`,
  still translucent.
- **Over photos**: `--ui-scrim` (ink 74%) behind white text, `--ui-detect` and
  `--ui-band` for detection and row bands. Measure contrast against the composited
  pixels, not the flat token.
- All new colour is `oklch()`; mixes and gradients interpolate `in oklch`. No
  gradient text. No shadow for elevation: separation is a translucent edge, a
  tint, or space.

## Blocks
- **Stage**: the content. A full-bleed photo, a list, or one large number. It
  takes the room the sheet leaves. Never wrapped in a card.
- **Sheet**: one surface, `--ui-sheet`, with a 1px `--ui-edge` top edge, no radius
  and no shadow, `padding-bottom: env(safe-area-inset-bottom)`. Everything the
  user operates sits on it: tabs, choices, fields, the primary action. A screen
  has one sheet.
- **Rows**: full-width buttons, 44px minimum (48 to 64 for choices), `--ui-sel`
  fill when selected, an optional check icon on the right. No box around a row.
  The selected row may grow taller and show its detail in place.
- **Numbers are big and few**: one result figure at display size (Red Hat
  Display 800), detail one tap away. No label-over-figure stat cells.
- **Progress** is the container: a 4px bar in `--ui-sel` filled with `--ink`, or
  a position in a list. Not a separate stat.
- **Nesting**: one level at most, and radii stay concentric (see Controls).
  Never the same fill and edge repeated at two levels.
- Page column: `width: min(1200px, 100% - 32px)` on wide screens, never `100vw`.
  Under 900px the stage and sheet stack in one column.
- Every data region has four states: loading (skeleton in its shape), empty (what
  goes here and the one action), error, full.

## Controls
- **Radii are concentric.** `--ui-r-outer` (16px) is the outer shape,
  `--ui-pad` (4px) the gap, `--ui-r-inner: max(2px, calc(var(--ui-r-outer) -
  var(--ui-pad)))` the child. A pill, segment or knob nested inside a block takes
  `--ui-r-inner`, never `999px` or a literal. Two shapes that are both fully
  round (`--ui-r-round`, 50%: the shutter ring and its disc) are concentric by
  construction. No literal `border-radius` in touched rules.
- **Primary action** (the CTA): scarlet fill, `--paper-card` text, `--ui-r-outer`,
  56px tall, label left and its state right ("Next, Length" and "Fleece 3 of 20").
  Hover `--red-deep`. Disabled: `--ui-edge-strong` fill, `--ink-soft` text,
  `disabled` attribute. One per screen, in the sheet.
- **Quiet actions**: text buttons, 14px weight 500 or 600 with an icon, no
  fill, hover `--ui-sel`. Links in the footer of a sheet are underlined in
  `--ui-edge-strong`.
- **Choice row** (radio): the row is the target. Selected = `--ui-sel` fill, weight
  600 and a check. Replaces grids of outlined chips.
- **Segmented track and stepper**: a `--ui-sel` track at `--ui-r-outer`, 4px
  padding, segments at `--ui-r-inner`, selected segment `--ui-sheet` fill. 44px
  segments.
- **Switch**: 52 by 32 track at `--ui-r-outer`, knob at `--ui-r-inner`; off
  `--ui-edge-strong`, on `--ink`.
- **Tabs**: `role="tablist"`, arrow keys, 48px, selected = weight 600, `--ink`
  text and a 2px active rule (translucent, see Materials).
- **Inputs**: 52px, `--ui-sel` fill, `--ui-r-outer`, no border. Label above at 13px
  weight 600.
- **States on every control**: rest, hover, focus-visible (2px `--red` outline,
  offset 2px, instant), active, disabled, loading where it applies. 44px touch
  targets; the row or cell takes the tap, not the glyph.
- Motion: state only (hover tints, presses, opacity crossfades at `--dur-fast`).
  `transform` and `opacity` only, never `transition: all`, a
  `prefers-reduced-motion` path for every animation, no scroll listeners, no
  load-in choreography on data.

## Type
- Display: Red Hat Display. Heads 600, `--track-display` (-0.035em), sentence
  case, one weight and one colour. Choice titles 600. Figures and the result
  number 800.
- Body and UI: Red Hat Text 400 / 500 / 600. Body 16px minimum for reading text;
  labels, tabs and quiet actions 13 to 15px, weight 500 or 600, sentence case,
  untracked, never uppercase.
- Figures: `font-variant-numeric: tabular-nums`, right-aligned in columns. Red Hat
  Mono (400 / 500) only where a column of figures needs it (tables, axis ticks).
- Wordmark only: Yellowtail for "Grading".
- **Load every weight you use.** Each page loads exactly: Red Hat Display
  600 / 700 / 800 / 900, Red Hat Text 400 / 500 / 600, Red Hat Mono 400 / 500,
  Yellowtail. A weight used in CSS but missing from the Google Fonts link renders
  as a faux-bold or a neighbour and breaks the icon stroke match. Red Hat Text
  600 and Red Hat Display 700 were used but never loaded; `index.html` now loads
  them. Check any other page that links the fonts (grep the CSS for `font-weight`
  before shipping a page). The fleece grader's self-hosted fonts must include the
  same set.
- No eyebrows, no "01 /" numbering, no middle-dot meta
  strings in headings, no em dashes in copy.

## Icons
- 24-unit viewBox, `fill: none`, `stroke: currentColor`, round caps and joins,
  sized in `em` (1.25em beside text) so they scale with the label.
- **Stroke follows the adjacent text weight**: 400 gives 1.5, 500 gives 1.75, 600
  gives 2, 700 gives 2.25 (800 and 900 text use 2.25). Set it with `--ic-sw` on
  the label that owns the icon, so the icon and its text change together. Never
  one stroke for all icons.
- Icon-only buttons carry an `aria-label`. Icons are `aria-hidden` beside text.
- The icon set is small and drawn on the grid: check, arrow, chevron down, upload,
  close, plus, minus, corner brackets, camera. No icon-in-circle headers, no emoji
  in headings.

## Ground
- One ground: white. `--ui-board`, `--ui-ground` and `--ui-sheet` are set in `:root`
  in both `style.css` and `fleece/style.css`. There is no ground switch and no
  `data-ground` attribute.
- Edges are translucent ink, so they hold on the ground.
- White ground never uses `#fff`; it uses `--lab-panel` (near-white, warm).
- Text on the white ground must still reach 4.5:1 (body) and 3:1 (large).

## Mobile
- Design at 390 first, check at 1440. Stage and sheet stack on phones; on wide
  screens the sheet becomes a rail beside the stage.
- Heights use `dvh` with a `vh` fallback declared on the line before it. No bare
  `vh` for full-screen layouts.
- The fleece grader sets `viewport-fit=cover` and pads sheets and bars with
  `env(safe-area-inset-*)`. The shutter and primary action stay inside the safe
  area and within thumb reach.
- 44px minimum touch targets everywhere; 16px minimum input text so iOS does not
  zoom.
- One-handed order: stage on top, the thing you tap at the bottom.

## Drill stage
- The carcass photo is the stage: full width, as tall as the screen allows. It is
  never inside a card and nothing sits over its centre.
- Grade choices are rows on the bottom sheet (a tablist for the grade family if
  needed, then the choice rows). One question per screen, one primary action
  ("Next", with its count).
- The **pick** highlights in place on its row (`--ui-sel`, weight 600, check). After
  answering, the **right answer** highlights in place (`--ui-ok-wash`, check, a
  short "Right answer" note). A miss is a tone shift and one explaining line, not
  an error state, and the picked row stays visible beside the right one.
- Feedback arrives in place. No modal, no toast, no interruption of the next
  photo.
- Progress is the 4px bar or the position in the run, not a stat cell.
- Touch targets on the drill are 44px or taller.

## Fleece
The fleece grader (bubble-sheet scanner) uses this language unchanged. It keeps a
self-contained copy of the shared token values (it must work offline without the
site stylesheet).
- **Key**: the stage is the list of fleeces, large numeral on the left, the
  entered values after it, the active row taller. The sheet edits the active
  field, then the primary action moves on ("Next, Length", "Fleece 3 of 20").
  Progress is a 4px bar. Blank means untouched.
- **Scan**: the stage is the viewfinder. A detected sheet is outlined with
  corner brackets and a dashed `--ui-detect` polygon; the status tag sits on
  `--ui-scrim`. The sheet holds the scan stack, name, adjust, remove and the
  shutter (a 3px ring around a scarlet disc).
- **Review**: the scan photo is the stage, drawn in SVG over the image. A dot is
  what the scan read, a ring is the official key, amber is needs a look. **Unsure
  marks are flagged on the scan photo as well as in review**: a dashed ring on
  each mark that read twice or not at all, plus an amber "Unsure, tap to fix" tag
  on the photo; tapping it opens the fix on the sheet. The review list and the
  photo agree.
- **Results**: one number at display size ("364 / 400"), points off beneath, a
  strip of bars for points off per fleece, then the sheets as rows.
- Colours of marks on the photo are translucent (Materials). Rings and dashes use
  `color-mix(in oklch, ...)` on ink or `--ui-ok`, not opaque tokens.
- Every `data-*` hook and id the script binds stays as it is; only markup and
  CSS change.

## Scoreboard (Power rankings only)
Unchanged and outside v3. The screen is an ink stage (`--sb-bg`, `--sb-panel`,
`--sb-panel-2`, hairlines `--sb-hair`), `--on-ink` type, Red Hat Display 900 at
-0.045em for rank numerals (44px rows, 32px from 4th down). No. 1 carries the
scarlet. Rows are lower-thirds ruled by `--sb-hair`. Movement in `--sb-up` and
`--sb-down`. Charts use `--on-ink` marks and `--sb-grid` gridlines.

## Charts
Drawn in SVG or CSS from real data, never images. A visible title, an `aria-label`
or hidden summary sentence, ticks at 12px, no gridline heavier than a hairline.
Bars are a track plus an element sized with `transform: scaleX()`. Never invent a
number: everything a chart shows is computed from data already loaded.

## Retired

### Furrow v1
Notebook `.entry` cards with ink head bars, the 8px notebook grid, moulded keys
with lit top edges, ruled-list-only screens, cards floating in an empty page.

### Lab v2 (2026-11-03 to 2026-11-17)
Retired because it reads as a generic app: rounded near-white cards with hairline
borders, label-over-figure stat cells, grids of outlined chips, and a full-width
red button at the bottom. Do not reintroduce on new or restyled screens. Existing
screens still carry these until Phase 4 moves them onto `--ui-*`.

- **Panel**: `--lab-panel` with a 1px opaque `--lab-rule` border, `--lab-radius`
  (12px), no shadow. Panels sat on the `--lab-bg` ground, never inside each
  other. Inner divisions were 1px `--lab-rule-2` hairlines. One dark panel per
  screen (`--ink` fill, `--on-ink` text) for the "your result" readout, with
  `--red-lift` accents.
- **Readout**: a row of 2 to 4 measured values (label 13px over a mono figure) in
  one panel split by hairlines. Replaced stat cards.
- **Data colours**: `--lab-ok` exact, `--lab-near` close, `--red-lift` / `--red`
  miss, `--lab-dot` everyone else; heat `--lab-heat-1` to `--lab-heat-5`.
- **Buttons**: 48px tall, a literal 8px radius, flat fill. Primary `--red` with
  `--lab-panel` text, hover darkens, active `translateY(1px)`. Secondary
  `--lab-panel` fill with a 1px `--lab-rule` border.
- **Chips and segmented control**: a 3px-padded `--lab-panel` track with a 1px
  border; selected segment `--ink` fill with `--on-ink` text. Grids of outlined
  chips for single choices.
- **Tabs**: ink fill when selected.
- **Header pattern**: title and one-line sub on the left, the readout on the
  right, under it an action row (segmented control, status sentence, button).
- Lab typography notes: labels and table heads Red Hat Text 500, 13 to 14px.
  Figures in Red Hat Mono, right-aligned.

### Avoid list
Written in Gate 1 (2026-11-17) from the traits that made the Lab v2 setup and
fleece screens read as generated. Items 1 to 4 are the retired traits. Items 5 to
11 are inferred, not sourced. Item 12 was added by the user.

1. No container with `border-radius` above 4px wrapping a group of fields or
   stats. Controls (inputs, segmented tracks, steppers, the CTA) are exempt;
   check non-control elements.
2. No near-white card on a bone ground with a 1px hairline border. No element
   pairs a lighter-than-ground fill with a 1px border.
3. No stat cell built as a small label above a monospace value. A numeral sits on
   the row or ground with its label beside or under it, in one consistent place.
4. No grid of three or more equal outlined chips for a single choice. Use choice
   rows, a segmented track or a stepper.
5. No full-width red button as the only footer action. The primary action lives in
   the sheet with its state ("Next, 7 of 12").
6. No more than one box nested inside another. The same fill and edge must not
   repeat at two levels.
7. No equal-weight rows. Totals and the active row carry a bigger numeral, a
   taller row or a heavier rule.
8. No shadow used for elevation. Separation is an edge, a tint or space.
9. No icon-in-circle headers and no decorative emoji in headings.
10. No scarlet on more than one thing per screen, and never as decoration. It marks
    the current action or an error.
11. No tap target under 44px high. The row or cell receives the tap, not the glyph.
12. No screen that imitates a paper form: no full ruled row-and-column grid as the
    page structure, no bubble or oval imitations as controls, no printed-card
    frame.

### Gate 1 and Gate 2 decisions (the user's words, kept as rules)
- The paper and scorebook references describe what the tool does, not how it
  should look. The user called that look "awkward and sterile". Borrow their logic
  only (one mark per row, totals at the foot, blank means untouched), never their
  appearance (ruled grids, pale form guides, printed-card frames).
- Wanted feel: modern, accessible, easy to use, and not the generic generated
  look. Reference points are bird identification and tracking apps and
  educational products (Merlin, Seek, Duolingo, Brilliant), not forms.
- Gate 1 relaxed items 1 and 6 for the nesting direction only; v3 adopts that as
  the single allowed level of nesting with concentric radii.
- Gate 2 (comp A chosen): its fleece screens are approved as drawn; the drill gets
  its stage treatment as a full redesign; the icon and the setup layout stayed
  open for later rounds.
