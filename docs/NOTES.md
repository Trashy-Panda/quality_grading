# Firebase Setup Guide (Do This Once — ~10 min)

Before the weekly challenge and leaderboard will work, you need a free Firebase account.
Follow these steps **exactly** — it's easier than it looks.

## Step 1 — Create a Firebase Project
1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **"Add project"**
3. Name it `beef-grading-drill` (or anything you want)
4. Disable Google Analytics (not needed) → **Create project**

## Step 2 — Enable Firestore Database
1. In the left sidebar click **"Firestore Database"**
2. Click **"Create database"**
3. Choose **"Start in production mode"** → Next
4. Pick any location (closest to you) → **Enable**
5. Go to the **Rules** tab and paste this, then click **Publish**:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read: if true;
      allow write: if request.auth.uid == uid;
    }
    match /submissions/{docId} {
      allow read: if true;
      allow create: if request.auth != null
        && request.resource.data.userId == request.auth.uid;
      allow update, delete: if false;
    }
  }
}
```

## Step 3 — Enable Authentication
1. In the left sidebar click **"Authentication"**
2. Click **"Get started"**
3. Click **Google** → toggle Enable → add your email as support email → **Save**
4. Click **GitHub** → toggle Enable
   - You'll need a GitHub OAuth app: go to github.com → Settings → Developer settings → OAuth Apps → New OAuth App
   - Homepage URL: `https://beefgrading.study`
   - Callback URL: copy the one shown in Firebase (looks like `https://your-project.firebaseapp.com/__/auth/handler`)
   - Click Register, then copy the Client ID and Client Secret back into Firebase → **Save**

## Step 4 — Get Your Config Values
1. In the left sidebar click the **gear icon** → **Project settings**
2. Scroll down to **"Your apps"** → click the `</>` (web) icon
3. Name the app `beef-grading-drill` → **Register app**
4. You'll see a `firebaseConfig` object like this:
```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

## Step 4b — Update Firestore Rules (replace with this expanded version)
In Firebase Console → Firestore → Rules, replace everything with:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read: if true;
      allow write: if request.auth.uid == uid;
    }
    match /submissions/{docId} {
      allow read: if true;
      allow create: if request.auth != null
        && request.resource.data.userId == request.auth.uid;
      allow delete: if request.auth != null;
      allow update: if false;
    }
    match /weeks/{weekId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```
Click **Publish**.

## Step 5 — Paste Into the App
1. Open `data.js`
2. Find `const FIREBASE_CONFIG = {` near the top
3. Replace each `"PASTE_YOUR_..."` value with the actual values from Step 4
4. Save the file

## Step 6 — Test It
- Open `index.html` locally in your browser
- You should see "Sign In" in the header
- Click it → sign in with Google → your name should appear
- Start a weekly challenge, finish it, click "Submit to Leaderboard"
- Open the Leaderboard — your score should appear

---

# Firestore Collections Schema

## grading_votes
Crowdsource grading votes submitted by authenticated users on `ai_carcasses` images.

| Field | Type | Constraints |
|---|---|---|
| `imageId` | string | non-empty; doc ID from `ai_carcasses` collection |
| `imageUrl` | string | must start with `https://` |
| `userId` | string | must equal `request.auth.uid` |
| `grade` | string | one of: `PR_HI`, `PR_AVG`, `PR_LO`, `CH_HI`, `CH_AVG`, `CH_LO`, `SE_HI`, `SE_LO`, `STD` |
| `submittedAt` | timestamp | server timestamp only (`request.time`) |

**Access rules:**
- read: authenticated users can read their own votes only (`resource.data.userId == request.auth.uid`)
- create: authenticated users only, all fields validated (see above)
- update: never
- delete: admin only (`KLoBqbA2P9UkQ83urzmgpxT4Oit1`)

**Note:** No unique-vote deduplication enforced at docId level (unlike submissions). If
one-vote-per-image-per-user is needed, use docId pattern `{uid}_{imageId}` in the client.

## meat_contests
Collegiate meat judging contest results powering the Power Rankings display.
One doc per contest per division. DocId slug: `{date}_{name}_{division}`
(e.g. `2026-01-18_national-western_senior`).

**Not currently linked from the public site.** The rankings display
(`powerrank.js` + `powerrank.css`) lives inside admin.html's Power Rankings
tab, behind a "Public Rankings Preview" `<details>` toggle — admin-auth-gated,
same as the rest of that tab — while the ranking methodology is still being
refined. It was pulled from `index.html` (and the site nav) on 2026-07-21; the
Firestore collection itself, its rules, and read access are unchanged (still
public read, admin-only write) since moving the *display* doesn't require
moving the *data*.

| Field | Type | Constraints |
|---|---|---|
| `name` | string | 1–200 chars |
| `shortName` | string | 1–60 chars |
| `date` | string | ISO `yyyy-mm-dd` (regex-validated) |
| `season` | int | 2000–2100 (calendar year) |
| `division` | string | `senior` or `junior` |
| `weight` | number | 1–2 (International = 2, default 1) |
| `sourceUrl` | string | optional; must start with `https://` if present |
| `teamCount` | int | 1–80 |
| `results` | list | size 1–80; elements `{school, place, score?, categories?}` |
| `createdAt` | timestamp | server time on create; immutable on update |
| `updatedAt` | timestamp | server time on every write |

**Access rules:**
- read: public (rankings render without auth)
- create/update: admin only (`KLoBqbA2P9UkQ83urzmgpxT4Oit1`), all scalar fields validated
- delete: admin only

**Note:** Rules can't iterate list elements, so `results` element contents are
admin-trusted (validated only as `is list` + size 1–80) — same caveat as
`submissions.answers`. After changing `firestore.rules`, the file must be manually
published in Firebase Console → Firestore Database → Rules → Publish (rules do not
deploy with the site).

**`teamCount` semantics differ by ingest source — both exist to keep
`placementFactor` (rank-sensitive) from being fed a `place` larger than the
field it's being scored against, which produces `NaN` and poisons every
rating in that season+division:**
- `powerrankings/ingest_judgingcard.py` (modern scrapes): after deduping raw
  judgingcard rows (which count every alternate/practice squad as its own
  entry) down to one best-place-per-school, the survivors are **renumbered**
  into a clean sequential 1..M ranking and `teamCount = M`. We know the true
  competing field here (every school that actually entered), so renumbering
  is accurate — it only removes artifacts of squad-alternate clutter.
- `powerrankings/ingest_historic.py` (1926–2025 PDF archive): the archive
  only tracks a fixed set of schools as table rows across the decades, so a
  given year's true field can include entrants who never got a row, and
  their recorded place can legitimately exceed the row count. `teamCount =
  max(len(results), max place seen that year)` — a defensible lower-bound
  estimate, not a renumbering (we don't know the full historic field).

**`altOnlySchools` (transient import hint, not part of the schema):**
`ingest_judgingcard.py` flags schools whose *every* raw judgingcard entry was
an alternate-squad row ("... Alt", "... Alt 3") with no plain-name or
color/mascot-squad entry ever seen — meaning the captured placement/score may
reflect a single competitor or JV squad rather than the real team (found
live: Houston 2026 senior's "University of Nebraska" entry scored 981 vs.
~4000+ for every real 4-person team). This is emitted as a top-level
`altOnlySchools: ["School Name", ...]` array in the scraper's output JSON —
**never written to Firestore.** The admin Power Rankings → Import flow reads
it to badge affected rows with an "unverified — alt squad only" flag and a
per-row exclude toggle; whatever the admin decides (keep, edit, or exclude)
is what gets saved, and the hint array itself is stripped before the write.

**Rating methodology (not a schema field):** a school's rating is the mean of
its own top-5 real resultRatings this season (or however many it has, if
fewer than 5) — no padding, no cross-season blending. An earlier version of
the engine tried filling missing result-slots with a prior-season-informed
estimate (carryover); this was reverted on 2026-07-21 after real-data testing
found it could still let a thin résumé's estimated slots outscore what the
same team actually did in a small sample (e.g. 2 real bad results padded by a
correctly-mediocre-but-still-kinder-than-reality historic average), and could
let a team that lost head-to-head to another program still rank above them.
Trying to estimate what a thin résumé "would have" scored kept producing new
edge cases; the simpler fix was to stop estimating.

**Participation threshold (rating methodology, not a schema field):** a
school only gets a numbered rank if it has at least `min(3,
maxContestsAnyoneInThatSeasonAndDivisionPlayed)` real results this season.
The cap on the "3" matters — some early archive seasons never tracked more
than 1-2 contests at all, so a flat "need 3" would leave those seasons
completely unranked; the relative cap relaxes to whatever was actually
achievable that season. Schools below the threshold are still shown, in a
separate "Not Yet Ranked — Limited Data This Season" list with their real
results (no fabricated rating implying a false rank). `weight` (International
= 2×) amplifies deviation from the field's centered average rather than
flatly multiplying the raw value — otherwise merely attending a weighted
contest could outscore winning an unweighted one, since placementFactor never
drops much below ~0.90 even for a bad placement. The historic archive data
(1926–2026, 539 docs) stays in Firestore regardless of any of the above — it
just isn't used to blend current-season ratings anymore; it's earmarked for a
future "program history / most championships" feature.

---

# Dev Workflow Cheat Sheet

## The Two Branches
- **master** — your live site at beefgrading.study. Never experiment here.
- **dev** — your sandbox. Break things, try ideas, no consequences.

---

## Switching Branches (No Commands Needed)
1. Look at the **bottom-left corner of VS Code** — it shows your current branch
2. Click it → a dropdown appears
3. Pick `master` or `dev`

That's it. Your files will update instantly to reflect whichever branch you're on.

> Tip: Keep a browser tab open to your local `index.html` for dev preview,
> and another tab open to `beefgrading.study` for the live site.

---

## Saving Your Work (Committing)
When you've made changes on dev and want to save a snapshot:
1. Click the **Source Control icon** in the left sidebar (looks like a git branch)
2. You'll see your changed files listed
3. Type a short message describing what you changed (e.g. "testing new color scheme")
4. Click the **Commit** button

Think of a commit like a save point in a video game — you can always return to it.

---

## Pushing
**Pushing** = uploading your local commits to GitHub.

Your commits only exist on your computer until you push. After committing:
- Click the **Sync Changes** button that appears in the Source Control panel
- This sends your dev branch changes up to GitHub (but NOT to your live site — dev and master are separate)

Why push dev at all? Backup. If your computer dies, your experiments are safe on GitHub.

---

## Merging Dev → Master (Going Live)
**Merging** = taking all the changes from dev and applying them to master.
This is how you go from "I like this" to "put it on the live site."

**Easiest way: just run `deploy.bat`**
- Double-click it in File Explorer, or run it in the terminal
- It merges dev into master, pushes to GitHub, and switches you back to dev automatically
- Live site updates within a minute or two

Alternatively, you can do it through GitHub's website:
1. Go to your repo on GitHub
2. Click **"Compare & pull request"** → **"Create pull request"** → **"Merge"**

---

## Didn't Like the Changes? Reset Dev
If your dev experiments went sideways and you want to start fresh from master:
1. Switch to `dev` branch (bottom-left corner)
2. Open the terminal in VS Code (Ctrl + `)
3. Run: `git reset --hard master`

This wipes all uncommitted dev changes and puts dev back in sync with master.

---

## Quick Visual
```
[dev branch]  →  experiment  →  commit  →  push to GitHub
                                                  ↓
                                    open GitHub website
                                    create pull request
                                          ↓
                                   merge into master
                                          ↓
                              beefgrading.study updates
```
