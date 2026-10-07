---
slug: herdr-usage-table-row
branch: session/2026-10-03-1420-herdr-usage-table-row
consumer: clade
created: 2026-10-03
base_sha: 47c1e9a0b2d4f6e8a1c3e5f7092b4d6f8a0c2e41
status: in-progress
last_updated: 2026-10-03T10:40+08:00
---

# Task

herdr-session-handoff.ts 的 usage 字串補上 `--table-row <row>`：parser 已接受這個旗標，`--tier-basis table-row` 也要求它，但 `--help` 沒列出，派工者照 usage 寫指令會漏帶。

# Context

- work id：W-2026-10-03-herdr-usage-table-row
- 下游 skill：無
- 允許路徑：`vendor/scripts/herdr-session-handoff.ts`、`test/herdr-session-handoff.test.ts`
- 要讀的規則與文件：`vendor/snippets/herdr-session-handoff/README.md` § Relay succession recipe（旗標語義）；`rules/core/agent-routing.routing-table.md`（`--table-row` 只接 Claude-native 列）
- 要動的檔案與現況：`vendor/scripts/herdr-session-handoff.ts` 約第 1017 行的 usage 字串缺 `[--table-row <row>]`；第 2763–2784 行的驗證已要求 `table-row` 搭 `--table-row`
- 驗收標準：`node vendor/scripts/herdr-session-handoff.ts --help` 輸出含 `--table-row <row>`；新增或更新一條測試斷言 usage 含該旗標；`pnpm exec vp check` 與 `node node_modules/typescript-native/bin/tsc -p tsconfig.vendor.json --noEmit` 綠燈
- backing service：無

# Progress

- [ ] 在 usage 字串的 `--tier-basis` 之後補 `[--table-row <row>]`
- [ ] 補一條測試斷言 `--help` 輸出含 `--table-row <row>`
- [ ] 跑 `pnpm exec vp check` 與 vendor typecheck，貼結果

# Recovery

接手這棵 worktree 的新 session 依序做：

1. 先讀 `capabilities/core/skills/wt/rules/worker契約.md`，照其中的 worker 契約工作。
2. 跑 `git log main..HEAD --oneline`，看已完成的 commit。
3. 跑 `git status --short`，看尚未 commit 的工作。
4. 從上方 Progress 下一個未勾選項接續；Context 已是消化過的上下文，不要從頭冷讀整個 repo。
