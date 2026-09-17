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
| `archive` | Archive completed manual-review findings | [review archive guide](references/legacy/review-archive/SKILL.md) |
| `screenshots` | Sweep completed screenshot topics into `_archive/` | [screenshot archive guide](references/legacy/screenshots-archive/SKILL.md) |

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
- `/review archive` archives only explicitly completed manual-review items and
  then invokes the screenshot archive mode required by the guide.
- `/review screenshots` archives only topics covered by the alignment rules;
  never sweep an unrelated topic or use a force flag.

If the request is a product code review, use the configured code-review agent.
If it is a Lighthouse audit or performance trace breakdown, use the dedicated
browser-devtools capability. This skill owns lifecycle evidence and archive
coordination, not product acceptance.


## Runtime 執行 — Cursor

Cursor 主線在 launcher、workspace、label、identity 與 transport correlation preflight 通過後，使用 Herdr create-only `--launcher cc`／`ccw`，把 brief 交給已合格的 Claude Code `Agent`、`subagent_type: screenshot-review` carrier；brief 必須落成 durable handoff file。

完成 receipt 由派出後的子 session 回傳；在此之前不得宣稱 review 完成。**NEVER** 改用 Cursor Task 的 `model=claude-*`、generic executor、Pi、GPT/Luna 或 quota waiver，也 **NEVER** 讓執行體再轉派。
