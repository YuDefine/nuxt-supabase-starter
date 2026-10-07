
# Rule 1 - 每次 maintain 只選一個 outcome，照其 Git／PR 行為收尾

- Level: `MUST`
- 每次只能選一個：

| Outcome | 必要條件 | Git／PR 行為 |
| --- | --- | --- |
| `clean` | 每個 feature 都有 source + live coverage，沒有值得落地的 map／harness diff | **現況結果**：不建 branch、不 commit、不開 PR；dirty verification diff 必須為零 |
| `changed` | 已 live re-prove 的 doc、map 或 owned harness correction | 只包含 target verification skill；依 consumer `workflow_model` 建一個 PR，或以 selective commit 落 trunk |
| `blocked` | coverage 無法完成，或 proven correction 無法安全落地 | 不開 PR；列出已覆蓋範圍、blocker 與 preserved evidence |

- 收尾動作：
  - `clean`：確認 target dir 無 diff；不建 branch、不 commit、不開 PR。
  - `changed`：重新讀每個 changed file；只落 target dir；依 workflow model 建一個 PR 或 selective commit。
  - `blocked`：不開 PR；保留 evidence 與 scratch run summary，不把 scratch notes commit。

## Good Example

- 這個例子是好的，因為 `changed` 只落 target dir、建一個 PR。

```text
outcome: changed；diff 只有 <skills-root>/verify-<consumer-id>/features/loans.md；workflow_model=github-flow → 開一個 PR
```

## Bad Example

- 這個例子是壞的，因為同時落了產品 code。

```text
outcome: changed；diff 含 verify-<consumer-id>/** 與 server/api/loans.ts
```

# Rule 2 - `clean` 是成功交付，NEVER 製造空 PR 當活動證明

- Level: `MUST`
- **`clean` 是成功交付，不是「什麼都沒做」。** 它必須帶 coverage 與 evidence summary，但 repository outcome 保持無 branch／無 commit／無 PR。
- 每日 unattended run 命中 `clean` 時也遵守同一契約，**NEVER** 製造空 PR 當活動證明。`blocked` 同樣不得藉由空 PR 表達狀態。

## Good Example

- 這個例子是好的，因為 clean 帶 coverage 但不開 PR。

```text
outcome: clean；source 5/5、live 5/5；evidence 5 份；無 branch／無 commit／無 PR
```

## Bad Example

- 這個例子是壞的，因為為了留下紀錄開空 PR。

```text
outcome: clean → 開 PR「verification: daily check ok」，只改了 README 的日期
```

# Rule 3 - Timeout 不自動批准

- Level: `MUST`
- Product ruling 永不因 timeout 自動批准。External action 到期轉 `blocked`／`cancelled`，恢復時建立新 gate；**NEVER** 用過期答案繼續 live pass。

## Good Example

- 這個例子是好的，因為到期後轉 blocked、恢復時重開 gate。

```text
產品裁決 gate 到期 → outcome: blocked；恢復時重建 gate 再問
```

## Bad Example

- 這個例子是壞的，因為拿過期答案繼續。

```text
三天前使用者說「先這樣」→ 當成批准，繼續 live pass
```
