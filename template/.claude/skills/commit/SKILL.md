---
name: commit
description: >-
  Use when 使用者要求提交工作區變更、merge back 已完成 worktree，或 worktree
  就緒佇列達到提交條件；需要拆成多筆時同樣適用。NOT for 把 clade 改動散播到 consumer（走 /clade-publish），NOT
  for 新建實作 worktree（交 wt 建立）。
metadata:
  clade:
    permission_tier: action
effort: high
---

<!-- clade-skill-scope: both -->

## User Input

```text
$ARGUMENTS
```

# SOP

照順序走；每步條件成立才讀該條判準，讀完照做。

1. 0-Batch｜READ 若進入 `/commit`（每次），讀取 `rules/批次入口判準.md`，先跑 `wt-helper batch status`。
2. 0-Lock｜READ 若要進品質流程，讀取 `rules/鎖與退出判準.md` Rule 1 取鎖。
3. 0-Coord→0-Transport→0-Scope→0-MR｜READ 若已持鎖，讀取 `rules/前置探測判準.md`。
4. Step 0｜READ 若候選已定，讀取 `rules/品質檢查判準.md`，跑 0-A～0-F。
5. Step 1｜READ 若品質檢查已過（每次），讀取 `rules/schema觸發判準.md` 跑觸發判定。
6. Step 2–4｜READ 若要分組提交，讀取 `rules/分組與提交判準.md`。
7. Step 5｜READ 若分組 commit 完成，讀取 `rules/交接判準.md`。
8. Step 6-Gate｜READ 若已 land 要進發版，讀取 `rules/發版授權判準.md`，跑 `deploy-trigger-check.ts`。
9. Step 6-A｜READ 若 `verdict=confirmed-push-main`，讀取 `rules/push-main發版判準.md`。
10. Step 6-B｜READ 若 `verdict=needs-approval` 或腳本不存在，讀取 `rules/停在push-main判準.md`。
11. Step 6b｜READ 若 tag 已推出，讀取 `rules/Notion同步判準.md`。
12. Step 7–8｜READ 若要出完成報告，讀取 `rules/完成報告判準.md`。
13. Final｜READ 若要退出（完成、gate 失敗、中止皆同），讀取 `rules/鎖與退出判準.md` Rule 2 釋放鎖。


