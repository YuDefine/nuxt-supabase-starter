# Rule 1 - 改寫 wrangler 指令時逐列對照語意差，D1 預設打 production

- Level: `MUST`
- 把 wrangler 帳號操作改寫成 `cf` 時，逐列對照下表，每一列都要在新指令上處理到：

| 面向 | wrangler | `cf` |
|---|---|---|
| D1 指令目標 | database **name** | database **UUID**（`cf d1 list --name <name>` 取得） |
| D1 預設打哪裡 | 本機（遠端要 `--remote`） | **遠端 production** |
| `--local` | 專案 dev server 的本機 state | cf 自己的 state（`~/.config/cloudflare/state`），**看不到** dev server 的資料——查 dev 資料用 `wrangler d1 execute <db> --local`，dev server 的 state 不在 wrangler 預設目錄（例如 NuxtHub dev）時加 `--persist-to <該目錄>` |
| D1 migrations 目錄 | wrangler config `migrations_dir` | `--dir`（預設 `./migrations`）；Drizzle 巢狀 layout 加 `--pattern "<dir>/*/migration.sql"` |

- 把 `wrangler d1 execute <name>`（本機）直接換成 `cf d1 query <uuid>` 等於改打 production。

## Good Example

- 這個例子是好的，因為查 dev 資料留在 wrangler `--local`，要查遠端才改用 cf 並換成 UUID。

```bash
# dev server 的資料
pnpm exec wrangler d1 execute app-db --local --command "select count(*) from users"
# 遠端 production（刻意）
cf d1 query "$(cf d1 list --name app-db | jq -r '.[0].uuid')" <查詢參數，見 cf d1 query --help>
```

## Bad Example

- 這個例子是壞的，因為原指令查本機，改寫後卻在 production 跑 delete。

```bash
# 原本：wrangler d1 execute app-db --command "delete from sessions"
cf d1 query <uuid> <同一句 delete>
```
