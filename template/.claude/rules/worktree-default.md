<!--
🔒 LOCKED — managed by clade
Source: rules/core/worktree-default.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->

# Worktree Default

> **無 frontmatter — unconditional always-load**。規約必須在每個會改 code 的 session Read 任何檔之前生效。

繁體中文

**核心命題**：multi-session 並行開發共用單一 working tree，staged 區、branch HEAD、partial WIP 都會跨 session 滲漏。

操作層面由 `/wt` 全自動 orchestrate — user 不需手動 add / merge / cleanup，主線 cwd 全程不動。

此規則優先於全域 `~/.claude/CLAUDE.md` 的「git workflow」相關段落（若存在）。

---

## §1 預設用 worktree

要寫、改、刪 tracked file 的工作 **MUST** 在獨立 worktree 內執行，**NEVER** 直接在 main 改。

**操作方式**：user 在 main 直接打 `/wt <task>` — `/wt` 建 worktree、dispatch subagent 進去做事（細節見 [[wt]]）。主線 chat session 全程 cwd 不動、不切 terminal、不開新 session。

**判定「要動 code」**：請求含 implement / fix / refactor / add / edit / 部署準備 / migration / config 寫入等動詞，且目標是 tracked file。

**例外：read-only session**。只讀不寫檔（grep / log / audit / git history / 解釋 code），**MAY** 在 main worktree。

**例外：main-bound skill（`/spectra-archive`）**。archive 語意就是「把 change 合併進 main」：Step 0 先 `wt-helper merge-back` 吸收對應 worktree，再做 bookkeeping（mv folder / delta sync / screenshot sweep）— 所有寫入目標都是 main，走 worktree 只多一道 merge-back、無 isolation benefit，因此 **MAY** 在 main worktree 直接跑。其他 spectra-* skill（`/spectra-apply` / `/spectra-ingest` / `/spectra-debug`）**不在此例外**，仍須走 `/wt`。

**判定「已在 worktree」**：`git rev-parse --git-dir` 含 `/worktrees/` 子路徑即已在 worktree，**不要**疊建新 worktree。

### §1 archive-on-main 的 clobber 窗口（pitfall 2026-06-01）

archive-on-main 例外讓未 commit 的 archive batch 躺在 **shared main**；`/commit` 因 gate halt 時這批 dirty 長期留在 main，會被別 session 的 `wt-helper add --baseline-strategy stash` 當 unclaimed dirty 整批捲進 `refs/wt-baseline/*`（實證見 [[pitfall-prefork-baseline-stash-sweeps-unclaimed-main-work]]）。

**MUST**（縮短 / 消除窗口）：

- **archive 收尾的 follow-up fix（修測試 / 補 code / 加 migration）走 `/wt` 進隔離 worktree**，**NEVER** 在 main 累積多步 in-flight 工作等 commit；archive bookkeeping 本身才 MAY 在 main 跑。
- `/commit` 因可恢復的 gate halt、batch 需進一步 code 改動才能過 gate 時，**SHOULD** 立即把 batch 移進隔離 worktree 修。
- 跨多步在 main 累積 batch 且無法立刻 commit 時，**SHOULD** 寫 coarse claim 保護（見 [[session-claims]] § 主線無 claim 的保護缺口）。

### §1 invariant：parent session cwd 不動

`/wt` 的所有 invocation form **SHALL NOT** 遷移 parent session 的 cwd。worktree 內操作由 subagent（cwd = worktree path）執行，主線（cwd = main）負責 dispatch。

**無例外**。先前的 `--dispatch-from-handoff` flag 已**移除** — subagent 隔離 cwd 達到同樣 UX。理由：mid-conversation 切 parent cwd 會破壞 file watcher、Bash cwd state、未完成 Read window。

### §1.x 階段間 setup chore：主線一行式 `cd` 進 worktree 自動跑

Phase 切換之間若需在 worktree 跑 **local-only** setup chore，主線 **MUST** 用 Bash `cd <wt> && <cmd>` 一行式自跑，**NEVER** 把指令清單推回 user。subshell `cd` 不影響 parent cwd（§1 invariant 講 sticky cwd，不禁 subshell cd）。

**自動代勞 OK**：`pnpm install` / `pnpm db:*` / `pnpm supabase:sync` / `pnpm build` / `pnpm lint` / `pnpm test` / `vp check` / `tsc --noEmit` / local pnpm script（無 push/publish/deploy 副作用）。

**仍需 user 拍板（真 destructive）**：`rm -rf <wt>`、`git push`（已被 §5 禁）、Prod DB migration / Prod creds、outbound 訊息、shared infra。

**失敗處理**：跑爆主線自己診斷修復，不丟回 user。**反模式**（立刻停手）：列「請你 cd 過去跑」清單、「跑完回我 OK」。**例外**：user 明確說「我自己跑」/「先別動」尊重。

### §1 Pre-fork baseline guard

Fork 出 worktree 之前，`wt-helper add` **MUST** 先跑 `detect-main-dirty` 偵測 main working tree 狀態，再依路徑決定策略：

- **Unmerged 非空** → 跑 `classifyUnmergedSafety` 分流：
  - **Safe-resolvable**（檔內無 conflict markers + 無 merge / rebase / cherry-pick in-progress state）→ helper 自動 `git add <paths>` 標 resolved 後 proceed（stale UU 是 index residue，無資料風險）。
  - **Unsafe**（任一條件命中）→ **STOP**，refuse to fork，列每條 unsafe path + reason。**NEVER** 自動處理真衝突 / 中段 merge — 任何動作都可能丟資料。
- **Clean** → 直接 fork（既有行為）。
- **Dirty 非空** → 依 caller 路徑：
  - **Spectra workflow 路徑**（有 change context）走 **commit-then-fork**：主線從 proposal + specs + `.spectra/touched/<change>.json` 萃取 affected paths（scope-in），呼叫 `wt-helper add ... --precheck-baseline <change> --baseline-strategy commit --baseline-scope-paths <comma>` — helper selective stage + commit `baseline: <change> pre-fork sync` 上 main 再 fork；scope-out（跨 session WIP）留在 main 不動。
    - **`--baseline-scope-paths` MUST 對齊 proposal `## Impact` `Affected code` 列的*每一條* scope-in path，NEVER 過度保守只挑核心 code** — 漏帶會讓同一條 change 的改動分散 main + worktree 兩處（scope 分裂，<consumer-a> `per-client-module-isolation` 實證）。Detection：fork 後 `git status` 若 main 仍有該 change `## Impact` 列的 dirty path = baseline 漏帶。
  - **Ad-hoc `/wt` 路徑**（無 change context）走 **stash-apply**：`wt-helper add ... --precheck-baseline --baseline-strategy stash`。Helper 內部在 main `git stash push -u -m wt-baseline/<slug>/<ISO>`，fork 後進 worktree `git stash apply` → **pin stash sha 到 `refs/wt-baseline/<slug>/<ISO>` 永久 ref** → `git stash drop`（物件仍 reachable）。Subagent 收到 [[wt]] Step 2 warn 段落知道哪些檔是 baseline 不該動。Pin 機制防 cleanup 後 baseline 永久消失 — 可用 `wt-helper rescue` 列出救回。
  - **Ambiguous**（scope-in 為空但 scope-out 非空、或三來源都對不上）→ **STOP** + 回 user 拍策略。**NEVER** 主線亂猜。

詳細 cookbook（4 種情境 + 完整 trace + scope filter 細節）見 `~/offline/clade/vendor/snippets/worktree-baseline/`。

#### Stash strategy 的隱性風險（hard rule）

`--baseline-strategy stash` 假設 dirty main = safe to stash，實際可能含 in-flight feature code 或別 session WIP — stash 不區分全部捲進 pinned ref，後續走 Path X 救援會讓 feature 從 main 整段消失（typecheck 不抓）。

**NEVER**：
- `--baseline-strategy stash` 跑完未 pre-fork audit 就直接 dispatch subagent
- merge-back 撞 conflict 時不查 baseline 內容、直接 `git reset --hard <subagent-commit>` 走 Path X
- cleanup `--force-discard-uncommitted` 不先 `wt-helper rescue` 確認 baseline 內容

完整 audit script / conflict diagnostic / recovery 命令見 [[pitfall-pre-fork-baseline-hides-in-flight-feature]]。

> Rationale (2026-05-18)：原「unmerged 永遠 STOP」過嚴 — helper 兩條 safety check 對 stale UU false-positive 極低、對真衝突仍 fail-safe。

**為什麼**：worktree 從 main HEAD 分出，看不到 working tree 的 untracked / modified — 沒這道 guard 時 subagent 進 worktree 看 baseline 全缺 fail-fast，每次 fork 都得回頭打擾 user 拍策略。

### Pre-flight guard 不適用範圍：spectra-propose

`spectra-propose` Step 11 的 `wt-helper add "<change-name>"` 呼叫**預設不帶** `--precheck-baseline`，整套 dirty / unmerged / scope guard **不適用**於 propose。理由：propose 全程只寫 `openspec/changes/<change-name>/`、跟 main 的 staged / modified / untracked 完全不撞檔；fork 基於 main HEAD commit，working tree state 留在 main；product code 要到 apply 階段才動。

**操作守則**：

- 看到 main dirty / staged / unmerged 時**直接** `/spectra-propose <name>`，**NEVER** 反射性建議 user 先 commit / stash / 詢問 staged 內容
- 例外：若 user 的 staged / WIP **就在** `openspec/changes/<change-name>/` 子目錄裡（重跑同名 propose 的 path collision 場景），先 inspect、跟 user 對齊是否覆蓋

> Anti-pattern 警示：別把這條鬆綁推廣到 `/spectra-apply` / `/spectra-ingest` / `/spectra-debug` — 這些 skill **會**寫 tracked product code，**仍須**走 §1 Pre-fork baseline guard。本例外**僅限** propose（fork 純粹為 apply 預備 worktree，不寫 product code）。

### Anti-pattern：手動 `git stash push -u -- <pathspec>` 做 selective baseline sync

**NEVER** 主線自己跑 `git stash push -u -m "<msg>" -- <pathspec>` 試圖 scope 部分檔案進 stash，再 cd 到別處 `stash apply` 做 cross-worktree baseline sync。

**為什麼禁**：git 2.50.1 pathspec stash 有 scope leak — stash commit 包整個 tracked tree 的 modifications，apply 到 fresh worktree 帶進大量 cross-session noise。詳見 [[pitfall-git-stash-pathspec-scope-leak]]。

**正解**：worktree baseline sync 走 `wt-helper add --precheck-baseline`（§1 上文，bulk stash 不帶 pathspec 避開此 bug）；非 worktree 場景的 selective sync（patch + rsync）與長期 cross-branch sync（format-patch + am）命令塊見 `~/offline/clade/vendor/snippets/worktree-baseline/README.md` § 手動 selective sync 正解。

**判別**：任何「想把 X、Y、Z 三個檔的改動搬去別 worktree」的場景，**第一反應應該是 wt-helper 或 patch route**，**禁止**自己手寫 `git stash push -u -- <paths>`。

## §2 禁止 silent branch 建立

Agent **MUST NOT** 跑 `git checkout -b`、`git branch <name>`、或任何會產生新 ref 的指令，**除非**先取得使用者明確同意。

**唯一例外**：`/wt` 規約定義的 `session/<YYYY-MM-DD-HHMM>-<slug>` 自動命名 — 命名完全由 convention 決定，`/wt` invocation 本身就是 user 對該 branch 的授權。

### 工具內部 branch 建立不受此規約限制

User 顯式呼叫的 script（如 `propagate.mjs` 建 `bump/<version>`）有 documented behavior，屬於 user authorized invocation。判定原則：「branch 是不是 user 透過工具 invocation 隱含授權的？」是 → 通過；不是 → 必須先問。

### Agent 想自由發揮命名（如 `feature/x` / `fix-bug-y`）

**ASK FIRST**。即使 agent 認為 branch 很合理，仍須先取得 user 同意。**NEVER** 偷偷建好再說。

## §3 Worktree 命名與位置

### Branch 命名

`session/<YYYY-MM-DD-HHMM>-<slug>`

- 時間戳對齊 [[session-tasks]] 慣例
- `<slug>` 經 `wt-helper` 的 normalization：lowercase、空白與特殊字元轉 `-`、collapse 重複 `-`、trim 首尾 `-`

### 檔案系統位置

`<consumer-parent>/<consumer-name>-wt/<slug>/`，即 `~/offline/<consumer>-wt/<slug>/`。

**Monorepo 子目錄 consumer**：`wt-helper` 走最外層 `.git` 解析 consumer root（例：starter 的 worktree 落在 `~/offline/nuxt-supabase-starter-wt/<slug>/`，**不是** `~/offline/template-wt/<slug>/`）。

## §4 與 propagate 的互動

`scripts/propagate.mjs` 的 worktree-aware preflight 偵測 cwd 在非 main worktree 即 exit non-zero — **publish + propagate 必須在 clade 主 worktree 跑**（先 `cd ~/offline/clade`）。理由：跨 worktree 寫投影層在 file watcher / staging 區會撞，refuse-and-guide 比悄悄出錯安全。

`/wt` 建 worktree 時已由 `wt-helper add` 跑 `git merge --ff-only origin/main` 拉最新投影層，一般不需再手動 sync。

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

## 相關規則

- [[wt]] — `/wt` skill 完整使用手冊（含 Step 0 resume detection、Step 1.5 寫 brief、Form 4 resume）
- [[session-tasks]] — 共用時間戳 + slug 慣例
- [[commit]] — main 上的 commit ceremony
- [[scope-discipline]] — scope 外的工作另開 `/wt` task
- [[handoff]] — §8 fallback 升級寫入入口；Mode B dispatch 用 `/wt <slug>: /<next-skill>` form
