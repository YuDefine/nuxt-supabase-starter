---
description: '自我維運標準——新增或修改無人值守的制度（systemd unit／timer、排程 workflow）時，四件事必備：訊號、有界自動修復、狀態轉變才發的通知、被下一層看守的定期檢測；成熟度 experimental→validating→stable 由 ledger 算'
paths: ['**/*.service', '**/*.timer', '.github/workflows/**']
---
<!-- Clade native rule; source: rules/core/self-maintenance.md; edit canonical source -->
<!-- clade-targets: claude,agents -->

# 自我維運標準

**適用判準**：plan 結案後，它會在沒人看著的情況下由排程或事件繼續觸發嗎？會 → 本節四件事必備；由人當場叫用（一次性修正、文件、重構、跑一次的 PoC）→ 不適用。看 diff 判：新增或修改 `*.service`、`*.timer`，或 `.github/workflows/*` 帶 `on: schedule`。

| 件 | 必備 | 不算數 |
| --- | --- | --- |
| 訊號 | 失敗以**退出碼**表達；`X-Clade-Signal=` 寫明量的是什麼、是不是代理值 | 只印 log、`\|\| echo`、`ExecStart=-` 沒寫 `X-Clade-Swallow=<理由>` |
| 自動修復 | 有界（次數／時窗上限）、可安全重試，修復失敗也回非 0；寫在 `X-Clade-Repair=`，沒有就寫 `none: <理由>` | 無上限重試、修復失敗靜默 |
| 通知 | `OnFailure=clade-alert@%p.service`＋`OnSuccess=clade-alert-ok@%p.service`（範本 `ops/systemd/clade-alert@.service`）；範本不在 repo 時指向 repo 裡有追蹤的告警 unit（目標檔不在 repo 會被 `scripts/audit-self-maintenance.ts` 標 `onfailure-target-missing`）。嚴重度寫在 `X-Clade-Severity=P0\|P1\|P2`；**狀態轉變才發** | `OnFailure=` 指向 repo 裡沒有的 unit（systemd 只記 enqueue 失敗）、持續重發同一狀態、只在 SessionStart 印 |
| 定期檢測 | 排程跑檢查；監測者本身被下一層看守（dev node 由 `ops/dev-node/clade-selfcheck.timer`，再外層是 GitHub-hosted 的 `.github/workflows/dead-man.yml`）；看守者不在 repo 時，演練紀錄寫明這一層由誰看 | 只有 `Restart=always`、只有人手動跑 |

契約寫在 unit 自己的 `X-Clade-*` 鍵（`X-Clade-Owner=` 必填），**NEVER** 另開一份會 drift 的清單。機械檢查：`node scripts/audit-self-maintenance.ts`（鍵名白名單、值域、`OnFailure=` 有值且目標 unit 在 repo、吞錯）；告警範本只給 user manager 用。

## 成熟度

狀態由 ledger 與演練 evidence 算出來，**NEVER** 存成要人去 commit 升級的欄位。

| 階段 | 進入條件 | 通知強度 |
| --- | --- | --- |
| experimental | 有契約、有訊號＋通知 | 每次轉變都推 |
| validating | plan 結案：四件事齊備，且在**目標主機、部署後環境**跑過一次故障演練、被偵測並自癒或告警 | 未自癒的 P0 立即推，其餘進摘要 |
| stable | 連續 14 天無未自癒的 P0／P1、heartbeat 不斷、人工介入 0、通知量在預算內 | 只推 P0 |
| retired | 制度移除 | — |

任一次未自癒 P0、人工介入、通知超預算，或有 commit 改到該制度的檔案 → 回 validating。合入前在別台機器、或手改過的環境跑的演練不算目標主機演練。

演練紀錄放 plan `evidence/*.md`，frontmatter 寫 `self-maintenance-drill: target-host`、`host:`、`deployed: <演練時部署的 commit sha>`、`outcome: self-healed|alerted`。**已強制**：`flow plan check-close` 對該 work 改過的制度檔查兩樣，擋下時印 finding code——`self-maintenance-contract`（service 契約不齊，同 `scripts/audit-self-maintenance.ts` 判定）、`self-maintenance-drill-missing`（沒有演練紀錄）、`-drill-invalid`（frontmatter 缺欄或 `deployed` 不是 7–40 位 hex commit）、`-drill-stale`（`deployed` 沒包含每支制度檔最後一次被改的 commit）、`self-maintenance-git-failed`（git 讀不到檔案清單或 work commit，看不到＝沒驗過）。work id 日期早於 `GATE_SINCE`（2026-10-28）的 plan 不受管，不追溯。`host:` 只驗非空，認不出是不是目標主機，這點仍靠你自己對照。

「該 work 改過」只認刻意宣告的歸屬（`flow plan check-close` 採用的就是這個判準）：`Work:` trailer ∪ 動過 plan 目錄的 commit ∪ HEAD 上 `X-Clade-Owner=` 寫本 work id（或 `specs/plans/<id>`）的制度檔（timer／drop-in 沿用同名 service；排程 workflow 寫註解 `# X-Clade-Owner: <id>`）。code-only 的 squash PR 靠第三項認出來，所以 owner 要寫成 work id 才認得出歸屬。**NEVER** 用「plan 開立後所有無 trailer 的 commit」猜歸屬——別 work 的 squash PR、dependabot、fleet sweep 會讓無關 plan 全部無法結案。演練的 `deployed` 要包含每支命中檔最後一次被改的 commit（不論誰改）。

## Red Flags

- 新 unit 沒有 `OnFailure=`，理由是「失敗了看 journal 就知道」
- 告警持續重發同一個狀態，或恢復時沒有 resolved
- 訊號是代理值（影子成本、估算）卻沒標
- 演練只在開發機跑過就寫「已驗證」

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 新增或修改 `*.service`／`*.timer`／`.github/workflows/**` |
| 消費端 | 寫 unit 或排程 workflow 的 agent；`scripts/audit-self-maintenance.ts`（契約）；`flow plan check-close`（結案；已接入，`vendor/scripts/flow/self-maintenance-gate.ts`，見 § 成熟度）；`clade-selfcheck`／`dead-man.yml`（看守） |
| 觸發點 | 本 rule 的 `paths:`；audit 的 finding 輸出指回本檔 |

設計與理由：`specs/plans/W-2026-10-28-self-healing-standard/system-analysis.md`（結案後改指 `docs/rule-rationale/self-maintenance.md`）。
