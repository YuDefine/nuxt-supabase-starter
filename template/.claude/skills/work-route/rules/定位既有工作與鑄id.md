# 定位既有工作與鑄 work id

觸發點：SKILL.md 第 1 步（續跑既有工作、提出方案或鑄新 work id 之前）。文中「第 N 節」指 SKILL.md 的第 N 步與它讀取的判準檔：第 0 節 `rules/worktree隔離與work-id.md`、第 1 節 `rules/定位既有工作與鑄id.md`、第 2 節 `rules/owner載入與代打.md`、第 3 節 `rules/前提修復與gate失敗.md`、第 4 節 `rules/依產物推進.md`、第 5 節 `rules/驗收交付與回報.md`；「上表」「判定表」未另指明時指 `rules/需求分流與免package.md` Rule 2。

# Rule 1 - 提出方案或鑄新 id 之前先列每一份 active plan，重疊就續跑

- Level: `MUST`

讀取本次需求、適用 `specs/truth/**`、既有 package 的 spec／plan／research／tasks 及證據；只續跑本次相關且未完成的工作。

**提出方案或鑄新 work id 之前**，MUST 列出**每一份** active plan（lifecycle repo：`flow plan list`），對**每一份** Scope 與本次需求重疊的 plan 讀完 `plan.md` 的 Scope、Decisions 與 Open work。重疊就續跑那一份；部分重疊時，新 plan 的 Scope MUST 有分工表寫明哪一塊歸哪個 work id（`flow plan open` 的 entry gate 只擋同 slug）。

## Good Example

- 這個例子是好的，因為逐份讀過重疊的 plan 才決定續跑或分工。

```text
flow plan list → 兩份 Scope 與本次需求重疊 → 各讀 Scope／Decisions／Open work → 其一涵蓋本需求 → 續跑那一份
```

## Bad Example

- 這個例子是壞的，因為只因 slug 不同就另開 package，沒有分工表。

```text
沒跑 flow plan list → flow plan open <新 slug>（entry gate 只擋同 slug，照樣過）
```

# Rule 2 - package 落點依 lifecycle marker 判定；缺 marker 是要先修的前提

- Level: `MUST`

已有 `plan.md` frontmatter 同時含 `work_id:` 與 `truth_baseline:` 時，沿用 `specs/plans/<work-id>/`。新工作：repo 根有 `specs/truth/work-lifecycle.md` 時 MUST 先 `flow plan open` 鑄 `W-…`，並以 `--kind` 記錄上表判定的工作種類；值域、各種類的必要產物與迴歸錨點寫法見 `rules/工作種類與必要產物.md`，**每一次**開 package 或改判之前讀它。manifest 宣告 `aixbdd`／`specformula` 卻沒有該檔，是要先修的前提而不是降級理由：照第 3 節第 3 步處理 truth root，再 `flow plan open`；**NEVER** 靜默改鑄 `NNN-<slug>`。只有兩側都沒宣告、且使用者沒有要採用 lifecycle 的 consumer 才鑄 `NNN-<slug>`。不為補前提、轉 owner 或重試另開 package。

## Good Example

- 這個例子是好的，因為manifest 宣告 aixbdd 卻缺 work-lifecycle.md 時先修 truth root 再鑄 W-。

```text
manifest 宣告 aixbdd、缺 specs/truth/work-lifecycle.md → 照第 3 節第 3 步處理 truth root → flow plan open --kind …
```

## Bad Example

- 這個例子是壞的，因為把缺檔當降級理由，靜默改鑄舊式 package。

```text
缺 specs/truth/work-lifecycle.md → 改鑄 NNN-<slug>
```

# Rule 3 - 鑄新 work id 之前照 predicate 表決定要不要問 Notion ticket

- Level: `MUST`

**Notion ticket 詢問（鑄新 work id 之前）**：確定是新需求／新 bug 要鑄 work id 時，先在 consumer 根跑 `node ~/offline/clade/vendor/scripts/lib/notion-hub.ts resolve --consumer-path .`（script 只在 clade 中央倉，consumer 沒有這份；不寫死任何 id）。由上而下取第一個成立的列：

| 可觀察 predicate | 處理 |
| --- | --- |
| 續跑既有 package、已從 Notion 票認領（`--origin notion:`），或免 package 工作 | 不問，照上段 |
| `configured: false`（未宣告 `notion.hub`） | 不問，照上段鑄 work id |
| resolve 失敗（非 0 exit、輸出不是 JSON） | 不問；照上段鑄 work id，並告知使用者 hub 解析失敗與錯誤原文，不靜默略過 |
| `configured: true`、`hub.ticketType` 為 null | 不問（使用者明說要開票也一樣）；照上段鑄 work id，並告知該 hub 的 `類型` 選項未驗證、`file` 會拒寫 |
| `configured: true`，使用者已在需求裡明說要／不要開票 | 不問，直接照下方「要」／「不要」處理 |
| `configured: true`，以上都不成立 | 鑄 work id **之前**問一次「要不要為這件工作建 Notion ticket」，附選項（推薦排第一）。`hub.delivery` 為 null（board-only hub）時問題 MUST 點明「不建票，客戶在 Notion 上看不到這件工作」 |

「要」→ 照 `notion-hub` skill Phase 4（工程師建票）跑 `node ~/offline/clade/vendor/scripts/notion-sync.ts file --title "<客戶看得懂的一句話>" --kind bug|feature --slug <slug>`，由它建票並鑄 work id（照做它印的 `export CLADE_WORK_ID=…`）；lifecycle repo 接著以 `flow plan open <slug> --work-id <該 id>` 開 package，**NEVER** 另鑄第二個 id。「不要」→ 照上段原流程鑄 work id。這是鑄 id 時的一次性詢問，不是同步步驟；之後的 ticket 推進照 `notion-work-coupling` 跟隨 flow。

## Good Example

- 這個例子是好的，因為resolve 後由上而下取第一個成立的列，該問才問、只問一次。

```text
resolve → configured: true、ticketType 有值、使用者沒說要不要 → 鑄 id 之前問一次（推薦選項排第一）
```

## Bad Example

- 這個例子是壞的，因為建票後又另鑄第二個 work id，或 resolve 失敗時靜默略過不告知。

```text
notion-sync file 已鑄 W-A → flow plan open <slug>（未帶 --work-id）→ 又鑄出 W-B
```

# Rule 4 - constitution 缺失或要調整時由 owner 做最小增量；內部契約與 project artifact 不互相替代

- Level: `MUST`

本次要調整 project constitution，或下一 owner 必讀的 constitution 缺失時，載入本 skill 的 `rules/.constitution/SKILL.md` 及其要求的資源，由該 owner 做最小增量處理。已授權工作中的可確定前提直接補齊；會改需求、權限或高影響規則時，只問具體缺口。

| 藉口（逐字，出自既有 plan 的 Decisions） | 現實 |
| --- | --- |
| 「constitution 未存在，本輪不改 constitution artifact」 | 缺失就是本段的觸發條件，不是豁免——照這句跳過，每個 session 會各留一份互不相同、未落地的 constitution。既有 plan 這樣寫 **NEVER** 構成前例：由 owner 建最小版、獨立落地，再續跑原工作 |

內部 `rules/.constitution/**` 是執行契約；專案 `.agents/constitution/**` 是治理 artifact。兩者不能互相替代。按當前 checkout 驗證 project artifact，不拿另一 worktree 的未提交檔冒充存在，也不把內部契約複製成 project constitution。

## Good Example

- 這個例子是好的，因為constitution 缺失時由 owner 建最小版、獨立落地後續跑原工作。

```text
下一 owner 必讀的 constitution 不存在 → 載入 rules/.constitution/SKILL.md → 建最小版並落地 → 續跑原工作
```

## Bad Example

- 這個例子是壞的，因為照既有 plan 的句子跳過，或把內部執行契約複製成 project constitution。

```text
plan Decisions 寫「constitution 未存在，本輪不改」→ 沿用這句跳過
```
