
# Rule 1 - 每個 feature 都要有 source evidence，以有上限的 prescan 收集

- Level: `MUST`
- 每個 feature 都要有 source evidence。依 clade routing threshold 收集：來源多時用一個 read-heavy／exploration prescan 批次處理，NEVER 照 upstream 原版無上限「一 feature 一 subagent」fan-out。
- Children／prescan 只讀 source，不 drive app、不改檔。每個 feature 回傳：

```text
feature summary
source entry points with repo-relative locations
likely drift or none
one concise live recipe
```

## Good Example

- 這個例子是好的，因為 12 個 feature 用一個 prescan 批次處理。

```text
12 個 feature → 一個 read-heavy prescan，逐 feature 回四欄
```

## Bad Example

- 這個例子是壞的，因為無上限 fan-out。

```text
12 個 feature → 派 12 個 subagent 各讀一個
```

# Rule 2 - 對帳時合併 recipe，source clean 不替代 live pass

- Level: `MUST`
- 每個 feature file 都有 source summary。
- 合併重疊 recipes，減少 app state transitions。
- recent churn 只有具體 user-facing source path 才能判 missing feature。
- source 看起來 clean **不替代** live pass。
- index 修正只改結構時，仍必須進 live pass 才能成為 `changed`。

## Good Example

- 這個例子是好的，因為依具體 user-facing path 判 missing feature。

```text
pages/exports/index.vue 新增、map 沒有 → missing feature「匯出」
```

## Bad Example

- 這個例子是壞的，因為 source 沒變就跳過 live pass。

```text
source 全部 likely drift: none → 直接報 clean
```
