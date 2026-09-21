---
name: verification
description: "Use for verification setup or maintenance. Not for product implementation or acceptance."
---

<!-- clade-skill-scope: both -->

# Verification infrastructure

`verification` is the single public entry for setup and maintenance. Select a
mode, then read the matching detailed guide; the guides retain the established
contracts and are references rather than separate runtime skills.

| Mode | Use when | Detailed guide |
| --- | --- | --- |
| `create` | No `verify-*/features/README.md` exists and infrastructure is needed | [create guide](references/legacy/verification-create/SKILL.md) |
| `maintain` | A verify skill exists and its source map or live coverage may have drifted | [maintenance guide](references/legacy/verification-maintain/SKILL.md) |

## Routing and boundary

- `/verification create` interviews the repository, creates consumer-owned
  verification infrastructure, validates its feature map, and proves one full
  Launch → Doctor → Drive → Evidence → Cleanup loop.
- `/verification maintain` reconciles every mapped feature and live-drives it;
  it may change verification infrastructure only, never product code.
- If no verify skill exists, `maintain` routes to `create`; if several exist,
  stop and ask the user to identify the target.
- Verification evidence does not by itself declare a product change accepted;
  acceptance remains with the product owner or designated reviewer.
