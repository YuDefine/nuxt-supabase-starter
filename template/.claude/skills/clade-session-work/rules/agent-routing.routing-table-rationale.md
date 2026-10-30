---
description: Routing Table 的取證層——grok 擴權的取證狀態、以及「拿數字當降檔理由」的三個陷阱（aggregate 跑分、配額權重 5:2.5:1、class-conditional 差距）。改 Routing Table 任一列、動 pi-routing-*.ts / pi-dispatch.ts，或要拿任何數字支持一次降檔／轉列時 path-scoped 載入；判準本身在 [[agent-routing.routing-table]]，本檔只承載理由與實證
paths:
  [
    '.claude/rules/agent-routing.md',
    'rules/core/agent-routing.md',
    'vendor/scripts/pi-routing-policy.ts',
    'vendor/scripts/pi-routing-gate.ts',
    'vendor/scripts/pi-dispatch.ts',
  ]
---
<!-- Clade native rule; source: rules/core/agent-routing.routing-table-rationale.md; edit canonical source -->
<!-- clade-targets: claude,agents -->
<!-- clade-adapters: claude -->

# Agent Routing — Routing Table 的取證層

> 本檔是原 `agent-routing.md` Routing Table 節前言的下推全文。**判準留在 [[agent-routing.routing-table]]**（哪些 model 合法、
> 六維 effort、`--route` / `--tier-basis` / `--table-row` 的 MUST），這裡只放它們的理由與實證——
> 那些內容每一份 always-load 都要付 bytes，而它們發作的時刻是「你正在改這張表」或
> 「你正要拿一個數字去支持降檔」，兩者都是 path-scoped 抓得到的。

## grok 擴權的取證狀態

> 2026-09-24 起 Grok 4.7 xhigh 已由 Charles 逐列拍板進入 `web-search`／`mechanical-fanout`／
> `read-heavy-scan`／`notion-ops`／`version-upgrade-research` 的鏈與 delegate-sub 鏈首——那是**政策決定**，
> 不是本節取證的結論。本節以下保留為當時（luna 仍在表上）的取證狀態紀錄。
> 2026-10-21 起 Grok（`grok-xai`）隨 xAI 退訂退場，表上已無 Grok 列；本節只剩歷史意義。

**現行判準**：Grok 在哪一格、第幾跳，一律照 [[agent-routing.routing-table]]。**NEVER** 拿本節的
n=1 取證去主張把 Grok 推進表上沒有它的列——要轉列先補 TD-509 列的 reps，再改表。

## 拿數字當降檔理由的三個陷阱

- **NEVER 拿 aggregate 跑分推導 routing boundary**：要看的是**這一類工作**的差距，不是總分。
  **同一個陷阱適用於 effort 檔位之間**——「low 跟 high 在通用題上差不多」對安全類 /
  高漏報成本類零證據力。
- ⚠️ **配額權重 UNKNOWN**：**NEVER** 把 5:2.5:1 當成已證實的配額比寫進任何計算——那是 API 價格與
  purchased-credit rate card，**訂閱內含配額**的 per-model debit multiplier 官方未公布。
  **降檔究竟省多少配額目前無法量化**。
- 跑分數字組與 benchmark 性質見 `docs/rule-rationale/agent-routing.md` § model 檔位的量測依據。
  **NEVER 拿本規約的 rationale 推翻本規約的字面**（該句已登記在 `registry/rule-invariants.json`）。

## GPT 退場與 Sonnet 5.5 接手（2026-09-29）

取證全文在 work `W-2026-09-29-routing-table-gpt-6-sol-sonnet-5-5-effort` 的 plan § 證據（`flow plan show` 帶該 work id 可讀；收案後原文在 git 歷史）；這裡只留會被下一次改表誤讀的三點：

- **Sonnet 與 Opus 同一個額度池**：上游 usage API 只回 `five_hour`／`seven_day`，沒有 Sonnet 分池窗；per-model debit 倍率同樣 UNKNOWN（見上節）。所以 Sonnet 接手省的是「同池內的消耗速率」，**NEVER** 讀成「另開一池」，也 **NEVER** 拿 API 價差（Sonnet 5.5 是 Opus 5.5 的一半）推算訂閱配額節省。
- **`high` 不是跑分結論**：官方「agentic coding 從 `medium` 起跳」是 aggregate eval，本檔第一個陷阱禁用它；選 `high` 的理由是它為 Sonnet 5.5 的 API 預設，且接手的是原 Sol xhigh 的列、低 effort 較常未驗證即回報。要降 `medium` 先補同 brief ≥5 reps 的對照。
- **`dispatch-fallback` 不換 Sonnet**：倍率 UNKNOWN、無品質對照、Sonnet 低 effort 較常未驗證即回報，而鏈尾載體的輸出沒有下游語意 gate。

## 對外提問審查席的 effort 例外（2026-10-14）

〔`question-review`〕是唯一以 xhigh effort 執行 Opus 5.5 的 clade 自有席位（Charles 2026-10-14 Q1=A），其餘 Opus 席維持 medium；〔`deep-security-audit`〕的 xhigh 是 plugin 自帶設定，理由另見下節。理由：

- **頻率低**：只在 reply-article 待確認頁發佈前、notion-hub 決策題建票前跑，一週頂多幾次，額度影響可忽略。
- **漏問的代價高**：對外頁漏一個參數，就是與客戶多一輪以天計的來回（2026-10-13 跳級補發確認頁：對方 10/10 答完，Q3 選項讓 7 位落進「跳級學生」，處置題卻寫死「2 位」，要再追問）。
- **工作本身重推理**：要逐一推演選項組合打開的路徑。

**對照紀錄（n=1，不是正式量測）**：同一份 fixture（`evals/skills/reply-article/fixtures/2026-10-13-跳級補發確認頁.md`，答案說明不在檔內），同一份 brief，兩檔各跑一次。

| 檔位 | 目標 Blocker（Q3 選跳級後頁首／時間／範本無題決定） | 其他 Blocker | 耗時 |
| --- | --- | --- | --- |
| xhigh | 抓到 | 4 個：Q1 範本檔、Q3 部分學生名單、Q5 B 證書期間，另把 J5 選跳級也列入同一條 | 約 5.4 分 |
| medium | 抓到 | 3 個：Q1 範本檔、Q3 部分學生名單、舊樣板效果句不進回覆 | 約 1.5 分 |

兩檔都過回歸題；xhigh 另外抓到 medium 沒提的 J2 與 Q4 的先後衝突、Q2 頁首與既有 Spring–Fall 做法的潛在衝突。單次對照只能說明 xhigh 沒有比較差，不能證明它一定比較好。要降回 medium，先照本檔慣例用同一份 brief 各跑 ≥5 次，比較目標 Blocker 的命中率。首輪兩次都讀到 fixture 檔頭的答案註解、結果作廢；之後答案說明只放在 `cases.json` 的 `_doc`。

## 深度安全稽核席照 plugin 自帶 model／effort（2026-10-24）

〔`deep-security-audit`〕是唯一不照本表指定 model／effort、改照外部 plugin（claude-security）自帶設定跑的席位（Charles 2026-10-24 Q3）。plugin 的研究員與驗證員寫死 `model: inherit`＋xhigh，Sonnet 子 agent 從 low 到 xhigh，掃描 workflow 把 effort tier 對到 medium／high／xhigh（`max` 也只映射到 high）；改成本表的 Claude Opus 5.5（effort: medium）等於改寫它的驗證流程，量到的就不是這個 plugin。理由：

- **頻率低**：只在 consumer 上線前、或 `SECURITY.md` 不變量變更等事件後跑，由人發起，不在 commit 路徑。
- **漏抓的代價高**：上線後才發現的授權繞過或跨租戶讀取，代價以事故計，不是多一輪 review。
- **內建反證**：每則候選要經三視角驗證員反駁才進報告，這道把關就是靠 xhigh 推理撐起來的。

邊界（列內已寫的硬條件，這裡說為什麼）：

- **必須從 Opus 5.5 主線啟動**：`inherit` 繼承主線 model；從 Sonnet 主線點火，研究員就是 Claude Sonnet 5.5（effort: xhigh），不是 Q3 同意的形狀。README 也只推薦 Opus 5.5 與 Fable 5.1（Fable 禁用）。
- **不自動點火**：plugin 每次 agent call 上限 1000、沒有美元上限；由 coordinator 或 agent 自行加派，花費就沒有人在看。push 後的掃描提示會誘導 agent 自己開掃，所以每台開發機的 `~/.claude/settings.json` 都設 `CLAUDE_SECURITY_SCAN_TIP=off`（該檔不歸 bootstrap 管，新機器要自己補）。關提示 **NEVER** 改用 `DISABLE_TELEMETRY`：security-guidance 會因此拿不到憑證。
- **只用 Scan codebase**：Scan changes 是 diff 層級的 security review，與 commit 0-S.2 的 `/security-review` 重複。
- **routing gate 不必開 allowlist**（2026-10-25 實跑 `pi-routing-gate.ts`）：Scan codebase 以 saved workflow `claude-security:scan` 呼叫，gate 放行（exit 0），workflow 內的 `agent()` 不經 gate 的 subagent 派工分支；直接 `Agent(claude-security:*)` 一律被 latch（exit 2），只有 Suggest patches 會這樣派，所以它不在本席。
- **不當 reviewer 替身**：commit 0-A 只認 `claude-review-safe.sh` FINALIZE；0-A 額度耗盡時 gate 保持未完成，不改用本席。
- **觸發點只登記、不點火**（T5，2026-10-29）：事件到了（consumer `business_activity` 由 `pre-production` 改 `active`、已 `active` 的 consumer `SECURITY.md` 不變量變更），agent 該做的是唯讀的 `security-evidence map`、把「需要深度稽核」連同 scope 與額度需求寫進 plan Open work 並 `flow ask` 請 Charles 決定、再用 `audit-security-scan-freshness.ts` 確認有效掃描沒過期（`/clade-health full` 每輪跑到）。事件觸發的是「提醒與準備」，不是授權；授權仍是上列「不自動點火」那條。
- **大 scope 前先排額度**（T3 回放成本，evidence `T3-replay-2026-10-25.md` §7）：同為 medium effort，13 檔約 15 USD（list）、46 檔約 16 USD，245 檔約 69 USD 且單支吃滿一個帳號 5 小時額度、panel 最後一段撞上限而沒 render 報告。所以 scope 超過約 100 檔，發起前二選一：按目錄切成多支（每支落在約 50 檔內，逐支發起）、或用 `claude-account-pool` 查各帳號剩餘額度後指定額度充足的帳號從 Opus 5.5 主線啟動。**NEVER** 在額度未知時對大 scope 點火：撞上限的代價是最後一段 panel 驗證沒跑完，已花的額度買不到結論。

## Opus 5.5 effort 量測（2026-10-12～15，結論：不改表）

work `W-2026-10-07-opus55-effort-measurement`；逐 rep 原始紀錄與重跑方式在該 plan 的 `evidence/`（`flow plan show` 帶該 work id 可讀；收案後原文在 git 歷史）。量的是本表跑 medium／low、而官方把 brownfield 除錯與 code review 放在 high 的那幾列；brief／rubric 皆先於結果 commit。

| 量測 | 列 | 設計 | 結果 | 結論 |
| --- | --- | --- | --- | --- |
| M-ID | `implementation-decision` | 3 件已結案 brownfield bug，medium／high 各 ×5 | 根因命中 15/15 對 15/15；雙呼叫點 B1／B2 全中；B3 位置判準 4/5 對 3/5；high token 多 18–33%、耗時約 1.5–1.6 倍 | 三題皆 ceiling，**不是**「medium 足夠」的證據 |
| M-0A | `code-review-opus` | 2 個 0-A 曾漏、後補修的 changeset，medium／high 各 ×5 | 已知 bug 召回：K1 4/5 對 2/5、K2 0/5 對 1/5、K3 0/5 對 2/5；high token 多 12–28%、耗時約 1.6–1.7 倍 | 兩檔多數 rep 都漏、方向相反，不構成降檔或升檔證據 |
| M-FB | `dispatch-fallback`（鏈尾） | TD-953 逐字抽取 brief，low ×5 | 捏造 0 筆、`grep -F` 100% | 5 reps 全用腳本機械切出原文，測到的是「有腳本時不捏造」，**不是** low 憑讀入內容逐字複誦的可靠度 |
| M-UI-ROUTING | UI 四列 | 3 件已結案 UI 任務，low／medium 各 ×5 | design-review、screenshot-match ceiling；ui-plan 21.6 對 21.8（/28）；ui-view 24.0 對 24.8（/25，low 5/5 漏 a11y 摘要） | 維持 medium |

- **ceiling 不是證據**：題組鑑別力不足時，兩檔同分只說明題太簡單。要拿這批列談降檔，先換更難題組（多根因、症狀誤導；M-FB 禁 `Bash` 重測），同一份 brief 各 ≥5 reps。
- **M-UI 只能這樣引用**：`/model` 切換在帶 `--effort`（high）與不帶（medium，來源不明）兩種啟動下都不改 effort。帶 `--effort` 的結果無法與「`--effort` 旗標優先」區分；不帶的那輪本機 `effortLevel`／`modelSettings` 全為 medium，分不出來源。**NEVER** 寫成「modelSettings 不生效」或「modelSettings 生效」。
