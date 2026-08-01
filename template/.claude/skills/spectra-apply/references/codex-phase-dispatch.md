<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/spectra-apply/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# spectra-apply — Step 6b C 類 phase codex 派工

> 本檔是 `spectra-apply/SKILL.md` 的執行細節分冊（clade fork 加料，2026-08-02 自 SKILL.md 抽出以縮 invoke 成本）。
> SKILL.md 對應 step 的 inline pointer 指到本檔；**MUST 依 pointer 指示完整讀對應 § 再執行**。
> 行為 gate（NEVER / MUST 判定）留在 SKILL.md inline；本檔是操作 recipe / 範本 / 查表。

---

## Step 6b — C 類 phase dispatch：prompt 範本、background dispatch、watch、post-notification checks

   **Codex phase dispatch template**（C 類專用，per `agent-routing.md` 「Codex 派工的標準流程」+「Spectra Apply Phase Dispatch」）:

   1. Write prompt to `/tmp/codex-spectra-apply-<change>-phase-<N>-prompt.md`，內容固定包含：

      ```
      [DELEGATED-BY-CLAUDE-CODE]

      請執行本 repo 的 spectra-apply phase <N>（<phase-title>）的全部 tasks。

      Change: <change-name>
      Phase: <N>. <phase-title>
      Tasks（請依序完成並用 `spectra task done <change> <task-id>` 標記）：

      <每個 task 的編號 + 描述，從 tasks.md 抓>

      Worktree workaround（clade TD-015 / spectra ≤2.3.1）：
      你在 session worktree 內跑 `spectra task done` 時，`.spectra/touched/` 會正確寫到當前 worktree ✅，
      但 tasks.md 的 `[ ] → [x]` 翻轉可能寫到 Claude Code system-managed agent worktree（`<consumer>/.claude/worktrees/agent-*/`），
      導致**當前 worktree 的 tasks.md 沒翻**。每跑完一次 `spectra task done`：
      1. `git -C $(pwd) diff -- openspec/changes/<change>/tasks.md` 確認當前 worktree 看得到 `[ ] → [x]`
      2. 若 diff 空 → 手動 Edit tasks.md 把對應行 `- [ ] <task-id>` 改成 `- [x] <task-id>`
      3. **NEVER** 動 `<consumer>/.claude/worktrees/agent-*/` 內任何檔（harness 自管，session 結束會 GC）

      Plan-first（**MUST**，per `.claude/rules/agent-routing.md` Plan-first 條目）：
      在動任何 Edit / Write / Bash 寫入動作之前，先在 stdout 最開頭輸出一段 `## Plan` section，包含：
      - **要動的具體檔案**（每條一行的相對路徑；對應到 phase <N> 內每個 task 的預期落點）
      - **每個檔案打算做什麼變動**（一句話 — 例如 schema 加哪欄 / API 加哪 endpoint / store 加哪個 action / migration 寫什麼）
      - **預期影響範圍**（typecheck / 哪些 unit test 會被觸發 / 是否需要 migration / runtime 行為改變）
      - **task → 檔案對應表**（每個 task ID 對應到哪些檔案，若某 task 不需要改檔請標 `(no file change — verification only)`）
      Plan 寫完後**立刻**繼續執行，**不要**停下來等確認。Plan 是事前公開思路給主線 cross-check，不是 review gate；主線會用 plan vs. `git diff` 對齊抓「漏做的 task」與「踩到 view 層」這類 drift。

      讀取以下檔案了解上下文：
      - openspec/changes/<change-name>/proposal.md
      - openspec/changes/<change-name>/design.md
      - openspec/changes/<change-name>/specs/*/spec.md
      - openspec/changes/<change-name>/tasks.md
      - .claude/rules/（相關 rule，例如 server-api / pinia-store / supabase-* / development）

      View-layer guard（**MUST**）：
      禁止修改 view 層檔案：
      - 副檔名：`.vue` / `.tsx` / `.jsx` / `.css` / `.scss`
      - 目錄：`app/pages/` / `app/components/` / `pages/` / `components/` / `views/` / `layouts/`
      若 task 需要 view 層改動，回報 "view layer change required, defer to main thread" 並跳過該 task（不要勾 checkbox），主線會自己處理。

      Commit Authorization（**MUST**，per `.claude/rules/agent-routing.codex-watch-protocol.md` § Commit Authorization）：
      完成 phase <N> 全部 tasks 後，**MUST** 在 worktree 內 commit 一次（一 phase 一 commit）：

      1. **Commit 前 self-check（任一條命中即 abort、NEVER commit）**：
         - View-layer drift：

           git diff --staged --name-only | grep -E '\.vue$|\.tsx$|\.jsx$|\.css$|\.scss$|app/(pages|components|layouts)/|^(pages|components|layouts|views)/'

           命中 → 回報 "view layer drift: <files>" 並中止
         - Scope discipline：

           git diff --staged --name-only

           對比本 phase 預期落點 — 超出範圍 → 回報 "scope drift: <files>" 並中止
      2. **Selective stage**：`git add -- <each scoped file path>` — **禁止** `git add -A` / `git add .`（會撈到 baseline）
      3. **Commit**：

         git commit -m "🧹 chore: wt <change-name>-phase-<N> — <一行說明>"

         - **MUST** 用 `🧹 chore: wt <change-name>-phase-<N>` format（emoji-conventional commitlint 合規；主線用 `git log main..HEAD` 對齊 phase）
         - **禁止** `--no-verify`（per `rules/core/commit.md` hard rule，hook 擋住代表 phase 內容有問題，必須修而非繞）

      仍禁止：`git push` / `git stash`（中途）/ `git commit --amend` / `/commit` / `/spectra-commit` / 跨 phase 混 commit。

      Acceptance：所有 phase <N> 的 tasks 完成、checkbox 已勾、**gate chain（L0–L2）全 PASS**（per [[verify-gate-chain]]）、phase commit 已在 worktree 內成立、`git log main..HEAD` 顯示 `🧹 chore: wt <change>-phase-<N> — ...`。
      Gate chain FAIL 時：解析 error output → 修正 → 重跑 gate chain，最多 5 輪（per [[verify-gate-chain]] § Iterate-until-green）。超過 5 輪仍 FAIL → 回報 main thread "gate chain not converging after 5 iterations: <last error summary>"。
      不要動 phase <N> 以外的 tasks。不要碰 ## Design Review 區塊（主線會自己做）。
      不要呼叫 /spectra-archive。
      ```

   2. Background bash:

      ```bash
      cd <consumer-repo-root> && codex exec \
        --model gpt-5.6-sol \
        --dangerously-bypass-approvals-and-sandbox \
        --skip-git-repo-check \
        -c model_reasoning_effort=high \
        < /tmp/codex-spectra-apply-<change>-phase-<N>-prompt.md 2>&1
      ```

   3. Inform user briefly + start Codex Watch Protocol（見 `agent-routing.md`）

   4. After `<task-notification status=completed>` — codex 已在 worktree 自 commit per § Commit Authorization：
      - BashOutput → read full stdout
      - Read tasks.md → confirm phase <N> all checkboxes are `[x]`
      - **MUST commit boundary check**: `git -C <wt> log main..HEAD --oneline` — confirm exactly one new commit per dispatched phase, format `🧹 chore: wt <change>-phase-<N> — ...`. Multiple commits per phase / missing commit / format mismatch → AskUserQuestion: [1] 主線 squash codex 的 multiple commits / [2] `git -C <wt> reset --soft main` 退 staging 重派 / [3] 中止
      - **MUST view-layer drift double-check**: `git -C <wt> diff main..HEAD --name-only -- '*.vue' '*.tsx' '*.jsx' '*.css' '*.scss' 'app/pages/**' 'app/components/**' 'app/layouts/**' 'pages/**' 'components/**' 'layouts/**' 'views/**'`（codex 自驗應已 abort，此處再驗保險）。**若有任何 view 層檔案被 codex 動過** → AskUserQuestion: [1] `git -C <wt> reset --soft main` 退 staging + 主線剔除 view 改動 + 重派 codex / [2] 接受並由主線自己重跑該 view phase / [3] 中止
      - **Scope discipline cross-check**: `git -C <wt> diff main..HEAD --name-only` vs prompt 內 phase scope 宣告。超出範圍 → AskUserQuestion 處理
      - Sanity check: `pnpm typecheck` (or equivalent), relevant tests
      - **If gaps detected** → AskUserQuestion: [1] 主線在 worktree 內 commit 補丁 / [2] reset 重派 codex / [3] 中止

   5. Move to next phase (re-classify and dispatch or self-execute)
