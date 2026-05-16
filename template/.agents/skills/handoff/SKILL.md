---
name: handoff
description: Session 交接管理。雙模：(A) 當前 chat session 有 in-progress 工作時，只做交接寫入（升級未完項到 HANDOFF.md / tech-debt / ROADMAP / spectra change）。(B) 當前 chat session 沒有要交辦的時，整理現有 HANDOFF.md + 評估剩餘 outstanding 工作適合串行還是並行，推薦並讓使用者用 request_user_input 選擇下一步。「Session」指當前 chat session，**不是** working tree / git state — user 並行多 session 工作，git 髒污可能來自別 session。Use when user types /handoff.
license: MIT
metadata:
  author: clade
  version: "1.0"
---

# /handoff

雙模 session 交接管理：模式由「當前是否有未交辦工作」自動決定。

## Step 1 — 偵測模式

「Session」=**當前這個 chat session**，不是 working tree / git state / 檔案系統狀態。User 經常並行多開 AI Agent session 工作，所以 `git status` 髒污、`tasks/<date>-*.md` 內 unchecked 項、active spectra change 的 unchecked tasks **都可能來自別的 session**，不能拿來判斷當前 session 是否有未交辦工作。

**Mode A — 當前 chat session 有未交辦工作**（任一條成立即 Mode A）：
- `TaskList` 顯示當前 session 任何 `in_progress` 或 `pending` task（TaskList 是 per-session 工具狀態，可信）
- 當前 chat 對話脈絡明顯顯示 user 正在 mid-task（我剛在做某事還沒收尾、user 剛交辦一個多步驟工作做到一半）
- Stop hook 攔住但 acceptance 未滿足 + 處於 [[worktree-default]] §8 死鎖（cwd 在 main + main 已 dirty）且當前 session 已自評不適合走 §7 分支 A（context 不寬裕 / 剩餘 work 不小 / 無法 selective stash）

**Mode B — 當前 chat session 沒有要交辦的**：以上皆否（即使 working tree 髒、tasks/ 有別 session 的 unchecked、spectra changes 有別 session 的 active work，都仍是 Mode B —— 那些屬於別 session 的責任）。

**禁止訊號**（這些都不算「當前 session」狀態）：
- ❌ `git status --short` 有 dirty file
- ❌ `tasks/<YYYY-MM-DD-HHMM>-*.md` 存在或有 unchecked 項
- ❌ `openspec/changes/<name>/tasks.md` 有 unchecked 項
- ❌ `HANDOFF.md` 有 In Progress 段落

宣布偵測結果一句話：「偵測到 Mode A（理由：當前 session TaskList 有 N 個 in-progress / 對話脈絡顯示 mid-task on X）」或「偵測到 Mode B（當前 session 清空）」。

## Step 2A — Mode A 流程（只做交接寫入）

只做以下，不做 reorganize、不做下一步推薦：

1. **盤點當前 session 未完項**（**只**從 per-session 來源蒐集）：
   - `TaskList` 取當前 session 所有未 completed task
   - 當前 chat 對話脈絡（我剛在做、user 剛交辦但沒做完的工作）

   **NEVER** 把以下當「當前 session 未完項」（這些屬於別 session 或檔案系統狀態，不是當前 chat 在做的事）：
   - ❌ `tasks/<date>-*.md` 既有 unchecked 項
   - ❌ active spectra change 既有 unchecked tasks
   - ❌ `git status` dirty 檔案

   例外：若當前 chat 對話脈絡明確指向某個 tasks/<date>-*.md / spectra change / dirty file 就是當前 session 在動的，那才算當前 session 工作 —— 由對話脈絡決定歸屬，不是由檔案存在決定。

2. **逐項分類升級**（依 `rules/core/session-tasks.md` 升級路徑表）：

   | 未完項類型 | 升級到 |
   | --- | --- |
   | 下一 session 要立刻接手的 in-progress 工作 | `HANDOFF.md` `## In Progress` section |
   | 被 blocker 卡住（缺權限 / 缺決策 / 等外部） | `HANDOFF.md` `## Blocked` |
   | 等待外部 signal（合約 / ramp 日期 / 第三方 API ready） | `docs/tech-debt.md` 建 `TD-NNN` |
   | 未來才做、可排優先序 | `openspec/ROADMAP.md` `## Next Moves` |
   | 規模膨脹（要動 spec / design review / 跨多檔） | 新 spectra change（先 `/spectra-propose`） |
   | 純放棄 | 直接刪 |

3. **寫入**：依分類 Edit / Write 對應檔案。HANDOFF.md `## In Progress` 條目 MUST 含：
   - change / task 名稱
   - 主要檔案路徑（讓接手者直接跳）
   - 目前做到哪裡 / 還剩什麼
   - 已踩過的坑（避免下一 session 重踩）
   - **若來自 [[worktree-default]] §8 死鎖**：額外加 Stop hook 攔點摘要、missing acceptance criterion、改過檔案的 selective stash ref（若有，例 `stash@{0}: <slug>-handoff`）、下一 session 接手指引（直接從 main 跑 `/<next-skill> <change-name>`，apply / ingest / debug 內建 worktree dispatch；若是 archive，直接從 main 跑 `/spectra-archive <change-name>`）
4. **清理 session-tasks**：所有未完項升級完成後 → 只 `mv` / 刪「當前 session 自己開的」`tasks/<date>-*.md`（依 `rules/core/session-tasks.md`「NEVER 動別人的 tasks 檔」）。若當前 session 從頭到尾沒開 tasks 檔，跳過此步。
5. **回報**：一句話總結升級數量（如「升級 3 到 HANDOFF / 1 到 tech-debt / 砍 2」）。**禁止**追加「下一步建議」或「要不要繼續做 X」。

## Step 2B — Mode B 流程（整理 + 推薦）

### 2B.1 整理現有 HANDOFF.md

讀 HANDOFF.md，逐段判斷：

| 內容類型 | 動作 |
| --- | --- |
| 已完成的 wave / 歷史 narrative | 移到 `docs/archives/<yyyy-mm>-<topic>.md` |
| 與當前 SoT 矛盾（版本過時、檔案已不存在） | 修正或刪除 |
| 重複條目（同一事在 HANDOFF / tech-debt / ROADMAP 都有） | 留最該的位置，其他刪 |
| 寫法違反當前專案規則（如 clade 自治區內 `consumer 自治區工作` violation） | 依規則重寫或刪除 |
| 仍 valid 的稽核 baseline 表 / outstanding follow-up | 保留 |

**MUST** 載入 `.claude/rules/local/*.md` 內所有自治區規則。若有 `clade-role-and-todo-discipline.md` 之類 local rule 限定 HANDOFF 寫法，整理時必須遵守。

### 2B.2 盤點剩餘 outstanding

從以下來源蒐集 outstanding 工作：

- 整理後的 `HANDOFF.md`
- `docs/tech-debt.md` 未解決的 TD-NNN
- `openspec/ROADMAP.md` `## Next Moves`
- 任何已 archive 但留下 follow-up 註記的 change

每條 outstanding 抓三件資料：
- 標題（一句話）
- 涉及檔案 / module / consumer
- 依賴關係（依賴誰、誰依賴它）

### 2B.3 Serial vs Parallel 評估

對每條 outstanding 套 rubric：

**Serial 訊號**（任一成立 → serial）：
- 同檔 / 同 module 內順序改動
- 同一 spectra change 內 phase 間有依賴（phase B 依賴 phase A 落地）
- 共享 mutex 資源：DB migration、單一 config 檔、單一 secret rotation
- 後一步的設計需要前一步的結果（探索結論決定後續方向）

**Parallel 訊號**（全成立 → parallel candidate）：
- 動到的檔案 / module / consumer 不重疊
- 沒有 phase 依賴（各自獨立完工）
- 無共享 mutex 資源
- 可獨立驗證（各自有 acceptance criteria）

若 Parallel candidate，**MUST** 套用 thin-brief 長駐 subagent 模式（避免 fresh subagent fan-out 冷載 N 倍 repo context）：
- 主線預先用 codebase-memory-mcp（`search_graph` / `trace_path` / `get_code_snippet`）定位每條 outstanding 的檔案路徑 + 符號 + 依賴，把結果寫進 brief
- 一條 outstanding 配一個長駐 named subagent；後續 phase 推進**MUST** 用 `SendMessage({to: name})` 續跑，**NEVER** 為同一條 outstanding 的下一個 phase 重開新 subagent
- Thin brief（3–5K 具體指示：檔案路徑、規則條目、驗收標準），**禁止**冷載整份 repo / AGENTS.md / rules
- 不同 outstanding 的長駐 subagent 可同時跑（多個 `Agent` tool call 放同一訊息）

### 2B.4 推薦 + request_user_input

寫一段「outstanding 盤點 + serial/parallel 推薦」訊息：

```
Outstanding（N 條）：

1. <標題> — <涉及範圍> — <serial/parallel 判定>
2. ...

推薦執行模式：<serial | parallel | mixed>
理由：<rubric 命中哪幾條>
```

接著用 `request_user_input` 問 user 選擇：
- Option 1: 推薦的執行模式 + 起手 outstanding（label 標 `(Recommended)`）
- Option 2-3: 替代方案（如「先做 outstanding #2」/「mixed: 先 serial #1 再 parallel #2-#3」）
- Option 4（optional）: 「都先不做，session 收工」

**禁止行為**（依 user AGENTS.md「不要把工作往後放」+ `clade-role-and-todo-discipline.md`「Session 結尾自查」）：
- 推薦清單裡放「N 週後再回頭做」/「排程 /schedule 在 X 天後」
- 推薦清單裡放當前主線「無法完整 own」的工作（consumer 自治區工作 / user 必須親自操作的外部系統指令）
- 用「block production」「最高優先」包裝其他自治區工作
- 推薦的 Option 1 不該是「都不做」（除非真的盤點為空）

### 2B.5 接續 dispatch（user 選定 outstanding 後）

User 透過 `request_user_input` 選定下一步 outstanding（含明確的 next-skill 與 change-name / argument）後，**MUST** 依下表透過 Skill tool 內呼對應的入口，**不要**輸出「請執行 cd ... && claude ...」oneliner 讓 user 另開 terminal。

| Next-skill 類型 | Dispatch 行為 |
| --- | --- |
| `/spectra-archive <change-name>` | **直接** 透過 Skill tool 內呼 `/spectra-archive <change-name>`，不建 worktree。Archive 是 main-bound 例外，per [[worktree-default]] §1 |
| `/spectra-apply` / `/spectra-ingest` / `/spectra-debug`（要寫 tracked file 的 spectra-* skill） | 透過 Skill tool 內呼 `/wt <slug>: /<next-skill> <change-name>`，由 `/wt` 建 worktree + dispatch subagent 跑 next-skill + squash 回 main + cleanup（per [[wt]] Form 3）。Parent session cwd 不動 |
| `/spectra-ask`、其他 read-only / 探索 skill | **直接** 透過 Skill tool 內呼（無需 worktree） |
| `/spectra-propose` / `/spectra-discuss` | **直接** 透過 Skill tool 內呼（propose / discuss 階段純寫 `openspec/changes/<new>/` 內新檔，不碰既有 tracked file，與[[worktree-default]] §1 的 worktree 邊界相容） |
| 不在表上的 skill | 評估後決定：若不寫 tracked file 直接 dispatch；若會寫則包進 `/wt <slug>: /<next-skill>` 走 worktree |

**判定條件**：

- 觸發此 dispatch path **MUST** 全部成立：當前 chat session 剛跑完 Mode B、user 已選定下一步、cwd 在 main worktree
- 若 cwd 不在 main worktree（罕見 — 應該是 user 在 worktree session 跑了 `/handoff`）→ Mode B 已不適用，警示後返回

**Slug 解析**：`/wt <slug>: /<next-skill> <change-name>` 的 `<slug>` 由 change-name 直接帶入（wt-helper 自動 normalize per [[worktree-default]] §3）。

**Parent cwd 不動 invariant**：`/wt` Form 3 內部用 subagent 進 worktree 跑 next-skill，主線（當前 chat session）cwd 全程在 main worktree，per [[worktree-default]] §1。先前 `wt-relax-for-archive-and-handoff` change 引入的 `--dispatch-from-handoff` flag 已**移除**，**禁止**在 args 內帶此 flag。

## Output contract

- Mode A：成功 = HANDOFF.md / tech-debt / ROADMAP 有對應寫入 + tasks 檔已清；訊息只含升級摘要
- Mode B：成功 = HANDOFF.md 已整理 + 盤點訊息 + `request_user_input` 已發出讓 user 選 + user 選定後 2B.5 dispatch 已完成（直接 dispatch 或內呼 `/wt <slug>: /<next-skill> <change-name>`）
- 失敗 / blocked：明確說明卡點，不假裝完成

## 與其他 skill 的銜接

- `/spectra-commit` — Mode A 升級 spectra change WIP 時，commit 用此 skill 走 selective stage
- `/spectra-propose` — Mode A「規模膨脹」分類升級時，後續開新 change 入口
- `/spectra-apply` — Mode B `request_user_input` user 選定起手 active change 後的執行入口
- `subagent-dev` — Mode B `request_user_input` user 選 parallel 後，subagent fan-out 由此 skill 執行
