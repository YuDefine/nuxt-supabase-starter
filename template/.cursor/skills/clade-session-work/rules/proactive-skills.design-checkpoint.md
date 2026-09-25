---
description: UI / design 工作的 Design Checkpoint、design skill 觸發順序、Design Review template、Design Gate、Cross-Change holistic review 與非 UI exception；動 UI 檔或寫 design artifact 時 path-scoped 載入
paths: ['app/**/*.vue', 'packages/*/app/**/*.vue', 'app/**/*.ts', 'packages/*/app/**/*.ts', 'components/**', 'packages/*/components/**', 'pages/**', 'packages/*/pages/**', 'layouts/**', 'packages/*/layouts/**', 'specs/plans/**', 'docs/specs/**/spec.md']
---
<!-- Clade native rule; source: rules/core/proactive-skills.design-checkpoint.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

# Proactive Skills — Design Checkpoint

> [[proactive-skills]] 的 reference 檔：動 UI 檔或寫 design artifact 時的 design skill orchestrator。

## Design Skill 自主觸發

### 觸發條件

**任何 `/implement` task 碰到 UI 工作**（建立/修改 `.vue` 檔案、pages、components、layouts）時，自動進入 Design Checkpoint。**每一個**這樣的 task 都適用，不是只有整包工作的最後一個。

### Design Checkpoint 流程

依下方 § Design Review Task Template 的 N.1–N.7 順序執行：PRODUCT.md 缺則先 `/impeccable init` → `/design improve` 取診斷與 Design Fidelity Report → 修 DRIFT（fidelity loop，max 2 輪，目標 8/8）→ 按 canonical order 跑計劃中的 skill → `/impeccable audit` 到 Critical = 0 → N.6 `/review screenshot` 視覺 QA（截圖證據附進 `design-review.md`）→ N.7 確認 `design-review.md` 無 DRIFT → 標記 task 完成。

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
/impeccable init        ← 專案首次（無 PRODUCT.md 時）
/impeccable document    ← 已有 code 但無 DESIGN.md 時，從 code 反推
/impeccable shape       ← （選用）code 前需求釐清；確認走 Shape brief 決策頁
  ↓
new-work build          ← 描述目標介面（Direction Gate 之後；NEVER 輸出 /impeccable craft）
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

**執行 `/tasks`（或手寫 `tasks/<date>-<slug>.md`）時**，若這次工作涉及 UI（清單中提及 `.vue`、`pages/`、`components/`、`layouts/`），**必須**在該 tasks 檔中加入 Design Review 區塊。

位置：最後一個功能區塊之後、`## 人工檢查`之前。
編號：N = 上一個功能區塊的序號 + 1。

```markdown
## N. Design Review

- [ ] N.1 檢查 PRODUCT.md（必要）+ DESIGN.md（建議）；缺 PRODUCT.md 跑 /impeccable init、缺 DESIGN.md 跑 /impeccable document
- [ ] N.2 執行 /design improve [affected pages/components]（含 Design Fidelity Report）
- [ ] N.3 修復所有 DRIFT 項目（Fidelity Score < 8/8 時必做，loop 直到 DRIFT = 0）
- [ ] N.4 依 /design 計劃按 canonical order 執行 targeted skills
- [ ] N.5 執行 /impeccable audit — 確認 Critical = 0
- [ ] N.6 執行 `/review screenshot` — 視覺 QA
- [ ] N.7 Fidelity 確認 — design-review.md 中無 DRIFT 項
```

`[affected pages/components]` 替換為此 change 實際涉及的 UI 檔案/頁面。

## Design Review 中斷與續跑

N.5 `/impeccable audit` 必須在**所有修正完成後**才執行。中途停下修正時 MUST 提示使用者：恢復後從 N.2 `/design improve` 重跑完整 Design Review，不得跳過。

## Design Review Findings Log

每次 Design Review 完成時，**必須**將發現的問題記錄到 `docs/design-review-findings.md`，用於追蹤跨 spec 的重複問題模式。

### 記錄格式

```markdown
## [WORK-SLUG] — YYYY-MM-DD

**影響範圍**: [affected pages/components]

| #   | 類別    | 問題摘要        | 嚴重度   | 發現來源  |
| --- | ------- | --------------- | -------- | --------- |
| 1   | spacing | 卡片間距不一致  | warning  | /impeccable layout   |
| 2   | a11y    | 缺少 aria-label | critical | /impeccable audit    |
| 3   | color   | 對比度不足      | critical | /impeccable colorize |
```

類別：`spacing` `layout` `typography` `color` `a11y` `responsive` `interaction` `copy` `consistency` `hardening` `performance`。分析由 `/design retro` 負責。

## Design → 規格回饋迴路

Design 工作可能發現 spec 未涵蓋的問題。**每一次**發現都按下表回饋，不是等收尾一起處理：

| 情境                                                                    | 動作                                        |
| ----------------------------------------------------------------------- | ------------------------------------------- |
| /design 發現 spec 未涵蓋的 UX 需求（如缺 empty state、缺 loading 狀態） | 回交 `/dsl-refine` 更新 truth feature；**NEVER** 就地改 `specs/truth/**` |
| /impeccable audit 發現需要新元件或新 API endpoint                       | 在當前 tasks 檔加一條 task；動到 API 契約時先改 `specs/api/**`（per [[specformula]] spec-first） |
| Design 決策影響資料模型或 API schema                                    | 記進 `docs/decisions/**` → 由 owner skill 落 `specs/data/**` / `specs/truth/**` |
| /design 改動範圍超出原工作 scope                                        | 停下，通知使用者，可能需要另開一個 work item |

## Design Gate（交付人工檢查前的硬門檻）

**把一件含 `.vue` 變更的工作交付人工檢查（或標 `work.done`）之前**，MUST 自己核對兩個信號：

1. **`design-review.md` 存在且含 fidelity 證據**——有 `/design improve` 產出的設計審查記錄，**且**包含「Design Fidelity Report」段落，**且**無未修復的 DRIFT 項目（表格中無 `| DRIFT |` 行）
2. **Design Review tasks 全部完成**——tasks 檔的 `## Design Review` 區塊中所有 checkbox 為 `[x]`

兩個信號至少一個成立，且 `## 人工檢查` 不留白，才可交付。都不成立 → **STOP**，回去補完再交付。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | informational — **不觸發任何東西**。沒有 detector 掛在「交付人工檢查」這個事件上 |
| 消費端 | 正要把含 UI 變更的工作交付人工檢查、或標 `work.done` 的那個 agent（本節） |
| 載入路徑 | 本節（`rules/core/proactive-skills.design-checkpoint.md`，path-scoped 於 UI 檔與 `specs/plans/**`） |

**NEVER** 把「沒有 hook 擋我」讀成這道門檻不存在——它唯一的執行者是讀到本節的那個 agent。

## Cross-Change Holistic Review（跨 change 整體性審查）

**觸發條件**（任一）：

- 專案已有 2+ 件完成的 UI 工作（`tasks/` 或 `specs/plans/**` 中含 `.vue` 相關 task 且已標 done）
- 當前工作的 UI 頁面與已完成頁面共用 layout（如 `desktop.vue`、`default.vue`）

**行為**：

- `/design improve` 的 Fidelity Check 擴大範圍，額外抽樣 2-3 個**同 layout 已上線頁面**
- 既有頁面的偏差標記為 **Cross-Work DRIFT**（建議修復，不阻擋交付）
- Cross-Work DRIFT 記錄在 `design-review.md` 的獨立段落，便於後續工作處理



## 純後端工作的例外

若工作純後端（migration、API、RLS、config），不觸發 Design Checkpoint，直接走 [[aixbdd-workflow]] 的標準入口順序。判斷依據：tasks 檔中是否有任何 task 涉及 `.vue` / `pages/` / `components/` / `layouts/` 檔案，且 git diff 中無 `.vue` 檔案。
