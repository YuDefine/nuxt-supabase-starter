---
description: Worktree 升級路徑 / Stop hook 死鎖 / spectra DB 跨 wt 共享 / artifact git / review-gui 坑 / WORKTREE-BRIEF（worktree-default §7–§11 detail）
paths:
  - 'openspec/changes/**'
  - 'vendor/scripts/wt-helper.mjs'
  - 'vendor/scripts/stash-reconcile.mjs'
  - 'vendor/scripts/review-gui.mts'
  - 'scripts/wt-helper.mjs'
  - 'scripts/review-gui.mts'
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/worktree-default.troubleshooting.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


> Path-scoped detail of [[worktree-default]] §7–§11。核心 always-load 規約在母檔 worktree-default.md。

繁體中文

## §7 升級路徑與 grandfathered worktree

命名不符 `session/*` 的舊 worktree **grandfathered**，不強制重命名；`wt-helper list` / `prune` 只認 `session/` 前綴，新建一律走 `/wt`。V2 → V3 in-flight worktree 處置：ready archive → `/spectra-archive <name>`（Step 0 自動 merge-back）；還在 implementation → 不動，archive 時吸收；ad-hoc Form-1 → `wt-helper land-pending <slug>`（alias of merge-back，容忍 multi-commit branch）；過時不要 → `cleanup --force --force-discard-unland`（**永久砍 commit**）。Legacy `cross-session-block-*` stash 走 `stash-reconcile.mjs`；HANDOFF drift 由 session-start `handoff-drift-scan.mjs` 偵測，drift → `/handoff` refresh。

## §8 Stop hook 死鎖 fallback

殘留死鎖場景只剩一條：**主線在 main 累積當前 session 的 dirty WIP + Stop hook 攔住 + 還要繼續做**。兩分支：

- **剩下的事可靠 `/wt` 隔離** → 跑 `/wt <剩下要做的事>`；新 worktree 從 main HEAD 開、看不到主線 dirty WIP，撞同檔走 §5 squash conflict fallback。
- **必須在 main 直接處理（罕見）** → escalate to `/handoff`（Mode A 自動偵測，per [[handoff]]）；HANDOFF entry 含 Stop hook 攔點 + missing acceptance criterion + 改過檔案清單 + 下一 session 接手指引。

**移除**：先前 §8 分支 A（切 cwd）與分支 C（`--dispatch-from-handoff`）— dispatch 改走 `/wt <slug>: /<next-skill>` form per [[wt]] Form 3。

### 預防原則

Session 開頭判定要動 code 就 **SHOULD** 立刻打 `/wt <task>`，不要先在 main 改一改才想到該開 worktree。

## §9 spectra DB 跨 worktree 共享心智模型

`.git/spectra-app/spectra.db` 是**單一 SQLite，跨所有 worktree 共享**。「main disk 無 directory + spectra list 顯示 active + park/unpark 失敗」**不**代表 zombie，多半是別 session 在 sibling worktree 物化。

**MUST**：
- **NEVER** 對 `spectra.db` 跑 `DELETE` / `UPDATE` / `INSERT` — 會影響別 worktree state
- **NEVER** 把「main 無 directory + list 顯示 active + park/unpark 失敗」當 zombie / 系統性 bug
- 偵測「zombie」前 **MUST** 先 `git worktree list` + `find ~/offline/<consumer>-wt` + `mdfind "<name>"`
- 啟動 active / parked change `apply` 前 **MUST** `git worktree list` 確認別 session 沒在同 change 做

碰到看似 zombie 一律 **STOP + AskUserQuestion**。誤動 DB 後從 `/tmp/spectra-db-backup-*.db` restore。

## §9.5 Spectra change artifact 必須活在 git，禁止靠 ephemeral worktree park/unpark

`Agent` tool 把 subagent 隔離進 `.claude/worktrees/agent-<hex>/` ephemeral worktree（session 結束 GC）— 在裡面 `spectra unpark` 的 artifacts GC 後永久遺失（ghost park，未 commit 的 proposal / specs / tasks 無 recovery path）。完整後果 / detection / recovery 見 [[pitfall-agent-tool-subagent-worktree-bypass]]。

**MUST**：
- `/spectra-propose` 收尾把 artifacts **commit 進 git**（不要光 park 交給下游 dispatch）
- `/spectra-apply` Step 2 把 `spectra unpark` 移到主線預先做，artifacts 落 main disk 後再 dispatch；**禁止**派 unpark 給 subagent
- **NEVER** 假設 subagent cwd = `<consumer>-wt/<slug>/`：派工前 echo cwd 確認，看到 `.claude/worktrees/agent-*` 立刻 STOP

## §10 review-gui 與 worktree 互動的已知坑

`vendor/scripts/review-gui.mts` 從多 worktree aggregate `openspec/changes/`，3 條已記坑：home list silent skip main change（[[pitfall-review-gui-collision-typo-and-worktree-startup]]）、source aggregation collision（[[pitfall-review-gui-source-aggregation-collision]]）、apply-pending batch button 按前 **MUST** spot check 每張 change impl 完成度（[[pitfall-review-gui-apply-pending-mid-apply-changes]]）。

改 review-gui.mts 後 consumer 端 `pnpm review:ui:kill && pnpm review:ui` 重啟才吃到新版。

## §11 WORKTREE-BRIEF.md — 持久化任務交接上下文

Session worktree 在 worktree root 攜帶 `WORKTREE-BRIEF.md`，內含原始任務描述、thin brief context、Progress checklist。這份檔案讓 session 意外中斷後，新 session 能無縫接手。

**MUST read first**：cwd 在 session worktree 且 `WORKTREE-BRIEF.md` 存在時，**MUST** 先讀它再做任何工作。Brief 是這個 worktree「該做什麼、做到哪、還剩什麼」的唯一權威來源。

**Subagent contract**：`/wt` 派出的 subagent **MUST** 在工作過程中更新 brief 的 Progress section（勾完成項、加新發現的步驟），並在完成時把 frontmatter `status` 改為 `done`（或 `blocked` / `failed`）。

**Resume path**：新 session 進入有 brief 的 worktree 時，走 brief 裡的 Recovery section：

1. `git log main..HEAD --oneline` 看已完成 commit
2. `git status` 看未 commit 的工作
3. 從 Progress 下一個未勾選項繼續
4. 不要從頭來過 — brief 已包含 digested context

**File 不進 git**：`WORKTREE-BRIEF.md` 由 `wt-helper add` 自動寫入 per-worktree `$GIT_DIR/info/exclude`，不會出現在 `git status`。**NEVER** `git add` 它。**NEVER** 加到 `.gitignore`（那會影響 main）。

**`/wt resume <slug>`**：明確 resume 入口。偵測既有 worktree + brief → 跳過建立，直接 dispatch resume subagent。

## §12 archive / merge-back 撞平行 worktree fork residue — canonical recovery

多條 change 平行、其中一條要 archive / merge-back 收尾時，會撞兩類 fork-time residue 阻擋。**MUST** 照下列 recovery 直接做，**NEVER** 回頭問 user、**NEVER** 反射性用 bulk `--auto-stash`。完整根因見 pitfall `pitfall-archive-mergeback-parallel-worktree-fork-residue`。

### §12.1 merge-back blocker = 別 session 的 main WIP → 最小範圍 stash

`wt-helper merge-back <change>` pre-sync 後回 `merge-back blocked: N file(s) in main's working tree would be overwritten by squash`（典型 `HANDOFF.md`）——那是**別 session 在 main 的未 commit WIP**。工具建議的 `--auto-stash` 是 **bulk-stash**（捲走 main 全部 dirty，含別 session / 別 archive-in-progress deletions），blast radius 過大。**MUST** 改用最小範圍：

```bash
git stash push -m "protect-main-<file>-during-mergeback" -- <blocker-path>
git status --porcelain          # 確認只有該檔消失、其他 main dirty 完整（此 git 版本無 pathspec scope-leak）
node scripts/wt-helper.mjs merge-back <change>   # 不帶 --auto-stash
git stash pop                   # 立即還原別 session WIP
git diff <blocker-path>         # 確認還原 == 原 WIP
```

- **NEVER** `--auto-stash`（bulk，擾動別 session / 別 archive-in-progress）。
- session branch 通常**不動** blocker 檔（是 pre-sync 把 main HEAD 版本帶進 branch 才觸發覆蓋判定）；先 `git log origin/main..HEAD -- <blocker>` 確認 branch 沒真的改它，就能安心 stash-pop round-trip。

### §12.2 spectra archive 撞 sibling worktree stale 副本 → 逐一 clean-check 後移除

`spectra archive <change>` 回 `Change '<change>' exists in both the main repository and a worktree: ...`——別 session 的 active-change worktree 各自帶著 fork 時的 `openspec/changes/<被 archive 的 change>/` clean 舊副本，逐一擋 archive（實測一次撞 4 個）。**MUST** 掃所有 sibling worktree、**驗每份 clean** 後移除（committed snapshot，`git checkout` 可完全復原）：

```bash
CHANGE=<change-name>
git worktree list --porcelain | awk '/^worktree /{print $2}' | while read wt; do
  [ "$wt" = "$(git rev-parse --show-toplevel)" ] && continue
  d="$wt/openspec/changes/$CHANGE"
  [ -d "$d" ] || continue
  dirty=$(git -C "$wt" status --porcelain "openspec/changes/$CHANGE/" | wc -l | tr -d ' ')
  if [ "$dirty" -eq 0 ]; then rm -rf "$d"; echo "removed stale copy from $wt"
  else echo "SKIP $wt — $dirty uncommitted (inspect first)"; fi
done
spectra archive "$CHANGE"       # 重跑
```

- **MUST** 先驗 `git status --porcelain` 為空才 `rm -rf`；有 uncommitted 才需人工判斷（極罕見——那不是該 worktree 的 change）。
- sibling worktree 之後自己 merge-back 的 pre-sync 會自然對齊 archive 結果，不需額外處理。

> Tool-enhancement candidate（pitfall prevention[1]，尚未實作）：`spectra-archive` Step 0 自動偵測+清 sibling clean 副本、`wt-helper merge-back` 對單一 blocker 自動 minimal-scope stash。落地前照本 § 手動 recovery。
