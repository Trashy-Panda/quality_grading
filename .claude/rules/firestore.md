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
| fleece_keys/{keyId} | public | any non-anonymous auth (validated) | never | owner or admin |

- Explicit read/create/update/delete per collection, no wildcards.
- Validate required fields, types, bounds, ownership on every write.
- Score integrity: `math.abs(pct - earned/max*100) < 0.5`; earned >= 0, max > 0.
- Server timestamps only. Submission docId `{uid}_{weekId}_{ruleSet}` blocks dupes.
- community_carcasses imageUrl must match `^https://.*`.
- fleece_keys `key` = 120 chars, 20 fleeces x 6 (grade 0-9, length 0-2, yield 2 digits, purity 0-1, character 0-2; '-' blank; rows past `n` are '------').
- After changes: publish in Firebase Console, test in Rules Playground, note
  schema changes in beefgrading.study/docs/NOTES.md.
