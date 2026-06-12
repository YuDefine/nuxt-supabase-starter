---
description: consumer 若採用 Notion ticket 制度（consumer-meta notion.ticketWorkflow=true），spectra change 生命週期 MUST 主動把對應 ticket 狀態跟著推進，避免「change 做完 / 發版了但 Notion ticket 沒更新」；狀態轉移授權沿用全域 _notion-tdms-board/REFERENCE.md §3 表，不另造 state machine
paths: ['openspec/changes/**', '.claude/consumer-meta.json', '.claude/skills/spectra-*/**', '.claude/skills/commit/SKILL.md']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/spectra-notion-coupling.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


# Spectra Change ↔ Notion Ticket 狀態耦合

**核心命題**：consumer 若有 Notion ticket 制度，change 的 Notion ticket 狀態**不能跟 spectra 生命週期脫鉤**。最常見的漏洞是「apply 做完 / 發版了，但對應 ticket 還停在『進行中』甚至『需確認』」——客戶看 board 以為沒人動。本規則把「change 生命週期事件 → ticket 狀態轉移」綁成**明文 workflow 步驟**，由 spectra-apply / spectra-archive 收尾主動推進，**不靠事後想起來**。

此規則優先於個別 skill 的 ad-hoc Notion 描述。狀態轉移授權**一律**沿用全域 `~/.claude/skills/_notion-tdms-board/REFERENCE.md §3` 的轉移表（單一真相層），本檔**不**重述 state machine、**不**新增 status 值。

---

## 觸發條件（兩者皆成立才生效）

1. **Consumer 採用**：consumer 的 `.claude/consumer-meta.json` 宣告 `notion.ticketWorkflow: true`（schema 見 `registry/consumer-meta.schema.json` 的 `notion` block；判讀經 [[consumer-meta]] snapshot，**NEVER** 直接 path-resolve consumer repo）。未宣告 / `false` → 本規則**完全不生效**，spectra 流程照常跑、不碰 Notion。
2. **該 change 連結到一張 ticket**：change 的 `proposal.md` 頂部有 ticket 連結（見下方「連結存放」）。沒有連結的 change（典型：來自 ROADMAP / 內部技術債、非客戶 ticket）→ 本規則**不生效**，不要硬湊一張 ticket。

兩條都成立才推進 ticket 狀態。任一不成立 → silent skip，**NEVER** 因為「想更新點什麼」就去碰 board。

---

## Change ↔ Ticket 連結存放（single source）

連結寫在 change 的 `proposal.md` **最上方**（`## Why` / `## Problem` 之前）一行 blockquote：

```markdown
> **Notion ticket**: <ticket-url>（page_id: <page-id>）
```

- git-tracked + 人可讀，跟著 change 走、不依賴 SQLite blob
- **由誰寫**：change 若是從 `/notion-ticket`（outbound）或 `/notion-board triage`（inbound）轉成 spectra change 時，**MUST** 在 propose 階段把 page_id 寫進這行。日後反查只認這行。
- **NEVER** 把連結塞進 `.spectra/`（會被 `spectra unpark` 覆蓋）或只留在 `HANDOFF.md`（HANDOFF 是 session-scoped，archive 後會清）。

---

## 生命週期 → ticket 狀態映射（沿用 REFERENCE.md §3 授權表）

| spectra 生命週期事件 | ticket 轉移 | 需要的 evidence | MUST-step 位置 |
| --- | --- | --- | --- |
| **apply 真的開工**（`/spectra-apply` 動 code） | `未開始`\|`需確認` → **`進行中`** | active claim 存在 | spectra-apply 收尾（Step 8b handoff 前） |
| **發版**（change 已 archive + `/commit` 出 git tag + push 觸發 deploy） | `進行中` → **`驗收中`** + 填 `修復版本 >= <tag>` | `git describe --tags` 拿得到本次發版 tag | spectra-archive 收尾（Step 8 summary 明文指示，緊接的 `/commit` 發版後由同一主線完成；見下「驗收中 的 tag 依賴」） |
| 客戶驗收 OK | `驗收中` → `完成` | — | ❌ **客戶側，Claude NEVER** |
| 人工歸檔 | `完成` → `封存` | — | ❌ **客戶側，Claude NEVER** |

**Hard rule（重申 REFERENCE.md §3）**：寫 `狀態` 前 **MUST** 確認該轉移在 §3 表是 ✅ Claude 可推。要碰 ❌（客戶側 `驗收中→完成` / `完成→封存`）→ **STOP**，改成「回報 user + 建議」，由 user 自己在 Notion 點。

### 「驗收中」的 tag 依賴（為什麼不在 archive 當下就轉）

`進行中 → 驗收中` 在 REFERENCE.md §3 要求**拿得到對應 git tag**（`修復版本 >=` 必須是真 tag）。但標準收尾順序是 **「先 archive 再 `/commit`」**（archive 是 bookkeeping、`/commit` Step 5 才 bump 版本 + 打 tag + push 發版）——所以 **archive 當下還沒有本次發版 tag**，`git describe --tags` 只會拿到上一版。

因此：

- **archive 收尾 MUST**：(a) 確保 ticket 已是 `進行中`（若還停在 `未開始`/`需確認` 先補轉）；(b) 在 Step 8 summary **明文列出 pending 動作**：「📌 Notion ticket `<page_id>`：本 change 已 archive，待 `/commit` 發版產 git tag 後 → 轉 `驗收中` + 填 `修復版本 >= <tag>`」。
- **發版完成後 MUST**：同一主線跑完 `/commit`（tag 已存在、push 已觸發 deploy）後，**立即** `git describe --tags --abbrev=0` 抓 tag，執行 `進行中 → 驗收中` + 寫 `修復版本 >= <tag>`。**NEVER** 把這步丟給「下次想起來」。

> consumer 若有 deploy 後 CI 綠燈確認流程（如 <consumer-b> Post-Push CI Watcher），`驗收中` 轉移 SHOULD 等 CI 綠燈（deploy 真的成功）再推，避免 tag 出去但 deploy 紅燈卻已標驗收中。

---

## 執行機制

- **入口**：走 `/notion-board`（inbound 全生命週期 skill）的狀態同步路徑，或依 `_notion-tdms-board/REFERENCE.md §3/§4` 直接 `ntn api -X PATCH "/v1/pages/<page_id>"` 改單一 `狀態` / `修復版本 >=` 欄位。
- **寫入前 MUST**：`notion-fetch collection://<dataSourceId>`（consumer-meta `notion.dataSourceId`）重撈 schema，property key（中文 + 全形空格 + `>=`）一字不差 copy-paste，**NEVER** 憑記憶拼 property 名（REFERENCE.md §2 hard rule）。
- **欄位邊界**（REFERENCE.md §2）：只寫 `狀態` 與 `修復版本 >=`（+ 必要時 `備註` 補開發備註）。**NEVER** 動 `名稱`（客戶原始描述）、`發布日期`（客戶提報日，不是發版日）、`驗收日期`（客戶側）、`驗收完成`（系統 readOnly）。

---

## Consumer 採用（consumer-meta `notion` block）

consumer 在自家 `.claude/consumer-meta.json` 加（schema 見 `registry/consumer-meta.schema.json`）：

```jsonc
"notion": {
  "ticketWorkflow": true,
  "boardDatabaseId": "<database-id>",
  "dataSourceId": "<data-source-id>",      // 建/改 page 用這個
  "referenceSkill": "_notion-tdms-board"   // 全域 skill dir，承載該 board 的真相層（座標 / schema / 狀態機）
}
```

- consumer-self 決策（per [[consumer-meta]] § Adoption），**NEVER** 由 clade 主線替 consumer 填。
- `boardDatabaseId` / `dataSourceId` / `referenceSkill` 是 per-consumer 事實（不同 consumer 不同 board）——本規則靠它參數化，不寫死 <consumer-b> 座標。
- 未採用的 consumer：`notion` block 缺 / `ticketWorkflow:false` → 本規則 silent no-op。

---

## 與「對外輸出需 user 授權」的關係

clade / 全域行為準則：對外發訊息 / 改工單屬 outbound，預設要 user 明確指示才做。**本規則本身就是那道 standing direction**——user 採用 `notion.ticketWorkflow:true` + 把 ticket 連進 change，即等同授權 spectra 流程在**授權轉移範圍內**（REFERENCE.md §3 的 ✅ 列）自動推進狀態。但：

- 授權**僅限** §3 的 ✅ 開發側轉移；客戶側（`驗收中→完成` 等）仍 **NEVER** 自動碰。
- 採用是 opt-in（consumer-meta flag）+ per-change（要有連結），不是全域預設。

---

## MUST

- consumer 採用 + change 有連結時，**MUST** 在 spectra-apply 收尾把 ticket 推到 `進行中`、在 archive 收尾 surface pending `驗收中` 並於發版後完成。
- 寫 Notion 前 **MUST** `notion-fetch` 重撈 data source schema 校對 property key。
- `驗收中` **MUST** 帶真 git tag 填 `修復版本 >=`。
- 推任何狀態前 **MUST** 確認該 change 有 active claim（per [[work-claims]] / [[session-claims]]）——無主 WIP 不代表 board 該動。

## NEVER

- **NEVER** 對 `notion.ticketWorkflow` 未啟用 / change 無連結的情況硬湊 ticket 更新。
- **NEVER** 碰 §3 客戶側轉移（`驗收中→完成` / `完成→封存` / 跳過驗收直接封存）。
- **NEVER** 覆寫 `發布日期`（客戶提報日）、`驗收日期`、`名稱`、`驗收完成`。
- **NEVER** 無 git tag 就標 `驗收中` 或亂填 `修復版本 >=`。
- **NEVER** 把連結存進 `.spectra/`（unpark 覆蓋）或只存 HANDOFF.md（session-scoped）。
- **NEVER** 憑記憶拼 Notion property key（中文 + 全形空格 + `>=`，憑記憶必錯）。

## Cross-ref

| 主題 | 真相層 |
| --- | --- |
| Notion 狀態機 + 轉移授權表 + 欄位邊界 + 版本對照 | `~/.claude/skills/_notion-tdms-board/REFERENCE.md` §2–§4（單一真相層） |
| inbound ticket 全生命週期（scan / triage / sync / report） | `~/.claude/skills/notion-board/SKILL.md` |
| outbound 決策題建立 ticket | `~/.claude/skills/notion-ticket/SKILL.md` |
| consumer 能力宣告 / aggregator | [[consumer-meta]] |
| change ownership / claim | [[work-claims]]、[[session-claims]] |
| 發版 / git tag 產生點 | [[commit]] Step 5（版本號升級 + tag push） |

## 違反時的回報方式

```
[spectra-notion-coupling] ticket 狀態漏同步

問題：change <name> 連結 ticket <page_id>，但 <生命週期事件> 後 ticket 狀態未推進

修正：
  - notion-fetch 重撈 schema → 依 §3 授權表推 <正確轉移>
  - 發版類轉移補填 修復版本 >= <git tag>

繞過：
  - consumer 未採用 → 在 .claude/consumer-meta.json 設 notion.ticketWorkflow=false（或留空）
  - 該 change 不對應任何客戶 ticket → proposal.md 不放連結即 silent skip
```
