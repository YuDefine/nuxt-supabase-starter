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

v3 atomic landing：`/wt` 跑完 subagent 在 worktree commit、worktree+branch **保留**（不 squash 不 cleanup）；`/spectra-archive` Step 0 `wt-helper merge-back` atomic 吸收進 main，user 再在 main 跑 `/commit`。Skill-owned worktree（`/dep-upgrade` 等有清楚完成點）**MUST** 自主 merge-back，不丟回 user。**NEVER** 在 subagent prompt 叫它跑 `/commit` / 在 worktree `git push` / `/wt` 返回時 squash。

> 完整 Codex 派工規約、auto merge-back contract、禁止項詳見 [[worktree-default.commit-ceremony]]（path-scoped：動 `openspec/changes/**` / `HANDOFF.md` / wt-helper 時載入）。

## §5.5 Merge-back ceremony

`wt-helper merge-back <slug>` 是 atomic landing 核心命令。`--auto-stash` 實為 **bulk-stash**（捲走 main **全部** dirty，不只 blockers）→ claim guard 檢查範圍 **MUST ⊇** 全部將被捲走的 dirty，撞別 session 認領 → **fail-loud STOP**。`git stash push` 必 verify create（乾淨 tree 不丟 exception）。

> 完整 flags / claim guard scope / stash reconcile 詳見 [[worktree-default.commit-ceremony]] § Merge-back ceremony。

## §6 操作工具：`/wt`、`wt-helper.mjs`、`stash-reconcile.mjs`

> 工具速查（list / merge-back / rescue / stash-reconcile）詳見 [[worktree-default.commit-ceremony]] § 操作工具；完整表見 `~/offline/clade/vendor/snippets/wt-helper/README.md`。

## §7 升級路徑與 grandfathered worktree

> 命名不符 `session/*` 的舊 worktree grandfathered；V2→V3 in-flight 處置、legacy stash / HANDOFF drift 詳見 [[worktree-default.troubleshooting]]。

## §8 Stop hook 死鎖 fallback

主線在 main 累積 dirty WIP + Stop hook 攔住 + 還要繼續：剩下可隔離 → `/wt <剩下的事>`；必須 main 直接處理（罕見）→ escalate `/handoff`（Mode A 自動偵測）。**預防**：session 開頭判定要動 code 就 SHOULD 立刻打 `/wt`。

> 詳見 [[worktree-default.troubleshooting]] § Stop hook 死鎖 fallback。

## §9 spectra DB 跨 worktree 共享心智模型

`.git/spectra-app/spectra.db` 是**跨所有 worktree 共享的單一 SQLite**。**NEVER** 對它跑 `DELETE` / `UPDATE` / `INSERT`；「main 無 directory + `spectra list` 顯示 active + park/unpark 失敗」**不**等於 zombie（多半別 session 在 sibling worktree 物化）。偵測 zombie 前 **MUST** 先 `git worktree list` + `find` + `mdfind`，看似 zombie 一律 **STOP + AskUserQuestion**。

> 詳見 [[worktree-default.troubleshooting]] § spectra DB 跨 worktree。

## §9.5 Spectra change artifact 必須活在 git

`Agent` tool subagent 的 ephemeral worktree（`.claude/worktrees/agent-*`）session 結束 GC，裡面 `spectra unpark` 的 artifacts 永久遺失。propose 收尾 **commit 進 git**；apply Step 2 unpark 移主線預先做；**NEVER** 假設 subagent cwd = `<consumer>-wt/<slug>/`（派工前 echo cwd 確認）。

> 詳見 [[worktree-default.troubleshooting]] § artifact 活在 git。

## §10 review-gui 與 worktree 互動的已知坑

> 3 條已記坑（home list silent skip / source aggregation collision / apply-pending 按前 spot check）詳見 [[worktree-default.troubleshooting]] § review-gui 坑。改 review-gui.mts 後 consumer 端 `pnpm review:ui:kill && pnpm review:ui` 重啟才吃新版。

## §11 WORKTREE-BRIEF.md — 持久化任務交接上下文

Session worktree 攜帶 `WORKTREE-BRIEF.md`（原始任務 + thin brief + Progress checklist）。cwd 在 session worktree 且 brief 存在時 **MUST** 先讀它再做事。`/wt` 派的 subagent **MUST** 更新 Progress + 完成時改 frontmatter `status`。檔不進 git（已在 per-worktree exclude），**NEVER** `git add` 它、**NEVER** 加進 `.gitignore`。

> 詳見 [[worktree-default.troubleshooting]] § WORKTREE-BRIEF。

## 相關規則

- [[wt]] — `/wt` skill 完整使用手冊（含 Step 0 resume detection、Step 1.5 寫 brief、Form 4 resume）
- [[session-tasks]] — 共用時間戳 + slug 慣例
- [[commit]] — main 上的 commit ceremony
- [[scope-discipline]] — scope 外的工作另開 `/wt` task
- [[handoff]] — §8 fallback 升級寫入入口；Mode B dispatch 用 `/wt <slug>: /<next-skill>` form
