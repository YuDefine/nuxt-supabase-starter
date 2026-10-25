
# schema mode 偵測什麼

`schema` mode（即 `data-sanity`，Layer C）是唯讀 static data-shape audit，抓 typecheck／lint／design review 都抓不到的**資料形狀**問題：client 傳 `perPage: 200` 而 server schema 是 `.max(100)` → API 400 → lookup map 空 → 整欄顯示 fallback。在 Design Checkpoint、交付人工檢查前，或改到 `useXxxQuery({ <param>: <literal> })`／lookup map 時，對觸及的 paginated query 與 lookup-resolved column 跑一次。

- 不給 `--files` → walk 整個 consumer（skip node_modules／.nuxt／dist）。給 `--files` → 掃指定的既有檔；route 關聯可額外讀取它匯入的 schema。範圍以傳入路徑為準，此參數不提供目錄隔離；只傳本次已授權的路徑。

偵測項：

1. **PARAM_BOUNDARY（Critical — blocks archive）**：client 端 pagination-ish param literal（`perPage`／`per_page`／`pageSize`／`page_size`／`limit`／`take`／`first`／`count`／`top`／`size`）超過（max）或低於（min）同名 server zod bound（`.max(N)`／`.min(N)`／`.length(N)`）。對應 UI-INV-2（lookup-resolved column 解析率 100%）。
2. **LOOKUP_MAP_RISK（advisory／warn）**：`xxxMap`／`xxxLookup`／`xxxById` 從 query data（`.reduce(`／`Object.fromEntries(`／`new Map(`）建的 lookup map。來源 query 若失敗，此 map empty → 對應 column uniform fallback。確認來源 query param 在 schema bound 內。
3. **SUBQUERY_ALIAS_COLLISION（advisory／warn）**：同一 serverish 檔案中重複使用 `.as('alias')`，供查核是否屬同一 SQL query 的衝突；不改 exit code。

JSON schema：`{ status: "pass"|"fail", violations: [{param, clientValue, kind, bound, clientFile, clientLine, clientRoute: string|null, serverFile, serverLine}], lookupRisks: [{name, file, line}], aliasCollisions: [{alias, count, lines, file}], scanned: N }`。

與其他 Layer 的關係：Layer B（`refactor-invariant-check.ts`）runtime 偵測「column 整欄 fallback」（症狀），Layer C static 偵測「param 超界」（root cause），兩者互補；Layer D（`UI-INVARIANTS.md`）的 UI-INV-2 是本 mode 的契約來源；Layer E.1（pre-handoff self-analysis）的 D4 維度（API contract boundary）可直接引用本 audit 結果。

# Rule 1 - exit 1（PARAM_BOUNDARY）是 Critical，MUST block

- Level: `MUST`
- exit 0 `status: "pass"` → 通過。`lookupRisks`／`aliasCollisions` 為 advisory，不 block；JSON 模式從 stdout 讀這兩個陣列，人讀模式在 pass 時印到 stderr。
- exit 1 `status: "fail"`（含 PARAM_BOUNDARY）→ root-cause 修 client literal 到 bound 內（典型：`perPage: 200` → `100`），或若新 bound 是有意則調 server schema。**NEVER** 標 phase／archive done、**NEVER** 留給 user 在 manual review 抓。

## Good Example

- 這個例子是好的，因為依 violation 把 client literal 修回 bound 內再重跑。

```text
[PARAM_BOUNDARY] perPage: 200 (app/pages/amendments.vue:3) vs .max(100) (server/api/employees.get.ts:2)
→ 改 perPage: 100，重跑 audit-data-sanity → exit 0
```

## Bad Example

- 這個例子是壞的，因為把 Critical 當 advisory 放行。

```text
exit 1，但 UI 看起來正常 → 標為完成，留待 manual review
```

# Rule 2 - 零命中不代表未覆蓋路徑已驗過

- Level: `MUST`
- audit 是 regex heuristic，不是完整資料契約驗證：可解析的明確 `/api` 呼叫會對應 route schema；無明確 route 時，僅在同名 bound 可收斂時比對；無法解析的明確 route 會略過；同名 fallback 仍可能 false-link。Bound extractor 只處理 `z...` chain，不覆蓋 Valibot bound、動態參數或所有 schema 寫法。
- PARAM_BOUNDARY 命中後查核實際 endpoint 與 schema；零命中時報告寫明未覆蓋的寫法，**NEVER** 宣稱這些路徑已驗過。

## Good Example

- 這個例子是好的，因為 pass 同時列出 heuristic 沒覆蓋的地方。

```text
schema mode: pass（scanned 214）；未覆蓋：server 以 Valibot 定義的 /api/reports，需人工比對 limit bound
```

## Bad Example

- 這個例子是壞的，因為把 heuristic 零命中寫成全面驗證。

```text
schema mode: pass → 所有 client param 均在 server bound 內
```
