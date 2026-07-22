# GradeThisMeat (beefgrading.study)

A beef-carcass quality-grading training site: students practice assigning USDA quality
grades to ribeye photos, with an AI grader (see `grader/`) providing seed content and a
crowd-consensus loop for calibration. Static site, no build step — Firebase (Firestore +
Auth) is the only backend.

## Where things live

| Folder / area | What it is |
|---|---|
| **repo root** | The live website — HTML/CSS/JS served directly by GitHub Pages. **Must stay at root** (see "Why root?" below). |
| **`grader/`** | The Python AI grading pipeline (Claude Vision + USDA reference calibration) — see [`grader/README.md`](grader/README.md) and [`grader/AUDIT_AND_REDESIGN.md`](grader/AUDIT_AND_REDESIGN.md) for the full methodology/history. |
| **`powerrankings/`** | Offline tooling for the collegiate meat judging Power Rankings section — judgingcard.com ingest script + methodology notes. See [`powerrankings/README.md`](powerrankings/README.md). |
| **`deployment/`** | `deploy.bat` (the sanctioned way to ship `dev` → `master`), plus `sync.bat` and a disabled auto-sync script — see comments in each file before using. |
| **`docs/`** | Setup/reference docs: `NOTES.md` (Firebase setup walkthrough) and three HTML files (`auth.html`, `weekly.html`, `leaderboard.html`) that are dev-reference snippets, **not live pages** — their markup is already merged into `index.html`. |
| **`.claude/`** | Claude Code tooling config (skills, permissions) — not app code. |
| **`pony-express-website/`** | A separate, unrelated project that happens to share this directory as a VS Code multi-root workspace (see `projects.code-workspace`). |

## The website (repo root)

| File | Purpose |
|---|---|
| `index.html` | The whole app — grading drill, auth, weekly challenge, and leaderboard are all sections within this one page. |
| `admin.html` | Admin panel (manage community carcasses, review crowd votes, weekly challenges). |
| `app.js` / `data.js` / `auth.js` / `weekly.js` / `leaderboard.js` / `powerrank.js` / `admin.js` | Corresponding logic for each area (`powerrank.js` = collegiate meat judging Power Rankings engine + section). |
| `style.css` / `premium.css` / `auth.css` / `weekly.css` / `leaderboard.css` / `powerrank.css` / `fieldguide.css` / `admin.css` | Styling, split by area. |
| `beefgrade.svg` | Site logo/shield icon. |
| `firestore.rules` | Firestore security rules — published manually via Firebase Console (not deployed automatically). |
| `CNAME` | Custom domain config for GitHub Pages (`beefgrading.study`). |

### Why root?

GitHub Pages serves the `master` branch's root directory literally — there's no build
step, no `/docs`-folder mode in use, nothing that lets HTML/CSS/JS live anywhere else
and still be reachable at the live URLs. `deployment/deploy.bat` works by merging `dev`
into `master` and pushing — so **any folder restructuring of the live site files on
`dev` would carry through to `master` on the next deploy and break production.** This
already happened once (see commit `adaa82e`, which reverted an earlier attempt to move
site files into a subfolder). If true folder separation for the website is wanted later,
it needs a GitHub Actions build step (or a Pages source-setting change) first — not just
a file move.

## Branch model

- `dev` — work here.
- `master` — production, auto-deploys via GitHub Pages. Ship via `deployment/deploy.bat`.

See [`CLAUDE.md`](CLAUDE.md) for the full agent-orchestration workflow used when working
on this repo with Claude Code.
