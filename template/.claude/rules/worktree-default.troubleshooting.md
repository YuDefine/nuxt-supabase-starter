---
description: Worktree 升級路徑 / Stop hook 死鎖 / spectra DB 跨 wt 共享 / artifact git / phase-tick commit / main 端 tasks.md 打勾方向判定 / review-gui 坑 / WORKTREE-BRIEF（worktree-default §7–§12 detail）
paths:
  - 'openspec/changes/**'
  - 'vendor/scripts/wt-helper.ts'
  - 'vendor/scripts/stash-reconcile.ts'
  - 'vendor/scripts/review-gui.ts'
  - 'scripts/wt-helper.ts'
  - 'scripts/review-gui.ts'
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/worktree-default.troubleshooting.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


> Path-scoped detail of [[worktree-default]] §7–§11。核心 always-load 規約在母檔 worktree-default.md。


## §7 升級路徑與 grandfathered worktree

命名不符 `session/*` 的舊 worktree **grandfathered**，不強制重命名；`wt-helper list` / `prune` 只認 `session/` 前綴，新建一律走 `/wt`。V2 → V3 in-flight worktree 處置：ready archive → `/spectra-archive <name>`（Step 0 自動 merge-back）；還在 implementation → 不動，archive 時吸收；ad-hoc Form-1 → `wt-helper land-pending <slug>`（alias of merge-back，容忍 multi-commit branch）；過時不要 → `cleanup --force --force-discard-unland`（**永久砍 commit**）。Legacy `cross-session-block-*` stash 走 `stash-reconcile.ts`；HANDOFF drift 由 session-start `handoff-drift-scan.ts` 偵測，drift → `/handoff` refresh。

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

### §9.5.1 Phase-tick commit 紀律（TD-216）

worktree subagent 完成每個 tasks.md phase section 的最後一個 `- [ ]` → `- [x]` 後 **MUST** commit tasks.md **與該 change 的 verify evidence sidecar** 到 worktree branch：

```bash
git commit --only -m "📝 docs(spectra): phase N done (<change-name>)" -- \
  openspec/changes/<change-name>/tasks.md .spectra/evidence/<change-name>.jsonl
```

**每一個** phase-tick commit 都 MUST 同時帶這兩條路徑，不是只有跑過 verify 的那一次；sidecar 檔尚未存在時才可省略該路徑。

type **MUST** 是 `📝 docs`，**NEVER** 是 `📝 spectra` —— 後者不在 conventional type 集合內，帶 emoji 型 `type-enum` 的 consumer（<consumer-b> 等）會在 commit-msg hook 擋下，而報的錯是 `subject may not be empty`，跟真因對不上。

**Why**：`merge-back --squash` 只帶 committed changes 回 main。未 commit 的 checkbox 更新留在 worktree working tree → merge-back 不帶回 → review-gui 讀 main tasks.md 永遠看到 `[ ]` → impl-gate 誤判 <90%。

**NEVER** 只在 worktree working tree 勾 checkbox 而不 commit — 即使「等做完一起 commit」也 **MUST** 至少在 build 結束前批次 commit 一次。同一條對 receipt 成立：**NEVER** 讓 `.spectra/evidence/<change-name>.jsonl` 只停在 worktree working tree —— checkbox 走 commit 回 main、receipt 留在原地被 GC，正是 [[TD-394]] 記的失敗型態。

**NEVER** 把 `openspec/changes/<change-name>/tasks.md` 與 `.spectra/evidence/<change-name>.jsonl` 以外的路徑加進這個 commit。契約 SoT 在 [[commit]] § worktree 內唯一合法的 commit：artifact-tick —— 那裡的 `git commit` 禁令對 worktree 內**其他任何**改動仍然成立，本節是它唯一的例外。

## §9.7.1 main 端出現 tasks.md 改動時，方向由 diff 判，不由 §9.7 外推

母檔 §9.7 的「main 的是 fork-time snapshot」管的是**讀**。它**不保證** main 上的改動一定比較舊 —— 有人在 main 補勾 checkbox（因為 worktree 沒依 §9.5.1 commit tasks.md，main 看起來落後）是常態。把它外推成「main 端出現的 tasks.md 改動一律是退化副本」，丟掉的會是**唯一**那份較新的進度。

main 端出現 `openspec/changes/**/tasks.md` 改動時 **MUST** 先量打勾方向：

```bash
# MUST 用 `git diff HEAD`（含 staged）—— 純 `git diff` 漏掉已 staged 的改動，全 staged 時兩行都回 0
git diff HEAD -- openspec/changes/<change>/tasks.md | grep -c '^+.*- \[x\]'   # 新增的打勾
git diff HEAD -- openspec/changes/<change>/tasks.md | grep -c '^-.*- \[x\]'   # 移除的打勾
```

方向確認後 **MUST 逐項比對打勾集合，NEVER 只比數量** —— 數量相同也可能是不相交的兩組，比數量會靜默丟掉 main 獨有的項：

```bash
diff <(grep -n '^\s*- \[x\]' <main>/openspec/changes/<change>/tasks.md) \
     <(grep -n '^\s*- \[x\]' <wt>/openspec/changes/<change>/tasks.md)
```

再依下表處置：

| 可觀察 predicate | 動作 |
| --- | --- |
| 有 active worktree，且 worktree 的打勾集合 **⊇** main 端（上面 diff 無 `<` 行） | main 這份確實多餘 → 可 stash / 捨棄 |
| 有 active worktree，但 main 端有 worktree 沒有的打勾項（diff 有 `<` 行） | main 這份是唯一記錄 → **NEVER** stash。依 [[worktree-baseline]] § 手動 selective sync 正解帶過去（`git -C <main> diff --binary HEAD -- <path> \| git -C <wt> apply`）再依 §9.5.1 commit。**NEVER** `git -C <wt> checkout main -- <path>` —— 它讀 main 的 **commit**，而本節前提正是那份改動未 commit |
| 無 active worktree（已 merge-back / 已 archive） | main 就是 working truth → **NEVER** 以「working truth 在 worktree」為由處置 |

**NEVER 只看 `git stash show --stat` 或 `git diff --stat` 判方向** —— `[ ]` → `[x]` 與 `[x]` → `[ ]` 在那裡給出**完全相同**的 insertions / deletions 數字（實證 2026-08-11 <consumer-b>：`21 insertions(+), 21 deletions(-)`，訊息標「退化副本」，實際是多勾了 21 項）。

**NEVER** 因為 stash 訊息自稱那是過期內容就採信 —— 寫那句訊息的 session 依據的正是本節被外推的那句話。詳見 [[pitfall-main-side-tasks-md-tick-stashed-as-stale-copy]]。

## §10 review-gui 與 worktree 互動的已知坑

`vendor/scripts/review-gui.ts` 從多 worktree aggregate `openspec/changes/`，3 條已記坑：home list silent skip main change（[[pitfall-review-gui-collision-typo-and-worktree-startup]]）、source aggregation collision（[[pitfall-review-gui-source-aggregation-collision]]）、apply-pending batch button 按前 **MUST** spot check 每張 change impl 完成度（[[pitfall-review-gui-apply-pending-mid-apply-changes]]）。

改 review-gui.ts 後 consumer 端 `pnpm review:ui:kill && pnpm review:ui` 重啟才吃到新版。

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

多條 change 平行、其中一條要 archive / merge-back 收尾時，會撞兩類 fork-time residue 阻擋。**MUST** 照下列 recovery 直接做，**NEVER** 回頭問 user。完整根因見 pitfall `pitfall-archive-mergeback-parallel-worktree-fork-residue`。

### §12.1 merge-back blocker = 別 session 的 main WIP → 最小範圍 stash

`wt-helper merge-back <change>` pre-sync 後回 `merge-back blocked: N file(s) in main's working tree would be overwritten by squash`（典型 `HANDOFF.md`）——那是**別 session 在 main 的未 commit WIP**。

**正解就是 `--auto-stash`**（也就是 `/spectra-archive` Step 0 寫的那條命令）。它是 bulk-stash（捲走 main 全部 dirty，不只 blockers，為的是避開 git 2.50.1 的 pathspec scope-leak），但 squash 一落地就**自動 pop 回 main**——squash 結果與原本的 main dirty 併回同一個 working tree，別 session 的 WIP 不會被留在 stash 裡。這正是「所有東西一起走一次 `/commit`」需要的狀態。

```bash
node scripts/wt-helper.ts merge-back <change> --auto-stash
# 成功時印：merge-back: auto-restored N stashed path(s) onto main
```

- pop 撞 conflict 時**不會**靜默：stash 保留、印出「squash HAS landed, stashed changes have NOT been merged back」+ 解法。此時才需要人工三方合併，**NEVER** 在沒讀那段警告前就繼續往下走。
- 只有在**明確要讓 main 其餘 dirty 完全不被碰**時（例：別 session 正在跑 archive，working tree 中途狀態不可擾動）才改走最小範圍 round-trip：`git stash push -m ... -- <blocker-path>` → 不帶 flag 的 `merge-back` → `git stash pop`。這是例外不是預設。
- session branch 通常**不動** blocker 檔（是 pre-sync 把 main HEAD 版本帶進 branch 才觸發覆蓋判定）；先 `git log origin/main..HEAD -- <blocker>` 確認 branch 沒真的改它，就能安心 round-trip。

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
