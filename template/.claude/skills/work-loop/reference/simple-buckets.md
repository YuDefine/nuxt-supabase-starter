<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/work-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# 固定步驟 bucket（3z / 3c / 3d / 3h / 3g）

> 本檔是 `SKILL.md` Step 3 的 branch 分頁，收錄**步驟固定、無分支判斷**的五個 bucket。命中哪一個就讀哪一節，其餘不必讀。
> 需要判斷的 bucket 不在這裡：`3a` / `3b` / `3e` / `3f` 留在 SKILL.md 主層，`3i`/`3j` 見 [blocker-evaluation.md](blocker-evaluation.md)，非 spectra candidate 見 [non-spectra-dispatch.md](non-spectra-dispatch.md)。

## Archive → ship 三條路徑（3z / 3c / 3d）

三者的差別只有**進場條件**，其餘相同。archive Step 0 的 merge-back 會把產品碼放進 main 的 index，跟 archive 目錄是同一批落地——**MUST** 整批走 `/commit`，NEVER 用 `--only` 只送 `openspec/`（會漏產品碼，或把產品碼用不帶 `Via` 的 `--only` 送上 main）。

| Bucket | 進場條件 | archive 前 |
| --- | --- | --- |
| **3z. done** | review 全通過（`pending=0` 且 `issued=0`） | 無 |
| **3c. awaitArchiveWalkthrough** | 只剩 `[discuss]` items 待 walkthrough | archive 內部 Step 3.5 自行處理 discuss walkthrough，不必先跑 |
| **3d. ready (userActionPending=0)** | review 全部 OK，可直接 ship | 無 |

共同步驟：

1. 直接 dispatch archive（**archive 免 worktree**）：

   ```
   Skill invoke: /spectra-archive <change-name>
   ```

2. Archive 完成 → merge-back 已包含在 archive Step 0，不必另外跑。

3. 落地 + push（merge-back 已把產品碼放進 index，與 archive 目錄同一批）：

   ```
   Skill invoke: /commit
   git push
   ```

   **NEVER** `git commit --only -- openspec/` 取代 `/commit`。卡人工檢查 → packaging，**NEVER** `--only` 繞 0-A。

4. 標 ✅ shipped。

## 3h. parked

暫存的 change，unpark 後推進。Parked 是 **actionable** 狀態——unpark 後走 3f dispatch，與 `applyInProgress` 等價。只有 `applyBlocked` / `awaitingUserDecision` 需要先評估（見 [blocker-evaluation.md](blocker-evaluation.md)）。

1. **Unpark**（在 main worktree 跑）：

   ```bash
   spectra unpark "<change-name>"
   git commit --only -m "📝 docs(spectra): unpark <change-name>" -- openspec/changes/<change-name>/tasks.md
   # 若 git diff --name-only 出現 tasks.md 以外的路徑 → 改走 /commit，NEVER 擴大 --only pathspec
   ```

2. **Dispatch spectra-apply**（同 SKILL.md § 3f）：

   ```
   Skill invoke: /wt <change-name>: /spectra-apply <change-name>
   ```

3. 完成後重跑 scan 確認 bucket。

## 3g. healthCheckNeeded

Tasks.md 格式問題或 Pre-Review Data Readiness violation。

1. 讀 scan 的 `hitsByCode` 確認具體問題。
2. 直接 Edit tasks.md 修格式（不需 worktree，tasks.md 是 openspec metadata）。
3. 重跑 scan 確認修復。
