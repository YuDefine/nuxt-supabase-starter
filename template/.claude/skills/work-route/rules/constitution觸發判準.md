# constitution 觸發判準

觸發點：`SKILL.md` Phase 3 step 4（project constitution 缺失，或本次要調整時）。

# Rule 1 - constitution 缺失或要調整時由 owner 做最小增量；內部契約與 project artifact 不互相替代

- Level: `MUST`

本次要調整 project constitution，或下一 owner 必讀的 constitution 缺失時，載入本 skill 的 `rules/.constitution/SKILL.md` 及其要求的資源，由該 owner 做最小增量處理。已授權工作中的可確定前提直接補齊；會改需求、權限或高影響規則時，只問具體缺口。缺失就是本條的觸發條件，不是豁免：既有 plan 寫「constitution 未存在，本輪不改 constitution artifact」**NEVER** 構成前例，由 owner 建最小版、獨立落地，再續跑原工作——照那句跳過，每個 session 會各留一份互不相同、未落地的 constitution。

內部 `rules/.constitution/**` 是執行契約；專案 `.agents/constitution/**` 是治理 artifact。兩者不能互相替代。按當前 checkout 驗證 project artifact，不拿另一 worktree 的未提交檔冒充存在，也不把內部契約複製成 project constitution。

## Good Example

- 這個例子是好的，因為constitution 缺失時由 owner 建最小版、獨立落地後續跑原工作。

```text
下一 owner 必讀的 constitution 不存在 → 載入 rules/.constitution/SKILL.md → 建最小版並落地 → 續跑原工作
```

## Bad Example

- 這個例子是壞的，因為照既有 plan 的 Decisions 句子跳過，或把內部執行契約複製成 project constitution。

| 藉口（逐字，出自既有 plan 的 Decisions） | 現實 |
| --- | --- |
| 「constitution 未存在，本輪不改 constitution artifact」 | 缺失就是本條的觸發條件，不是豁免——照這句跳過，每個 session 會各留一份互不相同、未落地的 constitution。既有 plan 這樣寫 **NEVER** 構成前例：由 owner 建最小版、獨立落地，再續跑原工作 |

```text
plan Decisions 寫「constitution 未存在，本輪不改」→ 沿用這句跳過
```
