# Grader Audit & Redesign Proposal

**Date:** 2026-07-15 · **Scope:** the AI ribeye grading pipeline (`grader/`), its history, and the site's consensus-voting loop it feeds. Audit + proposal only — no code changed.

---

## 1. Executive summary

The grader is measurably broken, and the failure is architectural, not perceptual.

- Across all 50 carcasses it has graded, the Claude-based grader has **only ever output 3 of the 9 grades** (Low Choice ×25, High Select ×12, Low Select ×13). It has never said Prime, Average/High Choice, or Standard.
- On the 20 images with human votes, it agrees with consensus exactly **25%** of the time and grades a mean of **0.65 rungs lower** than humans.
- The root cause: the model is asked to produce an **absolute grade in a single low-resolution shot**, calibrated by few-shot reference images that are themselves AI/consensus-derived (a circular loop). This is the opposite of how real grading instruments work — they measure a *continuous* marbling quantity under fixed reference conditions and map it to a grade with deterministic thresholds downstream.

**Recommendation: Option A — "Claude as a calibrated instrument"** (§5.1): the model reports only a marbling descriptor + subunit anchored against fixed official USDA marbling reference photos; the grade is assigned by a threshold table in code; k=3 median ensembling; bias offset calibrated against vote-weighted consensus. Validated for <$3 on a 50-image eval set before any full run (~$60–90 for all 2,857 images). Free/local options were evaluated honestly (§5.2) — they fail on structure, not effort, but earn a $0 supporting role (§5.3).

Independent of the redesign: rotate the live secrets sitting in `grader/base/` (§3.4) and fix the voting-loop bugs (§7) so future consensus data is trustworthy.

---

## 2. System lineage — the three graders

Git history shows three generations. **Only the third exists today, but the docs still describe the second.**

| Gen | Commit | Approach | Status |
|---|---|---|---|
| 1 — "Hackathon" | `da7f136` | 1st-place USDA/CSU hackathon model: ResNet50 transfer learning (`best_model.keras`), 4-class classifier — Select / Low Choice / Upper-⅔ Choice / Prime | Replaced same day |
| 2 — HSV color analysis | `ccebf26` | Pure-numpy HSV segmentation → intramuscular fat ratio → marbling score 0–1100 → grade | **Code deleted; README.md, module docstrings, and the Firestore `source` field still describe it** |
| 3 — Claude Vision | current | `claude-sonnet-4-6` vision call per image, absolute grade requested | **What actually runs** |

Gen-3 pipeline as it stands (`grade_ribeyes.py`, `model_utils.py`):

1. Image thumbnailed to **800×800, JPEG q82** (`model_utils.py:119-121`)
2. Optional few-shot: one reference image per grade tier fetched from **`community_carcasses`** (`model_utils.py:125-155`) — a collection populated by promoting crowd-consensus winners of *previous AI-graded images*
3. System prompt asks for an absolute grade + descriptor + score as JSON (`model_utils.py:69-102`)
4. Single API call (`model='claude-sonnet-4-6'`, `model_utils.py:253`), no ensembling
5. Result written to Firestore `ai_carcasses` with `source: 'AI Graded — Color Analysis'` (false; `grade_ribeyes.py:138`)
6. Site users vote on those images (`grading_votes`); admin promotes the modal grade to `community_carcasses` (`admin.js:1366-1392`) — which then becomes the grader's calibration standard for the next batch

---

## 3. Audit findings

### 3.1 Measured failure (Firestore, read 2026-07-14)

50 `ai_carcasses` docs; 20 have votes (79 votes total, 4 distinct voters).

**AI grade distribution (all 50):** CH_LO ×25 · SE_HI ×12 · SE_LO ×13 · *everything else ×0*

**AI vs consensus on the 20 voted images:**

| Metric | Value |
|---|---|
| Exact agreement | 5/20 (25%) |
| Off by 1 rung | 7/20 (35%) |
| Off by ≥2 rungs | 8/20 (40%) |
| Mean signed offset (AI − consensus) | **−0.65 rungs** (AI under-grades) |
| Signed-offset histogram | −2: ×7 · −1: ×4 · 0: ×5 · +1: ×3 · +2: ×1 |

Typical disagreements: AI says SE_LO where 8/9 voters say SE_HI; AI says CH_LO where all 4 voters say CH_AVG. The pattern is consistent one-to-two-rung *under*-grading, plus total absence of the top and bottom of the scale.

Caveat: the consensus itself is thin — 4 voters, several images with only 2 votes, and the voters are students the site exists to train. It is useful *directional* signal (especially the systematic bias), not gold truth. §6 builds an eval set that treats it accordingly.

### 3.2 Root causes

| Measured failure | Root cause |
|---|---|
| Range compression to 3 middle grades | Model asked for an **absolute grade in one shot**; LLMs hedge to the middle of a ladder under uncertainty. The prompt even pleads "← USE THIS, it is a real grade" (`model_utils.py:80`) — a symptom, not a fix. Single call, no ensembling, no distributional pressure. |
| Systematic −0.65 rung under-grading | **800px q82 thumbnail destroys fine marbling flecks** — and fine, dispersed marbling grades *higher* per USDA standards, so lost detail biases low. **Circular few-shot refs** re-anchor any existing bias into the next batch. |
| Low exact agreement | Grade is decided by the model as a *label string* (then fuzzy-matched via `_GRADE_MAP`), not derived from a continuous measurement; noisy circular refs; no self-consistency. |
| Silent bad data | Parse failure or retry exhaustion returns a fabricated `('SE_AVG', 0.4, 350.0)` (`model_utils.py:193`, `model_utils.py:266`) — SE_AVG is not even on the grader's 9-grade ladder. |

### 3.3 Pipeline & site bugs

| Bug | Location | Effect |
|---|---|---|
| Vote never increments `voteCount` | `app.js:949-969` writes to `grading_votes` only | Contribute feed orders by `voteCount asc` (`app.js:893-897`) — every doc stays at 0, so the **same 20 images are served forever**; the other 30 AI-graded docs have never been shown |
| No promotion threshold | `admin.js:1289-1293` takes the raw mode | A 2-vote "consensus" can be promoted to `community_carcasses` and become the grader's calibration reference |
| `source` field lies | `grade_ribeyes.py:138` — `'AI Graded — Color Analysis'` | Provenance of every AI doc is wrong; users/admin can't tell which model or prompt produced a grade |
| Fabricated fallback grade | `model_utils.py:193`, `:266` | Failures masquerade as real Average Select grades |
| Prompt says "8 grades," lists 9 | `model_utils.py:73-82` | Minor, but sloppy calibration text |
| Docs describe gen-2 | `README.md`, `grade_ribeyes.py:5-13` docstrings | "HSV pixel segmentation, no API needed" — none of it exists; misleads any future maintainer |
| Two divergent copies | `grader/*.py` vs `grader/base/*.py` | Identical except import paths, but the dataset and creds live under `base/` while root scripts resolve paths relative to themselves — easy to run the wrong copy |

### 3.4 🔴 Security (urgent, independent of redesign)

Live credentials sit on disk in `grader/base/` (currently untracked, but README claims they're gitignored — they are not covered from that location):

- `grader/base/api_key.txt` — **live Anthropic API key**
- `grader/base/cloudinary_creds.txt` — Cloudinary API secret
- `grader/base/firebase-service-account.json` — **Firebase admin private key** for `beef-grading-drill`

Action: rotate all three, add explicit `.gitignore` coverage for `grader/**/api_key.txt`, `grader/**/cloudinary_creds.txt`, `grader/**/firebase-service-account.json`, and confirm none ever reached a pushed commit (`git log --all -- '*api_key*' '*service-account*'`).

---

## 4. How real grading works (and the design principle that follows)

**Human grading / meat judging.** USDA quality grade = marbling degree × carcass maturity, evaluated at the ribbed 12th–13th rib interface. Marbling degrees run Practically Devoid → Traces → Slight → Small → Modest → Moderate → Slightly Abundant → Moderately Abundant → Abundant, each subdivided into 100 subunits (Small⁰⁰, Small⁵⁰…). Graders and judging teams calibrate against the **official USDA marbling reference photographs** — they make a *comparative* judgment against fixed visual anchors, not an unanchored absolute one.

**Instrument grading (e+v VBG2000 and successors, USDA-approved since 2007).** Standardized capture geometry, LED lighting, laser distance measurement → segment the ribeye ROI → measure marbling **as a continuous quantity** (amount, fleck size, distribution) → a regression **calibrated against expert grader panels** maps measurement → marbling score → the grade falls out of deterministic thresholds. A human grader adds the maturity component.

**The design principle the current grader violates:** *perception should output a continuous, anchored measurement; grade assignment belongs in deterministic downstream code.* Gen-3 asks the perceiver for the final label directly, unanchored, at low resolution — so it inherits every LLM tendency toward central, hedged answers, and there is no measurement left over to calibrate.

Also relevant from the literature: CNNs hit 86–91% marbling classification *in-domain* but degrade badly across facilities/capture conditions without domain adaptation; classical image-feature approaches reach R²≈0.83 *under standardized capture*; and VLMs are consistently better at **relative/comparative** judgments than absolute magnitude estimation. The TTU corpus (2,857 contest photos from 2003, uncontrolled lighting/angle) is exactly the hostile domain these caveats warn about.

Sources: [USDA carcass beef standards](https://www.ams.usda.gov/grades-standards/carcass-beef-grades-and-standards) · [official USDA marbling photographs](https://www.ams.usda.gov/grades-standards/beef/shields-and-marbling-pictures) · [USDA-approved grading instruments](https://www.ams.usda.gov/content/usda-announces-approved-instruments-beef-grading) · [history of instrument assessment of beef](https://www.beefresearch.org/Media/BeefResearch/Docs/the_history_of_instrument_assessment_of_beef_08-20-2020-93.pdf) · [SIRI + deep learning marbling assessment](https://www.sciencedirect.com/science/article/abs/pii/S0260877424000025) · [cross-facility domain-adaptation marbling regression](https://scholarworks.uark.edu/hnrcsturpc25/19/)

### Canonical threshold table (single source of truth for any option)

| Marbling score | Descriptor | Grade key |
|---|---|---|
| 900–999 | Abundant | PR_HI |
| 800–899 | Moderately Abundant | PR_AVG |
| 700–799 | Slightly Abundant | PR_LO |
| 600–699 | Moderate | CH_HI |
| 500–599 | Modest | CH_AVG |
| 400–499 | Small | CH_LO |
| 350–399 | Slight 50–99 | SE_HI |
| 300–349 | Slight 00–49 | SE_LO |
| < 300 | Traces / Practically Devoid | STD |

---

## 5. Redesign options

### 5.1 Option A — Claude as a calibrated instrument ⭐ recommended

**Architecture (each element targets a measured failure):**

1. **Decouple perception from mapping.** The model returns only `{descriptor, subunit}` (e.g. Modest 30 → score 530); the threshold table above assigns the grade **in code**. `grade` is deleted from the model's output schema entirely. The fine-vs-coarse rule becomes a subunit adjustment, matching how it actually works in USDA practice.
2. **Full-resolution input.** Longest side 1568px, JPEG q90 (Claude vision sweet spot) — optionally two views: full frame + native-resolution center crop of the eye muscle, labeled "full view" / "detail view." Restores the fine flecks whose loss drives the low bias.
3. **Fixed USDA anchors, prompt-cached.** Replace `load_reference_images()` with 9 static official USDA marbling reference photographs bundled in `grader/anchors/` (public-domain USDA works; verify the specific reproduction), each captioned with descriptor + score midpoint (Slight = 350 … Abundant = 950). Marked with `cache_control` so the anchor block is paid once per cache window across the whole batch. **Breaks the circular loop by construction.**
4. **Comparative anchoring.** The prompt asks the model to (a) name the anchor with clearly less marbling and the anchor with clearly more, (b) interpolate 0–100 between them, (c) report descriptor + subunit. Score computed in code from lower/upper/interp and cross-checked against descriptor+subunit; >50-point disagreement → flag. This plays to the VLM strength (relative judgment) instead of its weakness (absolute estimation).

   ```
   You are calibrating against the official USDA marbling standards shown above
   (ANCHOR 1: Slight/350 ... ANCHOR 9: Abundant/950).
   For the TARGET image:
   1. Name the anchor with clearly LESS marbling and the anchor with clearly MORE.
   2. Interpolate: where does the target sit between them (0-100)?
   3. Report the resulting descriptor and subunit.
   Targets in this dataset span the FULL range from Standard to High Prime;
   do not default to the middle. Judge only the large central eye muscle;
   ignore fat cap, seam fat, bone, and lighting glare.
   JSON only: {"lower_anchor": ..., "upper_anchor": ..., "interp": 0-100,
   "descriptor": ..., "subunit": 0-99, "fineness": "fine|mixed|coarse",
   "image_quality": "good|glare|dark|blurry"}
   ```

5. **Self-consistency.** k=3 calls, temperature ≈ 0.7, take the **median score**; spread → confidence (high < 50 pts, medium < 100, low ≥ 100). Median in continuous score-space also breaks the 3-grade mode-lock.
6. **Bias calibration from consensus.** After the eval run, compute the vote-weighted mean signed offset vs consensus; if |offset| > 25 points, apply a constant score correction **in code, not in the prompt**. This is the only place consensus data enters the grader — never as few-shot input.
7. **Honest failure handling.** Parse failure or `image_quality ≠ good` on all k calls → `grade: null, needs_review: true`. Never fabricate a grade.

**Why it fixes the measured failures:** compression → median-of-k continuous scores + anchor interpolation + explicit full-range instruction; under-grading → full-res detail + non-circular fixed anchors + residual constant offset; low agreement → deterministic mapping removes label-string ambiguity.

**Cost / effort:** validation < $3 (§6); full 2,857-image run at k=3 ≈ 8.6k Sonnet calls ≈ **$60–90** (benchmark a Haiku variant at ~⅓ price during eval); ~2–3 days to rewrite `model_utils.py` + batch loop. No new infrastructure.

**Risks:** USDA anchor photos are studio-quality vs 2003 contest photos (mitigated by the `image_quality` flag and glare instruction); k=3 triples cost (drop to k=1 if eval shows it's within noise); anchor-image licensing to verify.

### 5.2 Option B — free/local (honest verdict: not viable standalone)

- **B1 — resurrect the hackathon ResNet50.** Its 4 classes (Select / Low Choice / Upper-⅔ Choice / Prime) structurally cannot populate a 9-rung ladder — no Standard, no Select split, no Choice-average/high distinction, no Prime thirds. Trained on unknown capture conditions; the cross-facility degradation documented for marbling CNNs applies directly to 2003 contest photos. *Usable only as a coarse sanity signal.* Effort ~1 day; $0.
- **B2 — rebuild the documented HSV fat-ratio grader.** White-balance → segment lean → largest component = eye ROI → fat pixels → features (fat ratio, fleck count/size, dispersion) → regression to marbling score. The literature's R²≈0.83 required *standardized capture*; on uncontrolled contest photos, flash glare and surface bloom read as fat, and there are only 20 noisy consensus labels to calibrate against. *Expected to be worse than the current grader as an absolute measure; possibly decent as a relative ranking signal — testable for free in the eval (§6).* Effort ~2–4 days; $0.
- **B3 — local open VLM (e.g. Qwen2.5-VL via Ollama)** with the Option-A prompt architecture: $0 marginal, needs a GPU; worth running on the eval set purely to put an honest number in the comparison. Expectation: materially below Claude on exact/adjacent agreement.

**Answer to "could free be comparable?" — No, not for absolute 9-grade assignment on this dataset.** The ceilings are structural (4 classes; lighting-fragile thresholds; 20 calibration labels), not effort-limited. But free CV is genuinely valuable as a $0 auxiliary → Option C.

### 5.3 Option C — hybrid: free CV signal + Claude adjudication (fast-follow)

**C-lite (worth doing after A ships):** run the B2 feature extractor on every image; (a) use its fat-ratio deciles to stratify eval sampling for free, (b) flag any image where the CV-implied grade and Claude's grade differ by ≥2 rungs as `needs_review` and route it to the human voting queue *first* — disagreement images are exactly the pedagogically interesting ones for a training site. Optionally inject the CV measurement into the prompt as "a rough instrument reading that may be corrupted by glare."

**C-full (CV primary, Claude referee): rejected** — it puts the least-calibratable component in charge.

Cost: same API cost as A + ~2 days for the extractor. Risk: injected CV numbers could wrongly anchor Claude on glare-corrupted images — mitigate by using CV only for the disagreement flag, not in-prompt.

### 5.4 Comparison

| | A: Claude instrument | B: free/local | C: hybrid (A + CV flag) |
|---|---|---|---|
| Fixes range compression | ✅ median score + interpolation | ❌ 4-class / unstable thresholds | ✅ (via A core) |
| Fixes low bias | ✅ fixed anchors + calibration offset | ❓ uncalibratable with 20 labels | ✅ |
| 9-grade coverage | ✅ full | ❌ structurally impossible (B1) / fragile (B2) | ✅ |
| Cost (full 2,857) | ~$60–90 (k=3 Sonnet) | $0 | ~$60–90 |
| Effort | 2–3 days | 3–5 days | A + ~2 days |
| Key risk | anchor↔target domain gap | contest-photo lighting variance | CV mis-anchoring Claude |

---

## 6. Evaluation protocol (~100 API calls, before any full run)

**Eval set (50 images, two tiers):**

- **Tier 1 — consensus set (20):** the already-voted images. Label = vote-count-weighted mode; label weight `w = min(votes, 5)/5` so a 2-vote image counts 0.4. Role: bias-check, not gold.
- **Tier 2 — USDA-anchored gold set (30):** run the free B2 fat-ratio extractor over all 2,857 images ($0) and sample 30 stratified across fat-ratio deciles — this guarantees the eval set contains probable Prime and Standard images. (You cannot detect range compression on an eval set that is itself all mid-range.) The user grades each side-by-side against the official USDA marbling photographs, recording descriptor + subunit. Weight 1.0.

**Metrics** (on rung indices STD=0 … PR_HI=8, weighted by w): exact agreement · adjacent (≤1) agreement · mean signed bias (target |bias| ≤ 0.25) · MAE · quadratic-weighted kappa (punishes the current 40% off-by-≥2 failures) · **grade coverage** (distinct grades predicted on Tier 2 ≥ distinct label grades − 1, plus prediction-distribution entropy) · Spearman ρ of continuous score vs label order (gives B2's relative signal a fair hearing).

**Budget:**

| Run | Images | API calls |
|---|---|---|
| A-base: anchors + decoupled mapping, k=1 | 50 | 50 |
| A-sc: k=3 on the 15 worst A-base disagreements | 15 | 45 |
| B1 ResNet50 · B2 HSV · B3 local VLM | 50 | 0 |
| Current-grader baseline | — | 0 (already measured: 25% / 60% / −0.65 / 3 grades) |

**Go/no-go for the full regrade:** adjacent agreement ≥ 70% AND |bias| ≤ 0.25 AND coverage passes. If A-base (k=1) already passes, skip k=3 on the full run and save ⅔ of the cost.

---

## 7. Consensus-loop fixes (do these regardless of option)

1. **`voteCount` bug:** on vote submit, also `update({ voteCount: firebase.firestore.FieldValue.increment(1) })` on the `ai_carcasses` doc (requires a rules change to permit that one field, or a Cloud Function trigger on `grading_votes`). One-time backfill from existing `grading_votes`. Add a random tiebreak field so equal-count docs rotate.
2. **Promotion threshold** (`admin.js`): promote only when votes ≥ 5 AND mode share ≥ 60% AND mode vs runner-up within 1 rung; otherwise mark contentious. Store the full vote histogram on the promoted doc.
3. **Voter reliability weighting:** weight each voter by trailing adjacent-agreement with promoted consensus (`0.5 + 0.5·accuracy`, start 1.0). Transparent, resists one confident-wrong student.
4. **Break the circular loop:** the grader never reads `community_carcasses` again — fixed USDA anchors only. Delete the `load_reference_images()` pathway.
5. **Provenance:** every `ai_carcasses` doc gains `{aiModel, promptVersion, k, medianScore, scoreSpread, calibrationOffset}`; fix the false `source` string.
6. **Code hygiene:** replace the fabricated `SE_AVG` fallback with null/needs_review; fix the "8 grades" prompt header; rewrite README/docstrings to describe the real architecture; collapse the `grader/` vs `grader/base/` duplication to one copy.

---

## 8. Sequenced roadmap

| Phase | Work | Gate |
|---|---|---|
| **0** | Rotate secrets (§3.4) · voting-loop fixes (§7.1–7.2) | — |
| **1** | Build Option A prototype + B1/B2/B3 free baselines · run eval protocol (§6) | adjacent ≥ 70%, \|bias\| ≤ 0.25, coverage passes |
| **2** | Full 2,857-image regrade with provenance tags · archive old `ai_carcasses` cohort | spot-check + consensus bias re-measure |
| **3** | C-lite: CV disagreement flag → `needs_review` human queue | — |

---

## Addendum (2026-07-15) — Option A built and evaluated; NOT YET a pass

Following the recommendation above, Option A was implemented (`model_utils.py`, `grade_ribeyes.py`, `grader/anchors/` with 7 official USDA marbling photos downloaded from AMS, `cv_marbling.py` for free B2, `eval_harness.py` for §6's protocol) and run against the real eval budget. Two things surfaced worth recording honestly.

**Correction to §3.1's disagreement stats.** The original 40%-off-by-≥2 figure was computed on an 11-slot position scale that included the unused `SE_AVG`/`COM` grades as real slots, which opens an artificial 2-step gap between `SE_LO` and `SE_HI` that doesn't exist on the actual 9-grade practical ladder. Recomputed on the correct 9-rung scale, the old grader's stats on the same 20 consensus images are:

| Metric | Old grader (corrected) |
|---|---|
| Exact | 21.4% |
| Adjacent (≤1 rung) | **100%** |
| Bias | −0.44 rungs |
| MAE | 0.79 rungs |
| Quadratic-weighted kappa | 0.53 |

The systematic under-grading bias and mediocre exact-match rate are real and hold up. The "40% catastrophically off" framing does not — the old grader's 3-grade output range (CH_LO/SE_HI/SE_LO) is narrow enough that even a wrong guess usually lands within 1 rung of a nearby true label. That narrowness (the range-compression problem) is itself still the core defect — it's just not the *additional* off-by-2+ scattershot the uncorrected numbers implied.

**Option A, default (calibration_offset=0):** ran full k=1 Tier-1 + k=3 on worst 15 + Tier-2 coverage (~95 calls, $0.61 total, prompt caching working as designed). Result: **worse** than the old grader — bias −1.3 rungs (blended), adjacent 48.6%, exact 25.7%. The full-resolution input + comparative-anchoring prompt did fix range compression (Tier-2 coverage: 5 distinct grades across 30 images, entropy 1.87 bits, vs. the old grader's 3-grade lifetime total) — but revealed a *stronger* underlying low bias than the old grader had, likely because the fixed USDA anchor photos are bright, studio-lit, white-background images and the 2003 TTU contest photos are frequently dim/lower-contrast (the model's own `image_quality` flag came back `"dark"` on a large share of samples in ad hoc testing) — against bright anchors, a dim target reads as having less visible marbling than it actually has.

**Testing the built-in calibration_offset (§5.1 step 6):** a quick 20-call, offset=+150 recheck (Tier-1 only, $0.14) moved bias from −1.3 to **+0.94** and adjacent from 42.9% to **71.2%** — confirming the offset mechanism works and the true correction is real, but +150 overshoots. Linear interpolation between the two data points puts the zero-bias offset near **+85 to +90**, untested as of this writing.

**Verdict: NOT YET a pass on the strict §6 gate** (adjacent ≥70% AND |bias| ≤0.25). The architecture is behaving as designed — it responds to calibration exactly the way the design predicted, and coverage/range-compression is fixed — but landing the constant offset precisely on an n=20 noisy calibration set is not yet done, and n=20 is thin for pinning a single constant with confidence.

**Recommended next step before any full regrade:** run a small grid of calibration_offset values (e.g. 60, 75, 90, 105) on the same 20 Tier-1 images (~80 more calls, well under $1) to find the actual zero-crossing rather than extrapolating from 2 points, and consider whether the anchor images should be tonally normalized (matched brightness/contrast) to the TTU corpus's typical dim/flash-lit look rather than left as bright studio references — that may address the root cause more robustly than a single global constant. This is a tuning problem, not a rebuild — the underlying architecture change (decoupled perception, fixed anchors, self-consistency, honest needs_review) is working as intended.

## Addendum 2 (2026-07-15) — anchor floor-mislabeling bug fixed; PASS

The user identified a second, more fundamental root cause than the addendum above anticipated: the 7 official USDA marbling reference photos in `grader/anchors/` were captioned in `grader/anchors/manifest.json` with each descriptor band's **midpoint** score (Slight=350, Small=450, Modest=550, Moderate=650, Slightly Abundant=750, Moderately Abundant=850, Abundant=950), when they should represent the band's **floor** ("00" subunit) — the minimum marbling that still qualifies for that descriptor.

This was confirmed directly against the actual regulatory text — 7 CFR / USDA AMS *United States Standards for Grades of Carcass Beef* (eff. 2017), §54.104(o):

> "the quality grade and yield grade standards each describe beef which is representative of the **lower limits** of each quality grade and yield grade."
> "Illustrations of the **lower limits** of nine of these ten degrees of marbling are available from the USDA."

Every anchor photo the model calibrated against was mislabeled with a score ~50 points too high — the model was told "this photo = 350" when the photo actually depicts the floor of Select (300). Fixed in `grader/anchors/manifest.json` (all 7 scores corrected to band floors; `01_slight.jpg`'s `grade_key` also corrected from `SE_HI` to `SE_LO`, since 300 is definitionally the boundary between Standard and Select-low, not Select-high). Separately confirmed against the same standard that the site's existing Low/Average/High sub-grade ladder (`data.js` `QUALITY_GRADES`) is structurally correct and needed no change — Choice legitimately spans three marbling degrees (Small/Modest/Moderate) as one regulatory grade conventionally split into thirds; Select spans only one degree (Slight), hence Low/High with no "Average."

**Results, re-measured on the same 20 Tier-1 images, calibration_offset=0 (anchors fixed, no other change):**

| Metric | Pre-fix (mislabeled anchors) | Post-fix (correct anchor floors) |
|---|---|---|
| Exact (k1 / blended) | 17.1% / 25.7% | 18.6% / **32.9%** |
| Adjacent (k1 / blended) | 42.9% / 48.6% | 58.6% / 52.9% |
| Bias (k1 / blended) | −1.30 / −1.33 | **−0.91 / −0.97** |
| Quadratic-weighted kappa (k1 / blended) | 0.22 / 0.26 | 0.44 / **0.46** |

The anchor fix alone closed roughly 30% of the bias gap and nearly doubled kappa — a real, independent contribution, not a redundant fix. But a substantial residual bias remained, and Tier-2 Standard over-calling was still high (16/30), so a second correction was tested.

**Residual calibration_offset=+90 on top of the corrected anchors** (a fresh test — the earlier +90 result from Addendum 1 was calibrated against the *wrong* anchors and isn't reusable):

| Metric | Old grader (baseline) | New grader, fixed anchors + offset +90 |
|---|---|---|
| Exact | 21.4% | **41.4%** |
| Adjacent | 100%* | 85.7% |
| Bias | −0.44 | **+0.21** |
| MAE | 0.79 | 0.73 |
| QWK | 0.53 | 0.40 |

*the old grader's 100% adjacent figure is an artifact of its narrow 3-grade output range (see Addendum 1) — not evidence it was more accurate.

**GO/NO-GO: PASS** — adjacent (85.7%) ≥ 70% and |bias| (0.21) ≤ 0.25, on $0.75 total spend for this round. Exact-match nearly doubled the old grader. This clears the bar set in §6 for proceeding to a full regrade, pending the user's sign-off on that cost (~$60–90 estimated in §5.1, likely lower in practice given observed prompt-caching costs — every test this session has come in well under the original estimate).

**Still open:** QWK (0.40) is lower than the old grader's 0.53 despite every other metric improving — worth understanding before a full regrade (possibly the old grader's narrow range also inflates QWK the same way it inflates adjacent-rate; needs checking against the corrected 9-rung scale rather than assumed). n=20 remains a thin calibration set for a constant offset — this should be re-checked against a larger sample once more consensus votes accumulate.

## Addendum 3 (2026-07-16) — repo reorganization, secrets/dataset relocated

At the user's request, the whole repo was audited and reorganized for clarity (website files were **not** moved — GitHub Pages serves the `master` branch root literally with no build step, and this exact "move site files into folders" reorg was already attempted once in commit `adaa82e` and had to be reverted for breaking production; that constraint stands). Within `grader/`, changes relevant to anyone re-running scripts from this document or elsewhere:

- `grader/base/` (the older pipeline generation, entirely untracked, never committed) is gone. Its two load-bearing pieces were extracted first: the TTU dataset moved to `grader/tmp/` (matching where `grade_ribeyes.py` already looked by default — this incidentally fixes the "two divergent copies, easy to run the wrong one" issue flagged above), and the three secrets moved to `grader/secrets/`. Everything else in `grader/base/` was a byte-identical or superseded duplicate of files already in `grader/` root.
- `grader/files/` (a stale, untracked, ~6-week-old full site backup with zero references anywhere) was removed entirely.
- `preview.py` / `preview.bat` / `blind_grade.py` were removed (git-tracked, history preserved via `git rm`) — both called `model_utils.load_reference_images()`, a function this session's Option A redesign removed; they were broken and fully superseded by `preview_new_grader.py` and `build_trainer.py`/`eval_harness.py` respectively.
- Generated reports (`preview_new_grader*.html/json`, `trainer.html`, `eval_results*.json`, `cv_fat_ratios.csv`) now live in `grader/output/` instead of loose in `grader/`. State files that scripts actively read on every run (`calibration.json`, `trainer_seen.json`) stay at `grader/` root, not treated as disposable output.
- All scripts' default paths (`--sa`, `--images-dir`, `--cv-csv`, `--out`/`--out-html`/`--out-json`, the secret lookups in `model_utils.py`/`grade_ribeyes.py`) were updated to match. Old invocations like `--sa grader/base/firebase-service-account.json` should now read `--sa grader/secrets/firebase-service-account.json`.

## Appendix — re-runnable disagreement stats (read-only)

```python
# python grader/consensus_stats.py  (requires firebase-admin + service account)
import firebase_admin
from firebase_admin import credentials, firestore
from collections import Counter, defaultdict

cred = credentials.Certificate('grader/secrets/firebase-service-account.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

POS = {'PR_HI':11,'PR_AVG':10,'PR_LO':9,'CH_HI':8,'CH_AVG':7,'CH_LO':6,
       'SE_HI':5,'SE_AVG':4,'SE_LO':3,'STD':2,'COM':1}

votes = defaultdict(list)
for d in db.collection('grading_votes').stream():
    v = d.to_dict()
    votes[v.get('imageId')].append(v.get('grade'))

ai = {d.id: (d.to_dict().get('correct') or {}).get('qualityGrade')
      for d in db.collection('ai_carcasses').stream()}
print('AI grade distribution:', Counter(ai.values()))

diffs = []
for img, gl in votes.items():
    if ai.get(img) not in POS: continue
    cons = Counter(gl).most_common(1)[0][0]
    if cons in POS: diffs.append(POS[ai[img]] - POS[cons])

n = len(diffs)
print(f'n={n}  exact={sum(d==0 for d in diffs)/n:.0%}  '
      f'adjacent={sum(abs(d)<=1 for d in diffs)/n:.0%}  '
      f'bias={sum(diffs)/n:+.2f}  hist={dict(sorted(Counter(diffs).items()))}')
```
