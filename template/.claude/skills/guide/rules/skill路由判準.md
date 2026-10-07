# Rule 1 - 先以 consumer manifest 過濾，NEVER 因為本檔列了某支就斷定這個 repo 裝了它

- Level: `MUST`
- skill 由 consumer manifest 的 `modules` 決定裝哪些（canonical `.clade/manifest.json`，legacy `.claude/hub.json` 仍可讀）。本檔的條目帶標記時，只有宣告對應 module 的 repo 才有那支 skill——沒宣告就是打了也不存在，不是壞掉。
- 無標記的是 hub-core，每個 consumer 都有。
- 選路由前先排除 manifest 沒宣告的標記列；排除後沒有合適的列，就照「沒宣告的 repo」欄回報替代流程。

| 標記 | 需要 manifest 宣告 | 沒宣告的 repo |
| --- | --- | --- |
| 〔aixbdd〕 | `modules.capabilities` 含 `"aixbdd"` | 沒有 `work-route` 與它載入的需求管線（`/specify`、`/clarify`、`/system-analysis`、`/implement`）。待辦走 `tasks/` + HANDOFF / tech-debt / ROADMAP，`/work-loop` 照樣能跑 |
| 〔specformula〕 | `modules.capabilities` 含 `"specformula"` | 沒有 `.feature` / `isa.yml` 的 BDD 執行層 |
| 〔nuxt〕 | `modules.framework` = `"nuxt"` | 沒有 Nuxt 專用的稽核與 dev 工具 |
| 〔node〕 | `modules.ecosystem` 含 `"node"` | 沒有 `/version-upgrade`（它綁 npm/pnpm，不是綁 Nuxt） |

## Good Example

- 這個例子是好的，因為先讀 manifest，未宣告 aixbdd 就改走 `tasks/` 流程。

```text
.clade/manifest.json modules.capabilities = ["specformula"]（無 aixbdd）
使用者：「我要做一個新需求」→ 寫 tasks/2026-10-04-<slug>.md → 交 wt 建立隔離環境 → /commit
```

## Bad Example

- 這個例子是壞的，因為沒看 manifest 就推薦 aixbdd 才有的入口。

```text
使用者：「我要做一個新需求」→ 請打 /specify
```

# Rule 2 - 主流程（idea → shipped）的入口是 `work-route`，上游 owner 不當成 slash skill 推薦

- Level: `MUST`
- 〔aixbdd〕repo 開始或續做需求、bug、重構時，入口是 `work-route`：它分類需求、定位同一份工作、開 plan package，並依產物載入 owner。
- 可直接叫的只有 `work-route`、`/specify`、`/clarify`、`/system-analysis`、`/implement`。`clarify-over-specs`、`spec-by-example`、`technical-research`、`api-plan`、`data-plan`、`ui-plan`、`dsl-refine`、`tasks`、`bdd` 是由 `work-route` 載入的內部 owner，沒有同名 slash 入口，**NEVER** 叫使用者手打。
- 生命週期各站與 owner（〔aixbdd〕）：

| 階段 | owner | 這一站做什麼 |
| --- | --- | --- |
| 提案 | `/specify` | lifecycle repo（有 `specs/truth/work-lifecycle.md`）：先 `flow plan open` 再填 `spec.md`。未遷移 consumer：建 `specs/plans/NNN-<slug>/` |
| 澄清 | `/clarify`（內部 `clarify-over-specs`） | 對 `spec.md` 的模糊處逐項收斂 |
| 驗收 Gherkin | 內部 `spec-by-example` | 產 `features/acceptance/**` |
| 設計 | 內部 `technical-research`、`/system-analysis`（委派內部 `api-plan`、`data-plan`、`ui-plan`） | 定 techstack 與系統設計；UI 需求在此產靜態雛形 |
| 規格落地 | 內部 `dsl-refine` | 把句型寫進 `specs/truth/features/**` 與 `dsl.md` |
| 拆任務 | 內部 `tasks` | 產 plan package 的 `tasks.md`；開工前 `flow open <slug> --origin tasks:<path>` |
| 實作 | `/implement`（`[BDD-GREEN]` 委派內部 `bdd`） | 依 `tasks.md` 逐 phase 落 code 與測試 |
| 人工檢查 | `/review scan`（＝`flow gates --repo-only`） | 看哪些卡等人判（UI / 資料類 manual review）；hub-core |
| 提交 | `/commit` | 依功能分組走品質閘門提交；hub-core |

- 不確定專案當前該走哪一站：交 `work-route`，由它讀 `specs/plans/` 最新的 plan package 與 `tasks.md` 接續。
- 沒宣告 aixbdd 的 repo 整條主流程不適用，生命週期是「待辦來源 → `tasks/<date>-<slug>.md` → 交 `wt` 建立隔離環境 → `/commit`」。

## Good Example

- 這個例子是好的，因為在 aixbdd repo 把新需求交給 `work-route`，由它決定載入哪個 owner。

```text
modules.capabilities 含 aixbdd；使用者：「我要做一個新需求」→ invoke work-route
```

## Bad Example

- 這個例子是壞的，因為 `/spec-by-example` 沒有 slash 入口，使用者打了只會找不到。

```text
使用者：「需求寫好了，下一步？」→ 請打 /spec-by-example 產驗收 Gherkin
```

# Rule 3 - 從症狀進入時，依症狀表選一支 skill

- Level: `MUST`
- 使用者描述的是症狀或處境、不是階段時，照下表選列；同時命中多列時取最先動手的那一列。

| 症狀／處境 | 路由 |
| --- | --- |
| 遇到 bug / 異常行為 | 先查根因（交 `wt` 建立隔離環境後調查）；〔aixbdd〕repo 交 `work-route`，動到規格由它回 `/specify` |
| 要看 UI 畫面 / 截圖驗證 | `/review screenshot`（統一截圖入口；第一手載體見該 skill） |
| 歸檔、archive、搬截圖 | `/review archive`／`/review screenshots`——兩者已不是必做 archive，停寫契約在 `review` |
| 專案還沒有可重跑的 app control／feature map | `/verification create`（建立 consumer-owned `verify-<app>` skill） |
| 既有 verification skill／feature map 要對帳 source 與 live behavior | `/verification maintain`（`clean` 是零 branch／零 commit／零 PR 的成功結果） |
| 要動 code 而還在 main working tree | 交 `wt` 建立隔離環境（每條 task 一棵 worktree，多條可並行） |
| implementation plan 內有多個獨立 task 想並行 | 讀 `capabilities/core/references/implement-executor/`（同 session 派 subagent；跨 change 的並行仍交 `wt` 各自建立隔離環境） |
| session 要收尾 / 交接 | `/handoff`（有 in-progress 工作寫交接；沒有則整理 HANDOFF.md 推薦 outstanding） |
| 要把待辦無人值守推完（plan package / tasks 檔 / HANDOFF / tech-debt / ROADMAP） | `/work-loop`（自主推進 loop；一次性任務不適用） |
| 外部新資訊要改需求 | 〔aixbdd〕lifecycle repo 經 `work-route` 開新的 `W-…` package；未遷移 consumer 才開 `NNN-<slug>`。舊 plan package 是歷史，**NEVER** 回頭覆寫 |
| 問規格內容 | 直接讀 `specs/truth/**`（對非 owner skill 唯讀）與該 plan package 的 `spec.md` |
| 安全視角掃 changed code | `/security-review` |
| UI 設計與修改閉環 | `/impeccable`（無參數時依 critique 快照、git 變更與 detector 推下一支指令；閉環規約見 design-checkpoint） |
| 審計 Nuxt data-fetching 模式與效能 golden path | `/nuxt-data-audit`〔nuxt〕 |
| 偵測 client-server schema mismatch（review 前跑） | `/nuxt-data-audit schema`〔nuxt〕 |

## Good Example

- 這個例子是好的，因為 archive 類請求直接路由到停寫契約所在的 `review`。

```text
使用者：「這輪截圖要不要搬進 _archive？」→ /review screenshots（停寫契約在 review）
```

## Bad Example

- 這個例子是壞的，因為 guide 自己複寫了 archive 契約，與 review 漂移時無人發現。

```text
guide：/review archive 要寫 docs/manual-review-archive.md，截圖 rotate 進 _archive/
```

# Rule 4 - user-invoked skill 要告訴使用者手動打的指令，不由 model 觸發

- Level: `MUST`
- 下列 skill 設了 `disable-model-invocation`（或等價的 explicit-only 政策）——model 看不到它們的 description，選中時告訴使用者要手動打的指令：

| 指令 | 用途 |
| --- | --- |
| `/version-upgrade`〔node〕 | 單 consumer outdated batch 或跨 fleet 單套件 sweep 升級（副作用大，故不讓 model 自主觸發） |
| `/vite-tunnel`〔nuxt〕 | 建 Cloudflare Named Tunnel 給 dev server（跨裝置 OAuth / webhook 測試） |
| `/guide` | 本 skill |

## Good Example

- 這個例子是好的，因為把指令交給使用者手動打。

```text
使用者：「幫我把 nuxt 升到最新」→ 這支要你手動打：/version-upgrade nuxt
```

## Bad Example

- 這個例子是壞的，因為 model 試圖自己 invoke 一支它看不到的 skill。

```text
→ invoke version-upgrade（失敗：找不到 skill）
```

# Rule 5 - 所有 commit 的唯一入口是 `/commit`

- Level: `MUST`
- 一般 commit 一律 `/commit`（多閘門品質流程）。
- plan package 檔案的專屬 commit 同樣走 `/commit`，在 argument 寫明「只 commit `specs/plans/<NNN-slug>/` 與該工作觸動的實作檔」——`/spectra-commit` 等 spectra 家族在 [[proactive-skills]] § Sub-skill 禁用清單上，不改派。
- 兩者都用 `git commit --only` 隔離別 session 的 staged 內容；**NEVER** 繞過 skill 手打 `git add + git commit`。

## Good Example

- 這個例子是好的，因為 plan package 的提交也走 `/commit` 並限定範圍。

```text
/commit 只 commit specs/plans/W-2026-10-04-foo/ 與該工作觸動的實作檔
```

## Bad Example

- 這個例子是壞的，因為繞過品質流程，也可能帶走別 session 的 staged 內容。

```text
手打 git add -A，再自己 git commit 提交 plan 檔（沒走 /commit）
```
