# AI Ribeye Grading Pipeline

Grades ribeye cross-section photos (from the TTU meat-judging dataset, ~2,857 images)
using Claude Vision calibrated against fixed official USDA marbling reference photos,
then uploads each image + its predicted grade to Cloudinary (image hosting) + Firebase
Firestore (database) so they appear on beefgrading.study's "Help Train the Grading
Model" section.

**For the full methodology, audit history, and design rationale, see
[`AUDIT_AND_REDESIGN.md`](AUDIT_AND_REDESIGN.md).** This README only covers running
the tools day to day.

---

## Layout

```
grader/
├── secrets/          API keys + Firebase service account — gitignored, never committed
├── tmp/              TTU dataset (auto-downloaded ZIP + unzipped images) — gitignored
├── anchors/          7 official USDA marbling reference photos + manifest.json
├── output/           Generated reports (galleries, eval results, CSVs) — disposable, regeneratable
├── calibration.json  Current fitted calibration_offset (see recalibrate.py) — read by every script by default
├── trainer_seen.json Tracks which images build_trainer.py has already shown you
└── *.py              The scripts (below)
```

## Scripts

| Script | Purpose |
|---|---|
| `model_utils.py` | The grader itself — `analyze_marbling()`. Not run directly; imported by everything else. |
| `grade_ribeyes.py` | Batch pipeline: grade images, upload to Cloudinary, write to Firestore `ai_carcasses`. |
| `build_trainer.py` | Generates an interactive HTML page for you to correct the grader's calls (higher/lower). |
| `recalibrate.py` | Turns exported corrections from the trainer into a fitted `calibration_offset`, written to `calibration.json`. |
| `eval_harness.py` | Validates the grader against human-voted consensus images; used before committing to a full regrade. |
| `preview_new_grader.py` | Visual sanity-check gallery (raw grade vs. a candidate calibration offset, side by side). |
| `cv_marbling.py` | Free, model-free HSV heuristic (fat-ratio estimate) — used only for stratified sampling and disagreement-based prioritization, never as the grader itself. |
| `test_key.py` / `debug_key.py` | Standalone Anthropic API key smoke tests. |

## Setup

### 1. Install dependencies
```bash
pip install -r grader/requirements.txt
```

### 2. Get credentials, save them under `grader/secrets/`
- **Anthropic API key** → `grader/secrets/api_key.txt` (or set `ANTHROPIC_API_KEY` env var / pass `--anthropic-key`)
- **Cloudinary** (free tier at cloudinary.com) → `grader/secrets/cloudinary_creds.txt`:
  ```
  cloud_name=YOUR_CLOUD_NAME
  api_key=YOUR_API_KEY
  api_secret=YOUR_API_SECRET
  ```
- **Firebase service account** (Firebase Console → beef-grading-drill project → Project Settings → Service accounts → Generate new private key) → `grader/secrets/firebase-service-account.json`

> Everything under `grader/secrets/` is gitignored (`grader/**/*.txt`, `grader/**/firebase-service-account.json` etc. — see root `.gitignore`). Never commit these.

## Running

**Grade a small batch (dry run, no uploads):**
```bash
python grader/grade_ribeyes.py --sa grader/secrets/firebase-service-account.json --dry-run --limit 5
```

**Full pipeline run:**
```bash
python grader/grade_ribeyes.py --sa grader/secrets/firebase-service-account.json --cloud-name X --api-key X --api-secret X
```
(Cloudinary flags can also be omitted if `grader/secrets/cloudinary_creds.txt` is set up.)

**Build a training batch to correct the grader's calls:**
```bash
python grader/build_trainer.py --n 50
```
Open the resulting `grader/output/trainer.html` in a browser, grade through it, export corrections, then:
```bash
python grader/recalibrate.py <exported_corrections>.json
```

**Validate before a full regrade:**
```bash
python grader/eval_harness.py --sa grader/secrets/firebase-service-account.json
```

## Grade mapping

Marbling score (0–999) → grade key, matching the official USDA marbling degree bands
(confirmed against 7 CFR / USDA AMS *Standards for Grades of Carcass Beef*, §54.104):

| Score range | Grade key | Label |
|---|---|---|
| 900–999 | `PR_HI` | High Prime |
| 800–899 | `PR_AVG` | Average Prime |
| 700–799 | `PR_LO` | Low Prime |
| 600–699 | `CH_HI` | High Choice |
| 500–599 | `CH_AVG` | Average Choice |
| 400–499 | `CH_LO` | Low Choice |
| 350–399 | `SE_HI` | High Select |
| 300–349 | `SE_LO` | Low Select |
| < 300 | `STD` | Standard |
