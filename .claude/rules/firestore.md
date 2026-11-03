---
paths:
  - "beefgrading.study/firestore.rules"
  - "beefgrading.study/data.js"
  - "beefgrading.study/admin.js"
---
# Firestore rules
Fetch current docs before writing rules: firebase.google.com/docs/firestore/security
(rules-conditions, rules-data-validation, insecure-rules). Cite what you used.

| Collection | Read | Create | Update | Delete |
|---|---|---|---|---|
| users/{uid} | public | owner | owner | never |
| submissions/{docId} | public | owner (validated) | never | owner or admin |
| weeks/{weekId} | public | admin | admin | admin |
| community_carcasses/{docId} | public | any auth (validated) | never | admin |
| meat_contests/{contestId} | public | admin (validated) | admin (validated) | admin |

- Explicit read/create/update/delete per collection, no wildcards.
- Validate required fields, types, bounds, ownership on every write.
- Score integrity: `math.abs(pct - earned/max*100) < 0.5`; earned >= 0, max > 0.
- Server timestamps only. Submission docId `{uid}_{weekId}_{ruleSet}` blocks dupes.
- community_carcasses imageUrl must match `^https://.*`.
- After changes: publish in Firebase Console, test in Rules Playground, note
  schema changes in beefgrading.study/docs/NOTES.md.
