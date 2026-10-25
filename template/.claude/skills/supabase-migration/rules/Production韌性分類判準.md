
# Rule 1 - 部署路線依分類器輸出決定，NEVER 手判

- Level: `MUST`
- 分類等級的定義與範例以 `rules/modules/db-runtime/supabase-self-hosted/postgrest-resilience.md` § Migration Classification 與 `migration.md` § Pending Migration 分類為準，本 rule 不重寫第三份表。
- 路線一律取分類器（`classify-migration.mjs` 或 canonical `classify-migrations.ts`）輸出的 `overall`；**NEVER** 依印象改判較低等級，SQL 檔頭的 `-- Migration risk:` 只是證據，不覆寫分類器結果。
- 對應動作：

| `overall` | 動作 |
| --- | --- |
| `online_safe` | 可在線上跑，仍走 Phase 4 step 3 的 `/ready` gate 與 smoke |
| `expand_contract_required` | 拆成 expand → app rollout → contract 多次部署，**NEVER** 一次 deploy |
| `maintenance_required` | hard stop；記錄 rollback、maintenance window 與使用者影響後才可核准 |
| `review_required` | hard stop；人工 review 後才能決策 |

## Good Example

- 這個例子是好的，因為它照分類器的輸出走 hard stop。

```text
classify-migration.mjs → overall: maintenance_required（maintenance-alter-column-type）
決策：停止部署，記錄 maintenance window、rollback 步驟與受影響頁面後送核准
```

## Bad Example

- 這個例子是壞的，因為它用經驗把分類器的結果降級。

```text
classify-migration.mjs → overall: maintenance_required
決策：只是改欄位型別，表不大，直接上線
```

# Rule 2 - migration 安全不靠 app 端補救，evidence 必須保存

- Level: `MUST`
- **NEVER** 宣稱所有 migration 都能零停機。
- **NEVER** 把 app code 的 retry 或 session 修正當成 migration safety。
- 區分 PostgREST schema cache reload 與 DB lock：split surface 不能解除同一張 table 的 blocking lock。
- self-host production deploy **MUST** 保存 `/ready` evidence、traffic smoke summary 與 PostgREST logs。

## Good Example

- 這個例子是好的，因為它分開處理 lock 與 reload，並保存三份 evidence。

```text
lock：DDL 前 SET lock_timeout = '3s'
reload：A instance reload → /ready 200 → B instance reload → /ready 200
evidence：ready-watch 輸出、smoke-runner summary、docker logs supabase-rest
```

## Bad Example

- 這個例子是壞的，因為它用前端 retry 掩蓋 blocking DDL。

```text
前端遇 503 自動 retry 三次，所以這支 ACCESS EXCLUSIVE migration 可以白天上線
```
