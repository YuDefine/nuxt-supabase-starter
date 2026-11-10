---
description: 禁用 skill 清單的「不引導」那一半——任何 skill / rule / snippet / script 輸出 NEVER 出現叫人去跑禁用清單上那支 skill 的句子，含合法與違規的語境分界表與 audit 訊號。觸發是「正在寫或改 skill／rule／snippet／script 的輸出文案」，綁得到檔案故 path-scoped；禁用清單摘要（哪幾支 NEVER 主動觸發）留在 [[proactive-skills]]，逐支名單表（audit 解析源）在本檔
paths:
  [
    'rules/**',
    '.claude/rules/**',
    'capabilities/**/skills/**',
    '.claude/skills/**',
    'vendor/snippets/**',
    'vendor/scripts/**',
    'scripts/**',
  ]
---
<!-- Clade native rule; source: rules/core/proactive-skills.disabled-skill-guidance.md; edit canonical source -->

<!-- clade-targets: claude,agents -->

# 禁用 skill 的「不引導」義務

> 本檔是 [[proactive-skills]] § Sub-skill 禁用清單 的 path-scoped sibling。**哪幾支被禁用**摘要在該檔、逐支名單表在本檔，
> **NEVER** 因為本檔沒載入就當作清單不存在。

### Sub-skill 禁用清單（永不觸發）

本表由 `scripts/audit-disabled-skill-guidance.ts` 與其 test 現場解析（首欄每列以 `` `name` `` 開頭），列名格式勿動；`/design` 以 slash 形列名，audit 只認呼叫形。常駐層（[[proactive-skills]]）只留一行摘要，由上游 `spectra init` 帶入這些 skill 的 consumer 用本表查替代方式。

| Sub-skill | 替代方式 |
|---|---|
| `spectra-commit` | `rules/core/commit.md` 的標準 commit 工序 |
| `spectra-propose` | `/specify` 建 plan package；純技術工作走 `tasks/<date>-<slug>.md` |
| `spectra-apply` | `/implement` 按 plan package 的 `tasks.md` 執行 |
| `spectra-archive` | `flow` 卡標 done ＋ `/commit`；plan package 本身就是歷史，不搬動 |
| `spectra-discuss` | `/clarify-over-specs`（規格模糊）或依 [[knowledge-and-decisions]] 記 ADR（架構取捨） |
| `spectra-ingest` | 停下回交 truth owner skill（`/dsl-refine` 等），**NEVER** 就地補寫規格 |
| `spectra-analyze` / `spectra-clarify` / `spectra-ask` / `spectra-debug` | `/clarify-over-specs`、`/system-analysis`、直接讀 `specs/truth/**` |
| `opsx` | 上列各條的替代入口 |
| `/design` | 2026-09-27 退役（hub-core 已刪）；無參數 `impeccable` 推下一支指令，閉環見 [[proactive-skills.design-checkpoint]] |

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
| 觸發點 | 本節由共同 rules planner 交付到所選 runtime 的 `clade-session-work` native skill package |
