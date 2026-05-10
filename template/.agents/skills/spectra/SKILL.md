---
name: spectra
description: 'Spectra orchestrator — auto-detect which spectra sub-skill to invoke based on project state and user intent'
effort: low
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/spectra/
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->


# Spectra Orchestrator

When the user invokes `/spectra` without specifying a sub-skill, act as the orchestrator that determines the right workflow phase.

## Decision Flow

Run through these steps **in order**. Stop at the first match.

### Step 1: Check active changes

```bash
spectra list --json
```

Parse the result. Branch on the number of active changes:

- **No active changes** → go to Step 2 (no work in progress)
- **One or more active changes** → go to Step 3 (work exists)

### Step 2: No active changes — New work or inquiry

Ask the user what they want to do. Use **request_user_input** with these options:

1. **提案（Propose）** — 我有新功能/改動想規劃 → invoke `/spectra-propose`
2. **討論（Discuss）** — 我想先釐清需求再決定做法 → invoke `/spectra-discuss`
3. **查詢（Ask）** — 我想查詢現有 spec 的內容 → invoke `/spectra-ask`
4. **除錯（Debug）** — 我遇到問題想系統性排查 → invoke `/spectra-debug`

After the user picks, invoke the corresponding skill with the Skill tool.

> **Note**：選到 `Propose` 時，`spectra-propose` 入口的 Step 0 會再問一次「A. Codex GPT-5.5 xhigh / B. AI Agent 繼續做」。orchestrator **不要**在這裡先問，避免雙重詢問。

### Step 3: Active changes exist — Determine next action

For each active change, run:

```bash
spectra status --change "<name>" --json
```

Summarize the state to the user:

```
📋 目前進行中的 change：
- <name>: <status summary> (e.g., "proposal ✓, tasks ✓, 3/8 tasks done")
```

Then determine the most likely next action based on state:

| State                                        | Likely Action  | Skill                  |
| -------------------------------------------- | -------------- | ---------------------- |
| Missing required artifacts (proposal, tasks) | 補完 artifacts | `/spectra-ingest`      |
| All artifacts ready, tasks not started       | 開始實作       | `/spectra-apply`       |
| Tasks partially done                         | 繼續實作       | `/spectra-apply`       |
| All tasks done, 人工檢查未完成               | 人工檢查       | `/review-screenshot`   |
| All tasks done, 人工檢查全完成               | 歸檔           | Archive Flow（見下方） |
| Need to update from new context              | 更新 artifacts | `/spectra-ingest`      |

Present the recommendation and options to the user with **request_user_input**:

1. **{Recommended action}** — 建議：{reason}
2. **實作（Apply）** — 繼續或開始實作任務
3. **更新（Ingest）** — 從對話或 plan 更新 artifacts
4. **人工檢查（Review）** — 截圖驗收檢查清單 → `/review-screenshot`
5. **歸檔（Archive）** — 標記完成並歸檔（含人工檢查歸檔）
6. **稽核（Audit）** — 審查已改動的程式碼
7. **查詢（Ask）** — 查詢 spec 內容
8. **提案（Propose）** — 建立新的 change（另開）
9. **除錯（Debug）** — 系統性排查問題

Only show relevant options (e.g., don't show Archive if tasks aren't done). Always show the recommended action as the first option.

After the user picks, invoke the corresponding skill. If the user picks a skill that targets a specific change, pass the change name as argument.

### Step 4: Multiple active changes

If there are multiple active changes, first ask the user which change to work on (or if they want to start a new one), then proceed to Step 3 for the selected change.

Also check for parked changes:

```bash
spectra list --parked --json
```

If parked changes exist, mention them: "另外有 N 個暫存的 change：{names}，需要取回嗎？"

## Archive Flow（歸檔複合流程）

當使用者選擇「歸檔」或說「archive」時，**MUST** 按順序執行：

1. **檢查人工檢查狀態（kind-aware）** — 讀取 tasks artifact 的 `## 人工檢查` 區塊，依每條 item 的 leading kind marker 分流。
   - 解析每條 `- [ ]` / `- [x]` 行的 leading marker：`[review:ui]` 或 `[discuss]`。缺 marker 時依 Default Kind Derivation Rule 推導（proposal 含 `**No user-facing journey (backend-only)**` → `discuss`，其餘 → `review:ui`）。
   - 計算未勾項分組：`unchecked_review_ui` 與 `unchecked_discuss`。
   - **若 `unchecked_review_ui` > 0 且 `unchecked_discuss` > 0**（混合 kind）：依序執行 — 先跑 spectra-archive 內建 Step 2.5「Discuss Items Walkthrough」（讓 Claude 主動準備 evidence 與使用者討論並寫 `(claude-discussed: <ISO>)` annotation），再用 request_user_input 提示是否跑 `/review-screenshot` 處理 `[review:ui]` items。順序：discuss 先、review:ui 後 — 讓使用者見過所有討論點再進視覺驗收。
   - **若只有 `unchecked_review_ui` > 0**：用 request_user_input 詢問：
     - 「先跑檢查」→ invoke `/review-screenshot`
     - 「全部標記完成並歸檔」→ 繼續（archive-gate Check 4 會擋下未勾 `[review:ui]`）
     - 「取消」→ 停止
   - **若只有 `unchecked_discuss` > 0**：直接進入 spectra-archive Step 2.5 流程（由 spectra-archive skill 內部處理）；orchestrator 不需另外提示。
   - **若全部 `[x]` 或沒有人工檢查區塊** → 繼續。

2. **歸檔人工檢查** — invoke `/review-archive all`
   - 將所有檢查項目（含 `#N` 編號、kind marker、來源 change/spec 追溯）遷移到 `docs/manual-review-archive.md`

3. **歸檔 Spectra change** — invoke `/spectra-archive`
   - 歸檔 change artifacts 到 `openspec/changes/archive/`
   - spectra-archive 內部會在 Step 3.5 執行 Discuss Items Walkthrough（若上面 Step 1 未先跑）

這確保每次 archive 時，`[review:ui]` 與 `[discuss]` 兩 kind 的人工檢查結果都不會遺失，且可追溯到對應的 change 和 spec。

## 人工檢查清單（自動附加）

所有 Spectra workflow 在建立或更新 **tasks artifact** 時，**MUST** 在末尾附加人工檢查區塊：

1. 讀取 `docs/manual-review-checklist.md` 取得共用清單
2. 從清單中挑選**與此 change 相關**的檢查項目（不需要全部複製）
3. 每個項目加上 `#N` 流水號（從 #1 開始）
4. **每個項目 MUST 標 `[review:ui]` 或 `[discuss]` kind marker**（緊接 `#N` 後第一個 token）— 使用者 round-trip 驗收 → `[review:ui]`；Claude 主導的 evidence-based 討論 → `[discuss]`
5. 附加到 tasks artifact 最後一個 `##` 之後，格式：

```markdown
## 人工檢查

> 來源：`<change-name>` | Specs: `<spec-1>`, `<spec-2>`

- [ ] #1 [review:ui] 實際操作功能，確認 happy path 正常運作
- [ ] #2 [review:ui] 測試 edge case（空資料、超長文字、特殊字元）
- [ ] #3 [discuss] 確認 24h soak window 後 drift count 在預期範圍 @no-screenshot
```

- `來源` 標註 change name，`Specs` 列出此 change 包含的 spec names
- `#N` 流水號用於溝通定位（如「#3 有問題」）、截圖命名、歸檔追蹤
- Kind marker 決定 archive 流程：`[review:ui]` 走 `/review-screenshot`、`[discuss]` 走 spectra-archive Step 2.5 walkthrough
- 如果 tasks 已有 `## 人工檢查` 區塊，更新而非重複新增；既有無 marker items 不強制 retrofit（依 Default Kind Derivation Rule 處理）
- 完成檢查後，用 `/review-archive` 遷移到 `docs/manual-review-archive.md`

## 相關 Skills

| Skill                | 用途                                       |
| -------------------- | ------------------------------------------ |
| `/review-screenshot` | 對 todo 項目逐一截圖附註，產出視覺驗收報告 |
| `/review-archive`    | 將已完成的檢查項目遷移歸檔                 |

## Guardrails

- **NEVER** skip the detection step and guess — always check `spectra list` first
- **NEVER** directly write code — this skill only routes to the correct sub-skill
- **ALWAYS** use request_user_input to confirm before invoking a sub-skill
- If `spectra` CLI is not available, report the error and stop
- If request_user_input is not available, present options as plain text and wait for response
