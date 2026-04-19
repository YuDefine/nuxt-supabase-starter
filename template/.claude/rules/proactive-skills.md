# Proactive Skill Orchestra

所有 Spectra sub-skill 與 Design skill 應在適當情境下**主動調用**，不需使用者手動指定。此規則優先於個別 SKILL.md 的指示。

## 原則

1. **診斷驅動**——先理解問題再選工具，不盲目跑所有 skill
2. **內建而非附加**——Design 是實作的一部分，不是完成後的美化步驟
3. **來源無關**——不論規格書來自 Notion、文件、對話或 plan file，流程一致
4. **自主但透明**——主動調用 skill 時簡要告知使用者正在做什麼

## Spectra Sub-skill 自主觸發

### Intake 階段

| 情境                                           | 觸發                                    | 說明                             |
| ---------------------------------------------- | --------------------------------------- | -------------------------------- |
| 收到需求，需求模糊或有多種解讀                 | `spectra-discuss`                       | 先討論釐清，再 propose           |
| 收到需求，需求明確                             | `spectra-propose`                       | 直接建立 change                  |
| 需求來源是外部文件（Notion URL、PDF、貼文）    | 先讀取內容 → `spectra-propose`          | 提取結構化需求後建立 change      |
| Proposal 建立完成                              | `spectra-analyze`                       | 自動檢查一致性（不等使用者要求） |
| Analyze 發現 Critical/Warning                  | 修復 → 再 `spectra-analyze`（max 2 輪） | 迴圈直到通過                     |
| Artifacts 有模糊用詞（TBD、矛盾、缺 scenario） | `spectra-clarify`                       | 逐項澄清                         |

### Implementation 階段

| 情境                         | 觸發              | 說明                       |
| ---------------------------- | ----------------- | -------------------------- |
| 準備開始或繼續實作           | `spectra-apply`   | 按 tasks 執行              |
| 實作中遇到非預期錯誤         | `spectra-debug`   | 四階段系統性排查           |
| 實作中發現 spec 有誤或過時   | `spectra-ingest`  | 更新 artifacts，不停下實作 |
| 架構決策點（多種做法都可行） | `spectra-discuss` | 記錄決策到 artifacts       |
| 需要確認現有規格內容         | `spectra-ask`     | 查詢而非猜測               |

### Completion 階段

| 情境                                                  | 觸發              | 說明                                  |
| ----------------------------------------------------- | ----------------- | ------------------------------------- |
| 所有 tasks 完成 + 人工檢查通過                        | `spectra-archive` | 最終歸檔                              |
| Archive 完成 + change 有 UI（design review findings） | `design-retro`    | 分析 findings、識別重複模式、建議改善 |
| Findings 累積達 5 的倍數（5、10、15…）                | `design-retro`    | 週期性全量分析                        |

## Design Skill 自主觸發

### 觸發條件

**任何 spectra-apply task 碰到 UI 工作**（建立/修改 `.vue` 檔案、pages、components、layouts）時，自動進入 Design Checkpoint。

### Design Checkpoint 流程

```
Task 涉及 UI？
  │
  ├─ 否 → 正常完成 task
  │
  └─ 是 → Design Checkpoint：
       │
       ├─ 1. 檢查 .impeccable.md
       │     存在？→ 繼續
       │     不存在？→ 先跑 /impeccable teach
       │
       ├─ 2. 跑 /design improve [affected pages/components]
       │     → 取得診斷報告 + Design Fidelity Report
       │
       ├─ 2.5 修復所有 DRIFT 項目（fidelity check loop，max 2 輪）
       │     Fidelity Score = 8/8？→ 繼續
       │     有 DRIFT/MISSING？→ 修復 → 重新檢查（max 2 輪）
       │
       ├─ 3. 按 canonical order 執行計劃中的 design skill
       │     （結構 → 視覺 → 體驗 → 韌性 → polish）
       │
       ├─ 4. 跑 /audit [affected pages]
       │     Critical > 0？→ 修復後重跑
       │     Critical = 0？→ 繼續
       │
       └─ 5. 標記 task 完成
```

### Design Skill 選擇指南（診斷驅動）

根據 `/design improve` 的診斷結果選擇，不要盲目全跑：

| UI 類型                | 常見需要的 skill              | 通常不需要          |
| ---------------------- | ----------------------------- | ------------------- |
| 表單密集（CRUD、輸入） | /layout, /clarify, /harden    | /overdrive, /bolder |
| 資料表格（列表、搜尋） | /layout, /typeset, /adapt     | /delight, /animate  |
| 儀表板/圖表            | /colorize, /layout, /typeset  | /quieter, /harden   |
| 首次體驗/空狀態        | /harden, /clarify, /delight   | /optimize           |
| 複雜互動流程           | /animate, /clarify, /harden   | /bolder             |
| 登入/認證頁            | /typeset, /colorize           | /impeccable extract, /distill |

### Mutual Exclusivity

- `/bolder` vs `/quieter`——選一個方向
- `/distill` 先於 `/bolder`——簡化後才放大
- `/colorize` vs `/quieter`——減弱時不加色

### Canonical Order（偏離需說明理由）

```
/impeccable teach       ← 專案首次（無 .impeccable.md 時）
/impeccable shape       ← （選用）code 前需求釐清
  ↓
/impeccable craft       ← 主要建置流程（shape-then-build）
/distill                ← 先簡化（若雜亂）
  ↓
/layout                 ← 結構與佈局（v2.1 從 /arrange 改名）
/typeset                ← 字型與層次
/colorize | /bolder | /quieter  ← 色彩與強度（擇一）
  ↓
/animate                ← 動效
/clarify                ← 文案與訊息
/delight                ← 個性與驚喜
/harden                 ← 韌性、邊界情況、首次體驗（v2.1 併入原 /onboard）
  ↓
/optimize               ← 效能
/adapt                  ← 跨裝置（如需要）
/impeccable extract     ← 萃取為 design system（如適用）
  ↓
/audit                  ← 診斷驗收（Critical 必須為 0）
/polish                 ← 永遠最後（v2.1 併入原 /normalize 的對齊角色）
```

## Design Review Task Template

**執行 `spectra-propose` 時**，若 change 涉及 UI（tasks 中提及 `.vue`、`pages/`、`components/`、`layouts/`），**必須**在 tasks artifact 中加入 Design Review 區塊。

位置：最後一個功能區塊之後、`## 人工檢查`之前。
編號：N = 上一個功能區塊的序號 + 1。

```markdown
## N. Design Review

- [ ] N.1 檢查 .impeccable.md 是否存在，若無則執行 /impeccable teach
- [ ] N.2 執行 /design improve [affected pages/components]（含 Design Fidelity Report）
- [ ] N.3 修復所有 DRIFT 項目（Fidelity Score < 8/8 時必做，loop 直到 DRIFT = 0）
- [ ] N.4 依 /design 計劃按 canonical order 執行 targeted skills
- [ ] N.5 執行 /audit — 確認 Critical = 0
- [ ] N.6 執行 review-screenshot — 視覺 QA
- [ ] N.7 Fidelity 確認 — design-review.md 中無 DRIFT 項
```

`[affected pages/components]` 替換為此 change 實際涉及的 UI 檔案/頁面。

**效果**：spectra-apply 會依序執行到 Design Review 區塊，自然觸發 design 工作。Design tasks 是一等公民，不是附加步驟。

## Design Review 中斷與續跑

Design Review 過程中若發現問題過多（例如需要列修正計劃讓使用者確認），**提前停下時必須提示**：

> 完成上述修正後，需要**重新跑一次完整 Design Review**（從 N.2 `/design improve` 開始），確認所有問題都已修復且未引入新問題。

**規則**：Design Review 的 N.4 `/audit` 必須在**所有修正完成後**才執行。若中途停下修正，恢復後從 N.2 重新開始，不得跳過。

## Design Review Findings Log

每次 Design Review 完成時，**必須**將發現的問題記錄到 `docs/design-review-findings.md`，用於追蹤跨 spec 的重複問題模式。

### 記錄格式

```markdown
## [CHANGE-ID] — YYYY-MM-DD

**影響範圍**: [affected pages/components]

| #   | 類別    | 問題摘要        | 嚴重度   | 發現來源  |
| --- | ------- | --------------- | -------- | --------- |
| 1   | spacing | 卡片間距不一致  | warning  | /layout   |
| 2   | a11y    | 缺少 aria-label | critical | /audit    |
| 3   | color   | 對比度不足      | critical | /colorize |
```

### 類別定義

| 類別          | 說明                                |
| ------------- | ----------------------------------- |
| `spacing`     | 間距、padding、margin 問題          |
| `layout`      | 佈局結構、grid、flex 問題           |
| `typography`  | 字型、字級、行高、字重問題          |
| `color`       | 色彩、對比度、主題一致性問題        |
| `a11y`        | 無障礙（aria、focus、keyboard）問題 |
| `responsive`  | 響應式、跨裝置適配問題              |
| `interaction` | 動效、hover、transition 問題        |
| `copy`        | 文案、標籤、錯誤訊息問題            |
| `consistency` | 與 design system 不一致             |
| `hardening`   | 邊界情況、空狀態、loading 狀態      |
| `performance` | 渲染效能、圖片優化問題              |

### 週期性分析 → `/design-retro`

Findings log 的分析由 `/design-retro` skill 負責（見 `.claude/skills/design-retro/SKILL.md`）。記錄本身只負責結構化紀錄，分析與改善建議交由 skill 在適當時機執行。

## Design → Spectra 回饋迴路

Design 工作可能發現 spec 未涵蓋的問題。發現時不停下，按以下規則回饋：

| 情境                                                                    | 動作                                        |
| ----------------------------------------------------------------------- | ------------------------------------------- |
| /design 發現 spec 未涵蓋的 UX 需求（如缺 empty state、缺 loading 狀態） | `spectra-ingest` 更新 design artifact       |
| /audit 發現需要新元件或新 API endpoint                                  | `spectra-ingest` 更新 tasks（加新 task）    |
| Design 決策影響資料模型或 API schema                                    | `spectra-discuss` → 決定後 `spectra-ingest` |
| /design 改動範圍超出原 change scope                                     | 停下，通知使用者，可能需要拆 change         |

## Design Gate（Archive 前硬門檻）

**在 `spectra-archive` 前**，若 change 包含任何 `.vue` 檔案變更，hook `pre-archive-design-gate.sh` 檢查兩個信號：

1. **`design-review.md` 存在且含 fidelity 證據**——change 目錄中有 `/design improve` 產出的設計審查記錄，**且**包含「Design Fidelity Report」段落，**且**無未修復的 DRIFT 項目（表格中無 `| DRIFT |` 行）
2. **Design Review tasks 全部完成**——tasks.md 的 `## Design Review` 區塊中所有 checkbox 為 `[x]`

兩個信號至少一個成立才放行。都不成立 → `exit 2` 阻擋 archive。

## Cross-Change Holistic Review（跨 change 整體性審查）

**觸發條件**（任一）：

- 專案已有 2+ archived UI changes（`openspec/changes/archive/` 中含 `.vue` 相關 tasks 的 change）
- 當前 change 的 UI 頁面與已完成頁面共用 layout（如 `desktop.vue`、`default.vue`）

**行為**：

- `/design improve` 的 Fidelity Check 擴大範圍，額外抽樣 2-3 個**同 layout 已上線頁面**
- 既有頁面的偏差標記為 **Cross-Change DRIFT**（建議修復，不阻擋 archive）
- Cross-Change DRIFT 記錄在 `design-review.md` 的獨立段落，便於後續 change 處理

**效果**：防止第一個 change 設壞模板後，後續 change 複製偏差。跨 change 審查是建議性的——不阻擋當前 change archive，但留下明確記錄。

## 非 UI Change 的例外

若 change 純後端（migration、API、RLS、config），不觸發 Design Checkpoint，直接走 Spectra 標準流程。判斷依據：change 的 tasks artifact 中是否有任何 task 涉及 `.vue` / `pages/` / `components/` / `layouts/` 檔案，且 git diff 中無 `.vue` 檔案。

<!-- SPECTRA-UX:START v1.4.0 -->

## UX Completeness Gate（補充 Design Gate）

**Design Gate 檢查 UI 視覺品質；UX Completeness Gate 檢查 UI 功能覆蓋**。兩者並存，都必須通過。

**完整規則**：[`.claude/rules/ux-completeness.md`](./ux-completeness.md) — Definition of Done、Affected Entity Matrix、User Journeys、Exhaustiveness、State Coverage、心智模型、必禁事項。

### 階段閘門（hook 自動觸發）

| 階段                     | Hook                            | 檢查                                                          |
| ------------------------ | ------------------------------- | ------------------------------------------------------------- |
| Before `spectra-propose` | `pre-propose-ux-scan.sh`        | 注入 blast radius 要求                                        |
| After `spectra-propose`  | `post-propose-journey-check.sh` | `## Affected Entity Matrix` + `## User Journeys` 必填         |
| Before `spectra-apply`   | `pre-apply-journey-brief.sh`    | 抽出 journeys 簡報給 implementer                              |
| Before `spectra-archive` | `pre-archive-ux-gate.sh`        | Journey URL Touch / Schema-Types Drift / Exhaustiveness Drift |

### Apply 階段的 Exit criteria

完成所有 tasks 後必須：

1. 對照 User Journeys 逐一確認可在瀏覽器走通
2. 跑 `pnpm audit:ux-drift` 檢查 enum exhaustiveness 無新漂移
3. 派遣 `screenshot-review` agent 對每個 journey 截圖

<!-- SPECTRA-UX:END -->

## Spectra Roadmap Maintenance

**`openspec/ROADMAP.md` 是 spectra 工作流的儀表板**。AUTO 區塊由
`pnpm spectra:roadmap` 自動維護（hooks 會自動觸發），MANUAL 區塊由
你在討論中主動累積。

### AUTO 區塊內容

| 區塊 | 來源 | 說明 |
| --- | --- | --- |
| `Active Changes` | `openspec/changes/**` 掃描 | stage / 進度 / 觸動的 specs |
| `Parallel Tracks` | spec collision 分析 | independent / mutex / blocked |
| `Parked Changes` | `spectra list --parked --json` | park 後檔案不在 disk，但 metadata 仍要可見以免遺忘 |

park / unpark 會改動 `.spectra/spectra.db`，sync 的 mtime fast-path 已納入該檔，
所以 park 完不需要手動加 `--force`。

### 自動觸發點

| 時機 | 機制 | 保底 |
| --- | --- | --- |
| 新 session 開始 | `session-start-roadmap-sync.sh` | 永遠對齊 |
| Edit/Write 到 `openspec/changes/**` | `post-edit-roadmap-sync.sh` | 即時反映 |
| `spectra park` / `spectra unpark` 之後 | **你必須手動** `pnpm spectra:roadmap` | hook 沒監聽 `.spectra/spectra.db` |
| `/assign /spectra-*` 結束後 | **你必須手動** `pnpm spectra:roadmap` | 外部 runtime 不觸發 hook |

### Claude 主動維護的時機

Claude **必須**在以下時機更新 `## Next Moves` 區塊（MANUAL block）：

1. `/spectra-discuss` 收斂出「未來要做的事」→ 寫入 `### 近期` / `### 中期` / `### 長期`
2. `/spectra-propose` 結束時，若對話提到其他尚未 propose 的未來工作 → 寫入
3. `/spectra-archive` 結束時，若剛完成的 change 影響 Next Moves 的排序 → 重新評估
4. 使用者明確說「記到 roadmap」/「排進下一步」→ 立刻寫入

**格式**：`- [priority] 描述 — 依賴：xxx / 獨立 / 互斥：yyy`

- priority: `high` / `mid` / `low`
- 依賴關係：若知道需要先等某個 change 完成，明確列出
- **NEVER** 捏造 Next Moves 為了填滿區塊

### 讀 ROADMAP 的時機

- 新 session 開始時（hook 已自動 sync，你只要 Read 即可）
- 開始規劃新工作前，先看 `## Active Changes` + `## Parallel Tracks` 判斷可並行性
- 使用者問「parked 有什麼」「暫存的 change 還剩哪些」→ 看 `## Parked Changes` AUTO 區塊
- 使用者觸發以下關鍵字時（見下節「使用者觸發語」）

**不要依賴 `@openspec/ROADMAP.md` 快照引用** — 該機制只在 session 開頭載入一次，中途檔案變動不會反映。請用 Read 工具直接讀檔。

### 使用者觸發語（User trigger keywords）

使用者講下列任一關鍵字 → **立即**執行完整「sync → Read → 回報」流程：

| 類別 | 關鍵字（中文／英文） |
| --- | --- |
| 現況類 | 「roadmap 現況」/「專案現況」/「現在做到哪」/「現在在做什麼」/ "roadmap status" / "current state" / "where are we" |
| 下一步類 | 「接下來該做什麼」/「下一步」/「還有什麼要做」/ "what's next" / "next moves" |
| 刷新類 | 「看 roadmap」/「刷 roadmap」/「更新 roadmap」/ "show roadmap" / "refresh roadmap" |

**完整流程**（三步、不可跳）：

1. 跑 `pnpm spectra:roadmap --force` — 繞過 mtime 快路徑確保絕對最新
2. Read `<openspec>/ROADMAP.md` — 取得當前內容進入 context
3. 回報四件事：
   - **Active Changes 摘要** — 每個 change 的 stage + 進度 + 觸動的 specs
   - **Parallelism 訊號** — 有無 mutex / blocked，能並行推進哪幾條線
   - **Parked Changes** — 有無暫存的 change 需要使用者決定 unpark / archive / 放著
   - **Next Moves 狀態** — MANUAL backlog 有什麼項目，是否有本次對話該主動補進去的

**只 sync、不回報**：使用者說「sync roadmap」/「跑 spectra:roadmap」時，只執行第 1 步並簡報一行結果，**不**繼續讀 + 分析。

**單純查詢、不強制 sync**：使用者只說「roadmap 裡有什麼」等純查詢問句時，可依賴最近一次 hook 觸發的結果直接 Read，不必 `--force`。

### 禁止事項

- **NEVER** 手編 `<!-- SPECTRA-UX:ROADMAP-AUTO:* -->` 區塊內容 — 會被下次 sync 覆寫
- **NEVER** 把 AUTO 區塊的 active changes 複製到 MANUAL 區塊
- **NEVER** 為了填滿 Next Moves 編造使用者未提過的意圖
