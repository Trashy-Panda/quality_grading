# Body UI references (v3)

Directions: A = Scorecard, B = Instrument, C = Open ledger. "Opened" means fetched. PDFs were read as rendered pages, so the descriptions of #1 and #2 are first-hand. Everything else is from page text.

## References

1. **Canadian Co-operative Wool Growers, Wool Judging Card** (printed). https://alberta.wool.ca/images/uploads/files/preparation/Fleece-judging-card-E-F.pdf
   - One tall black-on-white card inside a heavy dark-red frame. Eight numbered traits run down the left with max points right-aligned (35, 10, 10, 10+5...). Beside each is a blank score box with a short ruled leader line, then a small-type description. Total 100 sits on a ruled foot row, with Greasy weight, Yield and Mean fibre diameter beneath.
   - **Borrow:** the score cell is a blank ruled slot, and the max is printed in the label column, so "x / 35" is built into the row. Feeds A, C.

2. **Meat Evaluation Form #480-4 scan sheet** (printed OMR, National Meat Evaluation). https://www.judgingcard.com/ScanSheets/samples/480-4-Meats.pdf
   - Pale-blue guides and ovals on white, with filled black marks. Rows have big bold row numbers on the left. Header bars are small rounded bands, one per block (Placing Classes, Keep/Cull, Written Exam).
   - **Borrow:** the Beef Carcass Quality Grading matrix. Columns are Prime / Choice / Select / Standard / Commercial / Utility, each split High / Avg / Low. The cells are labelled with their own codes (Pr+ Pr° Pr- Ch+ Ch° Ch-...). The instruction "Make only one mark in each row!" is printed inside the grid. Feeds A, B.

3. **Baseball scorebook** (printed). https://en.wikipedia.org/wiki/Baseball_scorekeeping
   - Rows are batters and columns are innings. Each cell holds a small diamond plus notation. Hits and runs are totalled at the foot of each column.
   - **Borrow:** each cell shows its own state with a mark, and column totals sit in a footer row. Feeds A, C.

4. **Optical mark recognition** (reference). https://en.wikipedia.org/wiki/Optical_mark_recognition
   - Describes registration marks, "drop-out colors", grid fields for IDs, and mark shapes (circle, square, lozenge). The page says nothing about layout beyond that.
   - **Borrow:** a registration-mark frame. Four corner marks sit on the sheet and double as the camera framing guide in the fleece grader. Feeds the fleece grader; A, B.

5. **Ableton Live, Session View** (instrument-style software). https://www.ableton.com/en/manual/live-concepts/
   - A grid where tracks are columns and scenes are rows. Each clip has its own launch button, and a mixer strip sits below.
   - **Borrow:** rows as scenes and columns as tracks, with every cell its own tap target. The manual describes structure only, not look. Feeds B, A.

6. **ODK Collect, filling forms** (field data collection, mobile). https://docs.getodk.org/collect-filling-forms/
   - Next/Back sit at the bottom of the screen. A top-right jump menu shows the whole form. Required questions block advancing, and some questions auto-advance on answer. Swiping also moves between screens.
   - **Borrow:** a jump-menu summary plus a fixed Back/Next bar, with auto-advance on single-choice answers. The page also notes the bar costs vertical space on short screens. Feeds B.

7. **BTO BirdTrack app** (field counting, mobile). https://bto.org/node/55072
   - Lists "+/-/circa buttons" for adding and adjusting counts, and a "Quick Add" for one-off sightings.
   - **Borrow:** +/-/circa as one tight stepper per row. The page gives no layout detail and says it will be updated for the new app, so treat the control as a cue only. Feeds B.

8. **eBird checklist guidance** (mobile data entry). https://support.ebird.org/en/support/solutions/articles/48000795623-ebird-mobile-app-submit-a-checklist
   - Counts are exact numbers or "X" for present but uncounted. "Don't enter 0"; leaving a row blank implies zero.
   - **Borrow:** blank means zero and X means present, so an untouched row costs no taps. Feeds C, A.
   - The search results (not a page that was opened) add that eBird has a Quick Entry bar taking "number, space, name".

9. **Butterick, Practical Typography: Tables** (type). https://practicaltypography.com/tables.html
   - Start with all cell borders off and add them back only where legibility needs them. "Increasing the cell margins is the best way to improve the legibility of a dense table", starting around 0.03 in and going up in 0.01 in steps.
   - **Borrow:** borders off by default, with spacing doing the separation. Feeds C.

Not used: Bloomberg's UX page returned 403 and the Teenage Engineering page gave no visual detail. The Tufte book page and the Scantron Wikipedia page said nothing usable. Unopened and excluded: the Oregon State fleece score sheet (301 redirect, binary only) and the University of Maryland wool evaluation PDF (ECONNRESET).

## Avoid list (draft)

Items 1-4 are the retired traits. Items 5-11 are the researcher's inference; no source was found documenting them as common generated-UI tells.

1. No container with border-radius above 4px wrapping a group of fields or stats. Check: grep `border-radius` and flag values above 4px on non-control elements.
2. No near-white card on a bone ground with a 1px hairline border. Check: no element pairs a lighter-than-ground fill with a 1px border.
3. No stat cell built as small label above monospace value. A numeral is on the row or ground with its label beside or under it, in one consistent place.
4. No grid of three or more equal outlined chips for a single choice. Use cells in a ruled row, a segmented track, or a stepper.
5. No full-width red button as the only footer action. The primary action lives in a fixed bar with its state (e.g. "Next, 7 of 12").
6. No more than one box nested inside another. The same fill and border should not repeat at two levels.
7. No equal-weight rows. Totals and the active row carry a heavier rule or bigger numeral than the rest.
8. No shadow used for elevation. Separation comes from rules (1px hairline, 2px or heavier for sections), tint, or space.
9. No icon-in-circle headers or decorative emoji in headings.
10. No scarlet on more than one thing per screen, and never as decoration. It marks the current action or an error.
11. No tap target under 44px high in a ruled cell. Check: the cell, not the glyph, receives the tap.

## User additions (Gate 1)

Decided by the user on 2026-11-17:

- **The paper references (1-4, and the scorebook/form look in general) describe what the
  tool does, not how it should look.** The user called them "awkward and sterile". The
  app must not look like an old form or an analog documenting system. Borrow their
  logic only (one mark per row, totals at the foot, blank means untouched); never
  their appearance (ruled grids, pale form guides, printed-card frames).
- **Wanted feel:** modern, easily accessible, easily usable. Still not the generic
  AI-generated look.
- **Places to look instead:** bird tracking and identification apps, and educational
  resources. See "Modern references (round 2)" below.
- **Avoid list:** all 11 rules apply to directions A and C. Direction B may nest one
  level with concentric radii (rules 1 and 6 relaxed for B only).
- **Added avoid rule 12:** no screen that imitates a paper form: no full ruled
  row-and-column grid as the page structure, no bubble/oval imitations as controls,
  no printed-card frame.

## Modern references (round 2)

Source note: no screenshots were seen; the fetch tool returns text only. Each entry says whether it comes from an opened page, store-listing or review text, or search snippets only. Treat the visual descriptions as second-hand.

1. **Merlin Bird ID.** Opened https://ixd.prattsi.org/2023/09/design-critique-merlin-bird-id-app/ and https://apps.apple.com/us/app/merlin-bird-id-by-cornell-lab/id773457673 (critique and listing text). Muted gray/green/yellow palette, bottom bar of Identify, Explore, Life List, Settings. Results appear as tiles.
   - **Borrow:** the highlight follows the live signal (a yellow row for the bird currently calling). For feedback, highlight the chosen and correct grade rows in place instead of opening a modal.
   - **Helps:** drill, feedback.

2. **Merlin Step by Step ID.** Same Pratt page. Five sequential steps, each advanced by one Next button.
   - **Borrow:** one question per screen with a single Next.
   - **Helps:** setup.

3. **Seek by iNaturalist.** Opened https://apps.apple.com/us/app/seek-by-inaturalist/id1353224144 (listing and review text). The camera is the home screen. A scan builds up through progress "bubbles", then returns an ID. Reviewers complain that badge pop-ups interrupt scanning.
   - **Borrow:** camera-first framing with the live recognition state shown on the viewfinder; never interrupt capture with pop-ups.
   - **Helps:** scan.

4. **Birda.** Opened https://www.birda.org/ (marketing text only). Photo-forward logs, life lists, goals, and an "unidentified, ask the community" escape hatch.
   - **Borrow:** an explicit "unsure" state as a first-class outcome, for the review of uncertain marks.
   - **Helps:** review.

5. **Duolingo home path.** Opened https://blog.duolingo.com/new-duolingo-home-screen-design/ (official prose). A single linear path replaced the skill tree. A floating arrow returns you to your current spot. Progress is position along the path.
   - **Borrow:** show session progress as position along one path (a 20-fleece key, a drill run).
   - **Helps:** summary, fleece key entry.

6. **Duolingo lesson feedback.** Search snippets only; no primary page opened. Secondary write-ups describe a top progress bar and wrong answers handled gently rather than with red error screens.
   - **Borrow:** a wrong answer is a tone shift plus a short explanation, not an error state.
   - **Helps:** feedback.

7. **Brilliant.** Opened https://brilliant.org/ (marketing text; says little about the UI). Lessons run on a shared interactive canvas the learner manipulates directly.
   - **Borrow:** put the artifact (the carcass photo) on a full-bleed stage; prompts and controls sit around it, not above it.
   - **Helps:** drill.

8. **Khan Academy mastery levels.** Search snippets only, from https://support.khanacademy.org/hc/tr/articles/5548760867853. Four levels (attempted, familiar, proficient, mastered), each with its own icon.
   - **Borrow:** a progress fill that is the container itself, not a separate stat cell.
   - **Helps:** summary, results.

9. **Kahoot.** Search snippets only, from https://support.kahoot.com/hc/articles/360039900153. After each question, results show how many chose each option; the final screen is a podium plus your own rank.
   - **Borrow:** a distribution view after an answer, e.g. how often each grade is confused with the right one.
   - **Helps:** feedback, summary.

10. **Adobe Scan.** Opened https://apps.apple.com/us/app/adobe-scan-pdf-scanner-ocr/id1199564834 (listing and review text). Live border detection frames the page, auto-capture; captured pages are previewed, reordered and deletable.
    - **Borrow:** a scan-stack strip showing captured pages with delete at any time, and a viewfinder that frames the sheet corners.
    - **Helps:** scan, review.

11. **Strong (workout logger).** Opened https://www.strong.app/ (feature list); review snippets from https://repreturn.com/strong-app-review/ say a set takes a couple of taps and the previous performance is shown inline.
    - **Borrow:** show the previous value inline in each row and auto-advance after each entry (20-row key entry).
    - **Helps:** fleece key entry.

Could not open: merlin.allaboutbirds.org, inaturalist.org/pages/seek_app, ebird.org/mobile, duolingo.com, khanacademy.org, kahoot.com, khan.github.io/wonder-blocks, the eBird App Store listing. Not covered: Anki/Quizlet, a university or museum learning resource.

### Three directions (researcher's proposal)

- **A. Field Guide Stage.** The photo fills the screen edge to edge. Grade choices sit on a thumb-height bottom sheet. A highlighted row marks the right answer; no cards or chips. Feeds: Merlin, Brilliant, Kahoot.
- **B. Path.** Every session is a single line of nodes (drill questions, or fleeces 1 to 20). A node fills in scarlet as you go; a "you are here" marker sits at the edge. Summary and results show the finished path. Feeds: Duolingo, Khan, Strong.
- **C. Camera-First Scanner.** The fleece tool opens on a live viewfinder with corner brackets and a scan-stack strip. Uncertain marks are flagged on the photo itself and resolved by tapping the photo. Scores are one large number, ink on the ground. Feeds: Seek, Adobe Scan, Birda.

Orchestrator note for Phase 2: as proposed, A is mostly a drill idea and C mostly a fleece idea, so they do not compare like for like. Each comp must still show the full shared content set (setup in both weekly states, fleece key entry, scan card, one review row, results summary), so each direction has to be extended to every screen: A as "content is the stage, controls on a bottom sheet", B as "everything is a position on a path", C as "capture and the image are the interface, one big number for outcomes". The plan's fixed technical requirements and the avoid list still apply; rules 1 and 6 are relaxed only for whichever direction nests blocks.

### What makes these not look generated

1. The content is the hero: a photo or camera view takes most of the screen, and controls are subordinate.
2. Selection is shown by colour and state change on the whole row, not by a grid of outlined chips.
3. Progress is spatial (a path position, a fill, a stack), never a label above a monospace value.
4. Feedback arrives in place, as a highlight on the thing you chose, not a toast or a modal.
5. One accent carries the meaning.
6. The primary action sits at thumb height but is contextual (Next, a capture ring), not a full-width red slab.
7. Uncertainty is a designed state ("not sure", flagged on the image), not an error.
8. Numbers are big and few: one score shown large, detail behind a tap.
