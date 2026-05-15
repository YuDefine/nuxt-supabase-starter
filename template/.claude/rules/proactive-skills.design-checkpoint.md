<!--
🔒 LOCKED — managed by clade
Source: rules/core/proactive-skills.design-checkpoint.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: UI / design 工作的 Design Checkpoint、design skill 觸發順序、Design Review template、Design Gate、Cross-Change holistic review 與非 UI exception；動 UI 檔或寫 design artifact 時 path-scoped 載入
paths: ['app/**/*.vue', 'app/**/*.ts', 'components/**', 'pages/**', 'layouts/**', 'openspec/changes/**/design.md', 'docs/specs/**/spec.md']
---

# Proactive Skills — Design Checkpoint

> Reference 檔。核心規約見 [`proactive-skills.md`](./proactive-skills.md)。本檔聚焦動 UI 檔（pages / components / layouts / `.vue` / `.ts`）或寫 `design.md` / `spec.md` 時主動觸發的 design skill orchestrator、Design Review task block 模板、Design Gate 阻擋條件、跨 change 整體性審查與非 UI exception。

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
       ├─ 1. 檢查 PRODUCT.md（必要）+ DESIGN.md（建議）
       │     PRODUCT.md 存在？→ 繼續（DESIGN.md 缺則建議跑 /impeccable document）
       │     PRODUCT.md 不存在？→ 先跑 /impeccable teach
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
       ├─ 4. 跑 /impeccable audit [affected pages]
       │     Critical > 0？→ 修復後重跑
       │     Critical = 0？→ 繼續
       │
       └─ 5. 標記 task 完成
```

### Design Skill 選擇指南（診斷驅動）

根據 `/design improve` 的診斷結果選擇，不要盲目全跑：

| UI 類型                | 常見需要的 skill              | 通常不需要          |
| ---------------------- | ----------------------------- | ------------------- |
| 表單密集（CRUD、輸入） | /impeccable layout, /impeccable clarify, /impeccable harden    | /impeccable overdrive, /impeccable bolder |
| 資料表格（列表、搜尋） | /impeccable layout, /impeccable typeset, /impeccable adapt     | /impeccable delight, /impeccable animate  |
| 儀表板/圖表            | /impeccable colorize, /impeccable layout, /impeccable typeset  | /impeccable quieter, /impeccable harden   |
| 首次體驗/空狀態        | /impeccable harden, /impeccable clarify, /impeccable delight   | /impeccable optimize           |
| 複雜互動流程           | /impeccable animate, /impeccable clarify, /impeccable harden   | /impeccable bolder             |
| 登入/認證頁            | /impeccable typeset, /impeccable colorize           | /impeccable extract, /impeccable distill |

### Mutual Exclusivity

- `/impeccable bolder` vs `/impeccable quieter`——選一個方向
- `/impeccable distill` 先於 `/impeccable bolder`——簡化後才放大
- `/impeccable colorize` vs `/impeccable quieter`——減弱時不加色

### Canonical Order（偏離需說明理由）

```
/impeccable teach       ← 專案首次（無 PRODUCT.md 時）
/impeccable document    ← 已有 code 但無 DESIGN.md 時，從 code 反推
/impeccable shape       ← （選用）code 前需求釐清
  ↓
/impeccable craft       ← 主要建置流程（shape-then-build）
/impeccable distill     ← 先簡化（若雜亂）
  ↓
/impeccable layout      ← 結構與佈局
/impeccable typeset     ← 字型與層次
/impeccable colorize | /impeccable bolder | /impeccable quieter  ← 色彩與強度（擇一）
  ↓
/impeccable animate     ← 動效
/impeccable clarify     ← 文案與訊息
/impeccable delight     ← 個性與驚喜
/impeccable harden      ← 韌性、邊界情況
/impeccable onboard     ← 首次體驗、空狀態、activation
  ↓
/impeccable optimize    ← 效能
/impeccable adapt       ← 跨裝置（如需要）
/impeccable extract     ← 萃取為 design system（如適用）
  ↓
/impeccable audit       ← 診斷驗收（Critical 必須為 0）
/impeccable polish      ← 永遠最後
```

## Design Review Task Template

**執行 `spectra-propose` 時**，若 change 涉及 UI（tasks 中提及 `.vue`、`pages/`、`components/`、`layouts/`），**必須**在 tasks artifact 中加入 Design Review 區塊。

位置：最後一個功能區塊之後、`## 人工檢查`之前。
編號：N = 上一個功能區塊的序號 + 1。

```markdown
## N. Design Review

- [ ] N.1 檢查 PRODUCT.md（必要）+ DESIGN.md（建議）；缺 PRODUCT.md 跑 /impeccable teach、缺 DESIGN.md 跑 /impeccable document
- [ ] N.2 執行 /design improve [affected pages/components]（含 Design Fidelity Report）
- [ ] N.3 修復所有 DRIFT 項目（Fidelity Score < 8/8 時必做，loop 直到 DRIFT = 0）
- [ ] N.4 依 /design 計劃按 canonical order 執行 targeted skills
- [ ] N.5 執行 /impeccable audit — 確認 Critical = 0
- [ ] N.6 執行 review-screenshot — 視覺 QA
- [ ] N.7 Fidelity 確認 — design-review.md 中無 DRIFT 項
```

`[affected pages/components]` 替換為此 change 實際涉及的 UI 檔案/頁面。

**效果**：spectra-apply 會依序執行到 Design Review 區塊，自然觸發 design 工作。Design tasks 是一等公民，不是附加步驟。

## Design Review 中斷與續跑

Design Review 過程中若發現問題過多（例如需要列修正計劃讓使用者確認），**提前停下時必須提示**：

> 完成上述修正後，需要**重新跑一次完整 Design Review**（從 N.2 `/design improve` 開始），確認所有問題都已修復且未引入新問題。

**規則**：Design Review 的 N.4 `/impeccable audit` 必須在**所有修正完成後**才執行。若中途停下修正，恢復後從 N.2 重新開始，不得跳過。

## Design Review Findings Log

每次 Design Review 完成時，**必須**將發現的問題記錄到 `docs/design-review-findings.md`，用於追蹤跨 spec 的重複問題模式。

### 記錄格式

```markdown
## [CHANGE-ID] — YYYY-MM-DD

**影響範圍**: [affected pages/components]

| #   | 類別    | 問題摘要        | 嚴重度   | 發現來源  |
| --- | ------- | --------------- | -------- | --------- |
| 1   | spacing | 卡片間距不一致  | warning  | /impeccable layout   |
| 2   | a11y    | 缺少 aria-label | critical | /impeccable audit    |
| 3   | color   | 對比度不足      | critical | /impeccable colorize |
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
| /impeccable audit 發現需要新元件或新 API endpoint                                  | `spectra-ingest` 更新 tasks（加新 task）    |
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

## Design Review Orchestration（snippet 補充）

繁體中文 | [English](./proactive-skills-section.en.md)

當 `spectra-apply` 任務碰到 UI 工作（頁面、元件、layout、互動流程），Design Review 是**一等公民**，不是收尾裝飾。

### 觸發時機

- tasks.md 涉及 UI 檔案或頁面路徑
- 實作中第一次開始編輯 UI 檔案
- `spectra-propose` 結束時已可判定 change 有 UI scope

### 必要流程

1. 檢查設計脈絡是否存在；沒有就先建立
2. 執行 `/design improve [affected pages/components]`
3. 依計劃按 canonical order 執行 targeted design skills
4. 執行 `/impeccable audit`，確認 Critical = 0
5. 執行 screenshot review，將證據補到 `design-review.md`
6. 對 UI change，archive 前必須通過 Design Gate

### Design Gate（archive 前硬門檻 — 補充版）

UI change 在 archive 前，至少要有以下其中一種完整證據，且**人工檢查不能留白**：

- `design-review.md` 有實質內容（截圖、Fidelity Report、無未修復 DRIFT）
- tasks.md 的 `## Design Review` 區塊全部完成

缺一不可時，`pre-archive-design-gate.sh` 會擋下 archive。
