<!--
🔒 LOCKED — managed by clade
Source: rules/core/proactive-skills.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

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

### Sub-skill 禁用清單（永不觸發）

| Sub-skill        | 規則                | 替代方式                                                              |
| ---------------- | ------------------- | --------------------------------------------------------------------- |
| `spectra-commit` | **NEVER** 主動觸發  | 走 `rules/core/commit.md` 規範的標準 commit 工序（含 hooks / 訊息格式） |

**原因**：spectra-commit 是 spectra CLI 上游帶來的薄殼，本治理範圍下 commit 必須統一走 `rules/core/commit.md`。Claude 偵測到使用者要 commit Spectra change 的相關檔案時，**MUST** 直接走標準 git / `/commit` 流程，**NEVER** 改派 spectra-commit。

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

<!-- SPECTRA-UX:START v1.13.4 -->

繁體中文 | [English](./proactive-skills-section.en.md)

## Design Review Orchestration

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

### `## Design Review` task block

若 `spectra-propose` 的 change 含 UI scope，tasks.md **必須**在最後一個功能區塊之後、`## 人工檢查` 之前加入：

```markdown
## N. Design Review

- [ ] N.1 檢查設計脈絡是否存在，若無則先建立
- [ ] N.2 執行 /design improve [affected pages/components]
- [ ] N.3 依計劃按 canonical order 執行 targeted design skills
- [ ] N.4 執行 /impeccable audit，確認 Critical = 0
- [ ] N.5 執行 screenshot review，補 design-review.md / 視覺 QA 證據
```

### Design Gate（archive 前硬門檻）

UI change 在 archive 前，至少要有以下其中一種完整證據，且**人工檢查不能留白**：

- `design-review.md` 有實質內容（截圖、Fidelity Report、無未修復 DRIFT）
- tasks.md 的 `## Design Review` 區塊全部完成

缺一不可時，`pre-archive-design-gate.sh` 會擋下 archive。

## Ingest Triggers

`spectra-ingest` 是 apply 階段的「需求漂移補丁」。當 proposal / tasks / design artifact 與實際需求或實作現況出現結構性落差時，**Claude MUST 主動引導使用者**（不是等使用者自己想起）。

### 主動觸發信號

Apply 階段中偵測到以下任一信號 → 必須立即處理：

1. **使用者口頭改需求** — 對話中出現「順便加…」「其實應該…」「我想改成…」「還要支援…」等擴增或修改
2. **Journey / Entity 遺漏** — 實作中發現觸動了 proposal 的 `User Journeys` / `Affected Entity Matrix` 未列之 surface 或 schema
3. **Tasks 結構性落差** — 不是單一 task 字句調整，而是要整段新增 / 刪除 / 重排
4. **Design scope 溢出** — design review 發現 UI 影響範圍超出 proposal 原列頁面 / 元件
5. **Schema 漂移** — migration 新增 enum / column 但 `Affected Entity Matrix` 沒對應紀錄
6. **Risk plan 前提變動** — 實作中發現 `Implementation Risk Plan` 的 truth layer / contract / test plan 需要更新

`post-edit-drift-check.sh`（hook）會自動偵測 5、4、2 的部分靜默漂移，寫 stderr 提示 Claude 考慮 ingest。LLM 判斷層面則需要主動感知 1、3、6。

### 決策規則（明確直接做、模糊再詢問）

| 情況 | 動作 |
| --- | --- |
| 信號明確（migration 新增未紀錄欄位、使用者直白改需求、journey 遺漏具體 URL） | Claude **直接跑** `spectra-ingest`，口頭告知「偵測到 X，已觸發 ingest 更新 Y」 |
| 信號模糊（不確定是否達結構性落差門檻、可能只是 task 字句微調） | 先口頭詢問使用者，描述信號並列出選項（ingest vs. 在當前 tasks 微調）讓使用者選 |

**NEVER** 偵測到信號卻靜默繼續實作 — 會導致 proposal / tasks 與實作永久不同步。

### 必要流程

1. 判斷信號明確度 → 直接跑 `spectra-ingest` 或先問
2. 確認 proposal / tasks / design artifact 已同步新需求
3. 繼續或調整當前 apply，不回頭修舊 task 的字句以敷衍差異
4. Archive 前已被 ingest 吸收的漏項不需再補 `@followup` marker

### 與其他登記出口的分界

- **當前 change 本身的 scope 漏項 → `spectra-ingest`**（本節規則）
- 範圍外技術債 → `docs/tech-debt.md` + `@followup[TD-NNN]`
- Session 未完 WIP → `HANDOFF.md`
- 未來才做的工作 → `openspec/ROADMAP.md` `## Next Moves`

**心智模型**：ingest 是「這個 change 自己要改」；tech-debt / handoff / roadmap 是「這個 change 之外的事」。分不清時預設走 ingest，不要為了維持原 proposal 敘述而把應補項偽裝成 follow-up。

## Scope Discipline

所有 spectra / design workflow 都受以下規則約束：

- 範圍外檔案不要順手改
- 途中發現其他問題：**不修，但必登記**
- 未知變更先回報，不得自行清場
- 不得在 subagent 內執行 `git reset --hard` / `git checkout --` / `git clean`

登記出口：

- 技術債 → `docs/tech-debt.md` + `@followup[TD-NNN]`
- 當前 session 未完 → `HANDOFF.md`
- 未來工作 → `openspec/ROADMAP.md`
- change 漏項 → `spectra-ingest`
- 架構決策 → `docs/decisions/**`

## Handoff Hygiene

符合以下情況，**MUST** 建立或更新 `HANDOFF.md`：

- session 結束時仍有 active change
- 有未 commit 的 WIP
- 有 blocker 需要下一個 session 接手
- 工作移交給其他 agent / runtime

`HANDOFF.md` 應至少記錄：

- 正在做什麼（change / task / 檔案）
- 卡在哪裡
- 下一步按優先序怎麼走
- 哪些項目仍**尚未被接手**

一旦下一個 session 接手：

1. 先建立 claim
2. 再從 `HANDOFF.md` 移除對應項目
3. 若已空，刪除 `HANDOFF.md`

## Manual Review

`## 人工檢查` 的 checkbox **不能由 agent 自行代勾**。

正確流程：

1. 截圖或準備驗收證據
2. 向使用者逐項展示
3. 使用者回覆 OK / 問題 / skip
4. 依答覆更新 checkbox

靜態 screenshot review 是證據，不等同於使用者驗收。

## Review Tiers

依變更風險決定 review 強度：

- Tier 1：小型低風險變更 → self-review
- Tier 2：中型以上功能變更 → `spectra-audit` + code review
- Tier 3：migration / auth / permission / raw SQL / security-critical → 更嚴格 review

不要因為 diff 短就把高風險變更降級。

## Screenshot Strategy

截圖工具選擇原則：

- 一次性探索、人工檢查、設計驗收 → `browser-use` 類工具優先
- 響應式、多 viewport、跨瀏覽器、多分頁、要沉澱回歸 → Playwright

同一組截圖重拍到第 3 次，應考慮沉澱為 Playwright spec。

## Knowledge And Decisions

碰到非直覺問題或 workaround，任務結束時應評估沉澱到 `docs/solutions/**`。  
做出跨任務的技術取捨時，應評估寫 ADR 到 `docs/decisions/**`。

## UX Completeness Gate（補充 Design Gate）

**Design Gate 檢查 UI 視覺品質；UX Completeness Gate 檢查 UI 功能覆蓋**。
兩者並存，都必須通過。完整規則見 [`docs/rules/ux-completeness.md`](docs/rules/ux-completeness.md)。

### Propose 階段

`pre-propose-ux-scan.sh`（hook）+ `post-propose-journey-check.sh`（hook）強制要求：

- `## Affected Entity Matrix`（若觸動 DB schema / shared types）
- `## User Journeys`（強制；純後端寫 `**No user-facing journey (backend-only)**`）
- `## Implementation Risk Plan`（強制；固定回答 `Truth layer / invariants`、`Review tier`、`Contract / failure paths`、`Test plan`、`Artifact sync`）

這個區塊保持精簡，目的不是寫 implementation 細節，而是把最容易拖到 `/commit` 才被指出的前提問題提前回答。

### Apply 階段

`pre-apply-journey-brief.sh`（hook）抽出 journeys + risk plan 簡報給 implementer。

**Exit criteria**：完成所有 tasks 後必須：

1. 對照 User Journeys 逐一確認可在瀏覽器走通
2. 跑 `pnpm audit:ux-drift` 檢查 enum exhaustiveness 無新漂移
3. 派遣 screenshot-review agent 對每個 journey 截圖

### Archive 階段

`pre-archive-ux-gate.sh`（hook）跑：

- **Journey URL Touch**：proposal 的 journey URL 對應 UI 檔必須被動過
- **Schema-Types Drift**：migration 新增 enum/column → shared types 必須同步
- **Exhaustiveness Drift**：audit-ux-drift 偵測新漂移 → warn

`pre-archive-followup-gate.sh`（hook，v1.5+）跑：

- **Follow-up Register**：tasks.md 的 `@followup[TD-NNN]` marker 必須在 `docs/tech-debt.md` 有完整 entry，否則阻擋 archive。詳見 `follow-up-register.md`。

### 必禁事項

- **NEVER** 寫空洞的 User Journeys 為通過 gate
- **NEVER** 用 Non-Goals 隱藏忘記做的 surface
- **NEVER** 把 `if/else if/else` 用在 enum 分支
- **NEVER** 新增 route 但不在 navigation 加入口
- **NEVER** 把「tasks 全勾 + tests 綠」當作 feature complete

### 心智模型

| 錯誤直覺 | 正確認識 |
| --- | --- |
| DB migration 過了就是 feature ready | DB allow ≠ feature ready |
| API test 綠就是 UX 完成 | Tests pass ≠ UX done |
| 既有頁面有了就不用改 | Branching logic 要更多改動 |
| 記得住改了什麼 | 列舉比記憶可靠 |
| Kiosk/主流程做完就收工 | Admin 管理路徑同等重要 |
| 感覺完成就是完成 | 差的那一哩通常是 UI |

## Spectra Roadmap Maintenance

**`openspec/ROADMAP.md` 是 spectra 工作流的儀表板**。AUTO 區塊由
`pnpm spectra:roadmap` 自動維護（hooks 會自動觸發），MANUAL 區塊由
你在討論中主動累積。

### AUTO 區塊內容

| 區塊 | 來源 | 說明 |
| --- | --- | --- |
| `Active Changes` | `openspec/changes/**` 掃描 | stage / 進度 / 觸動的 specs |
| `Active Claims` | `.spectra/claims/*.json` | 誰正在做哪個 change、最後 heartbeat、哪些 claim 已 stale |
| `Parallel Tracks` | spec collision 分析 | independent / mutex / blocked |
| `Parked Changes` | `spectra list --parked --json` | park 後檔案不在 disk，但 metadata 仍要可見以免遺忘 |

v1.6+: `spectra:roadmap` 每次執行都是完整操作（無 mtime fast-path、無 `--force`
flag）。park / unpark 後直接跑 `pnpm spectra:roadmap` 即可。

### MANUAL 區塊 drift 偵測（v1.6+）

每次 sync 時會另外掃 MANUAL 區塊，對照以下三種 ground truth 找出過時內容：

| Drift 類型 | 偵測條件 | Ground truth |
| --- | --- | --- |
| `archived-as-active` | MANUAL 提到某 change 名稱，語意又稱之為「進行中 / draft / open / wip」 | `openspec/changes/archive/` 目錄 |
| `td-status-mismatch` | MANUAL 提到 `TD-NNN` + active 語意詞，但 register 標 done/wontfix | `docs/tech-debt.md` Status |
| `version-mismatch` | MANUAL 以「Production 跑 vX.Y.Z」/「目前 vX.Y.Z」敘述版本 | `package.json` `version` |

**Drift 不自動改寫 MANUAL**（避免誤刪人寫內容），以 stderr 警告提示。Claude 看到
drift warning 時**必須**主動更新 MANUAL 區塊（Current State / Next Moves），
並在回應中告知使用者已修正哪些過時敘述。

### 自動觸發點

| 時機 | 機制 | 保底 |
| --- | --- | --- |
| 新 session 開始 | `session-start-roadmap-sync.sh` | 永遠對齊 roadmap + claims |
| Edit/Write | `post-edit-roadmap-sync.sh` | 有 claim heartbeat 或改到 `openspec/changes/**` 時即時反映 |
| `spectra park` / `spectra unpark` 之後 | **你必須手動** `pnpm spectra:roadmap` | hook 沒監聽 `.spectra/spectra.db` |
| `/assign /spectra-*` 結束後 | **你必須手動** `pnpm spectra:roadmap && pnpm spectra:claims` | 外部 runtime 不觸發 hook |

### Work Claim 規則（v1.10+）

`HANDOFF.md` 與 `ROADMAP.md` 都不是鎖。**真正避免撞工的是 claim。**

開始做 active spectra change 前：

1. 先執行 `pnpm spectra:claim -- <change>`
2. 再開始修改該 change 或相關實作檔
3. 若是接手 `HANDOFF.md`：claim 成立後立刻移除對應 handoff 項目
4. 完成、park、archive、或交棒時，執行 `pnpm spectra:release -- <change>`

**`HANDOFF.md` 只保留尚未被接手的項目。**

### Claude 主動維護的時機

Claude **必須**在以下時機更新 `## Next Moves` 區塊（MANUAL block）：

1. `spectra-discuss` workflow 收斂出「未來要做的事」→ 寫入 `### 近期` / `### 中期` / `### 長期`
2. `spectra-propose` workflow 結束時，若對話提到其他尚未 propose 的未來工作 → 寫入
3. `spectra-archive` workflow 結束時，若剛完成的 change 影響 Next Moves 的排序 → 重新評估
4. 使用者明確說「記到 roadmap」/「排進下一步」→ 立刻寫入

**格式**：`- [priority] 描述 — 依賴：xxx / 獨立 / 互斥：yyy`

- priority: `high` / `mid` / `low`
- 依賴關係：若知道需要先等某個 change 完成，明確列出
- **NEVER** 捏造 Next Moves 為了填滿區塊

### 讀 ROADMAP 的時機

- 新 session 開始時（hook 已自動 sync，你只要 Read 即可）
- 開始規劃新工作前，先看 `## Active Changes` + `## Active Claims` + `## Parallel Tracks`
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

1. 跑 `pnpm spectra:roadmap` — v1.6+ 每次皆完整 sync，無需 `--force`
2. Read `<openspec>/ROADMAP.md` — 取得當前內容進入 context
3. 回報五件事：
   - **Active Changes 摘要** — 每個 change 的 stage + 進度 + 觸動的 specs
   - **Active Claims 摘要** — 哪些 change 已有人接手、哪些 claim 已 stale
   - **Parallelism 訊號** — 有無 mutex / blocked，能並行推進哪幾條線
   - **Parked Changes** — 有無暫存的 change 需要使用者決定 unpark / archive / 放著
   - **MANUAL drift warnings** — 若 sync stderr 有 drift 警告，先依警告修正 MANUAL 再回報
   - **Next Moves 狀態** — MANUAL backlog 有什麼項目，是否有本次對話該主動補進去的

**只 sync、不回報**：使用者說「sync roadmap」/「跑 spectra:roadmap」時，只執行第 1 步並簡報一行結果（含 drift 摘要若有），**不**繼續讀 + 分析。

**單純查詢、不強制 sync**：使用者只說「roadmap 裡有什麼」等純查詢問句時，可依賴最近一次 hook 觸發的結果直接 Read。

### 禁止事項

- **NEVER** 手編 `<!-- SPECTRA-UX:ROADMAP-AUTO:* -->` 區塊內容 — 會被下次 sync 覆寫
- **NEVER** 把 AUTO 區塊的 active changes 複製到 MANUAL 區塊
- **NEVER** 為了填滿 Next Moves 編造使用者未提過的意圖
- **NEVER** 未 claim 就開始做 active change

## Follow-up Register (v1.5+)

`docs/tech-debt.md` 是所有 `@followup[TD-NNN]` marker 的 single source of truth。規則詳見 `follow-up-register.md`。

### Marker 語法（強制）

tasks.md 內未解決或延後項目 **MUST** 用 `@followup[TD-NNN]` 標註，每個 ID 在 register 有對應 entry。**禁止**自由文字（「DEFERRED」「LOCAL BLOCKED」「待後續處理」）不帶 marker。

### 自動化流程

| 時機 | 機制 | 動作 |
| --- | --- | --- |
| 新 session 開始 | `session-start-roadmap-sync.sh` | 跑 `pnpm spectra:followups` 摘要 open 數量 |
| `spectra-archive` 前 | `pre-archive-followup-gate.sh` | marker 未登記 register → `exit 2` 阻擋 |
| 手動 | `pnpm spectra:followups` | 詳細報告；`--fail-on-drift` 給 CI |

### Claude 主動維護的時機

- 人工檢查發現 deferred / local blocked 項 → 加 marker + 新增 register entry 一次到位
- Archive 前主動跑 `pnpm spectra:followups`，確認無 unregistered marker
- 使用者說「這個之後再弄」→ 提醒要建 TD-NNN entry

### 禁止事項

- **NEVER** 在 archive 前繞過 `pre-archive-followup-gate.sh`
- **NEVER** 為了通過 gate 而寫內容空洞的 register entry（Problem / Fix / Acceptance 必須具體）
- **NEVER** 在多個 register 以外的地方重複維護 follow-up 清單（single source of truth）

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

v1.6+: `pnpm spectra:roadmap` 每次執行都是完整操作（無 mtime fast-path、無 `--force`
flag）。park / unpark 後直接跑 `pnpm spectra:roadmap` 即可。

### MANUAL 區塊 drift 偵測（v1.6+）

每次 sync 時會另外掃 MANUAL 區塊，對照以下三種 ground truth 找出過時內容：

| Drift 類型 | 偵測條件 | Ground truth |
| --- | --- | --- |
| `archived-as-active` | MANUAL 提到某 change 名稱，語意又稱之為「進行中 / draft / open / wip」 | `openspec/changes/archive/` 目錄 |
| `td-status-mismatch` | MANUAL 提到 `TD-NNN` + active 語意詞，但 register 標 done/wontfix | `docs/tech-debt.md` Status |
| `version-mismatch` | MANUAL 以「Production 跑 vX.Y.Z」/「目前 vX.Y.Z」敘述版本 | `package.json` `version` |

**Drift 不自動改寫 MANUAL**（避免誤刪人寫內容），以 stderr 警告提示。Claude 看到
drift warning 時**必須**主動更新 MANUAL 區塊（Current State / Next Moves），
並在回應中告知使用者已修正哪些過時敘述。

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

1. 跑 `pnpm spectra:roadmap` — v1.6+ 每次皆完整 sync，無需 `--force`
2. Read `<openspec>/ROADMAP.md` — 取得當前內容進入 context
3. 回報五件事：
   - **Active Changes 摘要** — 每個 change 的 stage + 進度 + 觸動的 specs
   - **Parallelism 訊號** — 有無 mutex / blocked，能並行推進哪幾條線
   - **Parked Changes** — 有無暫存的 change 需要使用者決定 unpark / archive / 放著
   - **MANUAL drift warnings** — 若 sync stderr 有 drift 警告，先依警告修正 MANUAL 再回報
   - **Next Moves 狀態** — MANUAL backlog 有什麼項目，是否有本次對話該主動補進去的

**只 sync、不回報**：使用者說「sync roadmap」/「跑 spectra:roadmap」時，只執行第 1 步並簡報一行結果（含 drift 摘要若有），**不**繼續讀 + 分析。

**單純查詢、不強制 sync**：使用者只說「roadmap 裡有什麼」等純查詢問句時，可依賴最近一次 hook 觸發的結果直接 Read。

### 禁止事項

- **NEVER** 手編 `<!-- SPECTRA-UX:ROADMAP-AUTO:* -->` 區塊內容 — 會被下次 sync 覆寫
- **NEVER** 把 AUTO 區塊的 active changes 複製到 MANUAL 區塊
- **NEVER** 為了填滿 Next Moves 編造使用者未提過的意圖
