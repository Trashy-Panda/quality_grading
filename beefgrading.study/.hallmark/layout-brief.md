# Redesign brief v2 (Lab system)

Site: `C:\Users\gunny\code\beefgrading.study\` (static, vanilla JS, no build). Branch `dev`.
The working copy has large UNCOMMITTED work. Never run git checkout/reset/stash/commit.

## Read first, in this order
1. `docs/DESIGN.md`: the NEW locked system (v2 "Lab" + "Scoreboard"). It replaces the
   old Furrow look (notebook cards, ink head bars, moulded keys). The user rejected
   Furrow as "a box design that looks like an artifact". Do not carry it forward on
   the screens you touch: delete or override the old rules for your screen.
2. The reference comps it names: `.hallmark/comps/b-lab.html` and
   `.hallmark/comps/a-scoreboard.html`. Match their look closely: open them in
   Playwright and compare your screen against them side by side.
3. `../.claude/rules/frontend.md` (hard rules).
Tokens: `style.css :root` (`--lab-*`, `--sb-*`, `--on-ink*`, `--ink`, `--red*`). Do not
edit style.css `:root` (the orchestrator owns it); if you truly need a token, say so
in your report. Never repoint landing tokens. No literal colours below `:root`.

## Hard rules
- `addEventListener` only, never inline handlers.
- Escape all Firestore/user data written via innerHTML (`_escapeHtml` / `_prEscapeHtml`);
  attribute values escaped for `& < > " '`. Prefer textContent.
- No `addEventListener('scroll')`. Animate transform/opacity only, reduced-motion path.
- Before renaming/removing an id or class, grep app.js, weekly.js, leaderboard.js,
  powerrank.js, auth.js, scroll.js and the inline script in index.html.
- No em dashes (also not `&mdash;`/`&ndash;`) in copy, no eyebrows, no arrows glued to
  labels, no middle-dot meta strings. Sentence case. 44px touch targets.
- Never invent a number. Every figure and chart comes from data the page loaded.
- 390 and 1440 wide: no horizontal page scroll (a wide data table may scroll inside
  its own `overflow-x: auto` wrapper).

## Browser / server
The server on :8000 may be plain http.server (browser caches stale CSS/JS). In Playwright,
open a CDP session and send `Network.setCacheDisabled {cacheDisabled:true}`, and load
`http://localhost:8000/?v=<timestamp>`. Screenshots go in `c:\Users\gunny\code\.playwright-mcp\`.

## Checks before reporting
1. `node --check` on every touched .js
2. `grep -n "onerror=\|onclick=" *.html *.js` returns nothing
3. `node ../.claude/skills/design-taste/scripts/preflight.mjs <touched html/css>` from
   beefgrading.study exits 0
4. Playwright at 1440x900 and 390x844: no console errors, no page-level horizontal
   scroll, every state you built exercised. Viewport screenshots (plus one full-page)
   to `.playwright-mcp/<packet>-*.png`.
5. Self-review against the comp: list any place your screen still looks like the old
   boxed notebook style, and fix it before reporting.

## Report (under 150 words)
Files touched, what was built, ids/classes renamed or removed and where rebound, which
states were exercised and how, checks result, screenshot paths, anything not done.
