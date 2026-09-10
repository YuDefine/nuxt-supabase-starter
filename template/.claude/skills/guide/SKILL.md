---
name: guide
description: >-
  Hub skill 地圖：本 repo 實際裝到的 skill 的使用場景、邊界與銜接流程（router，零 context 成本；依 consumer
  manifest 的 modules 分層）。
metadata:
  author: clade
  version: '1.0'
  clade:
    invocation: explicit
    permission_tier: read-only
disable-model-invocation: true
---


# /guide — hub skill 地圖

不確定該用哪個 skill 時打 `/guide`。本 skill 是 router：描述每個 skill 的適用場景與銜接關係，本身不執行任何工作。讀完後直接 invoke 對應 skill。

## 先看這個：本表分層，不是每一支你都裝了

skill 由 consumer manifest 的 `modules` 決定裝哪些（canonical `.clade/manifest.json`，legacy `.claude/hub.json` 仍可讀）。下表的條目帶標記時，**只有宣告對應 module 的 repo 才有那支 skill**——沒宣告就是打了也不存在，不是壞掉：

| 標記 | 需要 manifest 宣告 | 沒宣告的 repo |
| --- | --- | --- |
| 〔aixbdd〕 | `modules.capabilities` 含 `"aixbdd"` | 沒有 `/specify`、`/tasks`、`/implement` 這條需求管線。待辦走 `tasks/` + HANDOFF / tech-debt / ROADMAP，`/work-loop` 照樣能跑 |
| 〔specformula〕 | `modules.capabilities` 含 `"specformula"` | 沒有 `.feature` / `isa.yml` 的 BDD 執行層 |
| 〔nuxt〕 | `modules.framework` = `"nuxt"` | 沒有 Nuxt 專用的稽核與 dev 工具 |
| 〔node〕 | `modules.ecosystem` 含 `"node"` | 沒有 `/version-upgrade`（它綁 npm/pnpm，不是綁 Nuxt） |

無標記的是 hub-core，每個 consumer 都有。**NEVER** 因為本表列了某支就斷定這裡裝了它——以該 repo 的 manifest 為準。

## 主流程（idea → shipped）

一條 change 的完整生命週期，依序銜接：

| 階段 | Skill | 這一站做什麼 |
| --- | --- | --- |
| 提案〔aixbdd〕 | `/specify` | 建 `specs/plans/NNN-<slug>/`：驗收標準與 truth-delta |
| 澄清〔aixbdd〕 | `/clarify-over-specs` | 對 `spec.md` 的模糊處逐項收斂 |
| 驗收 Gherkin〔aixbdd〕 | `/spec-by-example` → `/ui-plan` | 產 `features/acceptance/**` 與靜態雛形 |
| 設計〔aixbdd〕 | `/technical-research`、`/system-analysis` | 定 techstack 與系統設計 |
| 規格落地〔aixbdd〕 | `/dsl-refine` | 把句型寫進 `specs/truth/features/**` 與 `dsl.md` |
| 拆任務〔aixbdd〕 | `/tasks` | 產 plan package 的 `tasks.md`；開工前 `flow open <slug> --origin tasks:<path>` |
| 實作〔aixbdd〕 | `/implement`（`[BDD-GREEN]` 委派 `/bdd`） | 依 `tasks.md` 逐 phase 落 code 與測試 |
| 人工檢查 | `pnpm review:ui`（GUI）；批次前先 `/review-readiness-scan` 看哪些 ready | UI / 資料類 manual review |
| 提交 | `/commit` | 依功能分組走品質閘門提交（所有 commit 的唯一入口） |

不確定專案當前該走哪一站：先讀 `specs/plans/` 最新的 plan package 與它的 `tasks.md`，再按使用者目標接續。沒宣告 aixbdd 的 repo 整條主流程不適用——那裡的生命週期是「待辦來源 → `tasks/<date>-<slug>.md` → `/wt` → `/commit`」。

## On-ramps（從症狀進入）

- **遇到 bug / 異常行為** → 先查根因（`/wt` 隔離後調查）；動到規格才回 `/specify`〔aixbdd〕
- **要看 UI 畫面 / 截圖驗證** → `/review-screenshot`（統一截圖入口；第一手是 Pi `--model gemini --effort high`，見該 skill）
- **專案還沒有可重跑的 app control／feature map** → `/verification-create`（建立 consumer-owned `verify-<app>` skill）
- **既有 verification skill／feature map 要對帳 source 與 live behavior** → `/verification-maintain`（`clean` 是零 branch／零 commit／零 PR 的成功結果）
- **要動 code 而還在 main working tree** → `/wt`（開 worktree 隔離；`/wt A: ... B: ...` 可並行多條 task）
- **implementation plan 內有多個獨立 task 想並行** → `/subagent-dev`（同 session 派 subagent；跨 change 的並行仍走 `/wt`）
- **session 要收尾 / 交接** → `/handoff`（有 in-progress 工作寫交接；沒有則整理 HANDOFF.md 推薦 outstanding）
- **要把待辦無人值守推完**（plan package / tasks 檔 / HANDOFF / tech-debt / ROADMAP）→ `/work-loop`（自主推進 loop；一次性任務不適用）
- **外部新資訊要改需求** →〔aixbdd〕`/specify` 開新的 `NNN-<slug>`；舊 plan package 是歷史，**NEVER** 回頭覆寫
- **問規格內容** → 直接讀 `specs/truth/**`（對非 owner skill 唯讀）與該 plan package 的 `spec.md`
- **安全視角掃 changed code** → `/security-review`

## 歸檔兩兄弟的邊界

兩個 archive skill 各管一種資產，不互相替代（plan package 本身是歷史，不搬動）：

- `/review-archive` — 歸檔**已結束的人工檢查結果**（manual review → docs/manual-review-archive.md）；完成時同樣自動 sweep 截圖
- `/screenshots-archive` — 只搬**截圖資料夾**到 `_archive/`；由 `/review-archive` 的既有流程呼叫或依明確清理範圍執行，手動跑用於補救 pending sweep

## 品質 / 稽核類（standalone）

- `/design` — design orchestrator（new / improve / iterate / health）
- `/design-retro` — 分析歷史 design review findings 找重複模式
- `/nuxt-data-audit`〔nuxt〕 — 審計 Nuxt data-fetching 模式與效能 golden path
- `/data-sanity`〔nuxt〕 — 偵測 client-server schema mismatch（review 前 / archive 前跑）

## User-invoked（model 不會自動觸發，要自己記得）

以下 skill 已設 `disable-model-invocation`——model 看不到它們的 description，**必須手動打指令**：

- `/version-upgrade`〔node〕 — 單 consumer outdated batch 或跨 fleet 單套件 sweep 升級（副作用大，故不讓 model 自主觸發）
- `/vite-tunnel`〔nuxt〕 — 建 Cloudflare Named Tunnel 給 dev server（跨裝置 OAuth / webhook 測試）
- `/guide` — 本 skill

## Commit 相關邊界

- 一般 commit 一律 `/commit`（多閘門品質流程）
- plan package 檔案的專屬 commit **同樣走 `/commit`**，在 argument 寫明「只 commit `specs/plans/<NNN-slug>/` 與該工作觸動的實作檔」——`/spectra-commit` 等 spectra 家族已自 clade 移除（見 [[proactive-skills]] § Sub-skill 禁用清單），**NEVER** 改派
- 兩者都用 `git commit --only` 隔離別 session 的 staged 內容——不要繞過 skill 手打 `git add + git commit`
