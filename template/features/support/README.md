# BDD（SpecFormula + Cucumber）執行方式

backend wire BDD：`specs/truth/features/backend/**/*.feature` 經 `features/steps/*.steps.ts`
的 custom step 打到真實啟動的 Nuxt dev server 與本機 Supabase Postgres。

## 前置

1. 本機 Supabase：`supabase start`（套用 migrations + seed）。DB port 預設 54322，
   被佔用時改 `supabase/config.toml` 的 `db.port` 並用 `SPECFORMULA_DB_PORT` 告訴 runner。
2. `.env`：從 `.env.example` 複製並填入本機值（`SUPABASE_URL`、`SUPABASE_SECRET_KEY`、
   `BETTER_AUTH_SECRET` 等）。
3. Dev server（**必須** `SPECFORMULA_TEST=1`，否則 `/test/*` 控制面被
   `server/middleware/00.test-routes-guard.ts` 擋成 404）：

   ```bash
   SPECFORMULA_TEST=1 pnpm dev
   ```

## 執行

```bash
pnpm test:bdd
```

環境變數：`SPECFORMULA_BASE_URL`（預設 `http://127.0.0.1:3020`）、
`SPECFORMULA_DB_HOST/PORT/NAME/USER/PASSWORD`（預設 127.0.0.1:54322 postgres/postgres）。

## 結構

- `features/support/environment.ts`——唯一 bootstrap 入口：plugin 載入、isa.yml 讀取、
  `StepDefinitionFactory.register`（MUST 留在 module load 階段）、`/test/health` 等待、
  `SpecFormulaBridge` 初始化（Postgres datasource + FetchHttpClientAdapter）。
- `features/steps/*.steps.ts`——custom step。規約 NEVER：內建六指令能表達的句型
  不准在這裡複寫；profiles 的句型全是 wire-oriented 特化（延遲 fixture 落地、
  dev-login 別名綁定、REVOKE 故障注入、`/test/db-log` 觀測斷言），集中於
  `profiles.steps.ts`。
- `/test/health`、`/test/db-log`——測試控制面，只在 `SPECFORMULA_TEST=1` 且非
  production 下可達。

## 斷言紀律

- `權威狀態`（資料表）斷言走獨立 pg 連線直讀 DB，不讀 app 記憶體。
- 「沒有被查詢」類斷言經 `/test/db-log` 觀測 app 的 outbound PostgREST 請求；
  授權角色查詢（`select=role`）是允許的讀取（TD-026 D3）。
