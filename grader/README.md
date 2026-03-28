# AI Ribeye Grading Pipeline

Grades ~2,857 TTU ribeye images using color-based intramuscular fat segmentation,
then uploads every image + its predicted grade to Cloudinary (image hosting) +
Firebase Firestore (database) so they appear live on gradethismeat.xyz.

---

## How it works

1. Downloads TTU Ribeyes.zip (~2,857 images) automatically
2. Analyzes each image using HSV pixel segmentation to measure intramuscular fat ratio
3. Maps fat ratio → USDA marbling score (0–1100) → grade key (`CH_HI`, `PR_LO`, etc.)
4. Uploads the image to **Cloudinary** → gets a permanent public HTTPS URL
5. Writes a document to **Firestore `community_carcasses`** with the image URL + grade
6. Images appear immediately in the Community Set and Weekly Challenge pool on the site

No ML model needed — uses the same color analysis technique as USDA's Computer Vision System.

---

## Setup

### 1. Install dependencies

```bash
pip install -r grader/requirements.txt
```

### 2. Get a Cloudinary account (free, no credit card)

1. Sign up at **https://cloudinary.com** (free tier: 25GB storage, 25GB bandwidth/month)
2. After signing in, go to your **Dashboard**
3. Note your **Cloud Name**, **API Key**, and **API Secret**

### 3. Get a Firebase service account key

1. Go to [Firebase Console](https://console.firebase.google.com) → beef-grading-drill project
2. Project Settings (gear icon) → **Service accounts** tab
3. Click **Generate new private key** → **Generate key**
4. Save the downloaded JSON as `grader/firebase-service-account.json`

> Keep this file secret — it has admin access to your Firebase project.
> It is already in `.gitignore`.

---

## Running

### Test run (5 images first)

```bash
python grader/grade_ribeyes.py \
  --sa grader/firebase-service-account.json \
  --cloud-name YOUR_CLOUD_NAME \
  --api-key YOUR_API_KEY \
  --api-secret YOUR_API_SECRET \
  --limit 5
```

After this runs, check:
- Cloudinary Dashboard → Media Library → `ribeyes/` folder has 5 images
- Firestore → `community_carcasses` collection has 5 new docs with `imageUrl` + `correct.qualityGrade`
- Open one `imageUrl` in your browser → image loads from `res.cloudinary.com`
- gradethismeat.xyz → community carcasses → new images appear

### Dry run (grade only, no uploads)

```bash
python grader/grade_ribeyes.py \
  --sa grader/firebase-service-account.json \
  --cloud-name x --api-key x --api-secret x \
  --dry-run
```

### Full run (all ~2,857 images)

```bash
python grader/grade_ribeyes.py \
  --sa grader/firebase-service-account.json \
  --cloud-name YOUR_CLOUD_NAME \
  --api-key YOUR_API_KEY \
  --api-secret YOUR_API_SECRET
```

Takes ~30–60 minutes depending on your internet speed (2,857 image uploads).

### If you already have the ZIP downloaded

```bash
python grader/grade_ribeyes.py \
  --sa grader/firebase-service-account.json \
  --cloud-name YOUR_CLOUD_NAME \
  --api-key YOUR_API_KEY \
  --api-secret YOUR_API_SECRET \
  --zip path/to/Ribeyes.zip
```

---

## CLI options

| Flag | Default | Description |
|---|---|---|
| `--sa` | (required) | Path to `firebase-service-account.json` |
| `--cloud-name` | (required) | Cloudinary cloud name |
| `--api-key` | (required) | Cloudinary API key |
| `--api-secret` | (required) | Cloudinary API secret |
| `--zip` | auto-download | Path to `Ribeyes.zip` (skips download if provided) |
| `--images` | — | Path to folder of extracted images (skips ZIP entirely) |
| `--limit` | `0` (all) | Max images to process (useful for testing) |
| `--dry-run` | false | Grade images but skip all uploads |

---

## Grade mapping

The script measures intramuscular fat ratio and maps it to the website's 11-grade system:

| Score range | Grade key | Label |
|---|---|---|
| 900–1100 | `PR_HI` | High Prime |
| 800–899 | `PR_AVG` | Average Prime |
| 700–799 | `PR_LO` | Low Prime |
| 600–699 | `CH_HI` | High Choice |
| 500–599 | `CH_AVG` | Average Choice |
| 400–499 | `CH_LO` | Low Choice |
| 350–399 | `SE_HI` | High Select |
| 300–349 | `SE_AVG` | Average Select |
| 200–299 | `SE_LO` | Low Select |
| < 200 | `STD` | Standard |

---

## Grading technique

Same core approach as USDA's Computer Vision System:
1. Convert image to HSV color space (pure numpy, no OpenCV required)
2. Exclude background (dark pixels V < 35)
3. Identify lean meat (red-pink hue, H 0–22°, moderate saturation)
4. Identify intramuscular fat (cream/white, low saturation S < 0.38, high brightness V > 140)
5. Compute fat ratio = fat pixels / (fat + lean pixels)
6. Map ratio → USDA marbling score via piecewise linear interpolation
7. Map score → grade key
