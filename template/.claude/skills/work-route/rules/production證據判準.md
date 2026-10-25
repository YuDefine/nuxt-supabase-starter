# production 證據判準

觸發點：`SKILL.md` Phase 5 step 5（調查、驗收需要 production 資料當證據，或工作本身要修 production 資料時）。

# Rule 1 - 需要 production 資料時只走 prod-sql

- Level: `MUST`

調查 bug、確認 production 現況或驗收需要 production 資料當證據，或工作本身要修 production 資料時，先讀 prod-access 規約（clade 源檔 `rules/core/prod-access.md`，consumer 投影 Claude `.claude/rules/prod-access.md`、Pi `.agents/skills/clade-security/rules/prod-access.md`）；該規約 path-gated，沒載入時照這個路徑直接讀。

| 可觀察 predicate | 處理 |
| --- | --- |
| 只要讀 | `node scripts/prod-sql.ts read --sql '…'`，免提示；結果連同查詢寫進本次工作的 evidence |
| 要改資料列（白名單表、≤500 列） | `prod-sql plan` → 沒有警訊就由 agent 自己 `prod-sql apply`，不等使用者（prod-access § 誰要同意）；有警訊改走 migration。`apply` 能不能指向 production 以 prod-access § 改 prod 資料 當下寫的限制為準，先讀再跑 |
| 要改結構，或超出上一列的範圍 | migration 管線，照 database 規約分類與部署 |
| `prod-sql` 回「沒有憑證檔」 | 本 consumer 尚未接入：照 prod-access § 接入 走：設定檔 PR 合入後 agent 自己 `bootstrap --role agent_ro`（不等使用者授權、不需演練），接入完成後續跑原工作；設定檔還沒合入就先開 PR |

**NEVER** 因為 `prod-sql` 不可用或回報拒絕，就改走 prod MCP 的 `execute_sql`、ssh 進主機下 psql、或借用高權限連線字串；拿不到證據時保留已做工作與原始錯誤，回報具體缺口及解除條件。

## Good Example

- 這個例子是好的，因為讀取直接走唯讀 CLI，沒有為了一句查詢去問使用者。

```text
bug 只在 production 重現 → node scripts/prod-sql.ts read --sql 'select status, count(*) from app.orders group by 1' → 寫進 evidence → 續跑調查
```

## Bad Example

- 這個例子是壞的，因為繞過唯一入口，權限檢查、授權與回退資料全部不存在。

```text
prod-sql 回「沒有憑證檔」→ ssh <prod-host> docker exec supabase-db psql -U postgres -c 'update …'
```
