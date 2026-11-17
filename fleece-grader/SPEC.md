# Fleece Grader — spec

Phone-photo grader for the wool-judging grading-rail sheet ("Wool Grading", 20 fleece rows).
Static site, vanilla HTML/CSS/JS ES modules, no build step, no npm in the shipped app.
Runs fully in the browser (works offline once loaded). Separate from `beefgrading.study/`.

## Sheet (see assets/blank-sheet.jpg)
20 rows. Per row, left to right, 38 bubbles:

| Field | Bubbles | Index order |
|---|---|---|
| grade | 10 | 0=70s, 1=64s, 2=62s, 3=60s, 4=58s, 5=56s, 6=54s, 7=50s, 8=48s, 9=46s |
| length | 3 | 0=Staple, 1=French Combing, 2=Clothing |
| yieldTens | 10 | digit; drawn as two rows: 0-4 on top, 5-9 below |
| yieldOnes | 10 | same layout |
| purity | 2 | 0=Good, 1=Poor |
| character | 3 | 0=Good, 1=Average, 2=Poor |

Handwritten "Written" yield boxes are ignored (bubbles count, like a contest).
Bubbles are faint gray dotted outlines; students fill with dark pencil.
Graders (teammates) mark the official answer with a diagonal slash, often pen, sometimes
colored, sometimes pencil. When a student is right the grader may slash over the filled
bubble or skip the slash entirely.

## Data shapes
```js
// one fleece answer (student or key); null = no answer
{ grade: 0-9|null, length: 0-2|null, yield: 0-99|null, purity: 0-1|null, character: 0-2|null }
// sheet = array of 20 of those (index 0 = fleece 1)

// OMR read of one bubble group
{ value: int|null, status: 'ok'|'blank'|'multiple'|'unsure',
  fill: number[],          // 0..1 darkness per bubble
  slash: int|null,         // bubble the grader slashed, if detected
  slashStatus: 'ok'|'none'|'multiple'|'unsure', slashMode: 'color'|'shape' }
```

## Scoring rules (defaults; keep in one editable RULES object)
Deduction by distance d = |student - key| (index distance; yield = numeric distance):
- grade: 0→0, 1→2, 2→4, ≥3→6
- length: 0→0, 1→2, 2→4
- yield: 0–4→0, 5–6→2, 7–8→4, ≥9→6
- purity: wrong→2
- character: d→d (1→1, 2→2)
- Student blank or multiple on a keyed field = max deduction for that field.
Each fleece is worth 20 (6+4+6+2+2). Only fleeces with an official key are graded;
a key field left null is skipped and its points drop out of the fleece total.
Report both: score out of total (primary, e.g. 382/400 for 20 fleeces) and points off.

## Key sources
1. Manual key entry (tap answers).
2. Scan a sheet bubbled by the official.
3. Slash consensus: every sheet in one session shares the same key, so combine graders'
   slashes across the stack (majority vote per fleece/field). Flag any sheet whose slash
   disagrees with consensus (grading-error audit). Fields with no slash anywhere → ask user.

## Files
- scoring.js — pure scoring (RULES, scoreField, scoreFleece, scoreSheet)
- consensus.js — pure slash-consensus + audit
- template.js — sheet geometry (normalized coords inside the table border)
- omr.js — OpenCV.js image pipeline → OMR reads
- index.html / app.js / style.css — UI (later packet)
- tests/*.test.mjs — `node --test fleece-grader/tests/*.test.mjs` (the directory form fails on Node 25)
