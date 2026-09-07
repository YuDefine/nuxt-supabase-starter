<!--
🔒 LOCKED — managed by clade
Source: rules/core/proactive-skills.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->
# Proactive Skill Orchestra

所有 SDD（SpecFormula / aixbdd）入口與 Design skill 應在適當情境下**主動調用**，不需使用者手動指定。此規則優先於個別 SKILL.md 的指示。

> 本檔是 trigger 主規則（無 frontmatter，每個 session 必載入）。詳細場景規約拆到 path-scoped reference：
>
> - 動 UI 檔（`app/**/*.vue` / `components/**` / `pages/**` / `layouts/**`）或寫 design artifact：[`proactive-skills.design-checkpoint.md`](./proactive-skills.design-checkpoint.md)
> - 走到 `## 人工檢查` 階段、要把驗收入口交給人：[`proactive-skills.manual-review-entry.md`](./proactive-skills.manual-review-entry.md)

## 原則

1. **診斷驅動**——先理解問題再選工具，不盲目跑所有 skill
2. **內建而非附加**——Design 是實作的一部分，不是完成後的美化步驟
3. **來源無關**——不論規格書來自 Notion、文件、對話或 plan file，流程一致
4. **自主但透明**——主動調用 skill 時簡要告知使用者正在做什麼

## SDD 入口自主觸發

**每一個**下表的情境命中時都 MUST 主動走對應入口，不是只有「使用者明講」的那些。入口順序的硬約束（九步 MUST 依序、truth 只由 owner skill 寫）在 [[aixbdd-workflow]]，執行層契約在 [[specformula]]——本表只管「什麼時候該想到它」。

### Intake（PM 側）

| 情境 | 觸發 | 說明 |
|---|---|---|
| 收到新需求，要開始一次迭代 | `/specify` | 建 `specs/plans/NNN-<slug>/`，`NNN` 取現有最大加一 |
| 需求來源是外部文件（Notion URL、PDF、貼文） | 先讀取內容 → `/specify` | 提取結構化需求後才建 plan package |
| `spec.md` 有模糊用詞（TBD、矛盾、缺驗收標準） | `/clarify-over-specs` | 逐項澄清，更新 `spec.md` |
| 驗收標準要寫成可執行 Gherkin | `/spec-by-example` → `/ui-plan` | 產 `features/acceptance/**` 與靜態雛形 |
| 要新增或調整 artifact 規則 | `/constitution` | 只在規則本身要動時 |

### Implementation（RD 側）

| 情境 | 觸發 | 說明 |
|---|---|---|
| 要決定 BDD techstack / 測試策略 / 系統有哪些端 | `/technical-research` | 三題必問全部拍板才可寫 `research.md` |
| 驗收 Gherkin 已定案，要拆系統設計 | `/system-analysis`（委派 `/api-plan`、`/data-plan`） | 產 plan 的 `plan.md` |
| Gherkin 句型要落成可執行 DSL | `/dsl-refine` | 寫 `specs/truth/features/**` 與 `dsl.md` |
| plan 要拆成可執行任務 | `/tasks` | 產 plan package 的 `tasks.md` |
| 準備開始或繼續寫產品碼 | `/implement`（`[BDD-GREEN]` / `[BDD-REFACTOR]` 委派 `/bdd`） | 按 `tasks.md` 執行 |
| 要動 `specs/api/**`、`specs/data/**` 或任何 `.feature` | spec-first：先改 spec 再改實作 | per [[specformula]] MUST 1，**每一個** operation 都適用 |
| 實作中發現 feature 或 DSL 有缺口 | 停下回交 `/dsl-refine` | **NEVER** 就地補寫——那一行不會回到 truth |

### Session 編排

| 情境 | 觸發 | 說明 |
|---|---|---|
| session 結束仍有未完工作、或要交棒 | `/handoff`（`park` / `relay` / `fanout` / `next`） | 四個 arg 全部以本 session 收工結束 |
| 待辦要自主推進（HANDOFF / tech-debt / ROADMAP） | `/work-loop` | |
| 一條工作要開隔離 worktree | `/wt` | |
| 動 UI 檔或寫 design artifact | Design Checkpoint | 見 [[proactive-skills.design-checkpoint]] |

### Completion

| 情境 | 觸發 | 說明 |
|---|---|---|
| 有 UI 的工作完成（design review findings 已產出） | `design-retro` | 分析 findings、識別重複模式、建議改善 |
| Findings 累積達 5 的倍數（5、10、15…） | `design-retro` | 週期性全量分析 |

### Sub-skill 禁用清單（永不觸發）

| Sub-skill | 規則 | 替代方式 |
|---|---|---|
| `spectra-commit` | **NEVER** 主動觸發 | 走 `rules/core/commit.md` 規範的標準 commit 工序（含 hooks / 訊息格式） |
| `spectra-propose` | **NEVER** 主動觸發 | `/specify` 建 `specs/plans/NNN-<slug>/`；純技術工作走 `tasks/<date>-<slug>.md` |
| `spectra-apply` | **NEVER** 主動觸發 | `/implement` 按 plan package 的 `tasks.md` 執行 |
| `spectra-archive` | **NEVER** 主動觸發 | `flow` 卡標 done ＋ `/commit`；plan package 本身就是歷史，不搬動 |
| `spectra-discuss` | **NEVER** 主動觸發 | `/clarify-over-specs`（規格模糊）或 `docs/decisions/**`（架構取捨） |
| `spectra-ingest` | **NEVER** 主動觸發 | 停下回交 truth owner skill（`/dsl-refine` 等），**NEVER** 就地補寫規格 |
| `spectra-analyze` / `spectra-clarify` / `spectra-ask` / `spectra-debug` | **NEVER** 主動觸發 | `/clarify-over-specs`、`/system-analysis`、直接讀 `specs/truth/**` |
| `opsx` | **NEVER** 主動觸發 | 上列各條的替代入口 |

**原因**：clade 的 SDD 層自 2026-09-07 起是 SpecFormula ＋ aixbdd（[[specformula]] / [[aixbdd-workflow]]），spectra / openspec 生命週期已整批退場，對應的 hook、script 與 skill 都已移除。consumer 若由上游 `spectra init` 帶入這些 skill 仍適用本清單。**每一支**清單上的 skill 都 **NEVER** 主動觸發，不是只有 `spectra-commit`。

#### 禁用不只管「不觸發」，也管「不引導」

**任何 skill / rule / snippet / script 輸出，NEVER 出現叫人去跑禁用清單上那支 skill 的句子。**
不觸發與不引導是兩件事：hook 攔得住 agent 自己 invoke，攔不住一份 SKILL.md 寫著
「commit 用 `/spectra-commit` 走 selective stage」而 user 照著打——那時被擋下的是 user，
而擋人的理由寫在他讀不到的另一個檔裡。

合法與違規的分界是**語境**，不是有沒有出現那個字串：

| 出現形式 | 判定 |
| --- | --- |
| `**NEVER** 在 worktree 內跑 `/spectra-commit`` | ✅ 禁止陳述，MUST 保留 |
| 本節這種「已停用、改用 X」的說明 | ✅ 禁用宣告 |
| `docs/archives/` / `docs/pitfalls/` / `tasks/archive/` 的歷史紀錄 | ✅ 不改寫歷史 |
| 「commit 走 `/spectra-commit`」「必須走 `/spectra-commit` 或 `/commit`」 | ❌ 引導，MUST 改成替代方式 |
| script 執行期印出「run /spectra-commit」 | ❌ 引導，且它繞過所有文件審查直接到 user 眼前 |

**NEVER** 用「它只是描述既有機制」「這句是給知道它已停用的人看的」當保留理由——
讀到那句話的人不會同時讀到本節，這正是禁用清單存在的前提。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 非禁止語境下出現禁用 skill 名 → `scripts/audit-disabled-skill-guidance.ts` 報 offender、exit 1。**warn-only，不接 publish gate**：它靠語境啟發式判定，會有誤報，放在擋路的位置會逼人加逃生口 |
| 消費端 | 正在寫 / 改 skill、rule、snippet、script 輸出文案的 agent（本節）；`/clade-health` 每輪跑一次 |
| 載入路徑 | 本節（`rules/core/proactive-skills.md`，consumer 端投影為 runtime rules 目錄） |

## Scope Discipline

所有 SDD / design workflow 都受 [`scope-discipline.md`](./scope-discipline.md) 約束：範圍外檔案不順手改、途中發現其他問題**不修但必登記**、未知變更先回報不自行清場、不得在 subagent 內執行 `git reset --hard` / `git checkout --` / `git clean`。

登記出口：

- 技術債 → `docs/tech-debt.md`（直接登記一條 `TD-NNN`，per [[follow-up-register]]）
- 當前 session 未完 → `HANDOFF.md`
- 未來工作 → repo 根目錄 `ROADMAP.md`
- 規格漏項 → 停下回交 truth owner skill（`/dsl-refine` 等），**NEVER** 就地補寫
- 架構決策 → `docs/decisions/**`

## Handoff Hygiene

符合以下情況，**MUST** 建立或更新 `HANDOFF.md`（內容要求與接手流程見 [`handoff.md`](./handoff.md)）：

- session 結束時仍有進行中的 work item
- 有未 commit 的 WIP
- 有 blocker 需要下一個 session 接手
- 工作移交給其他 agent / runtime

## Manual Review

`## 人工檢查` 的 checkbox **不能由 agent 自行代勾**。三條契約：

1. 進入人工檢查階段（implementation tasks 完成、剩 `## 人工檢查` 區塊）時，**第一動作是 auto-triage**（per [[review-gui-surface]] MUST 9），不是直接引導使用者跑 `pnpm review:ui`
2. 推進完畢後 **MUST** 跑 `node ~/offline/clade/vendor/scripts/check-review-readiness.ts --repo . --change <work-slug>` 確認 bucket；**exit 0 才可引導 user 到 review-gui**
3. **NEVER** 自判 bucket、**NEVER** 跳過 script、**NEVER** 在 exit ≠ 0 時引導 user 到 review-gui —— runtime 自判已多次證明不可靠
4. **給人的 URL = scan 的 `reviewUrl`（永遠 `https://review-gui.<maintainer-domain>` + `reviewPath`）**。違反字面就是違反精神。`127.0.0.1` / Tailscale IPv4 / `*.ts.net` 只准 agent 探測。交付前 MUST 讀 [[proactive-skills.manual-review-entry]] § 交付入口前置查詢

Auto-triage 的三類 pending item 路由、`[discuss]` item 的歸屬、review-gui deep-link 格式與 fallback 模式見 [[proactive-skills.manual-review-entry]]（path-scoped：碰 `tasks/**` / `specs/plans/**` 時載入）。

### Dev Server Auto-Spawn（agent 自起，不要叫 user cd）

詳見 [[proactive-skills.dev-server-spawn]]（path-scoped，碰 `scripts/dev-session*` / `consumer-meta.json` / `nuxt.config.*` 時載入）。核心 one-liner：agent 自己起 dev server，**MUST** 經 `vendor/scripts/dev-session.ts`（durability=herdr），**NEVER** 裸 `nuxt dev` / `pnpm dev` / background execution。

**Dev-port 池滿時**：先跑 `wt-helper reclaim-stale` 釋放 stale slot（三層判定見 [[worktree-default]] §6），**NEVER** 把池滿當 blocker 退回 user。reclaim 後仍滿才問（attended）或 packaging（unattended）。

**採用 per-worktree backing service（DB clone / PostgREST sidecar）的 consumer**：起 dev server **MUST** 先驗那些服務存在，缺席時 fail-loud 並點名是哪個服務、修復指令是什麼。launcher 的「port 有沒有 LISTENING」對這個問題恆為真，所以它擋不住 —— 第一個發現異常的會是瀏覽器，而它只會顯示 app 為「後端抖動」寫的 503/500，完全指不到 DB。同一條要求適用於任何預期 backing service 在的入口（integration test、收 verify evidence），不只 dev server。條款全文見 [[db-preview-env]] § 缺席側。

## Review Tiers

詳見 [[review-tiers]]。

## Screenshot Strategy

詳見 [[screenshot-strategy]]。

### Browser Worktree Verify Auth（hard rule）

開 auth-protected URL 前 **MUST** 完成 pre-auth（port 3000 singleton + `__test-login?role=admin&email=...`），**NEVER** 截到空白頁後才開始診斷 auth。

**載體**：由 selected runtime 的 browser adapter 開同一個 `__test-login` URL；若沒有已驗證的 browser adapter，保持 blocked。完整 cookbook 見對應 runtime adapter 的 auth reference。Pitfall ref: `docs/pitfalls/2026-06-24-browser-auth-blank-page-on-alt-port.md`。

## Knowledge And Decisions

碰到非直覺問題或 workaround，任務結束時應評估沉澱到 `docs/solutions/**`。
做出跨任務的技術取捨時，應評估寫 ADR 到 `docs/decisions/**`。
