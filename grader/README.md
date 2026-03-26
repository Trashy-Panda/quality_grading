# AI Ribeye Grading Pipeline

Grades ~2,000 TTU ribeye images using the 1st-place USDA/CSU hackathon model
(ResNet50 transfer learning), then uploads every image + its predicted grade to
Firebase so they appear live on gradethismeat.xyz.

---

## How it works

1. Downloads TTU Ribeyes.zip (~2,000 images)
2. Runs each image through the pre-trained ResNet50 model
3. Converts the predicted marbling score to a USDA grade key (`CH_HI`, `PR_LO`, etc.)
4. Uploads the image to **Firebase Storage** → gets a permanent public URL
5. Writes a document to **Firestore `community_carcasses`** with the image URL + grade
6. Images appear immediately in the Community Set and Weekly Challenge pool on the site

---

## Setup

### 1. Install dependencies

```bash
pip install -r grader/requirements.txt
```

### 2. Download the pre-trained model

Download `best_model.keras` from the 1st-place hackathon team's Google Drive:

**https://drive.google.com/file/d/1suQxD6kJ8wviCNpbCZZRWIENzsGF6him/view**

Save it anywhere — you'll pass the path via `--model`.

### 3. Get a Firebase service account key

1. Go to [Firebase Console](https://console.firebase.google.com) → beef-grading-drill project
2. Project Settings (gear icon) → **Service accounts** tab
3. Click **Generate new private key** → **Generate key**
4. Save the downloaded JSON as `grader/firebase-service-account.json`

> Keep this file secret — it has admin access to your Firebase project.
> It is already in `.gitignore`.

### 4. Enable Firebase Storage

1. Firebase Console → **Storage** → Get started
2. Choose a region (us-central1 is fine) → Done
3. The free Spark plan includes 5 GB — enough for ~2,000 JPEG images

---

## Running

### Test run (5 images first)

```bash
python grader/grade_ribeyes.py \
  --model best_model.keras \
  --sa grader/firebase-service-account.json \
  --limit 5
```

After this runs, check:
- Firebase Console → Storage → `ribeyes/` folder has 5 images
- Firestore → `community_carcasses` collection has 5 new docs with `imageUrl` + `correct.qualityGrade`
- Open one `imageUrl` in your browser → image loads
- gradethismeat.xyz → Settings → Community Set → new images appear

### Full run (all ~2,000 images)

```bash
python grader/grade_ribeyes.py \
  --model best_model.keras \
  --sa grader/firebase-service-account.json
```

Takes ~15–30 minutes depending on your internet speed and GPU.

### If you already have the ZIP downloaded

```bash
python grader/grade_ribeyes.py \
  --model best_model.keras \
  --sa grader/firebase-service-account.json \
  --zip path/to/Ribeyes.zip
```

---

## CLI options

| Flag | Default | Description |
|---|---|---|
| `--model` | (required) | Path to `best_model.keras` |
| `--sa` | (required) | Path to `firebase-service-account.json` |
| `--zip` | auto-download | Path to `Ribeyes.zip` (skips download if provided) |
| `--bucket` | `beef-grading-drill.appspot.com` | Firebase Storage bucket |
| `--batch` | `32` | Inference batch size (reduce to `8` if you get OOM errors) |
| `--limit` | `0` (all) | Max images to process (useful for testing) |

---

## Grade mapping

The model predicts a marbling score on the USDA 0–1100 scale.
The script maps it to the website's 11-grade system:

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

## Model source

- Team: coenpetto (1st place, USDA/CSU Hackathon, April 2024)
- Architecture: ResNet50 (ImageNet pretrained, frozen) + regression head
- Training data: ~1,401 labeled ribeye images, Path1 Challenge dataset (USDA-AMS)
- Repo: https://github.com/coenpetto/USDA-Hackathon-4-6-24
