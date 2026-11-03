# beefgrading.study

USDA beef quality-grading drill for FFA / 4-H / collegiate meat judging.
Static site: vanilla HTML/CSS/JS, no build step, no npm. Backend: Firebase
Firestore + Auth. Live at beefgrading.study.

## Layout
- Everything for this project lives in `beefgrading.study/` (site, `grader/`,
  `docs/`, `deployment/`, `powerrankings/`, README). `.claude/` and `.agents/`
  at repo root are shared tooling, not part of the site.
- Live site files: index.html, 404.html, admin.html, *.css, app.js, auth.js,
  data.js, weekly.js, leaderboard.js, powerrank.js, admin.js, scroll.js, assets/,
  CNAME, firestore.rules. auth/weekly/leaderboard .html are reference docs in docs/.
- Design tokens: `style.css` `:root` is the single source of truth.

## Branches and deploy
- Work on `dev`. `master` is production.
- `.github/workflows/deploy-pages.yml` publishes `beefgrading.study/` on every push
  to `master`. `deployment/deploy.bat` merges dev -> master and pushes.
- Never push or merge to master without the user's go AND a passing security
  review (use the `security-auditor` subagent).

## Hard rules
- `addEventListener` only; never inline `onclick=` / `onerror=`.
- `escapeHtml()` on any user data written via innerHTML; attribute values via an
  escaper covering `& < > " '`.
- No `addEventListener('scroll')`. Animate transform/opacity only; every animation
  has a `prefers-reduced-motion` path. Hidden reveal states stay scoped to `.js-reveals`.
- `FIREBASE_CONFIG` in data.js is intentionally public. Do not move it to .env.
- Admin UID: `KLoBqbA2P9UkQ83urzmgpxT4Oit1` (checked in admin.js AND firestore.rules).

## Workflow
- Design work: Hallmark skill (`/hallmark`), plus design-taste preflight as a gate:
  `node ../.claude/skills/design-taste/scripts/preflight.mjs <files>` from beefgrading.study.
- Visuals: build in SVG/CSS on the theme tokens first; Canva generate-image only
  when code cannot do it.
- Local preview: dev server on http://localhost:8000 (no-cache); check with the
  Playwright MCP at 390 and 1440 wide.
- Delegate multi-file execution to subagents on Sonnet (Haiku for grep/audit);
  orchestrator plans and reviews.
- Path-scoped detail lives in `.claude/rules/` and loads only when relevant.

## Output
Be concise. No recaps of what was just shown.

# Compact instructions
When compacting, keep: current branch and last commit, open tasks, user decisions,
any failing checks. Drop tool output dumps and screenshots.
