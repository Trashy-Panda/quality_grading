# GradeThisMeat (beefgrading.study)

A beef-carcass quality-grading training site: students practice assigning USDA quality
grades to ribeye photos, with an AI grader (see `grader/`) providing seed content and a
crowd-consensus loop for calibration. Static site, no build step — Firebase (Firestore +
Auth) is the only backend.

This whole folder is the project — everything for beefgrading.study lives here, as a
single unit sibling to `.claude/`/`.agents/` (shared tooling across other projects, not
part of this one) at the true repo root. `CLAUDE.md` is an exception, staying at
repo root itself since Claude Code auto-loads project instructions from the working
directory. The repo-root `README.md` is the GitHub landing page for the whole project.

## Where things live

| Folder / area | What it is |
|---|---|
| **this folder's root** | The live website — HTML/CSS/JS published to GitHub Pages by `.github/workflows/deploy-pages.yml`. See "How it's served" below. |
| **`grader/`** | The Python AI grading pipeline (Claude Vision + USDA reference calibration) — see [`grader/README.md`](grader/README.md) and [`grader/AUDIT_AND_REDESIGN.md`](grader/AUDIT_AND_REDESIGN.md) for the full methodology/history. |
| **`powerrankings/`** | Offline tooling for the collegiate meat judging Power Rankings section — judgingcard.com ingest script + methodology notes. See [`powerrankings/README.md`](powerrankings/README.md). |
| **`deployment/`** | `deploy.bat` (the sanctioned way to ship `dev` → `master`), plus `sync.bat` and a disabled auto-sync script — see comments in each file before using. |
| **`docs/`** | Setup/reference docs: `NOTES.md` (Firebase setup walkthrough) and three HTML files (`auth.html`, `weekly.html`, `leaderboard.html`) that are dev-reference snippets, **not live pages** — their markup is already merged into `index.html`. |

Outside this folder, at the true repo root: `CLAUDE.md` (must stay there, see above),
`.claude/`/`.agents/` (shared Claude Code tooling, not this project),
`projects.code-workspace` (ties this repo + `pony-express-website/`, an unrelated
project, together as a VS Code multi-root workspace).

## The website (this folder's root)

| File | Purpose |
|---|---|
| `index.html` | The whole app — grading drill, auth, weekly challenge, leaderboard, and Power Rankings (linked from the site nav) are all sections within this one page. |
| `admin.html` | Admin panel (manage community carcasses, review crowd votes, weekly challenges, Power Rankings contest data). |
| `app.js` / `data.js` / `auth.js` / `weekly.js` / `leaderboard.js` / `powerrank.js` / `admin.js` | Corresponding logic for each area (`powerrank.js` = collegiate meat judging Power Rankings engine + section). |
| `style.css` / `premium.css` / `auth.css` / `weekly.css` / `leaderboard.css` / `powerrank.css` / `fieldguide.css` / `admin.css` | Styling, split by area. |
| `beefgrade.svg` / `og-card.png` | Site logo/shield icon and social-share preview image (the latter referenced by absolute URL in `index.html`'s OpenGraph tags). |
| `assets/` | Reference photos (`assets/anchors/`) and background art (`assets/art-*.png`) loaded by `index.html`/CSS at root-relative paths. |
| `404.html` | GitHub Pages custom error page (convention: must sit at the published root). |
| `firestore.rules` | Firestore security rules — published manually via Firebase Console (not deployed automatically). |
| `CNAME` | Custom domain config for GitHub Pages (`beefgrading.study`). |

## How it's served

`.github/workflows/deploy-pages.yml` (at the true repo root, required by GitHub Actions)
publishes this folder's contents as the GitHub Pages site on every push to `master` —
`beefgrading.study/index.html` becomes `/index.html` on the live domain, etc. This
decouples what Pages serves from where files sit in the repo, which is what makes a
project folder like this one possible at all.

**Historical note**, kept for context: this project used to require all live site files
to sit at the literal repo root, because Pages read `master`'s branch tree directly with
no build step in between — moving files into a subfolder broke production once (commit
`adaa82e`, before this reorg). That's no longer the constraint once a publish step
(the Actions workflow above) sits between the repo and what Pages actually serves.

Note also that `grader/`, `docs/`, `deployment/`, `powerrankings/`, and this file itself
get published alongside the live site (nothing separates "served" from "tooling" within
this folder yet) — harmless today since nothing in them is sensitive (no PII, no
secrets — those are gitignored regardless of where they sit), but worth knowing if
that's ever a concern; a `site/` subfolder split is a clean, optional future refinement.

## Branch model

- `dev` — work here.
- `master` — production, auto-deploys via the Actions workflow above once pushed. Ship
  via `deployment/deploy.bat` (still just merges `dev` into `master` and pushes — the
  Actions publish step runs automatically afterward).

See [`../CLAUDE.md`](../CLAUDE.md) for the full agent-orchestration workflow used when
working on this repo with Claude Code.
