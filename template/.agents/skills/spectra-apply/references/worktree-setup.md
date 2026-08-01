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
      | scope-in 為空（無論 scope-out 為空或非空、無論三來源是否對得上）| 直接走 c.4 **clean fork**；若 scope-out 非空，印一行通知：`main 有 <N> 條 dirty 不屬於本 change，已留在 main 不動，worktree 從 HEAD fork`。**NEVER** STOP / request_user_input / 要求 user 先 commit/stash —— worktree 隔離已處理 main WIP 對 apply 的影響；同檔衝突是 merge-back 時的事，不在 apply 範圍 |

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
         - **Per `db-topology-invariant` 規則**：dev DB 是共享實例，reset 前 **MUST** 自主協調（不問 user）：
           1. `node scripts/claim-helper.ts list` 列 active claims
           2. 分類：`lastActivity > 2h` = stale（殭屍 claim，忽略）；`lastActivity < 30min` 且 claim 的 change 有 DB-dependent work（migration / seed / e2e） = 真 active
           3. 真 active claim = 0 → 直接 proceed，log 一行「dev DB reset — N stale claims ignored」
           4. 真 active claim > 0 → 仍 proceed（apply 的 DB sync 優先於 claim collision），但 log「dev DB reset — warning: N active claims: <names>」
           5. **NEVER** 因為有 stale claims 或甚至 active claims 就停下來問 user — dev DB reset 是 evidence collection 的前置條件，阻斷 reset = 阻斷整條 change 的推進。log 足矣

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
