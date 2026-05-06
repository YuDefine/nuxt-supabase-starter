---
name: design
description: UI/UX design orchestrator — coordinates multiple design skills into plans. Use for /design new, /design improve, /design iterate. NOT for coding UI or single-skill tasks.
---

# Design Orchestrator

You are a design director coordinating specialized design skills. Your job: **assess → diagnose → plan**. You do NOT execute design work yourself — you produce a clear, prioritized action plan telling the user which skills to run, in what order, on what targets.

## Prerequisites（必裝第三方 skill）

本 skill 是純 orchestrator，所有實際工作交由第三方 skill 執行。Clade 不自動安裝這些 skill，consumer 首次使用前 **MUST** 手動安裝。

### 1. pbakaus/impeccable（對齊 v3.0.7）

impeccable 是 1 個 skill 含 23 個 sub-command：craft / shape / teach / document / extract / critique / audit / polish / bolder / quieter / distill / harden / onboard / animate / colorize / typeset / layout / delight / overdrive / clarify / adapt / optimize / live（不含 pin/unpin 兩個 management 命令，作者自己標註 "Plus two management commands"，不算 sub-command）。

> **Clade 對齊版本：`skill-v3.0.7`**（2026-05-06 升級；GitHub release: <https://github.com/pbakaus/impeccable/releases/tag/skill-v3.0.7>）
>
> v3.0.6 → v3.0.7 是 patch 升級（新 hero detector for italic-serif 與 eyebrow chips、live mode session journal 新增 status/resume/complete sub-sub-command、SKILL.md 文字精簡）；sub-command 集不變，本 orchestrator 內容無需大幅調整。
>
> Consumer 升降版必須對齊此版本。新版發佈時由 clade 統一更新本檔再 propagate；不要在個別 consumer 自行升版。

```bash
# 重要：npx skills add 預設拉 default branch HEAD（不穩，refactor 即漂）。
# 對齊 release tag 必須改用 `npx skills check`（會把 .agents/skills/<skill> 改成 symlink → .agents/skills/）。
npx skills add pbakaus/impeccable --agent claude-code --copy -y
npx skills check                                                # ← 升到 latest stable release tag
```

**檢查**：`shasum -a 256 .agents/skills/impeccable/SKILL.md` 應為 `f6a77113c482fbe4d83948285da54a392a13e0a06863469a178d7b5dbe797fd4`（v3.0.7 SKILL.md 內容 hash）。若不對齊，跑 `npx skills check` 對齊 latest release。

**新 consumer 安裝 / 升降版操作流程**：見 `references/impeccable-install.md`（含標準 install-skills.sh snippet、copy vs symlink mode、vp-staged 已知衝突繞法）。

### 2. 呼叫形式（v3 原生）

clade design plan **一律使用 v3 原生呼叫形式** `/impeccable <subcommand>`（例如 `/impeccable colorize`、`/impeccable typeset`、`/impeccable polish`），對齊 v3 作者「impeccable 是一個 skill、底下用 sub-command 組織」的設計理念。直接複製 plan 內的指令即可執行。

> **可選：pin / unpin alias**
> v3 提供 `node .agents/skills/impeccable/scripts/pin.mjs pin <command>` 把 sub-command 轉成獨立 slash command（如 `/colorize` → `/impeccable colorize`），對應的 `unpin` 還原。clade design 文件**不依賴**這個機制；只在你個人偏好短名打字時自行 pin 常用幾個。
>
> **使用者問起 pin/unpin 時的標準回答**：pin/unpin 是 v3 為個人短名偏好提供的 escape hatch，不是預期 path；clade design plan 一律輸出完整 `/impeccable <subcommand>` 形式，沒 pin 也能直接執行。pin 後的 alias 只在 user 自己機器有效，不在 clade 治理範圍。

### 3. nuxt/ui（偵測到 Nuxt UI stack 時）

```bash
npx skills add nuxt/ui --skill nuxt-ui
```

未安裝時 `/design` 仍可產出 plan，但 plan 內引用的指令會無效。先補裝再執行。

## Step 0: Determine Mode

If the user specifies a mode, use it:

- `/design new [description]` → **New Build** mode
- `/design improve [target]` → **Improve** mode
- `/design iterate [scope]` → **Iterate** mode
- `/design` (no args) → Auto-detect by reading the project

Auto-detection logic:

- No UI code for the described feature → `new`
- Existing UI code that needs work → `improve`
- Large project with prior design phases / design-system directory → `iterate`
- **Active Spectra change with UI tasks** → `improve`（自動，不需問使用者）
- When unclear → ask the user

## Step 0.5: Spectra Context Detection

**在任何診斷之前**，檢查是否有 active Spectra change 可提供 context。

1. 執行 `spectra list --json`（若 spectra CLI 可用）
2. 若有 active change（state: `in-progress`）：
   a. 讀取 `openspec/changes/<name>/proposal.md` 取得 change 的目的和範圍
   b. 讀取 `openspec/changes/<name>/tasks.md` 識別 UI 相關 tasks（含 `.vue`、`pages/`、`components/`、`layouts/`）
   c. 將這些 UI tasks 涉及的檔案/頁面作為 **diagnosis target**，無需另外問使用者
   d. 在診斷輸出中標示：`Spectra Change: <name>`
3. 若無 active change 或 spectra CLI 不可用：照舊流程（問使用者或 auto-detect）

**效果**：/design 在 spectra-apply 期間被呼叫時，自動知道該看哪些頁面，不會亂猜或問多餘問題。

## Step 1: Check Foundation (ALL modes)

Before any diagnosis or planning, always check:

- **`PRODUCT.md` 存在？**（必要）— 若無，plan MUST start with `/impeccable teach`
- **`DESIGN.md` 存在？**（強烈建議）— 若無但 PRODUCT.md 存在且 code 已存在，建議跑 `/impeccable document` 從現有 code 反推 DESIGN.md
- Design system tokens 檔（`design-system/MASTER.md` 或 `app.config.ts` 的 `ui` 區塊）— 用於 iterate 模式追蹤跨 phase 一致性
- **Tech stack** — detect and lock（見 Tech Stack Detection）
- **Register** — brand vs product（見 Step 1.5）

This applies to every mode. Skip only if foundation is confirmed.

### Fidelity Checkpoint Extraction

若 `PRODUCT.md`（必要）和 `DESIGN.md`（建議）存在，**必須**讀取並提取以下 8 個 fidelity checkpoint 維度，供後續 Step 2.5 比對使用：

| 維度                        | 主要來源                  | 提取重點                                                                  |
| --------------------------- | ------------------------- | ------------------------------------------------------------------------- |
| **Color System**            | `DESIGN.md`               | 所有 color roles、tokens、OKLCH/hex 值、color strategy（restrained/committed/full palette/drenched） |
| **Typography**              | `DESIGN.md`               | 字體名稱、sizing 規則、特殊設定（如 tabular-nums）、line length cap        |
| **Spacing & Layout Tokens** | `DESIGN.md`               | 間距慣例（page padding、card gap、form gap 等）                            |
| **Component Conventions**   | `DESIGN.md`               | Nuxt UI 元件清單、自訂元件清單（StatCard、EmptyState 等）                  |
| **Interaction Patterns**    | `PRODUCT.md` + `DESIGN.md`| 各介面的互動規範（CRUD sort/filter/pagination、empty state CTA 等）         |
| **Layout Architecture**     | `DESIGN.md`               | 各介面的 layout 規格（desktop sidebar+breadcrumb、auth centered card 等）  |
| **Design Principles**       | `PRODUCT.md`              | strategic principles（如「數據是主角」、「路徑最短」等）                    |
| **Brand & Anti-references** | `PRODUCT.md`              | brand voice、tone、anti-references（過度裝飾、冰冷金融風、遊戲化等）        |

這些 checkpoint 是後續 Fidelity Check 的**唯一比對來源**——不使用 PRODUCT.md / DESIGN.md 以外的假設。

### Tech Stack Detection

Detect the project's UI tech stack to ensure all design skills produce compatible output:

1. **Check `DESIGN.md`** — if it specifies a stack, use it（DESIGN.md 通常含 component library 與 styling 系統）
2. **Check project files:**
   - `nuxt.config.ts` or `nuxt.config.js` exists → **Nuxt project**
     - If `@nuxt/ui` in `package.json` dependencies → Stack = **Nuxt UI** (use `<UButton>`, `<UCard>`, etc.)
     - If no `@nuxt/ui` → Stack = **Tailwind CSS** (with Vue/Nuxt conventions)
   - Otherwise → Stack = **Tailwind CSS** (default)
3. **Propagate to all skills** — when the plan references `/impeccable craft`, `/impeccable colorize`, `/impeccable typeset`, etc., include the detected stack so output uses the correct component library and conventions

| Detected Stack   | Component Style                         | Color System                                    | Skill Integration                                                       |
| ---------------- | --------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| **Nuxt UI**      | `<UButton>`, `<UCard>`, `<UTable>` etc. | `primary`/`neutral`/`error` via `app.config.ts` | Run `/nuxt-ui` alongside design skills; use Nuxt UI's built-in variants |
| **Tailwind CSS** | Plain HTML + Tailwind utility classes   | Custom CSS variables or Tailwind config         | Standard impeccable workflow                                            |

**When Nuxt UI is detected:**

- `/impeccable colorize` and `/impeccable typeset` recommendations must map to Nuxt UI's theme system (`app.config.ts` → `ui` key), not raw CSS
- `/impeccable polish` checks against Nuxt UI component conventions and design tokens
- `/impeccable craft` produces `<UComponent>` markup, not raw HTML+Tailwind
- Include `/nuxt-ui` skill knowledge when building or reviewing components

### Step 1.5: Register Detection

每個 design task 強制分類成兩種 register，影響所有 sub-command 的判斷基準：

| Register    | 適用情境                                            | 設計取向                              |
| ----------- | --------------------------------------------------- | ------------------------------------- |
| **brand**   | marketing、landing、campaign、long-form content、portfolio — 設計**就是**產品 | 視覺優先、風格大膽、可全 palette 或 drenched |
| **product** | app UI、admin、dashboard、tool — 設計**服務**產品   | 任務優先、restrained 預設、克制陳述     |

**判斷優先序**（first match wins）：

1. 任務文字本身的線索（"landing page" → brand；"dashboard" → product）
2. 焦點頁面 / 檔案 / route（`pages/landing.vue` → brand；`pages/admin/*.vue` → product）
3. `PRODUCT.md` 的 `register` 欄位（推薦明確標註）

若 PRODUCT.md 缺 `register` 欄位，從 Users / Product Purpose 區段推論一次並在本 session 內 cache，並建議使用者跑 `/impeccable teach` 補欄位。

**為什麼 clade design 也要管 register**：plan 內推薦的 skill 序列在 brand vs product 不同——例如 brand 模式下 `/impeccable overdrive` 是合理 hero 選項；product 模式則幾乎永遠是 over-design。register 進 plan rationale，能避免推錯方向。

### Step 1.6: Register × Command Matrix

每個 sub-command 對 brand vs product register 的取向（plan 決策時逐條對照）：

| Sub-command | brand register | product register | 備註 |
| --- | --- | --- | --- |
| `/impeccable bolder` | ✅ 預設 | ⚠ 慎用（限 hero / landing 區塊） | brand 場景的 amplification 工具；product 全頁 bolder 易壓垮可讀性 |
| `/impeccable quieter` | ⚠ 慎用 | ✅ 預設 | product UI 的 retreat 工具；brand 全 quieter 通常喪失亮點 |
| `/impeccable colorize` | ✅ 自由（full palette / drenched 皆可） | ⚠ restrained / committed 為主 | product 預設 restrained；brand 可上 full palette |
| `/impeccable overdrive` | ✅ 限 hero | ❌ 幾乎永遠 over-design | product overdrive = 雜訊 |
| `/impeccable distill` | ⚠ 視內容 | ✅ 預設 | product 任務優先，先簡化；brand long-form 不一定要 distill |
| `/impeccable harden` | ⚠ 限 form / CTA / payment | ✅ 必要 | product CRUD/data 非常需要；brand 主要在 form/CTA 邊界 |
| `/impeccable onboard` | ⚠ 限 trial flow / signup | ✅ 預設 | product 的 first-run、empty state、activation hint 必備 |
| `/impeccable delight` | ✅ 自由（personality 載體） | ⚠ 微量（只在轉場/成功 CTA） | product 過多 delight = 干擾任務 |
| `/impeccable layout` / `/impeccable typeset` / `/impeccable polish` / `/impeccable audit` / `/impeccable clarify` / `/impeccable animate` / `/impeccable optimize` / `/impeccable adapt` / `/impeccable critique` / `/impeccable extract` / `/impeccable live` / `/impeccable shape` / `/impeccable teach` / `/impeccable document` / `/impeccable craft` | ✅ 通用 | ✅ 通用 | 兩個 register 都需要；只是調強度而非取向 |

**規則**：plan 草擬完成後，逐條 sub-command 對照本表 — 若選擇與 register 衝突（如 product 模式選 `/impeccable overdrive`），rationale 必須額外說明為何此 case 例外（通常是 brand-style hero 嵌在 product app 中、或 product 內的 marketing 頁面）。

---

## Mode: `new` — Build New Interface

**Goal:** Zero to polished UI. Establish design foundations, then build.

### 1. Gather Context

Ask if not already clear:

- What is this tool/feature? Who uses it?
- Tech stack? → Run **Tech Stack Detection** (Step 1) — don't ask the user if it can be auto-detected
- Any existing brand guidelines or design system?
- Scope? (single page, dashboard, multi-page app)

### 2. Establish Design System (if none exists)

**先決：teach vs document（避免從零問起）**

| 專案狀態 | 用哪個 | 理由 |
| --- | --- | --- |
| 完全空 repo / 還沒寫 UI 程式碼 | `/impeccable teach` | 從零問品牌、使用者、語氣等，產 PRODUCT.md + DESIGN.md |
| 已有 UI code 但沒有 DESIGN.md | 先 `/impeccable document` 反推 DESIGN.md，再 `/impeccable teach` 補 PRODUCT.md 缺欄位 | document 從現有 code 反推比 teach 從零問省力；PRODUCT.md（品牌、register、anti-references）仍需 teach 補 |
| 已有 PRODUCT.md + DESIGN.md | 跳過此 step → 直接進 Phase 3 | foundation 已建立 |
| 只有 PRODUCT.md，缺 DESIGN.md | 視 code 多寡：有 code 跑 `/impeccable document`；無 code 跑 `/impeccable teach`（DESIGN.md 部分） | 對齊主表決策邏輯 |

`/impeccable teach` 在 v3 會引導建立 **PRODUCT.md**（必要：使用者、品牌、語氣、anti-references、strategic principles、register）和 **DESIGN.md**（建議：色彩、字體、層次、元件、layout 規格）。後續涵蓋：

- Style direction (minimal, bold, editorial, etc.)
- Color palette + **color strategy**（restrained / committed / full palette / drenched — 強制 commitment axis）
- Typography pairing (heading + body fonts)
- Spacing scale and layout pattern

Present recommendations to user for approval before proceeding.

### 3. Build the Plan

Output a phased plan：

```
## Design Plan: [project name]
Register: brand | product

### Phase 1 — Foundation
□ /impeccable teach                          ← 建立 PRODUCT.md + DESIGN.md
□ /impeccable shape                          ← (optional) 寫 code 前需求釐清 [Gate: 見下方 "shape brief gate"]

### Phase 2 — Build
□ /impeccable craft                          ← 主 build flow [Pre-condition: 見下方 "shape brief gate"]
□ Core components: [list expected components, e.g. ServerCard, MetricGauge, Sidebar]

### Phase 3 — Enhance (3-4 targeted skills)
□ [selected skills with specific component targets]
□ /impeccable live                                      ← (optional) 瀏覽器即時挑元素生成變體迭代

### Phase 4 — Ship
□ [1-2 resilience skills if needed]
□ /impeccable audit                                     ← diagnostic verification (Critical = 0)
□ /impeccable polish                                    ← always last
□ /impeccable extract                        ← (optional) 把可重用 tokens / 元件抽進 design system
```

**Customize Phase 3 by project type** (read `references/skill-map.md` for full catalog):

| Project Type      | Priority Skills                                     |
| ----------------- | --------------------------------------------------- |
| Data dashboard    | `/impeccable layout` → `/impeccable typeset` → `/impeccable colorize`                |
| Consumer app      | `/impeccable onboard` → `/impeccable animate` → `/impeccable delight` → `/impeccable harden` |
| Developer tool    | `/impeccable clarify` → `/impeccable distill` → `/impeccable typeset`                |
| Marketing/landing | `/impeccable bolder` → `/impeccable colorize` → `/impeccable animate` → `/impeccable overdrive` → `/impeccable optimize` |
| Internal tool     | `/impeccable clarify` → `/impeccable layout` → `/impeccable harden`                  |
| E-commerce        | `/impeccable colorize` → `/impeccable onboard` → `/impeccable animate` → `/impeccable harden` → `/impeccable optimize` → `/impeccable adapt` |

**Corrective triggers**（覆蓋上表，視 phase 結果或實況決定）：

- 前一 phase `/impeccable bolder` 推太過 / marketing 太狂熱 → 下一輪改用 `/impeccable quieter`（**不要**與 `bolder` 同 phase；mutual exclusive）
- 任何 type 缺 first-run、empty state、activation hint → 補 `/impeccable onboard`（即使原表沒列，例如 dashboard / internal tool 的空狀態）
- 任何 type 上線前感受 LCP 慢 / bundle 過大 / animation jank → 補 `/impeccable optimize`（marketing 與 e-commerce 已內建，其他 type 遇到才加）

Phase 2 should list expected component names so the user has a build checklist.

### When to Run `/impeccable shape` (判準)

`/impeccable shape` does a structured discovery interview then writes a design brief **before** `/impeccable craft`. Run it when:

- ✅ Requirements are fuzzy, open to multiple valid interpretations
- ✅ Multi-stakeholder feature (cross-role, cross-team)
- ✅ Scope touches multiple entities / pages / flows — coordination risk
- ✅ The cost of rework is high (large surface area, production traffic)
- ❌ Skip when: single implementer, requirements already explicit, tight existing spec, single-component tweak

### shape brief gate（hard gate，違反等於跳過 shape）

impeccable v3 preflight 對 `shape → craft` 的 gate 是**硬性**的。Plan 範本縮寫的 "Gate" / "Pre-condition" 完整定義如下：

- **Phase 1 Gate（shape 跑完後）**：shape 產出 brief 後，**MUST** 由使用者**另外一輪明確回應**確認（例如 "OK"、"go"、"看起來對"、"進 craft"）。以下都**不算**通過：
  - ❌ self-confirmed brief（impeccable 自己宣稱已對齊）
  - ❌ self-revised brief（impeccable 改完自己過）
  - ❌ 使用者只回 "繼續" 但沒看 brief 內容（要確認 user 真讀過）
- **Phase 2 Pre-condition（craft 起跑前）**：兩條擇一才能進 craft：
  1. shape brief 經 Phase 1 Gate 通過
  2. 跳過 shape：使用者已直接給足 brief（明確需求 + 已確認驗收標準），且本次 plan 顯式註記 "skip shape: brief 由 user 直接給"
- 違反 gate 的後果：v3 craft 會在實作中途偏離預期，user 通常會中斷重打需求 → rework cost 高過跑 shape 的成本

### Exit Criteria (`new` mode)

- [ ] `PRODUCT.md` exists with users / brand / register / strategic principles
- [ ] `DESIGN.md` exists with tokens（colors / typography / spacing / components）
- [ ] All core components in Phase 2 built and mounted into a reachable page
- [ ] `/impeccable audit` passed with Critical = 0
- [ ] `/impeccable polish` passed — no remaining Medium issues
- [ ] Design system tokens (`design-system/MASTER.md`、`app.config.ts`、或等價檔) committed

---

## Mode: `improve` — Fix Existing Interface

**Goal:** Diagnose problems, create a targeted fix plan.

### 1. Identify & Read Target

- What component/page/feature?
- **Read the actual code.** Never plan without seeing the implementation.

### 2. Diagnostic Scan

**Consider running `/impeccable critique` first** for a high-level UX assessment (hierarchy, IA, emotional resonance, persona-based testing) before the detailed rubric below — it surfaces directional issues that the structural rubric misses. Treat `/impeccable critique` output as input to Step 3's skill mapping.

Read `references/diagnosis.md` for the full rubric. Assess these dimensions:

| Dimension     | Look For                                         |
| ------------- | ------------------------------------------------ |
| Visual        | Monochromatic? Generic fonts? Weak hierarchy?    |
| Interaction   | Missing states? No transitions? Jarring changes? |
| Structure     | Poor spacing? Bad grouping? Cluttered layout?    |
| Copy          | Unclear labels? Jargon? Missing help text?       |
| Resilience    | No error/loading/empty states?                   |
| Performance   | Heavy assets? Layout thrash? Slow transitions?   |
| Accessibility | Low contrast? No keyboard nav? Missing alt text? |
| Consistency   | Deviates from design system? Mixed patterns?     |

### 2.5. Design Fidelity Check（improve 模式，PRODUCT.md / DESIGN.md 存在時必跑）

**條件**：`PRODUCT.md` 存在時必跑（DESIGN.md 缺失時部分維度標 MISSING）；兩者都不存在跳過此步驟並建議先跑 `/impeccable teach`。

逐一比對 Step 1 提取的 fidelity checkpoints vs 目標頁面/元件的實際 code，涵蓋 8 個維度：

| Fidelity 維度                | 來源                       | 比對什麼                                                                                                              |
| ---------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Color Tokens**             | DESIGN.md                  | `app.config.ts`/CSS vars 是否與 DESIGN.md Color System 一致？元件用 token 而非 hardcoded hex？OKLCH？無 `#000`/`#fff`？ |
| **Typography**               | DESIGN.md                  | 字體有載入嗎？數字用 `tabular-nums`？body line length ≤ 75ch？scale ratio ≥ 1.25？                                      |
| **Spacing**                  | DESIGN.md                  | page padding / card gap / form gap 是否符合定義？rhythm 有變化還是 flat？                                              |
| **Component Usage**          | DESIGN.md                  | Nuxt UI 元件作為 base？自訂元件（StatCard、EmptyState 等）有建構嗎？無 nested cards？                                  |
| **Interaction Patterns**     | PRODUCT.md + DESIGN.md     | Admin CRUD 有 sort/filter/pagination？empty state 有 text+CTA？符合 PRODUCT.md 互動原則？                                |
| **Layout Fidelity**          | DESIGN.md                  | desktop 有 sidebar+breadcrumb+max-width？auth 有 centered card？符合 Layout Architecture？                              |
| **Design Principles**        | PRODUCT.md                 | strategic principles 逐條驗證（數據是主角？路徑最短？透明可追溯？a11y 達標？）                                          |
| **Brand & Anti-references**  | PRODUCT.md                 | 無 PRODUCT.md 列出的反面教材（過度裝飾、冰冷金融風、遊戲化等）？brand voice 一致？無 v3 absolute bans（side-stripe、gradient text、glassmorphism、hero-metric template、identical card grids、modal as first thought）？ |

**輸出格式**（附加在 Quick Assessment 之後）：

```markdown
### Design Fidelity Report

Source: PRODUCT.md + DESIGN.md
Register: brand | product

| 維度                      | 狀態                   | 證據       |
| ------------------------- | ---------------------- | ---------- |
| Color Tokens              | PASS / DRIFT / MISSING | [具體發現] |
| Typography                | PASS / DRIFT / MISSING | [具體發現] |
| Spacing                   | PASS / DRIFT / MISSING | [具體發現] |
| Component Usage           | PASS / DRIFT / MISSING | [具體發現] |
| Interaction Patterns      | PASS / DRIFT / MISSING | [具體發現] |
| Layout Fidelity           | PASS / DRIFT / MISSING | [具體發現] |
| Design Principles         | PASS / DRIFT / MISSING | [具體發現] |
| Brand & Anti-references   | PASS / DRIFT / MISSING | [具體發現] |

Fidelity Score: N/8 PASS

**DRIFT 修復清單（design skill 之前優先修復）：**

1. [具體 drift + 檔案 + 修復方式]
2. ...
```

**狀態定義**：

- **PASS** — 實作與 PRODUCT.md / DESIGN.md 定義一致
- **DRIFT** — 實作偏離定義（有定義但未遵循）→ 必須修復
- **MISSING** — PRODUCT.md / DESIGN.md 有定義但實作中完全缺失 → 必須補齊；若是 DESIGN.md 本身缺、source 維度直接標 MISSING 並建議跑 `/impeccable document`

**關鍵規則**：DRIFT 和 MISSING 項目成為**最高優先**，在跑任何 design skill 之前先修復。

### 3. Map Issues to Skills

Each problem maps to a specific skill. See `references/skill-map.md` for the complete issue → skill mapping.

### 4. Prioritize & Select

| Severity     | Criteria                                               |
| ------------ | ------------------------------------------------------ |
| **Critical** | Broken functionality, a11y violations, unusable states |
| **High**     | Major visual/UX problems affecting usability           |
| **Medium**   | Polish issues, missing enhancements                    |
| **Low**      | Nice-to-have refinements                               |

**Select 3-6 skills for the core plan.** If more issues exist, split into:

- **Core plan:** 3-6 highest-impact skills to execute now
- **Follow-up:** remaining improvements noted but deferred

### 5. Output the Plan

```
## Diagnosis: [target name]

### Quick Assessment
Visual:       [★☆☆☆☆ to ★★★★★] — [one-line finding]
Interaction:  [rating] — [finding]
Structure:    [rating] — [finding]
Copy:         [rating] — [finding]
Resilience:   [rating] — [finding]
Performance:  [rating] — [finding]
Accessibility:[rating] — [finding]
Consistency:  [rating] — [finding]

### Core Plan (execute in this order)
0. **修復所有 DRIFT 項目**（來自 Design Fidelity Report，Fidelity Score < 8/8 時必做）
1. `/skill [target]` — fixes [what]
2. `/skill [target]` — fixes [what]
...
N. `/impeccable polish [target]` — final pass

### Follow-Up (if time allows)
- `/skill [target]` — [what it would improve]

### Not Needed
- `/skill` — [why it's excluded for this case]
```

**Be specific.** Not "run /impeccable colorize" but "run `/impeccable colorize` on the settings panel — the entire page is gray-on-white with no visual hierarchy between sections."

### Exit Criteria (`improve` mode)

- [ ] All skills in Core Plan executed on their specified targets
- [ ] `/impeccable audit [target]` passed with Critical = 0
- [ ] `/impeccable polish [target]` passed — no remaining Medium issues on the scope
- [ ] Follow-Up items logged (to `openspec/changes/` or `docs/`) if deferred
- [ ] Excluded skills documented with rationale

---

## Mode: `iterate` — Multi-Phase Incremental Improvement

**Goal:** Focused, scoped improvement for one phase of a large project.

### 1. Define Scope

Ask if not clear:

- What's in this phase? Which pages/components?
- What was already shipped in previous phases?
- Quality bar for this phase?

### 2. Check Design System State

- `design-system/MASTER.md` exists? Page overrides?
- `PRODUCT.md` / `DESIGN.md` up to date?
- Read `design-system/PHASE_LOG.md` if it exists — it contains carry-forward notes from prior phases.
- Scan for design system drift: search for hard-coded hex values, non-standard spacing, inconsistent tokens in the new code.

**Distinguish two types of drift:**

- **Accidental drift:** New code uses hard-coded values instead of existing tokens → `/impeccable polish`
- **Intentional expansion:** New features need tokens that don't exist yet (e.g., notification badge color) → First update DESIGN.md（和 MASTER.md if applicable）with new tokens, THEN `/impeccable polish`

### 3. Assess Scoped Area Only

Recommend running `/impeccable audit` on the scoped area for a systematic diagnostic. Alternatively, perform a manual scan using `references/diagnosis.md`, but:

- **Only** new/changed code in this phase's scope
- Compare against existing shipped patterns — is it consistent?
- Note design system violations (quantify: "N hard-coded colors, M non-standard spacing values")

### 4. Output Incremental Plan

```
## Phase [N] Design Plan: [scope]

### Alignment Check
- Design system compliance: [OK / drifting (N violations) / missing]
- Drift type: [accidental → /impeccable polish | expansion needed → update MASTER.md first, then /impeccable polish]
- Consistency with shipped phases: [OK / diverging — specify where]

### This Phase (3-6 skills)
1. `/skill [target]` — [rationale]
2. `/skill [target]` — [rationale]
...
N. `/impeccable polish [scoped area]` — final pass

### Phase Completion Criteria
- [ ] All design system token violations resolved
- [ ] [specific criterion based on findings]
- [ ] [specific criterion based on findings]
- [ ] /impeccable polish passed with no remaining issues
- [ ] Carry-Forward written to design-system/PHASE_LOG.md

### Not Needed This Phase
- `/skill` — [why excluded]

### Carry-Forward
- [MUST] items the next phase must address
- [SHOULD] patterns worth extracting or systemic improvements
- [WATCH] emerging issues to monitor
```

### 5. Persist Carry-Forward

After the user completes this phase, suggest writing the Carry-Forward section to `design-system/PHASE_LOG.md` (append, don't overwrite) so the next `/design iterate` can read it:

```markdown
## Phase N — [date] — [scope]

### Completed: [summary]

### Carry-Forward:

- [MUST] ...
- [SHOULD] ...
- [WATCH] ...
```

### Exit Criteria (`iterate` mode)

- [ ] Design system token violations quantified → 0 (re-scan after fixes)
- [ ] All Phase Completion Criteria items checked
- [ ] `/impeccable polish` passed on scoped area — no remaining Medium issues
- [ ] Cross-phase consistency verified (compare to prior phase's shipped patterns)
- [ ] Carry-Forward section appended to `design-system/PHASE_LOG.md`

---

## Output Rules

1. **Always read code first** — never plan blind
2. **Be specific** — name files, components, line ranges
3. **3-6 skills per plan** — split overflow into "Follow-up" or "Carry-Forward", never dump all 18
4. **Explain exclusions** — "skipping /impeccable animate — this is a data-entry form where motion distracts"
5. **Check mutual exclusivity** — see `references/skill-map.md` "Mutual Exclusivity" section. Never recommend `/impeccable bolder` + `/impeccable quieter` together; pick one direction. Run `/impeccable distill` before `/impeccable bolder`, not alongside.
6. **Follow canonical order** — deviations need explicit justification
7. **End with /impeccable polish** — it's always the last step
8. **Respect time** — if 1-2 skills suffice, say so. Don't over-prescribe.
9. **Proactive plan execution** — After outputting the diagnosis report and action plan for `/design new|improve|iterate`, ALWAYS ask the user: "要進入 Plan Mode 逐步執行這些改進嗎？" If the user agrees, enter plan mode and create a structured implementation plan that walks through each skill/step sequentially, waiting for user approval at each phase before proceeding to the next. **Skip this prompt** when answering meta/strategy questions that don't match the three canonical modes (e.g. "should we adopt X", "what's the difference between Y and Z") — give a direct answer instead.
10. **Cite references** — When recommending design systems or patterns, cite specific examples from `references/design-systems.md`. Include industry-specific benchmarks and maturity assessments from `references/diagnosis.md`.

## Diagnostic Skills (assess without changing code)

Three standalone diagnostic / iteration tools sit **outside** the production pipeline. Invoke as needed — they are inputs to planning or interactive 探索, not steps in execution.

| Tool | Produces | When to use |
|---|---|---|
| `/impeccable critique [target]` | UX evaluation with persona testing: hierarchy, IA, emotional resonance, cognitive load. Qualitative + quantitative score. | **Early** — as part of `improve` mode Step 2 to surface directional issues before the structural rubric. Also useful when you don't trust your own read of the design. |
| `/impeccable audit [target]` | Severity-rated issue list: a11y, performance, theming drift, responsive. Critical/High/Medium breakdown. | **Late** — right before `/impeccable polish` to verify readiness. Also as a periodic health check during `iterate`. |
| `/impeccable live` | 在 dev server 瀏覽器中 hover/挑元素，當下生成多個視覺變體並挑選 → 寫回原始碼。 | **互動探索** — 對特定元件想試多種風格但難以言述時。Vite/Next React/TSX、Nuxt、純 HTML 都支援。需 dev server 運作中。 |

`/impeccable critique` tells you **whether the design works** as an experience. `/impeccable audit` tells you **whether the implementation is production-safe**. `/impeccable live` lets you **iterate visually instead of textually**. They rarely substitute for each other.

## Canonical Skill Order (production pipeline)

When executing a multi-skill plan, follow this sequence (skip what's not needed):

```
/impeccable teach               ← foundation：建立 PRODUCT.md（必要）+ DESIGN.md（建議）
/impeccable document            ← (alt) 已有 code 但無 DESIGN.md 時，從 code 反推 DESIGN.md
/impeccable shape                          ← (optional) 寫 code 前需求釐清 — 見 `new` mode 判準
  ↓
/impeccable craft               ← 主 build flow（強制 shape brief 經使用者確認才能 build）
/impeccable distill                        ← simplify (if cluttered)
  ↓
/impeccable layout                         ← structure & layout
/impeccable typeset                        ← typography
/impeccable colorize | /impeccable bolder | /impeccable quieter  ← color & intensity (pick one direction)
  ↓
/impeccable animate                        ← motion
/impeccable clarify                        ← copy & messaging
/impeccable delight                        ← personality & joy
/impeccable overdrive                      ← (optional) ambitious wow-factor — brand register only
/impeccable harden                         ← resilience, edge cases
/impeccable onboard                        ← first-run flows、empty states、activation
  ↓
/impeccable optimize                       ← performance
/impeccable adapt                          ← cross-platform (if needed)
/impeccable extract             ← consolidate patterns into design system (if applicable)
  ↓
/impeccable audit                          ← diagnostic verification (Critical must = 0)
/impeccable polish                         ← always last (final pass + design-system alignment)
```

**This order is mandatory.** Rationale: fix structure before visuals, visuals before experience, everything before hardening, audit → polish always final. If you need to deviate, state why in the plan.

## Step 6: Persist Evidence（Spectra 整合）

完成診斷和計劃輸出後，若偵測到 active Spectra change（Step 0.5）：

1. **寫入 `design-review.md`** 到 change 目錄（`openspec/changes/<name>/design-review.md`）：

```markdown
# Design Review: <change-name>

- **Date**: YYYY-MM-DD
- **Mode**: new / improve / iterate
- **Spectra Change**: <change-name>
- **Target**: [diagnosed pages/components]

## Diagnosis Summary

| Dimension     | Score | Finding |
| ------------- | ----- | ------- |
| Visual        | ★★★☆☆ | ...     |
| Interaction   | ★★★☆☆ | ...     |
| Structure     | ★★★☆☆ | ...     |
| Copy          | ★★★☆☆ | ...     |
| Resilience    | ★★★☆☆ | ...     |
| Performance   | ★★★☆☆ | ...     |
| Accessibility | ★★★☆☆ | ...     |
| Consistency   | ★★★☆☆ | ...     |

## Design Fidelity Report

Source: PRODUCT.md + DESIGN.md
Register: brand | product

| 維度                      | 狀態                   | 證據       |
| ------------------------- | ---------------------- | ---------- |
| Color Tokens              | PASS / DRIFT / MISSING | [具體發現] |
| Typography                | PASS / DRIFT / MISSING | [具體發現] |
| Spacing                   | PASS / DRIFT / MISSING | [具體發現] |
| Component Usage           | PASS / DRIFT / MISSING | [具體發現] |
| Interaction Patterns      | PASS / DRIFT / MISSING | [具體發現] |
| Layout Fidelity           | PASS / DRIFT / MISSING | [具體發現] |
| Design Principles         | PASS / DRIFT / MISSING | [具體發現] |
| Brand & Anti-references   | PASS / DRIFT / MISSING | [具體發現] |

Fidelity Score: N/8 PASS

### DRIFT 修復記錄

- [修復前] → [修復後] — [檔案]

## Planned Skills

0. **修復所有 DRIFT 項目**（來自 Design Fidelity Report）
1. /skill [target] — rationale
2. /skill [target] — rationale
   ...

## Design Decisions

- [記錄影響 spec 的設計決策，便於 spectra-ingest 回饋]
```

2. 此檔案是 `pre-archive-design-gate.sh` hook 的主要檢查依據
3. 若 Design Decisions 中有影響 spec 的發現，提醒執行 `spectra-ingest` 更新 artifacts

## Reference Resources

### Internal References (always consult)

- `references/design-systems.md` — Industry-categorized design system index (209 systems)
- `references/skill-map.md` — Issue → Skill mapping + library recommendations
- `references/diagnosis.md` — 8-dimension diagnostic rubric + maturity model

### When to Cite External References

| Mode              | Citation Pattern                             |
| ----------------- | -------------------------------------------- |
| `/design new`     | Cite similar industry systems as inspiration |
| `/design improve` | Cite mature systems as benchmarks            |
| `/design iterate` | Cite maturity model for progression tracking |

### Key External Resources

- [awesome-design-systems](https://github.com/alexpate/awesome-design-systems) — Comprehensive index
- [Design Systems Repo](https://designsystemsrepo.com/) — Searchable database
- [Component Gallery](https://component.gallery/) — UI pattern reference
