---
description: UI 工作的 impeccable 修改閉環（找問題 → 專科修 → 沉澱）、P0–P3 問題族 × 專科指令對照、Design Review tasks 模板、design-review.md 證據與 Design Gate、非 UI exception；動 UI 檔或寫 design artifact 時 path-scoped 載入
paths: ['app/**/*.vue', 'packages/*/app/**/*.vue', 'app/**/*.ts', 'packages/*/app/**/*.ts', 'components/**', 'packages/*/components/**', 'pages/**', 'packages/*/pages/**', 'layouts/**', 'packages/*/layouts/**', 'specs/plans/**', 'docs/specs/**/spec.md']
---
<!-- Clade native rule; source: rules/core/proactive-skills.design-checkpoint.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

# Proactive Skills — Design Checkpoint（impeccable 修改閉環）

> [[proactive-skills]] 的 reference 檔：動 UI 檔或寫 design artifact 時，用 impeccable 跑完「找問題 → 專科修 → 沉澱」閉環。

## 觸發條件

**任何實作 task 碰到 UI 工作**（建立/修改 `.vue`、pages、components、layouts）時進入 Design Checkpoint。**每一個**這樣的 task 都適用，不是只有整包工作的最後一個。task 標 done 之前閉環要走完（見 § Design Review Task Template）。

## 入口：不知道下一步就跑無參數 `impeccable`

**NEVER** 照一張靜態順序表逐支跑 impeccable 指令。不確定下一步時跑**無參數** `impeccable`：它讀 `impeccable signals`（有沒有 critique 快照、快照的 P0／P1、`git.changedFiles`、dev server 是否在跑）與 `impeccable detect` 的結果，推 2–3 支指令，不自動執行。照它的推薦挑，偏離時在 `design-review.md` 寫一行理由。

每個 session 做 UI 前先讓 impeccable 載入脈絡（`impeccable context`，skill 的 Setup 會自己跑）：

| context 回報 | 先做 |
| --- | --- |
| `NO_PRODUCT_MD` | `impeccable init` 建 PRODUCT.md |
| 有 code、沒有 DESIGN.md | `impeccable document` 從 code 反推 |
| `MANUAL_DETECTOR_REQUIRED`（這個 runtime 沒有自動 detector hook，例如 Codex） | 收尾前手動跑一次 `impeccable detect --json <變更的 UI 檔>` |

## 閉環三階段

| 階段 | 做什麼 | 產出 |
| --- | --- | --- |
| 1 找問題 | `critique <surface>`（使用者角度，P0–P3，寫 `.impeccable/critique/` 快照並留趨勢）＋ `audit <surface>`（工程角度：a11y、RWD、對比、點擊範圍）；detector hook 在每次編輯時已跑機械層 | critique 快照、audit 報告 |
| 2 專科修 | 依下表**一個問題族對一支指令**、只動指定範圍，從 P0 往 P3 修；`polish` 永遠最後，它讀快照當 backlog，清完就 `critique-storage close` | 修正後的 UI、已關閉的快照 |
| 3 沉澱 | 本輪動到 token 或建立新元件慣例 → `document`（更新 DESIGN.md）或 `extract`（抽進 design system）；刻意保留的發現寫 `.impeccable/critique/ignore.md`；detector 例外**只在使用者確認後**用 `impeccable hooks ignore-value` | 更新的 DESIGN.md／ignore 紀錄 |

下一個畫面的 `impeccable context` 會自動載入更新後的 DESIGN.md，閉環回到起點。

### P0–P3 問題族 × 專科指令

| critique／audit 指出的問題族 | 專科指令 |
| --- | --- |
| 死路、使用者不知道下一步、首次使用或空狀態沒引導 | `clarify`／`onboard` |
| 主次不分、視覺噪音過多（或反過來：平淡沒重點） | `quieter`（或 `bolder`） |
| 冗言、重複資訊、元素過多 | `distill` |
| 字級、字重、行高層次 | `typeset` |
| 間距、對齊、版面結構 | `layout` |
| 色彩與對比、品牌色使用 | `colorize` |
| 邊界狀況（空、錯、載入、超長內容、權限） | `harden` |
| 跨裝置、斷點 | `adapt` |
| 動效與過場 | `animate` |
| 效能（首屏、互動延遲） | `optimize` |
| 語意說不清、要看到才能判斷 | `live`（瀏覽器內即時出變體）或 `generate`（對指定元素出一批變體）讓使用者挑 |
| 全路徑收尾 | `polish`（最後，關閉快照） |

互斥：`bolder` 與 `quieter` 選一個方向；`distill` 先於 `bolder`；減弱（`quieter`）時不加色（`colorize`）。

`clarify` 或任何改 UI 文案的指令，文案語氣照 [[ui-copy-tone]]——impeccable 不懂「避免軟體開發英文、行業詞依 PRODUCT.md Users 判」這條 fleet 規則。

### 新畫面與方向未定

PM 確認前要給可審查的設計證據時：`shape` 釐清需求，new-work 的方向回合（impeccable 用 `serve-question` 自己開本機決策頁，**NEVER** 轉接到其他決策頁）；方向說不清就 `live`／`generate` 出變體。Nuxt UI 專案的元件選擇照 [[nuxt-ui-mcp]] § Component Candidates。

## Design Review Task Template

**產出或手寫 tasks 檔時**，若這次工作涉及 UI（清單中提及 `.vue`、`pages/`、`components/`、`layouts/`），**必須**在該 tasks 檔加入 Design Review 區塊。

位置：最後一個功能區塊之後、`## 人工檢查` 之前。編號：N = 上一個功能區塊的序號 + 1。

```markdown
## N. Design Review

- [ ] N.1 `impeccable context`：缺 PRODUCT.md 跑 `init`；有 code 缺 DESIGN.md 跑 `document`
- [ ] N.2 `critique` ＋ `audit` [affected surfaces]（critique 快照路徑記進 design-review.md）
- [ ] N.3 依 P0 → P3 逐族跑專科指令（說不清的走 `live`／`generate`）
- [ ] N.4 `polish` [affected surfaces]，清完 `critique-storage close` 關閉快照
- [ ] N.5 `impeccable detect --json [changed UI files]` 乾淨、`audit` Critical = 0
- [ ] N.6 沉澱：`document`／`extract`／`ignore.md`，或在 design-review.md 寫「本輪無 design system 變更」
- [ ] N.7 `/review screenshot` 取證，寫 design-review.md
```

`[affected surfaces]` 替換為此工作實際涉及的頁面／元件。

### 中斷與續跑

N.5 在**所有修正完成後**才跑。中途停下時提示使用者：恢復後從 N.2 重跑 critique，並逐項記錄 P0／P1 的修正與明確 close 證據。本機檔一改，`critique-storage latest` 可能因指紋不同自動寫 `closed: true`；那不代表問題已修，commit 0-B.1 不把它當成通過證據。

## design-review.md（Design Gate 證據）

位置：plan package 為 `specs/plans/<work-id>/design-review.md`；ad-hoc 為 `docs/design-review/<slug>.md`。檔名固定（`residency-classify`、[[nuxt-ui-mcp]] 的 paths 與既有紀錄都認它）。內容記閉環，不貼 critique 全文：

```markdown
# Design Review: <work item>

- **Date**: YYYY-MM-DD
- **Work item**: <work id / slug>
- **Surfaces**: [affected pages/components]

## Stage 1 找問題

| 來源 | 結果 |
| --- | --- |
| critique | 分數 <n>/<max>，P0 <n>／P1 <n>／P2 <n>／P3 <n>；快照 `.impeccable/critique/<file>` |
| audit | Critical <n>／其他 <n> |
| detect | <n> findings（或「乾淨」） |

## Stage 2 專科修

| 問題族 | 指令 | 範圍 | 結果 |
| --- | --- | --- | --- |
| 主次不分 | `quieter` | `app/pages/orders.vue` 篩選列 | 已修 |

polish：已關閉快照 `<file>`（或：未關閉，理由）

## Stage 3 沉澱

- DESIGN.md：已更新（`document`）／本輪無 design system 變更
- ignore.md／`ignore-value`：<條目與使用者確認紀錄>，或「無」

## 截圖證據

- `/review screenshot` 產出路徑與判讀結論
```

影響 spec 的設計發現照 § Design → 規格回饋迴路處理，**NEVER** 就地改 `specs/truth/**`。

## Design → 規格回饋迴路

Design 工作可能發現 spec 未涵蓋的問題。**每一次**發現都按下表回饋，不是等收尾一起處理：

| 情境 | 動作 |
| --- | --- |
| critique／audit 發現 spec 未涵蓋的 UX 需求（如缺 empty state、缺 loading 狀態） | 回交 `/dsl-refine` 更新 truth feature；**NEVER** 就地改 `specs/truth/**` |
| audit 發現需要新元件或新 API endpoint | 在當前 tasks 檔加一條 task；動到 API 契約時先改 `specs/api/**`（per [[specformula]] spec-first） |
| Design 決策影響資料模型或 API schema | 依 [[knowledge-and-decisions]] 記 ADR（**NEVER** 在 `docs/decisions/` 開新檔）→ 由 owner skill 落 `specs/data/**` / `specs/truth/**` |
| 修正範圍超出原工作 scope | 停下，通知使用者，可能需要另開一個 work item |

## Design Gate（交付人工檢查前的硬門檻）

**把一件含 `.vue` 變更的工作交付人工檢查（或標 `work.done`）之前**，MUST 自己核對：

1. **`design-review.md` 存在且三階段都有紀錄**——Stage 1 有 critique 快照路徑與 P0–P3 計數；Stage 2 逐項記錄 P0／P1 修正、polish 與明確 close 的快照路徑，或使用者確認的 ignore；單有 `closed: true` 不算；Stage 3 有 DESIGN.md 更新或「本輪無 design system 變更」一行
2. **Design Review tasks 全部完成**——tasks 檔的 `## Design Review` 區塊中所有 checkbox 為 `[x]`

兩項都成立，且 `## 人工檢查` 不留白，才可交付。任一不成立 → **STOP**，補完再交付。commit 端的唯讀快照處置檢查在 commit skill `gates.md` § 0-B.1。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | informational — **不觸發任何東西**。沒有 detector 掛在「交付人工檢查」這個事件上（commit 0-B.1 只擋 commit） |
| 消費端 | 正要把含 UI 變更的工作交付人工檢查、或標 `work.done` 的那個 agent（本節） |
| 載入路徑 | 本節（`rules/core/proactive-skills.design-checkpoint.md`，path-scoped 於 UI 檔與 `specs/plans/**`） |

**NEVER** 把「沒有 hook 擋我」讀成這道門檻不存在——它唯一的執行者是讀到本節的那個 agent。

## 跨工作的整體性

同 layout 已上線的頁面（如共用 `desktop.vue`、`default.vue`）與本次頁面一起跑 `critique` 時，既有頁面的問題記在 `design-review.md` 的獨立段落（建議修，不阻擋本次交付）。整個 app 的健康度診斷就是對全站跑 `critique`／`audit`。

## 純後端工作的例外

工作純後端（migration、API、RLS、config）不觸發 Design Checkpoint，直接走 [[aixbdd-workflow]] 的標準入口順序。判斷依據：tasks 檔中沒有任何 task 涉及 `.vue` / `pages/` / `components/` / `layouts/` 檔案，且 git diff 中無 `.vue` 檔案。
