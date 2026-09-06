---
description: Worktree 全文規約（§1 pre-fork baseline guard 四條契約與 archive-on-main clobber 窗口、§3 命名與位置、§4 與 propagate 的互動、§5 commit 階段、§5.5 merge-back ceremony 與 claim guard scope、§5.5.1 pre-archive gate 的掃描根目錄、§6–§11 工具與 troubleshooting 索引）；always-load 的薄 pointer 在 [[worktree-default]]，觸發時機是「送出 wt-helper add / merge-back / 任何 worktree 操作之前」，由 [[worktree-default]] 的 MUST-Read 指針叫醒
paths: ['vendor/scripts/wt-helper.ts', 'scripts/wt-helper.ts', 'vendor/scripts/stash-reconcile.ts', 'scripts/stash-reconcile.ts', '**/WORKTREE-BRIEF.md', '**/hooks/pre-archive-*.sh', '**/spectra-advanced/archive-gate.sh', '**/spectra-advanced/design-gate.sh', '**/spectra-advanced/followup-gate.sh']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/worktree-default.detail.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Worktree Default（全文）

> 本檔是 [[worktree-default]] 的下推全文。[[worktree-default]] 常駐 §1 判定、§2 禁止 silent branch、§5.1 停手信號，其餘全部在這裡。

## §1 細則

### §1 archive-on-main 的 clobber 窗口（pitfall 2026-06-01）

archive-on-main 例外讓未 commit 的 archive batch 躺在 **shared main**；`/commit` 因 gate halt 時這批 dirty 長期留在 main，會被別 session 的 `wt-helper add --baseline-strategy stash` 當 unclaimed dirty 整批捲進 `refs/wt-baseline/*`（實證見 [[pitfall-prefork-baseline-stash-sweeps-unclaimed-main-work]]）。

**MUST**：有來源 worktree 的每個 archive 在來源內完成 gates 與 bookkeeping；follow-up fix 同樣留在來源。正式批次從一開始就在隔離整合區 review，gate halt 時保留該區繼續修，不把 candidate 搬進 main。已在 main 完成的 solo bookkeeping 沿用原路徑；多步修正先進隔離 worktree。

### §1 invariant：parent session cwd 不動

`/wt` 的所有 invocation form **SHALL NOT** 遷移 parent session 的 cwd。worktree 內操作由 subagent（cwd = worktree path）執行，主線（cwd = main）負責 dispatch。

**無例外**。先前的 `--dispatch-from-handoff` flag 已**移除** — subagent 隔離 cwd 達到同樣 UX。理由：mid-conversation 切 parent cwd 會破壞 file watcher、Bash cwd state、未完成 Read window。

### §1.x 階段間 setup chore：主線一行式 `cd` 進 worktree 自動跑

Phase 切換之間若需在 worktree 跑 **local-only** setup chore，主線 **MUST** 用 Bash `cd <wt> && <cmd>` 一行式自跑，**NEVER** 把指令清單推回 user。subshell `cd` 不影響 parent cwd（§1 invariant 講 sticky cwd，不禁 subshell cd）。

**自動代勞 OK**：`pnpm install` / `pnpm db:*` / `pnpm supabase:sync` / `pnpm build` / `pnpm lint` / `pnpm test` / `vp check` / `tsc --noEmit` / local pnpm script（無 push/publish/deploy 副作用）。

**仍需 user 拍板（真 destructive）**：`rm -rf <wt>`、`git push`（已被 §5 禁）、Prod DB migration / Prod creds、outbound 訊息、shared infra。

**失敗處理**：跑爆主線自己診斷修復，不丟回 user。**反模式**（立刻停手）：列「請你 cd 過去跑」清單、「跑完回我 OK」。**例外**：user 明確說「我自己跑」/「先別動」尊重。

### §1 Pre-fork baseline guard（契約）

`wt-helper add` fork 之前會先偵測 main working tree 狀態再決定策略。**四條契約在每個 session 都成立**：

1. **預設完全不 capture main dirty** — main 原封不動、worktree 從 HEAD fork clean。
2. **要把 main WIP 帶進 worktree 必須顯式傳 flag** — `--include-unrelated-dirty`（bulk 全帶）或 `--baseline-scope-paths <comma>`（scoped，走 commit strategy）。有 change context 時 scoped 才是正解，bulk 是無從 scope 時的鈍器。
3. **傳了 `--include-unrelated-dirty` 之後，NEVER 對 user 宣稱「main working tree 不變」/「main 沒被動到」/「你的 WIP 還在 main」** —— 傳了它，那三句話**必然**是假的。**MUST** 明確告訴 user：main 上原有的 N 個 dirty 檔已搬進 worktree `<path>`，main 端現在是乾淨的。（per [[pitfall-include-unrelated-dirty-claimed-main-untouched]]）
4. **NEVER 主線自己跑 `git stash push -u -m "<msg>" -- <pathspec>`** 做 selective baseline sync —— git 2.50.1 pathspec stash 有 scope leak，stash commit 會包整個 tracked tree 的 modifications。任何「想把 X、Y、Z 三個檔搬去別 worktree」的場景，第一反應是 wt-helper 或 patch route。（per [[pitfall-git-stash-pathspec-scope-leak]]）

> **決定要 fork worktree 之後、送出 `wt-helper add` 之前，MUST 先讀 [[wt]] skill 的 `baseline-guard.md`**（SKILL.md Step 1 帶 MUST Read 指示；該 skill 由 hub-core plugin 提供，不在 consumer 的 `.claude/skills/` 下）—— unmerged / clean / dirty 三路分流、`--baseline-scope-paths` 的對齊要求、stash strategy 的隱性風險與 `rescue` 救援、bulk-capture 的還原三步驟都在那裡。

### OPSX 建立需求同樣先隔離

OPSX create / revise 會寫 canonical intent、binding 與投影。每次呼叫前套用上面的 pre-fork baseline guard；已有 worktree 就沿用。既有來源先用 list / inspect 唯讀找身分，避免同名需求重建。

## §3 Worktree 命名與位置

### Branch 命名

`session/<YYYY-MM-DD-HHMM>-<slug>`

- 時間戳對齊 [[session-tasks]] 慣例
- `<slug>` 經 `wt-helper` 的 normalization：lowercase、空白與特殊字元轉 `-`、collapse 重複 `-`、trim 首尾 `-`

### 檔案系統位置

`<consumer-parent>/<consumer-name>-wt/<slug>/`，即 `~/offline/<consumer>-wt/<slug>/`。

**Monorepo 子目錄 consumer**：`wt-helper` 走最外層 `.git` 解析 consumer root（例：starter 的 worktree 落在 `~/offline/nuxt-supabase-starter-wt/<slug>/`，**不是** `~/offline/template-wt/<slug>/`）。

## §4 與 propagate 的互動

`scripts/propagate.ts` 的 worktree-aware preflight 偵測 cwd 在非 main worktree 即 exit non-zero — **publish + propagate 必須在 clade 主 worktree 跑**（先 `cd ~/offline/clade`）。理由：跨 worktree 寫投影層在 file watcher / staging 區會撞，refuse-and-guide 比悄悄出錯安全。

`/wt` 建 worktree 時已由 `wt-helper add` 跑 `git merge --ff-only origin/main` 拉最新投影層，一般不需再手動 sync。

## §5 Commit 階段：checkpoint → 批次整合 → /commit → 回收

Worker 完成實作與必要驗收後 checkpoint，主線確認 scope 與寫入權交接後登記就緒。同 repo 累積 4 件 distinct work id 自動進批次；手動 `/commit` / merge back 無最低件數，dependency / drained / stop 提前結批。隔離整合區跑一次完整 `/commit`，正式落地 main 後統一清理。Worker 不各跑完整品質鏈、不 push；所有 skill-owned wt 同樣走就緒池。

> 執行 checkpoint／收割／落地前 **MUST** 讀 [[worktree-default.commit-ceremony]] §5 與 commit skill 的 `batch.md`。


## §5.5 Merge-back ceremony

`wt-helper batch` 是新流程入口，來源固定、隔離整合、驗證落地後清理。Legacy `merge-back` 只保留供 caller 遷移，squash 後保留來源；其 `--auto-stash` 仍為 bulk-stash，claim guard 檢查範圍 **MUST ⊇** 全部將被捲走的 dirty。已登記來源不得走 legacy。

> 完整 flags / claim guard scope / stash reconcile 詳見 [[worktree-default.commit-ceremony]] § Merge-back ceremony。

### §5.5.1 Pre-archive gate 掃的是 change 所在的 worktree，NEVER 是 cwd

四道 pre-archive gate（`pre-archive-ux-gate.sh` / `-evidence-` / `-design-` / `-followup-`）是
legacy `PreToolUse:Skill` adapter；OPSX archive 由 `opsx-control` 直接呼叫既有 gate。兩條路徑都先驗實作樹，再進批次落地流程。
來源尚未正式落地時，main 不含 worktree 的最新驗收內容：main 的
`tasks.md` 還是 propose 當時那份（零 annotation），screenshots 一張都不在。

所以 gate 若掃 cwd（main），對**每一個**走 worktree 的 change 都會報「item 缺 evidence」
與「Journey URL 沒對應到 git diff」。而 [[worktree-default]] §1 規定要動 code 就 MUST 走
worktree —— 這不是邊角，是**每次第一次 archive 的必然結果**。

**MUST**：gate 先解析 change 所在的 worktree，把那棵樹當掃描根目錄。實作是共用 helper
`plugins/hub-core/hooks/_change-source-root.sh`（consumer 端投影為 `.claude/hooks/`），
它呼叫 `wt-helper resolve <slug>`。

**NEVER 在別處重寫那個 find。** `wt-helper resolve` 與 `merge-back` 共用
`findSessionWorktreeForSlug()` —— 同一份 matcher 才保證「gate 驗過的那棵樹」就是
「要進行 archive 的那棵實作樹」。兩份會漂，而漂開之後的症狀是 **gate 綠、archive 成功、
內容不對**，事後從任何紀錄都看不出來。

**每次 OPSX archive 都先在實作樹跑既有 archive、evidence、design、followup gate 與目前 revision predicates，再做 bookkeeping。NEVER 先合回 main 才收證據**。通過後 checkpoint／登記就緒，正式批次審查先於 main 落地與來源清理。

**Fail-open by construction**：解析不到 worktree（change 在 main 上做完、worktree 已被
merge-back 清掉、consumer 尚未散播到 `wt-helper resolve`）一律回退 cwd = 修改前的行為。
`wt-helper resolve` 的 exit 3 是「沒有 worktree」，**NEVER** 讀成失敗而擋下 archive。

**本節刻意不在 always-load 留 pointer。** 它的義務只在「有人要改 gate / 加第五支 hook」時發作，
而那一刻本檔已經被 `paths:` 叫醒（四支 gate script 都在裡面）；再加上
`test/pre-archive-gate-scans-change-worktree.test.ts` 最後一條在漏接時直接紅。
兩層都綁在會發生的事件上，常駐一行 283 bytes 買不到第三層——那正是 always-load budget
要擋的那種「看起來是淨改善」的增量。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | gate 掃到的根目錄 ≠ cwd 時，helper 在 stderr 印一行 `[pre-archive] scanning worktree for '<change>': <path>`。**informational — 不改變任何 gate 的 exit code**；它存在是因為「沒有人報過掃了哪一棵樹」正是這個 bug 隱形的原因 |
| 消費端 | OPSX archive adapter 與四道 legacy pre-archive hook；讀到那行的 agent 用它確認 gate 看的是對的樹 |
| 載入路徑 | 本節（`rules/core/worktree-default.detail.md`，paths-gated 於 `wt-helper.ts` 與四支 gate script——改解析器或改 gate 時載入）＋ 上述 regression test 的機械兜底 |

對應 pitfall：[[pitfall-pre-archive-gate-scans-main-not-change-worktree]]。

## §6 操作工具：`/wt`、`wt-helper.ts`、`stash-reconcile.ts`

> 工具速查（list / merge-back / rescue / stash-reconcile）詳見 [[worktree-default.commit-ceremony]] § 操作工具；完整表見 `~/offline/clade/vendor/snippets/wt-helper/README.md`。

## §7 升級路徑與 grandfathered worktree

> 命名不符 `session/*` 的舊 worktree grandfathered；V2→V3 in-flight 處置、legacy stash / HANDOFF drift 詳見 [[worktree-default.troubleshooting]]。

## §8 Stop hook 死鎖 fallback

主線在 main 累積 dirty WIP + Stop hook 攔住 + 還要繼續：剩下可隔離 → `/wt <剩下的事>`；必須 main 直接處理（罕見）→ escalate `/handoff`（Mode A 自動偵測）。**預防**：session 開頭判定要動 code 就 SHOULD 立刻打 `/wt`。

> 詳見 [[worktree-default.troubleshooting]] § Stop hook 死鎖 fallback。

## §9 spectra DB 跨 worktree 共享心智模型

`.git/spectra-app/spectra.db` 是**跨所有 worktree 共享的單一 SQLite**。**NEVER** 對它跑 `DELETE` / `UPDATE` / `INSERT`；「main 無 directory + `spectra list` 顯示 active + park/unpark 失敗」**不**等於 zombie（多半別 session 在 sibling worktree 物化）。偵測 zombie 前 **MUST** 先 `git worktree list` + `find` + `mdfind`，看似 zombie 一律 **STOP + AskUserQuestion**。

> 詳見 [[worktree-default.troubleshooting]] § spectra DB 跨 worktree。

## §9.5 需求與證據的持久性

OPSX canonical intent、binding、投影與正式 evidence receipt 依各自儲存契約保留。每次 phase 完成後，先經 OPSX evidence command 寫入並回讀目前 revision，再 project 重建投影；tracked artifacts 在實作 worktree 限定路徑 commit。tasks.md 是投影，不能用手動勾選當完成證據。

Legacy 原件經 OPSX history 唯讀回讀；未完需求以 supersedes／provenance 接續，NEVER 再跑 park／unpark 或覆寫歷史。派工前確認實際 cwd，持久證據不能只留在會 GC 的 ephemeral worktree。

> 詳見 [[worktree-default.troubleshooting]] §9.5。

## §9.7 Artifact Reading SOP — 讀進度前先查 active worktree

讀 spectra change 進度（`tasks.md` / `openspec/changes/<slug>/` artifacts / WORKTREE-BRIEF.md）時 **MUST** 先查有沒有 active worktree：

```bash
ls ~/offline/<consumer>-wt/<change-slug>/ 2>/dev/null || git worktree list
```

- **有 active worktree** → 讀 worktree 內的 `tasks.md`（working truth）；main 的 `tasks.md` 是 fork-time snapshot，不代表當前進度
- **無 active worktree** → 讀 main（change 尚未 `/wt` 物化，或已 merge-back）

只讀 main 會誤判「還沒開始實作」— 實際可能 worktree 已推進數個 phase。`/handoff` scan、`/spectra-ask` status check、主線 cross-check 都適用本 SOP。

### §9.7.1 main 端出現 tasks.md 改動時，方向由 diff 判，不由本節外推

上一段管的是**讀**，它**不保證** main 上的改動比較舊 —— 在 main 補勾 checkbox 是常態。**NEVER** 把它外推成「main 端出現的 tasks.md 改動一律是退化副本」而 stash 掉；**MUST** 先用 `git diff HEAD`（含 staged）量打勾方向、再逐項比對打勾集合（**NEVER** 只比數量、**NEVER** 只看 `--stat`：`[ ]`→`[x]` 與反向給出完全相同的 insertions / deletions）。

> 指令逐字、三種 predicate 的處置表、2026-08-11 <consumer-b> 實證詳見 [[worktree-default.troubleshooting]] §9.7.1 與 [[pitfall-main-side-tasks-md-tick-stashed-as-stale-copy]]。

## §10 review-gui 與 worktree 互動的已知坑

> 3 條已記坑（home list silent skip / source aggregation collision / apply-pending 按前 spot check）詳見 [[worktree-default.troubleshooting]] § review-gui 坑。改 review-gui.ts 後 consumer 端 `pnpm review:ui:kill && pnpm review:ui` 重啟才吃新版。

## §11 WORKTREE-BRIEF.md — 持久化任務交接上下文

Session worktree 攜帶 `WORKTREE-BRIEF.md`（原始任務 + thin brief + Progress checklist）。cwd 在 session worktree 且 brief 存在時 **MUST** 先讀它再做事。`/wt` 派的 subagent **MUST** 更新 Progress + 完成時改 frontmatter `status`。檔不進 git（已在 per-worktree exclude），**NEVER** `git add` 它、**NEVER** 加進 `.gitignore`。

> 詳見 [[worktree-default.troubleshooting]] § WORKTREE-BRIEF。
