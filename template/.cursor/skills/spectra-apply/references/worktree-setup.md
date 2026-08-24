<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/spectra-apply/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# spectra-apply — Step 0 worktree 建置細節

> 本檔是 `spectra-apply/SKILL.md` 的執行細節分冊（clade fork 加料，2026-08-02 自 SKILL.md 抽出以縮 invoke 成本）。
> SKILL.md 對應 step 的 inline pointer 指到本檔；**MUST 依 pointer 指示完整讀對應 § 再執行**。
> 行為 gate（NEVER / MUST 判定）留在 SKILL.md inline；本檔是操作 recipe / 範本 / 查表。

---

## Step 0c — Pre-fork baseline guard + 自動建 worktree（c.1–c.4）

   c. **Pre-fork baseline guard + 自動建 worktree**（idempotent）：

      Spectra-apply 走 **commit-then-fork** — 有 change context，把屬於這條 change 的 baseline 自動 commit 上 main 再 fork，避免 worktree 看不到 main 的 untracked / modified baseline（契約見 [[worktree-default]] §1；`--baseline-scope-paths` 的對齊要求與三路分流見 [[wt]] skill 的 `baseline-guard.md`）。

      **c.1 — 偵測 main dirty**：

      ```bash
      node scripts/wt-helper.ts detect-main-dirty --json
      ```

      解析回傳 `{ modified, untracked, conflicted }`：

      - **conflicted 非空** → STOP，回報 user 解 conflict 再重試（wt-helper 拒絕自動處理 unmerged）
      - **modified + untracked 為空**（clean）→ 跳到 c.4 直接 fork
      - **modified + untracked 非空** → 進 c.2 做 scope filter

      **c.2 — Scope filter（主線自己做，不靠 wt-helper）**：

      把 dirty paths 分成 **scope-in**（屬於這條 change 的 baseline）vs **scope-out**（其他）。三來源 union：

      1. 讀 `.spectra/touched/<change-name>.json`（若存在；spectra-commit 上次 sync 寫入）— 列出的 path 為 scope-in
      2. Grep `openspec/changes/<change-name>/proposal.md` + `openspec/changes/<change-name>/specs/**/*.md`，找 `packages/` / `server/` / `app/` / `supabase/` / `scripts/` 等 module path 提及；任一 dirty path 是它們的子路徑或開頭命中 → scope-in
      3. Fallback：dirty path basename 或開頭跟 change name slug 的 word 命中 → scope-in

      其餘 dirty → scope-out。

      **c.3 — 三情境決策**：

      | 情境 | 行為 |
      | --- | --- |
      | scope-in 非空 + scope-out 為空 | 直接走 c.4，commit-then-fork |
      | scope-in 非空 + scope-out 非空 | 印分類報告給 user（scope-in N 條 / scope-out N 條）後走 c.4，commit **只**包 scope-in；scope-out 留在 main 不動 |
      | scope-in 為空（無論 scope-out 為空或非空、無論三來源是否對得上）| 直接走 c.4 **clean fork**；若 scope-out 非空，印一行通知：`main 有 <N> 條 dirty 不屬於本 change，已留在 main 不動，worktree 從 HEAD fork`。**NEVER** STOP / AskUserQuestion / 要求 user 先 commit/stash —— worktree 隔離已處理 main WIP 對 apply 的影響；同檔衝突是 merge-back 時的事，不在 apply 範圍 |

      **c.4 — Fork（commit-then-fork 或 clean fork）**：

      ```bash
      # 有 scope-in baseline 要 commit
      node scripts/wt-helper.ts add <change-name> \
        --precheck-baseline <change-name> \
        --baseline-strategy commit \
        --baseline-scope-paths <comma-separated-scope-in-paths>

      # 或：main clean / user 選 (b) cross-session 不動 dirty
      node scripts/wt-helper.ts add <change-name>
      ```

      Helper 用 change name 當 slug，內部 normalize（lowercase / 空白轉 `-` / collapse 重複 `-`）。commit 策略時 helper 跑 selective stage（`git add -- <scope-paths>`，**禁** `git add -A`）+ commit `baseline: <change-name> pre-fork sync` + fork。Helper 行為與失敗處理見 `plugins/hub-core/skills/wt/SKILL.md`。

      若 helper fail with `Worktree path already exists` → slug 對應 worktree 已存在（前次 session 建過、未清掉），**沿用即可**，視為成功；用 `node scripts/wt-helper.ts list --json` 抓既有 path。**注意**：既有 worktree 不會再跑 baseline guard，若 main 仍有屬於本 change 的 dirty baseline，必須 user 自己 commit 後 worktree 內 `git pull` 或 cherry-pick。

      其他 helper 錯誤 → 報錯並 STOP，**不要**降級回「在 main 跑」。

---

## Step 0c.5 — Main-side unpark + commit-to-git（理由、四步流程、failure handling）

      **理由**：spectra v3 `spectra park` 把 artifacts 從 disk 搬進 `.git/spectra-app/spectra.db` SQLite blob（**不在 git tracked file**）；後續 `spectra unpark` 會 restore artifacts 到 cwd 的 worktree disk 並把 SQLite parked 條目刪除。若 unpark 在 AI Agent `Agent` tool dispatched subagent 的 ephemeral cwd（`.claude/worktrees/agent-*/`，session 結束 GC）跑 → artifacts 寫進去就被 GC 清掉、SQLite 也沒了 → **永久遺失**（<consumer-i> 已撞，99 tasks + 5 specs + proposal 蒸發）。

      因此 **MUST** 在 dispatch subagent **之前**，由主線在 main worktree（**或** Step 0c 剛 fork 出的 session worktree — 兩者都是 persistent disk，非 ephemeral）跑 unpark + commit-to-git，artifacts 落 git tracked file，subagent fork 出去後天然帶過、不再依賴 SQLite blob。

      **執行流程**：

      1. **偵測是否 parked**：

         ```bash
         spectra list --parked --json | jq -r '.parked[]?' | grep -Fx "<change-name>"
         ```

         - 命中（change 在 parked 列表）→ 繼續執行 unpark
         - 未命中 → artifacts 已在 disk / git（可能 propose 階段 Option A 已 commit、或前次 apply session 已處理），跳過此步進 Step 0d

      2. **主線在 main 跑 unpark**（**禁止**在 subagent / ephemeral worktree 跑；本步驟發生在 dispatch 之前，主線 cwd 仍是 main）：

         ```bash
         spectra unpark "<change-name>"
         ```

         Unpark 把 artifacts blob restore 到 main worktree disk 的 `openspec/changes/<change-name>/`。SQLite parked 條目被刪除（這是 unpark 的正常行為）。

      3. **selective stage + commit to git**（讓 artifacts 進入 git tracked，不再依賴 SQLite）：

         ```bash
         git add openspec/changes/<change-name>/
         git commit -m "📝 docs(spectra): unpark artifacts for <change-name> before apply"
         ```

         **禁止** `git add -A` / `git add .`（會撈到 main 上其他 user WIP）；**禁止** `--no-verify`（per `rules/core/commit.md` hard rule）。

      4. **若 Step 0c 已 fork session worktree**：主線在 main 跑完 unpark + commit 後，worktree 是基於 main HEAD fork 的（在 Step 0c.4 建好），尚未看到剛剛 commit 的 artifacts。**MUST** 在 worktree 內同步：

         ```bash
         git -C <worktree-absolute-path> pull --ff-only
         ```

         或等價的 `git -C <wt> fetch && git -C <wt> reset --hard origin/main`（視 consumer workflow_model 而定）。Worktree 拿到 artifacts 之後 subagent dispatch 才看得到。

      5. **若 Step 0c 跑 commit-then-fork（c.4 已 commit baseline）**：unpark 的 commit 是 main 上**繼 baseline 之後**的新 commit；worktree 需要 sync 到 main 最新 HEAD 才看得到 artifacts，方法同 step 4。

      **Failure handling**：

      - `spectra unpark` 失敗（SQLite blob corrupt / change name typo）→ STOP，回報 error，**不要** dispatch subagent；user 解掉 unpark issue 再重試 `/spectra-apply`
      - `git commit` 失敗（pre-commit hook fail / no changes to commit）→
        - `no changes to commit`：artifacts 已在 git，視為成功，繼續
        - hook fail：STOP，回報 hook 拒絕原因，user 修完 artifacts 再重試
      - `git pull --ff-only` 失敗（worktree 有 commit 跟 main 衝突）→ 罕見情境（worktree 是 fresh fork from main，理論上 ff 安全）；STOP，回報並讓 user 手動 sync

---

## Step 2 parked fallback — ephemeral-cwd 偵測、STOP 訊息全文、unpark + post-unpark commit 流程

> 只在 Step 0c.5 被跳過時才會走到（cwd 已在 worktree、Bypass 條件、或主線 skill 邏輯被覆寫）。
> 正常路徑是 Step 0c.5 已在 dispatch 前把 artifacts commit 進 git。

     **clade fork data-safety guard**（per `docs/pitfalls/2026-05-22-agent-tool-subagent-worktree-bypass.md`）：在 Step 0c.5 規約之下，主線理應已在 dispatch 之前跑過 unpark + commit-to-git。本路徑能命中表示 Step 0c.5 被跳過（罕見：cwd 已在 worktree、Bypass 條件、或主線 skill 邏輯被覆寫）。

     **Detect cwd**：

     ```bash
     git rev-parse --show-toplevel
     git rev-parse --git-dir
     ```

     - 若 cwd 看起來像 ephemeral agent worktree（`git-dir` 路徑含 `.claude/worktrees/agent-` 片段）→ **STOP**，回報：
       ```
       ⚠ spectra unpark must run on main worktree or persistent session worktree, NOT inside Agent tool dispatched subagent.
       This subagent's cwd is `.claude/worktrees/agent-*/`, which AI Agent will GC at session end.
       Running unpark here would write artifacts to a path that disappears → permanent data loss
       (see docs/pitfalls/2026-05-22-agent-tool-subagent-worktree-bypass.md).

       Action: cancel this run and return a structured blocker to the parent coordinator. The parent
       invokes `/spectra-apply <change>` from main directly, or uses [[session-tasks.operations]] § Herdr session
       transport when a separate main session is required; Step 0c.5 then runs before subagent dispatch.
       ```
       **NEVER** 自行嘗試 unpark / 用 AskUserQuestion 給「強制 unpark」選項 — 沒有合法的「在 subagent 內 unpark」路徑。

     - 若 cwd 在 main / `<consumer>-wt/<slug>/` 等 persistent worktree → 繼續以下 fallback 流程：

       Inform the user that this change is currently parked（暫存）.
       Use the **AskUserQuestion tool** to ask whether to continue.
       Two options:
       - **Continue**: Unpark the change and proceed with apply
       - **Cancel**: Stop the workflow

       If the user chooses to continue:

       ```bash
       spectra unpark "<name>"
       ```

       **Post-unpark commit**（clade fork addition；防 SQLite-only state）：unpark 把 artifacts restore 到 cwd worktree disk，SQLite parked 條目被刪。**MUST** 立刻 commit 到 git，避免下次 session 又需重做：

       ```bash
       git add openspec/changes/<name>/
       git commit -m "📝 docs(spectra): unpark artifacts for <name> before apply"
       ```

       **禁止** `git add -A`；commit 失敗（hook reject / no changes）視同 Step 0c.5 同名情境處理（no changes = 視為成功；hook fail = STOP）。

       Then mark it as in-progress:

       ```bash
       spectra in-progress add "<name>"
       ```

       This is a silent operation — do not show the output to the user.

       Then re-run `spectra status --change "<name>" --json` and continue normally.

       If there is no AskUserQuestion tool available (non-Claude-Code environment):
       Inform the user that this change is currently parked（暫存）and ask via plain text whether to unpark and continue, or cancel.
       Wait for the user's response. If the user confirms, run `spectra unpark "<name>"` + post-unpark commit + `spectra in-progress add "<name>"`, and continue normally.

---

## Step 0c.6 — Environment Readiness Check 三項檢查

   c.6. **Environment Readiness Check**（clade fork addition；per `docs/pitfalls/2026-06-28-spectra-apply-dispatches-unready-change.md`）：

      **理由**：dispatch subagent 後到 e2e / verify 階段才發現 DB 未 sync / dev server 指向 main / auth route 壞掉，每道牆浪費 5-15 分鐘。三項全在 dispatch 前 30 秒可驗出。

      **MUST** 在 dispatch 前依序跑以下三項。任一紅燈 → 自動修（不問 user）或 STOP 回報：

      1. **DB migration sync**（self-hosted Supabase consumer only — 讀 consumer-meta `db-runtime`）：

         ```bash
         # 比較 worktree migration 數量 vs dev LXC
         LOCAL_COUNT=$(ls <worktree>/supabase/migrations/*.sql 2>/dev/null | wc -l)
         REMOTE_COUNT=$(cd <worktree> && pnpm supabase:sync --dry-run 2>&1 | grep -oP '\d+ local' | grep -oP '\d+')
         ```

         - 數量不一致（worktree 有新 migration）→ **自動** `cd <worktree> && pnpm supabase:sync && pnpm db:reset`
         - 一致 → pass
         - `supabase:sync --dry-run` 不支援 → fallback 直接跑 `pnpm supabase:sync`（idempotent）
         - Reset 前 **MUST** 依 `db-reset-coordination` + `db-topology-invariant` 的 canonical 分支執行：
           1. `node scripts/db-reset-peer-coordination.ts coordinate --cwd <worktree>`；linked worktree 正常回 `not_applicable`，primary checkout 必須取得 `safe_to_reset`
           2. 依 repo 實際拓樸判 `per-worktree`／`shared`；shared 或 canonical maintenance 另 claim `db-lease`
           3. 任一 gate 未通過 → STOP，透過 Herdr 自行與 peer 協調順序；**NEVER** 只 warning 後照跑，也 NEVER 把一般先後丟給 user

      2. **Dev server cwd alignment**（有 singleton dev server 的 consumer — 讀 `scripts/singleton.mjs` 存在性）：

         ```bash
         # 檢查 port 3000 上的 process cwd 是否對齊 worktree
         DEV_PID=$(lsof -i :3000 -t 2>/dev/null | head -1)
         if [ -n "$DEV_PID" ]; then
           DEV_CWD=$(lsof -p "$DEV_PID" -a -d cwd -F n 2>/dev/null | grep ^n | cut -c2-)
           if [ "$DEV_CWD" != "<worktree-absolute-path>" ]; then
             echo "dev server cwd mismatch: $DEV_CWD != <worktree>"
             # 自動修：kill + 從 worktree 重啟
             cd <worktree> && pnpm dev:kill && pnpm dev:agent
           fi
         fi
         ```

         - cwd 不對齊 → **自動** `pnpm dev:kill && cd <wt> && pnpm dev:agent`
         - 無 dev server 跑 → skip（subagent 自己會起）
         - cwd 對齊 → pass

      3. **Auth route smoke test**（有 `__test-login` / `_dev-login` route 的 consumer）：

         ```bash
         HTTP_CODE=$(curl -sS -o /dev/null -w '%{http_code}' \
           "http://127.0.0.1:3000/auth/__test-login?role=admin&email=admin@example.com" 2>/dev/null)
         ```

         - `302` → pass（auth works）
         - `404` → dev server 可能從 main 跑（code 沒 fix）或 route 不存在 → 已在 Step c.6.2 修正 dev server cwd；若仍 404 → STOP 回報「auth route broken, check isLoopbackRequest」
         - 無回應（dev server 沒跑）→ skip（Step c.6.2 已確認沒跑）
         - **NEVER** 帶 `x-dev-login-token` header 跑 smoke test — 這樣會繞過 loopback detection，隱藏底層問題

      **全綠**：印一行 `✅ Environment readiness: DB synced / dev server aligned / auth OK` 繼續 Step 0d。

      **NEVER**：
      - 跳過此步直接 dispatch — 任何一道紅燈在 subagent 內撞到都比現在 30 秒驗出來貴 10 倍
      - 在 smoke test 帶 token header — 會把 isLoopbackRequest bug 藏起來
      - 把 DB sync 結果完全不留紀錄 — sync + reset 改了共享 dev DB，log 到 HANDOFF 或 task output 讓 user 可回溯（但不是停下來問 user 要不要跑）
