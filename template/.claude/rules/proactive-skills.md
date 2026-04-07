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

| 情境                         | 觸發              | 說明                        |
| ---------------------------- | ----------------- | --------------------------- |
| 準備開始或繼續實作           | `spectra-apply`   | 按 tasks 執行               |
| 實作中遇到非預期錯誤         | `spectra-debug`   | 四階段系統性排查            |
| 實作中發現 spec 有誤或過時   | `spectra-ingest`  | 更新 artifacts，不停下實作  |
| 架構決策點（多種做法都可行） | `spectra-discuss` | 記錄決策到 artifacts        |
| 需要確認現有規格內容         | `spectra-ask`     | 查詢而非猜測                |

### Completion 階段

| 情境                     | 觸發              | 說明                               |
| ------------------------ | ----------------- | ---------------------------------- |
| 所有 tasks 完成          | `spectra-verify`  | 驗證三維度：完整性、正確性、一致性 |
| Verify 通過              | `spectra-sync`    | Delta specs → main specs           |
| Sync 完成 + 人工檢查通過                             | `spectra-archive` | 最終歸檔                           |
| Archive 完成 + change 有 UI（design review findings） | `design-retro`    | 分析 findings、識別重複模式、建議改善 |
| Findings 累積達 5 的倍數（5、10、15…）                | `design-retro`    | 週期性全量分析                      |

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
       │     不存在？→ 先跑 /teach-impeccable
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
| 表單密集（CRUD、輸入） | /arrange, /clarify, /harden   | /overdrive, /bolder |
| 資料表格（列表、搜尋） | /arrange, /typeset, /adapt    | /delight, /animate  |
| 儀表板/圖表            | /colorize, /arrange, /typeset | /quieter, /onboard  |
| 首次體驗/空狀態        | /onboard, /clarify, /delight  | /optimize           |
| 複雜互動流程           | /animate, /clarify, /harden   | /bolder             |
| 登入/認證頁            | /typeset, /colorize           | /extract, /distill  |

### Mutual Exclusivity

- `/bolder` vs `/quieter`——選一個方向
- `/distill` 先於 `/bolder`——簡化後才放大
- `/colorize` vs `/quieter`——減弱時不加色

### Canonical Order（偏離需說明理由）

```
/teach-impeccable       ← 專案首次（無 .impeccable.md 時）
  ↓
/normalize              ← 對齊 design system（若偏移）
/distill                ← 先簡化（若雜亂）
  ↓
/arrange                ← 結構與佈局
/typeset                ← 字型與層次
/colorize | /bolder | /quieter  ← 色彩與強度（擇一）
  ↓
/animate                ← 動效
/clarify                ← 文案與訊息
/delight                ← 個性與驚喜
/onboard                ← 首次體驗（如適用）
  ↓
/harden                 ← 韌性與邊界情況
/optimize               ← 效能
/adapt                  ← 跨裝置（如需要）
  ↓
/polish                 ← 永遠最後
```

## Design Review Task Template

**執行 `spectra-propose` 時**，若 change 涉及 UI（tasks 中提及 `.vue`、`pages/`、`components/`、`layouts/`），**必須**在 tasks artifact 中加入 Design Review 區塊。

位置：最後一個功能區塊之後、`## 人工檢查`之前。
編號：N = 上一個功能區塊的序號 + 1。

```markdown
## N. Design Review

- [ ] N.1 檢查 .impeccable.md 是否存在，若無則執行 /teach-impeccable
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

| # | 類別 | 問題摘要 | 嚴重度 | 發現來源 |
|---|------|---------|--------|---------|
| 1 | spacing | 卡片間距不一致 | warning | /arrange |
| 2 | a11y | 缺少 aria-label | critical | /audit |
| 3 | color | 對比度不足 | critical | /colorize |
```

### 類別定義

| 類別 | 說明 |
|------|------|
| `spacing` | 間距、padding、margin 問題 |
| `layout` | 佈局結構、grid、flex 問題 |
| `typography` | 字型、字級、行高、字重問題 |
| `color` | 色彩、對比度、主題一致性問題 |
| `a11y` | 無障礙（aria、focus、keyboard）問題 |
| `responsive` | 響應式、跨裝置適配問題 |
| `interaction` | 動效、hover、transition 問題 |
| `copy` | 文案、標籤、錯誤訊息問題 |
| `consistency` | 與 design system 不一致 |
| `hardening` | 邊界情況、空狀態、loading 狀態 |
| `performance` | 渲染效能、圖片優化問題 |

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
