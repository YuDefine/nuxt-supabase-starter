
# Rule 1 - 每次 maintain 只選一個 outcome，照其 Git／PR 行為收尾

- Level: `MUST`
- 每次只能選一個，由上而下取第一個命中的列：

評估：first-match；以上皆非 → O*

| id | predicate | Outcome | Git／PR 收尾動作 |
| --- | --- | --- | --- |
| O1 | coverage 無法完成，或 proven correction 無法安全落地 | `blocked` | 不開 PR；列已覆蓋範圍、blocker 與 preserved evidence；scratch run summary 保留但不 commit |
| O2 | 有已 live re-prove 的 doc、map 或 owned harness correction | `changed` | 重讀每個 changed file；只落 target verification skill dir；依 consumer `workflow_model` 建一個 PR 或 selective commit 落 trunk |
| O3 | 每個 feature 都有 source + live coverage，且沒有值得落地的 map／harness diff | `clean` | **現況結果**：確認 target dir 無 diff（dirty verification diff 為零）；不建 branch、不 commit、不開 PR |
| O* | 以上皆非 | `blocked` | 同 O1，回報判不出 outcome 的原因 |

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
