<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/work-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# `/wt` 不可用時的 dispatch 形狀

> 主檔 pointer：Step 4a 判出「`/wt` 叫不動」時 MUST 先完整讀本檔。判定表在主檔，執行細節在這裡。

## 這個分支為什麼存在

Step 4a 的三條 dispatch 都假設 `/wt` 在本 repo 叫得動。那個假設在**產地（clade home）不成立**——
它不啟用 hub-core，而 `/wt` 是 hub-core 的 skill（[[TD-390]] 的同一個根因）。

假設不成立時的失敗長相是**判斷錯誤，不是報錯**：主線發現派不出去，於是把該 item 當成
「這裡做不了」記進 Skipped——而 § Skip 合法理由窮舉只有 3 條，「工具叫不動」不在內。

## 四步

```bash
node vendor/scripts/wt-helper.ts add <slug>          # 1. 開，main 保持 dirty 不動
# 2. 主線在 ~/offline/<repo>-wt/<slug>/ 內 Edit / 跑 test / git commit --only
node vendor/scripts/wt-helper.ts merge-back <slug> --dry-run   # 3. 先確認別 session WIP 不會被捲走
node vendor/scripts/wt-helper.ts merge-back <slug>             # 4. squash 進 main 的 index
git commit --only -m "…" -- <逐條列出剛才改的檔>               # 4b. 這步不能省，見下
```

**第 4b 步不能省**：`merge-back` 走 `git merge --squash`，改動落在 main 的 **index、不建 commit**，
而同一次執行已經刪掉 worktree 目錄與 session branch。那個瞬間 staged 區是這份工作的唯一副本。
它收尾照印 `absorbed into main + worktree cleaned`，真相在上面幾行的 `Squash commit -- not updating HEAD`。

## 驗收不打折

收割 SOP（[harvest.md](harvest.md)）每一步照跑，[guardrails.md](guardrails.md) 的
`git commit --only`、scope-verify、三層 verify 一條都不放寬。差別只在**誰產生那個 commit**
（主線而非 subagent），不在**要不要有 commit**。

## 代價是併發，不是工作量

主線只有一個，所以扇出組實質變成序列（[dispatch-topology.md](dispatch-topology.md) 的扇出上限
在這個分支是 1）。做完一個 worktree 的 commit → merge-back → 落地，才開下一個。

上限變 1 **只改併發**：分組判定、收割 SOP、commit 紀律逐條照舊，item 也不會因此變成可跳過。

## 實證

2026-08-06 round 18 於 clade home 實跑四次（TD-405 / TD-401 / TD-397 / TD-365 各一個 worktree），
四次都走完 commit → merge-back → 三層 verify，主線的 `git` 完全正常。

對照：round 11 兩個 worktree **subagent** 的 `git` 一律 permission denied（含 `git status` /
`git log`，加 `dangerouslyDisableSandbox` 也一樣）——那是 [[TD-396]] 的命題，本分支不解它，
只是繞開它。
