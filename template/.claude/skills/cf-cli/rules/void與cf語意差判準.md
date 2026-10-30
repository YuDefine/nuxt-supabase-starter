# Rule 1 - void 能做的不用 cf；改打 cf 時逐列對照語意差，D1 預設打 production

- Level: `MUST`
- 部署、本機 dev、型別、D1 migration／execute、secret sync、網域、log、rollback 優先用 `void`；只有 void 不涵蓋的操作才改打 `cf`。
- 從 void 換成 `cf`，或把 wrangler 指令改寫成 `cf`，逐列對照下表，每一列都要在新指令上處理到：

| 面向 | void | `cf` |
|---|---|---|
| D1 指令目標 | 專案 `void.config.ts` 綁定的資料庫（不用指名） | database **UUID**（`cf d1 list --name <name>` 取得） |
| D1 預設打哪裡 | **本機**（遠端要 `--remote`） | **遠端 production** |
| `--local` | `void db execute` 預設就是專案 dev server 的本機 state | cf 自己的 state（`~/.config/cloudflare/state`），**看不到** dev server 的資料——查 dev 資料用 `void db execute <sql>`，NEVER 用 `cf d1 query --local` |
| D1 migrations | `void db status`／`void db migrate`，`void deploy` 自動套用 | `cf d1 migrations list\|apply`：目錄用 `--dir`（預設 `./migrations`）；Drizzle 巢狀 layout 加 `--pattern "<dir>/*/migration.sql"` |
| D1 還原點 | `void deploy` 套 migration 前自動存 Time Travel 點 | `cf d1 time-travel get-bookmark\|restore`，要自己先取 bookmark |
| secret | `void secret put\|sync\|list\|delete` | `cf workers secrets bulk --file`（見 Phase 4） |

- 從 wrangler 遷移的對照：`wrangler d1 execute <name>`（本機）→ `void db execute <sql>`；`wrangler d1 execute <name> --remote` → `void db execute <sql> --remote`。只有非 void Worker 才換成 `cf d1 query <uuid>`。
- 把 `void db execute`（本機）直接換成 `cf d1 query <uuid>` 等於改打 production。

## Good Example

- 這個例子是好的，因為查 dev 資料留在 `void db execute`，要查遠端 production 才刻意改用 cf 並換成 UUID。

```bash
# dev server 的資料
void db execute "select count(*) from users"
# 遠端 production（刻意；非 void Worker 或 void 不涵蓋時）
cf d1 query "$(cf d1 list --name app-db | jq -r '.[0].uuid')" <查詢參數，見 cf d1 query --help>
```

## Bad Example

- 這個例子是壞的，因為原指令查本機，改寫後卻在 production 跑 delete。

```bash
# 原本：void db execute "delete from sessions"
cf d1 query <uuid> <同一句 delete>
```
