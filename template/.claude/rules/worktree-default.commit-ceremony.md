---
description: Worktree v3 commit 階段 — subagent commit → archive 吸收 → merge-back ceremony → 操作工具（worktree-default §5/§5.5/§6 detail）
paths:
  - 'openspec/changes/**'
  - 'HANDOFF.md'
  - 'vendor/scripts/wt-helper.mjs'
  - 'vendor/scripts/stash-reconcile.mjs'
  - 'scripts/wt-helper.mjs'
  - 'scripts/stash-reconcile.mjs'
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/worktree-default.commit-ceremony.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


> Path-scoped detail of [[worktree-default]] §5 / §5.5 / §6。核心 always-load 規約在母檔 worktree-default.md。

繁體中文

## §5 Commit 階段：subagent commit → archive 吸收 → user `/commit`

**v3 atomic landing model**（取代 v2 「`/wt` 返回時 squash」）：

`/wt` 跑完後 subagent 在 worktree branch 上有 commit，**worktree 連同 branch 保留**（不 squash 不 cleanup）。`/spectra-archive <change-name>` Step 0 跑 `wt-helper merge-back` 把 worktree atomic 吸收進 main + cleanup，再做 archive bookkeeping；user 之後在 main 跑 `/commit` 一次 commit 累積的 diff。

### 為什麼從 v2 改 v3


v3 atomic landing 解這些：main 永遠 deployable；多 session 平行不污染 main（每條 worktree 各自保留到 archive）；一個 ceremony land 全部；人工檢查 Gate 與 archive gate 對齊為同一道進 main 關卡。

### Mechanic

**Codex 派工規約**（細則見 [[agent-routing.codex-watch-protocol]] § Commit Authorization）：codex 可在 worktree 內 commit，但 **MUST** 遵守：一 phase 一 commit、message 強制 `🧹 chore: wt <change>-phase-<N> — <short>`、不繞 hook（**禁止** `--no-verify`）、selective stage（**禁止** `git add -A`）、commit 前自跑 drift + scope check、**仍禁止** `git push` / 中途 `git stash` / `--amend` / `/commit` / `/spectra-commit`。主線收到完工通知後 **MUST** 驗 commit 邊界對齊 phase + format、double-check drift / scope（發現 → `git -C <wt> reset --soft main` 重派）、跑 typecheck / test。

本段「Subagent 在 worktree commit」**對 Claude subagent 與 codex 都適用**（規約相同）；差別只在 subject 後綴：Claude subagent 用 `🧹 chore: wt <slug> — <free-form>`，codex 強制 phase 格式以利主線對齊。

1. **Subagent 在 worktree 內 commit**（`/wt` prompt template 強制）：`git add -- <scoped file>` selective stage（**禁止** `git add -A`） + `git commit -m "🧹 chore: wt <slug> — <short>"`，可多 commit，pre-commit / commit-msg hook 必跑。**NEVER**：`git push` / `/commit` / `/spectra-commit`。
2. **`/wt` 返回時**：**不** squash，**不** cleanup。worktree + branch 保留，主線只報告 status。
3. **`/spectra-archive <name>` Step 0 — atomic merge-back**：跑 `node scripts/wt-helper.mjs merge-back <name> --auto-stash --noop-if-missing`（細節見 §5.5）。
4. **Archive 後續 step**（gates / spec sync / screenshot sweep / folder mv）跑於 post-squash main，gate 檢查看到 merge 後結果。
5. **User 在 main 跑 `/commit`**（時機 user 決定，可累積多 archive 再一次 commit）：selective stage + 0-A/B/C 品質閘門 + commit + push。Archive 後 tasks.md 已 mv 進 archive 子目錄，人工檢查 Gate 不擋。

### Ad-hoc Form-1 worktree（非 spectra change）

無 `/spectra-archive` 觸發 merge-back，user 手動跑 `wt-helper merge-back <slug> --auto-stash` 後走 `/commit`。deferred-landing 是 `/wt` 的「通用 primitive」設計；**此例外只屬於 `/wt` 本身**，包裝 `/wt` 的 skill 走下面 Skill-owned 管轄。

### Skill-owned worktree lifecycle（auto merge-back contract）

Skill 自己 fork worktree、有**清楚 end-of-skill 完成點**、**無下游 skill 接手 landing** → **MUST** 在完成點自主 merge-back + selective stage on main，**NEVER** 把這幾步丟回 user。

**符合**：`/dep-upgrade` § Outdated mode、機械化 codemod / bulk rename / 批次重構 skill。

**不符合（保留 deferred-landing）**：`/wt` primitive、`/spectra-apply`（archive 吸收）、`/spectra-ingest`、`/spectra-debug`、`/spectra-propose`（不寫 product code）。

**Auto merge-back 標準流程 6 步**（cd 回 main → `merge-back --auto-stash` → baseline blocker 自清 → 真衝突 STOP + AskUserQuestion，**NEVER** 主線自決 → selective stage on main，**禁止** `git add -A` → **NEVER** 自動 `/commit`）+ 摘要彙報四要素（必印）+ 例外處理，完整命令見 `~/offline/clade/vendor/snippets/worktree-baseline/merge-back-ceremony.md` § Skill-owned auto merge-back 標準流程。**NEVER** 預設主動延遲 landing（user 明確說「先別 land」才 skip auto）。

### 禁止項

- **NEVER** 在 subagent prompt 內叫它跑 `/commit` / `/spectra-commit` — main commit 才是 ceremony
- **NEVER** 在 `/wt` orchestration 自動跑 `/commit` 收尾 — 剝奪 user 對 commit 時機的控制
- **NEVER** 在 worktree 內 `git push` session branch — 只會在 origin 留 stale ref
- **NEVER** 在 `/wt` 返回時 squash（v3 核心改動 — squash 推延到 archive）
- **NEVER** 略過 `/spectra-archive` Step 0 直接做 archive bookkeeping — gates 會跑於 false-clean main
- **NEVER** 用 `wt-helper cleanup <slug> --force --force-discard-unland` 不先跑 `merge-back` — 永久丟失 branch commits

## §5.5 Merge-back ceremony

`wt-helper merge-back <slug>` 是 atomic landing 的核心命令，由 `/spectra-archive` Step 0 自動呼叫，或 user 手動呼叫。完整 flags 表與預設行為 7 步見 `~/offline/clade/vendor/snippets/worktree-baseline/merge-back-ceremony.md`；flags 詳見 `node vendor/scripts/wt-helper.mjs merge-back --help`。

### Claim guard scope ⊇ bulk-stash scope（hard rule）

`--auto-stash` 實際執行的是 **bulk-stash（`git stash push -u`，不帶 pathspec）**，捲走 main **全部** dirty —— 不只 `blockers`（= branch changeset ∩ main dirty）。因此 `--auto-stash` 在真正 bulk-stash **之前**，claim guard 的檢查範圍 **MUST ⊇ 將被 bulk-stash 捲走的全部 dirty**，**NEVER** 只查 `blockers` 子集。

- bulk-stash 前 **MUST** 對 main **全部** dirty（`detectMainDirty`）跑 claim 比對（`classifyDirtyPaths`，`excludeClaim` 為本 merge-back worktree 的 claim）；
- 差集（`allDirty \ blockers`）若含**別 session 認領**（`otherSession`）的 dirty → **fail-loud STOP / refuse auto-stash**（與既有 blocker-only / pre-fork guard 一致），列出 `<path> → <session-id>` 並要 user 等別 session 收斂或協調，**NEVER** 默默 bulk-stash 捲走別 session WIP；
- 差集為空 / 全屬本 change / 為**無主**（unclaimed）dirty → 維持既有正常 flow（`--auto-stash` 本就設計來吞無主 dirty，user 後續走 `stash-reconcile`）。

**為什麼**：claim guard 原本只假設「危險 = branch 要 land 的改動撞到別 session 改同檔」，但 bulk-stash 的副作用是「為清出乾淨 working tree 做 squash，把**所有** dirty 移走」——範圍遠大於 branch changeset。不在 branch changeset 的別 session 認領檔不是 blocker，guard 從未檢查，bulk-stash 照捲（2026-05-29 <consumer-b>：vending merge-back `--auto-stash` 捲走別 session my-kpi 19 檔 WIP）。**正解是擴大 guard 檢查範圍，不是縮小 stash 範圍**（pathspec stash 會踩 git 2.50.1 scope leak，見 `pitfall-git-stash-pathspec-scope-leak`）。詳見 `pitfall-merge-back-autostash-bulk-captures-other-session-wip`。

### Stash 操作必 verify create

`git stash push -u -m <msg>` 對乾淨 working tree exit 0 + stdout `No local changes to save`，**不會丟 exception**、stash list 不會多 entry。任何 wt-helper / spectra script 跑 `git stash push` 都 **MUST** 在 push 前後比對 `git rev-parse --verify refs/stash` 確認 stash entry 真的建立；mismatch → 把 stashRef 設 null 並 warn，**禁止**仍宣稱 stashed。詳見 `pitfall-wt-helper-merge-back-silent-stash-miss`。未來新加 stash push 路徑（spectra-apply phase suffixes、clade-propagate、clade-publish 等）皆套同樣 contract。

### Stash reconcile（後續清理）

`node scripts/stash-reconcile.mjs`（`--interactive` / `--json` / `--slug <slug>` / `--stale-days N` / `--include-all`）列每條 namespaced stash + 建議命令；merge-back 成功收尾會自動印帶 `--slug` 的 reconcile hint。**永遠不 auto-pop / auto-stage / auto-commit**：apply 後 user WIP 在 working tree，必須走 `/spectra-commit` 或 `/commit` 的 selective stage（**禁止** `git add -A`）。

完整命令清單、Stash 命名空間表與失敗 fallback 表見 `~/offline/clade/vendor/snippets/worktree-baseline/merge-back-ceremony.md`。其中 `cleanup` 拒絕 uncommitted 時 **NEVER** 急加 `--force-discard-uncommitted` — 先 `wt-helper rescue --show <ref>` 看 patch、救完再 cleanup。

## §6 操作工具：`/wt`、`wt-helper.mjs`、`stash-reconcile.mjs`

常用 6 列：

| 動作 | 指令 | 說明 |
| --- | --- | --- |
| 開始 worktree task（推薦入口） | `/wt <task description>` | `/wt` orchestrate build + dispatch + report；不 squash 不 cleanup（v3） |
| 列出 session worktree | `node scripts/wt-helper.mjs list` 或 `--json` | 看 pending worktrees |
| Atomic merge-back | `node scripts/wt-helper.mjs merge-back <slug>` | 把 worktree atomic land 進 main（squash + cleanup） |
| Merge-back 預覽 | `node scripts/wt-helper.mjs merge-back <slug> --dry-run` | 列 blockers 不執行 |
| List pre-fork baseline 救援候選 | `node scripts/wt-helper.mjs rescue` | 列 `refs/wt-baseline/*` pinned ref + fsck dangling stash；`--show <ref\|sha>` 看 patch（read-only） |
| Stash reconcile 互動 | `node scripts/stash-reconcile.mjs --interactive` | 一條一條 apply / drop / view（never auto-pop） |

完整工具表（含 `cleanup --force`（**丟工作**，必先 merge-back + rescue 撈 baseline）、`land-pending`、`prune`、reconcile 各模式、`handoff-drift-scan.mjs`）見 `~/offline/clade/vendor/snippets/wt-helper/README.md` § 工具速查表。

`/wt` skill source：`~/offline/clade/plugins/hub-core/skills/wt/SKILL.md`；`wt-helper.mjs` / `stash-reconcile.mjs` / `handoff-drift-scan.mjs` source：`~/offline/clade/vendor/scripts/`（散播投影到 consumer 的 `scripts/`）。
