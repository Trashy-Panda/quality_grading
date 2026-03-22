# GradeThisMeat — Claude Code Orchestrator

## Project Context

Static GitHub Pages site at **gradethismeat.xyz**. Stack: vanilla HTML/CSS/JS (no build
system, no npm, no server), Firebase Firestore + Auth as the sole backend.

- Branch `dev` → work here. Branch `master` → production (auto-deploys via GitHub Pages).
- Deploy via `deploy.bat` (merges dev → master → push).
- Files: `index.html`, `style.css`, `app.js`, `auth.js`, `data.js`, `weekly.js`,
  `leaderboard.js`, `admin.html`, `admin.js`, `admin.css`, `auth.html`, `auth.css`,
  `weekly.html`, `weekly.css`, `leaderboard.html`, `leaderboard.css`

---

## ⚡ SPAWN ROUTING TABLE — Read This First

**NEVER handle these task types directly in the main context window.**
Always route to the correct specialist agent.

```
TASK TYPE                                         AGENT (mandatory)
──────────────────────────────────────────────────────────────────────
Any HTML / CSS change                           → STYLE AGENT
Any JS UI logic, component, or animation        → STYLE AGENT
New page, section, modal, or UI element         → STYLE AGENT
Icon, logo, font, color palette, layout         → STYLE AGENT
Firestore rules change                          → BACKEND AGENT
New Firestore collection or schema design       → BACKEND AGENT
Firebase Auth config change                     → BACKEND AGENT
Data migration (any service → Firestore)        → BACKEND AGENT → STYLE AGENT
Security review or pre-ship audit               → SECURITY AGENT
Any merge to master                             → SECURITY AGENT first (mandatory gate)
Any new user input field added                  → SECURITY AGENT after STYLE AGENT builds

If uncertain which agent → spawn SECURITY AGENT to assess, then route.
```

---

## STYLE AGENT — Expert Frontend + MCP Specialist

**Sole handler of all frontend work.** Do not write HTML/CSS/JS in the main context.

### MCP Workflow (mandatory order for any new component)

```
Step 1 → mcp__magic__21st_magic_component_inspiration
         Browse real components matching the UI need BEFORE writing any code.
         Search terms: component type + "brutalist" or "high contrast"
         Goal: find the closest existing component to adapt — not invent from scratch.

Step 2 → mcp__magic__21st_magic_component_builder
         Build the component using Step 1 findings as context.
         Always include in the prompt:
           - "vanilla JS, no React, no npm, no build tools"
           - "neo-brutalist: 2-3px black borders, offset box-shadow, monospace accents"

Step 3 → mcp__magic__21st_magic_component_refiner  (if iteration needed)
         Pass the current output + the specific delta needed.
         Refine until it matches the existing design system.

Step 4 → mcp__magic__logo_search  (when icons or logos are needed)
         Always use this over emoji or text substitutes. Request SVG format.
```

**Post-MCP (always):** Strip any React/Vue/JSX syntax. Replace `className` → `class`.
Replace component props → vanilla JS function parameters. Replace event prop handlers
→ `addEventListener`. Replace `useState` → plain variables + DOM updates.

### Design Intelligence: ui-ux-pro-max

Run before any significant UI build (skip for trivial one-line fixes):

```bash
# Generate design system
python3 skills/ui-ux-pro-max/scripts/search.py \
  "beef grading agriculture brutalist educational drill" \
  --design-system -p "GradeThisMeat" -f markdown

# Get UX rules for the specific concern
python3 skills/ui-ux-pro-max/scripts/search.py \
  "animation accessibility keyboard-nav" --domain ux

# Stack-specific patterns (this project = closest to html-tailwind)
python3 skills/ui-ux-pro-max/scripts/search.py \
  "interactive form feedback" --stack html-tailwind
```

Cross-reference with existing design CSVs:
- `.claude/skills/design/data/colors.csv` — industry palette overrides
- `.claude/skills/design/data/ux-guidelines.csv` — do/don't rules with code examples
- `.claude/skills/design/data/ui-reasoning.csv` — anti-patterns with severity ratings

### Animation: Motion Vanilla JS (CDN — no React needed)

Add once per HTML file that uses Motion animations:
```html
<script src="https://cdn.jsdelivr.net/npm/motion@latest/dist/motion.js"></script>
```

```js
const { animate, timeline, scroll, inView, stagger } = Motion;

// Scroll-triggered entrance (leaderboard rows, cards)
inView('.leaderboard-row', ({ target }) => {
  animate(target, { opacity: [0, 1], x: [-20, 0] }, { duration: 0.25 });
});

// Spring physics (modals, overlays)
animate('.modal', { scale: [0.95, 1] }, { type: 'spring', stiffness: 300, damping: 20 });

// Staggered list reveals
animate('.leaderboard-row', { opacity: [0, 1] }, { delay: stagger(0.05) });

// Always respect reduced motion
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  animate('.hero', { opacity: [0, 1] }, { duration: 0.4 });
}
```

Motion skill reference: `.claude/skills/motion/SKILL.md` — ignore React/JSX sections,
apply spring presets, stagger patterns, and accessibility guidance directly.

**CSS transitions for simple states** (hover, button feedback): `transition: transform 150ms ease, opacity 150ms ease`
**Only animate** `transform` and `opacity` — never `width`/`height` (layout thrash).

### Neo-Brutalist Design System Tokens

```css
--border: 2px solid #000;          /* standard border */
--border-thick: 3px solid #000;    /* headers, cards */
--shadow-sm: 3px 3px 0 #000;
--shadow-md: 4px 4px 0 #000;
--shadow-lg: 6px 6px 0 #000;
--radius: 0;                        /* no border radius */
--font-mono: 'Space Mono', monospace;
--font-body: 'Inter', sans-serif;
--color-brand: #cc0000;            /* red accent */
```

### Hard Rules

- `addEventListener` only — NO inline handlers (`onerror=`, `onclick=` attributes)
- `escapeHtml()` on every `.innerHTML` assignment of user-generated content (5 chars: `& < > " '`)
- `_escapeAttr()` for attribute values — must also escape all 5 chars
- `aria-label` on all icon-only buttons; `tabindex`; keyboard nav; min 4.5:1 contrast
- Test mobile viewport before marking any component done
- After every build: `grep -n "onerror=\|onclick=" *.html *.js` → must return no results

### Spawn Count

- **1 agent**: single component or single page section
- **2 agents in parallel**: two independent pages (e.g., leaderboard.html + admin.html)
- **3 agents in parallel**: full site reskin (main app + admin + leaderboard simultaneously)

---

## BACKEND AGENT — Expert Firebase + Firestore Rules Specialist

**Sole handler of all Firestore and Firebase Auth work.**

### MCP Workflow (mandatory — fetch live docs before writing rules)

```
Step 1 → WebFetch: https://firebase.google.com/docs/firestore/security/rules-conditions
         Load current rules syntax reference BEFORE writing any rules.

Step 2 → WebFetch: https://firebase.google.com/docs/firestore/security/rules-data-validation
         Load current data validation patterns.

Step 3 → WebSearch: "firebase firestore security rules [specific feature] site:firebase.google.com"
         For any feature not covered in Step 1-2.

Step 4 → WebFetch: https://firebase.google.com/docs/firestore/security/insecure-rules
         ALWAYS check this — verify none of the insecure patterns appear in the new rules.
```

**Always cite the documentation URL** used for each rules section written.

### Collections + Access Matrix

| Collection | Read | Create | Update | Delete |
|---|---|---|---|---|
| `users/{uid}` | public | owner (uid match) | owner (uid match) | never |
| `submissions/{docId}` | public | owner (validated) | never | owner or admin |
| `weeks/{weekId}` | public | admin only | admin only | admin only |
| `community_carcasses/{docId}` | public | any auth (validated) | never | admin only |

### Schema Design Rules

- Every collection needs explicit `read`, `create`, `update`, `delete` rules — no wildcards
- Every write rule validates: required fields, field types, field bounds, ownership
- Admin check: `request.auth.uid == 'KLoBqbA2P9UkQ83urzmgpxT4Oit1'`
- Score integrity: server-side pct consistency check — `math.abs(pct - earned/max*100) < 0.5`
- Server timestamps only — never trust client-supplied timestamps
- DocId deduplication for submissions: `{uid}_{weekId}_{ruleSet}` prevents duplicates

### After Updating Rules

1. Publish in Firebase Console → Firestore → Rules
2. Test each permission scenario in the Firebase Rules Playground
3. Document schema changes in `NOTES.md`

### Firebase Web Config Note

The `FIREBASE_CONFIG` in `data.js` is **intentionally public**. It is a project identifier
that routes SDK requests — not a secret. Real security is enforced by Firestore Security
Rules + Firebase Auth authorized domain restrictions. Ref: https://firebase.google.com/docs/projects/api-keys

Do NOT treat Firebase web config as a secret. Do NOT remove it or move it to .env.

### Spawn Count

- **1 agent**: rules change or collection update (rules = one document, sequential edits)
- **2 agents in parallel**: only if one handles rules AND a separate agent handles unrelated docs

---

## SECURITY AGENT — Expert Auditor + Pre-Ship Gate

**Reviews only — does not write application code. Required before every master merge.**

### MCP Workflow (mandatory — check latest threat intelligence)

```
Step 1 → WebSearch: "firebase firestore security misconfiguration 2025"
         Check for new attack patterns against Firebase/Firestore.

Step 2 → WebFetch: https://owasp.org/www-project-top-ten/
         Load current OWASP Top 10 — verify no item applies to recent changes.

Step 3 → WebSearch: "github pages content security policy headers 2025"
         Check current best practice for CSP on GitHub Pages static hosting.
```

### Pre-Ship Checklist (agent runs each grep/read check)

**Secrets:**
- [ ] `grep -r "MASTER_KEY\|BIN_ID\|jsonbin" *.js` → no results
- [ ] `grep -r "password\|secret\|token" *.js | grep -v "//\|firebase"` → review hits
- [ ] `.gitignore` exists, covers `.env` and `*.local`

**Firestore rules (read from Firebase Console or local copy):**
- [ ] `weeks` writes check `ADMIN_UID` — NOT just `request.auth != null`
- [ ] `submissions` delete: `resource.data.userId == request.auth.uid || isAdmin()`
- [ ] `submissions` create: validates earned ≥ 0, max > 0, pct 0-100, pct consistency check
- [ ] `community_carcasses` imageUrl enforces `^https://.*`
- [ ] No collection uses `allow write: if true` or `allow read: if request.auth != null` alone

**XSS:**
- [ ] `grep -n "innerHTML" *.js` — every result uses `escapeHtml()` on user data
- [ ] `_escapeAttr` in `leaderboard.js` escapes all 5 chars (`& < > " '`)
- [ ] `grep -n "onerror=\|onclick=" *.html *.js` → no inline HTML attribute handlers

**Auth:**
- [ ] Firebase Console: Auth authorized domains = only `gradethismeat.xyz` + `localhost`
- [ ] Admin UID check in BOTH `admin.js` AND Firestore rules

**Rate limiting:**
- [ ] DocId collision blocks duplicate submissions per user/week/ruleSet
- [ ] `community_carcasses` write validated against HTTPS URL and grade key

**Test with second account (Account B = non-admin):**
- [ ] `_db.collection('weeks').doc('t').set({test:1})` → `permission-denied`
- [ ] Delete Account A's submission → `permission-denied`
- [ ] Fake score `{earned:9999,max:100,pct:100}` → `permission-denied`
- [ ] Community carcass with `http://` URL → `permission-denied`
- [ ] 2nd score same weekId + ruleSet → blocked by docId collision

---

## Orchestrator Patterns

### New UI feature (no Firestore changes)
```
→ STYLE AGENT only
```

### New UI feature (needs new Firestore collection)
```
→ STYLE AGENT  ←── parallel ──→  BACKEND AGENT
→ SECURITY AGENT (after both)
```

### Security sprint
```
→ SECURITY AGENT (audit, produce findings list)
→ BACKEND AGENT (fix rules)  ←── parallel ──→  STYLE AGENT (fix JS/HTML)
→ SECURITY AGENT (verify fixes)
```

### Pre-master merge (always mandatory)
```
→ SECURITY AGENT  (block merge until full checklist passes)
```

### Data migration
```
→ BACKEND AGENT (new schema + rules)
→ STYLE AGENT (update JS to use new endpoints)
→ SECURITY AGENT (verify no old keys/endpoints remain)
```

### Large UI refresh (multiple independent pages)
```
→ STYLE AGENT × N  (one per page, all in parallel)
→ SECURITY AGENT (after all finish)
```
