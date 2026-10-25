# 鑄 work id 前 Notion 詢問判準

觸發點：`SKILL.md` Phase 3 step 3（確定是新需求／新 bug 要鑄 work id 之前）。

# Rule 1 - 鑄新 work id 之前照 predicate 表決定要不要問 Notion ticket

- Level: `MUST`

**Notion ticket 詢問（鑄新 work id 之前）**：確定是新需求／新 bug 要鑄 work id 時，先在 consumer 根跑 `node ~/offline/clade/vendor/scripts/lib/notion-hub.ts resolve --consumer-path .`（script 只在 clade 中央倉，consumer 沒有這份；不寫死任何 id）。由上而下取第一個成立的列：

| 可觀察 predicate | 處理 |
| --- | --- |
| 續跑既有 package、已從 Notion 票認領（`--origin notion:`），或免 package 工作 | 不問，照 `工作種類與必要產物.md` Rule 5 的 package 落點續行 |
| `configured: false`（未宣告 `notion.hub`） | 不問，照 `工作種類與必要產物.md` Rule 5 鑄 work id |
| resolve 失敗（非 0 exit、輸出不是 JSON） | 不問；照 `工作種類與必要產物.md` Rule 5 鑄 work id，並告知使用者 hub 解析失敗與錯誤原文，不靜默略過 |
| `configured: true`、`hub.ticketType` 為 null | 不問（使用者明說要開票也一樣）；照 `工作種類與必要產物.md` Rule 5 鑄 work id，並告知該 hub 的 `類型` 選項未驗證、`file` 會拒寫 |
| `configured: true`，使用者已在需求裡明說要／不要開票 | 不問，直接照下方「要」／「不要」處理 |
| `configured: true`，以上都不成立 | 鑄 work id **之前**問一次「要不要為這件工作建 Notion ticket」，附選項（推薦排第一）。`hub.delivery` 為 null（board-only hub）時問題 MUST 點明「不建票，客戶在 Notion 上看不到這件工作」 |

「要」→ 照 `notion-hub` skill Phase 4（工程師建票）跑 `node ~/offline/clade/vendor/scripts/notion-sync.ts file --title "<客戶看得懂的一句話>" --kind bug|feature --slug <slug>`，由它建票並鑄 work id（照做它印的 `export CLADE_WORK_ID=…`）；lifecycle repo 接著以 `flow plan open <slug> --work-id <該 id>` 開 package，**NEVER** 另鑄第二個 id。「不要」→ 照 `工作種類與必要產物.md` Rule 5 原流程鑄 work id。這是鑄 id 時的一次性詢問，不是同步步驟；之後的 ticket 推進照 `notion-work-coupling` 跟隨 flow。

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
