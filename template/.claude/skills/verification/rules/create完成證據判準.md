
# Rule 1 - 沒實跑過的 generated skill 是 draft，五格完成證據逐格勾

- Level: `MUST`
- 交付前逐格確認：
  - [ ] validator exit 0
  - [ ] Launch／Doctor／Drive／Evidence／Cleanup invocation 與結果可重跑
  - [ ] cleanup 後 evidence 仍存在
  - [ ] git diff 只含 verification infrastructure 與明確 scaffolding
  - [ ] 沒有宣稱任何產品 change 已被 UX owner 接受
- 本 skill 只建立 verification infrastructure；**NEVER** 替某個產品 change 宣告驗收通過。Verification evidence 本身不宣告產品 change 已被接受；acceptance 仍歸產品 owner 或指定 reviewer。

## Good Example

- 這個例子是好的，因為每格都有可重跑的證據。

```text
[x] validator exit 0（node <skills-root>/verification/scripts/check-feature-map.mjs <skills-root>/verify-<consumer-id>）
[x] 閉環：pnpm dev → doctor ok → drive create-save → evidence screenshots/local/verify/create-save.png → cleanup
[x] cleanup 後 evidence 仍在
[x] git diff 只有 <skills-root>/verify-<consumer-id>/**
[x] 未宣稱 UX accepted
```

## Bad Example

- 這個例子是壞的，因為沒實跑就交付，還宣告驗收。

```text
verify skill 已產生，結構看起來沒問題，這個功能驗收通過
```

# Rule 2 - 交棒維護時交代四件事，排程只在使用者問 cadence 時推薦

- Level: `MUST`
- 輸出 target path、已實跑 feature、evidence path、known unreachable prerequisites，並指出後續用 `/verification maintain`。
- 只有使用者詢問 cadence 時才推薦時間排程；control-plane 預設在 user-facing source change 後與正式驗收前觸發維護。

## Good Example

- 這個例子是好的，因為四件事齊全並指向 maintain mode。

```text
target：<skills-root>/verify-<consumer-id>；已實跑：create-save；evidence：screenshots/local/verify/；unreachable：SSO 登入（需 IdP 測試帳號）。後續用 /verification maintain。
```

## Bad Example

- 這個例子是壞的，因為沒人問就推排程，也沒交代 unreachable。

```text
完成！建議每週一排程跑一次 maintain。
```
