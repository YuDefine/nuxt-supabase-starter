---
name: review
description: "Use for review lifecycle work: readiness scans, UI evidence, manual-review archive, or screenshot archive. Not for product code review."
---


# Review lifecycle（統一入口）

`review` is the single public entry for the review support lifecycle. Choose one
mode from the user's request, then read the corresponding legacy guide before
acting; those guides retain the detailed contracts and are references, not
independently discoverable skills.

| Mode | Use when | Detailed guide |
| --- | --- | --- |
| `scan` | Check whether anything in this repo is waiting on a human | No guide: run `flow gates --repo-only --json` and follow [[review-gui-surface]] § Hard rule |
| `screenshot` | Collect UI screenshots or execute a visual checklist | [screenshot guide](references/legacy/review-screenshot/SKILL.md) and its evidence contract |
| `archive` | Retired: do not append `docs/manual-review-archive.md`; completed items stay in the work package | [review archive guide](references/legacy/review-archive/SKILL.md) |
| `screenshots` | Retired: do not move topics into `_archive/` | [screenshot archive guide](references/legacy/screenshots-archive/SKILL.md) |

Screenshot evidence is collected by the named **Pi Gemini 3.8 Flash** worker
(`screenshot-review-verify`, effort `high`; dispatch with
`--model gemini --effort high --table-row screenshot-review-verify`); 截圖與 item 的符合性 gate 另交 **Claude Opus 5 · medium** (`screenshot-match-analysis`). The worker must not
sign its own compliance result.

需要使用者拍板時，向使用者提問並等待回答；不要自行補完未決事項。

## Routing

- `/review scan` runs `node ~/offline/clade/vendor/scripts/flow/flow.ts gates --repo-only --json`
  from the consumer root (never with `CLADE_HOME`) and reports every card by
  gate family; exit 2 from `--require-empty` means it could not tell, never "none".
- `/review screenshot` collects evidence through the existing screenshot
  worker and preserves every evidence limitation in the receipt.
- `/review archive` does **not** write `docs/manual-review-archive.md`. Completed items stay in the work package; see the retired guide.
- `/review screenshots` does **not** sweep topics into `_archive/`; it reports current top-level topics only.

If the request is a product code review, use the configured code-review agent.
If it is a Lighthouse audit or performance trace breakdown, use the dedicated
browser-devtools capability. This skill owns lifecycle evidence. Archive production writers are retired.


## Runtime 執行 — Claude Code

本 runtime 的合格視覺執行載體是 Claude Code `Agent` tool，`subagent_type: screenshot-review`。in-process dispatch 將 brief 放在 `prompt`；完成後由主線收取 JSON manifest，再依共同 evidence gate 判讀。

**NEVER** 派 Pi 任一 model，也 **NEVER** 讓執行體再轉派或因 quota 不足降低獨立視覺判讀要求。工具不可用時回報阻擋，保留 gate 未完成。

## Archive interaction

When `/review archive` or `/review screenshots` requires a user choice, use
Claude Code `AskUserQuestion` with every valid option and an explicit skip
option, then wait for the answer before moving files. The question mechanism
is only the runtime carrier of the shared interaction contract.
