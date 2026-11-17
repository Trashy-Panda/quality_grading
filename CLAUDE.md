# beefgrading.study

USDA beef quality-grading drill for FFA / 4-H / collegiate meat judging.
Static site: vanilla HTML/CSS/JS, no build step, no npm. Backend: Firebase
Firestore + Auth. Live at beefgrading.study.

## Layout
- Everything for this project lives in `beefgrading.study/` (site, `grader/`,
  `docs/`, `deployment/`, `powerrankings/`, README). `.claude/` and `.agents/`
  at repo root are shared tooling, not part of the site.
- Live site files: index.html, 404.html, admin.html, *.css, app.js, auth.js,
  data.js, weekly.js, leaderboard.js, powerrank.js, admin.js, scroll.js, assets/, fleece/,
  CNAME, firestore.rules. auth/weekly/leaderboard .html are reference docs in docs/.
- Fleece grader (offline PWA) ships from `fleece/`; its dev pages, tests and private scanned sheets stay in repo-root `fleece-grader/`, never under the published folder. Dev server `python ../fleece-grader/dev/devserver.py 8012`; tests `node --test fleece-grader/tests/*.test.mjs` from repo root. Bump the cache version in `fleece/sw.js` on every fleece release.
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
  when code cannot do it (claude.ai connectors are off for this repo via
  `disableClaudeAiConnectors` in .claude/settings.local.json; ask the user to flip it).
- Local preview: dev server on http://localhost:8000 (no-cache); check with `node ../.claude/tools/cdp-shot.mjs` (headless Chrome over CDP; the Playwright MCP is often locked) at 390, 1440, 1920 and 3840 wide. Dev server:
  `python deployment/devserver.py` from beefgrading.study.
- Orchestration: global `~/.claude/CLAUDE.md` + `orchestrate` skill (Opus plans,
  Haiku/Sonnet agents execute, verifier gates, `reflect` after).
- Standard Done-when checks for site packets (run from beefgrading.study):
  preflight exits 0 on touched files; `node --check` on touched JS;
  `grep -n "onerror=\|onclick=" *.html *.js` empty; 390, 1440, 1920 and 3840 render
  with no console errors. Design packets: verifier on `model: sonnet`.
- Path-scoped detail lives in `.claude/rules/` and loads only when relevant.

## Output
Be concise. No recaps of what was just shown.

# Compact instructions
When compacting, keep: current branch and last commit, open tasks, user decisions,
any failing checks, the active packet plan (goal, done-when, which agents are
running or pending). Drop tool output dumps and screenshots.
