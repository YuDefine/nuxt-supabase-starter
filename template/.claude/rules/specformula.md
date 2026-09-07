---
description: SpecFormula BDD/SDD 框架在 Nuxt 4 + Supabase consumer 的採用契約——spec-first 順序、isa.yml 與 /test/* 控制面契約、業務時鐘單一來源、hosted Supabase 的 SSL 阻斷
paths: ['features/**', 'specs/api/**', 'specs/data/**', 'isa.yml', 'cucumber.cjs', 'server/routes/test/**', 'server/utils/time-service.ts', 'packages/*/server/routes/test/**', 'packages/*/server/utils/time-service.ts']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/specformula.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


<!-- clade-targets: claude,codex,cursor -->

# SpecFormula 標準（fleet 唯一 SDD/BDD 框架）

> Upstream: <https://github.com/SpecFormula/specformula-dev-framework>。clade 端有兩份：`vendor/specformula/`（git submodule，完整上游）與 `vendor/specformula-ts/`（curated mirror，由 `scripts/sync-upstream-mirrors.ts` 依 `registry/upstream-submodules.json` 生成，帶 `PIN.json` / `MANIFEST.json`）。散播到 consumer 的是後者，落點同名 `vendor/specformula-ts/`。
>
> Cookbook（全部 template 與安裝 SOP）：`~/offline/clade/vendor/snippets/specformula/`
>
> Convention 定位與 variant：`docs/conventions/sdd-framework.md`
>
> Audit signal：`node scripts/audit-specformula-adoption.ts`

**核心命題**：SpecFormula 的 step definition 由 `isa.yml` 的 regex 動態生成，不是人寫的。所以「規格」與「測試」是同一份檔案——OpenAPI 的 `summary`、DDL 的表定義、`.feature` 的中文指令三者對得起來，測試才跑得起來。對不上時失敗訊息指向 spec，不指向測試碼。

## 何時用 / 不用

| 可觀察 predicate | 採用 |
| --- | --- |
| consumer 的 `.claude/hub.json` 宣告 `capabilities: ["specformula"]` | ✅ 本檔全部條款生效 |
| Nuxt 4 + PostgreSQL（Supabase）且有 HTTP API 要驗收 | ✅ 適用對象 |
| 無資料庫的服務（純 proxy、純靜態、純 CLI） | ❌ 不用——`entity_setup` / `entity_validate` 佔六個內建指令的一半，沒有 DB 時框架只剩 API 斷言，不值那套安裝成本 |
| 需要對 **hosted** Supabase（`*.supabase.co`）跑 BDD | ❌ **目前不可行**，見下方 NEVER 第 2 條 |
| 既有 consumer 已跑 spectra（legacy SDD） | 併存，新增的 API operation 走 SpecFormula；遷移節奏由該 consumer 自己決定 |
| consumer 同時宣告 `aixbdd` | 上游流程層也生效：`.feature` 與 DSL 由 [`aixbdd-workflow.md`](./aixbdd-workflow.md) 的九步產出，本檔管它們怎麼跑。**兩個 capability 各自獨立**——只宣告 `specformula`、自己手寫 `isa.yml` 與 `.feature` 是合法路徑 |

## API surface

packages 未發佈到 npm（全部 `private: true`），**從原始碼消費**：`exports` 直接指向 `src/index.ts`，靠 `tsx` 在 runtime 轉譯，沒有 build 步驟。

```jsonc
// pnpm-workspace.yaml
packages: ['vendor/specformula-ts/packages/*']
// package.json
"test:bdd": "NODE_OPTIONS='--import tsx' cucumber-js"
```

| 匯出 | 來源 | 用途 |
| --- | --- | --- |
| `SpecFormulaBridge.getInstance()` | `@specformula/node` | 單例；`setDataSource` / `setHttpClient` / `setAuthenticator` / `initialize` / `newScenario` / `endScenario` / `closeAllDataSources` |
| `createPostgresDataSource(config, schema?)` | `@specformula/node` | `config` 只有 `host` / `port` / `database` / `username` / `password`；`schema` 走 pg 的 `options: -c search_path`（ADR ts-0011） |
| `FetchHttpClientAdapter(baseUrl)` | `@specformula/node` | 打**已在跑的** server。沒有 Nuxt / h3 in-process adapter，`SupertestHttpClientAdapter` 需要 Express-style handle，Nitro 不給 |
| `Authenticator` | `@specformula/core` | `buildAuthHeaders(token)` 必要成員；`getToken(actorId)` 把 feature 裡 `(UID="$Alice.id")` 的 actor id 換成 bearer token |
| `StepDefinitionFactory.register()` / `loadSpecFormulaPlugins()` | `@specformula/cucumber` | **MUST 在 module load 時跑**，不能放 `BeforeAll`——cucumber 載 feature 之前就要看得到 step definition |
| `IsaSpecReader` / `EntityDdlReader` / `ApiSpecReader` | `@specformula/core` | 三者的路徑全部相對 **cwd** 解析，不是相對 isa.yml |

**`@specformula/node` 的 index 靜態 export `SqliteDataSource`，而它靜態 `import 'better-sqlite3'`。** 所以 `db_type: postgresql` 的 consumer **也 MUST** 安裝 `better-sqlite3`，即使一行 SQLite 都不用；它不在 `@specformula/node` 的 dependencies 裡，pnpm 不會替你裝。

### `/test/*` 控制面契約（四端點，缺一不可）

| 端點 | 回應 | 誰在用 |
| --- | --- | --- |
| `GET /test/health` | `{"status":"ok"}` | 起 server 後輪詢就緒 |
| `POST /test/token` body `{"userId":123}` | `{"token":"..."}` | `Authenticator.getToken` 換 bearer token |
| `POST /test/time` body `{"now":"2026-01-27T10:00:00"}` | `{"status":"ok","now":"..."}` | `time_control` 指令凍結業務時鐘 |
| `DELETE /test/time` | `{"status":"ok"}` | scenario 收尾解凍 |

Nuxt 的 `server/api/**` 掛在 `/api/` 之下，而契約要的是裸 `/test/*`——**MUST** 放 `server/routes/test/`。

## Wiring

最小接線（bootstrap、authenticator、四個 test route、time-service、guard middleware、CI job）全部有 template，逐檔在 `vendor/snippets/specformula/README.md` 的 template 表；安裝 SOP 六步同檔。本節不複製那些程式碼——它們會漂。

## MUST

1. **spec-first**：**每一個**新增或修改的 API operation，都 MUST 先改 OpenAPI（`specs/api/`）、DDL（`specs/data/`）與 `.feature`，再寫實作碼。不是只處理最後一個 operation，也不是整批做完再補 feature。
2. **每一個** operation 的 OpenAPI `summary` MUST 在整份 spec 內唯一——`api_call` 與 `response_validate` 兩個指令都靠 `summary` 反查 operation，重複時查到哪一個由掃描順序決定。
3. **每一處**業務時間讀取 MUST 走 `server/utils/time-service.ts` 的 `now()`。`POST /test/time` 凍結的是那支 module 的 process-global 狀態，繞過它的呼叫點對凍結完全無感。
4. `/test/*` 四端點 MUST 由 `server/middleware/00.test-routes-guard.ts` 守住：`process.env.SPECFORMULA_TEST === '1'` **且**非 production 才放行，其餘一律 404。
5. `features/support/environment.ts` 的 `loadSpecFormulaPlugins()` MUST 排在 `new IsaSpecReader().read()` **之前**——plugin 貢獻的 `instruction_type` 要先註冊，`isa.yml` 驗證才不會以 `SPEC_ISA_INSTRUCTION_TYPE_UNKNOWN` 拒絕它。

## NEVER

1. **NEVER 手寫 step definition 去接 `isa.yml` 已涵蓋的六個內建指令**（`time_control` / `entity_setup` / `api_call` / `response_validate` / `entity_validate` / `entity_non_existence_validate`）。要新的 Gherkin 句型就在 `isa.yml` 加一條 `format` regex，要框架沒有的行為才用 `instruction_type: custom`。手寫的那支會與動態註冊的同時匹配，cucumber 報 ambiguous，而訊息指向你的檔、不指向 `isa.yml`。
2. **NEVER 讓 `isa.yml` 的 `db_type: postgresql` 指向 hosted Supabase**（`db.<ref>.supabase.co`、pooler endpoint、任何要求 TLS 的 endpoint）。`JdbcDataSourceConfig` 只有 host / port / database / username / password 五個欄位，**沒有 `ssl`、沒有 `connectionString`**，`pg` 預設不開 TLS，連線會直接被拒。在上游補上 SSL 支援之前，BDD 的 DB 一律指本機 `supabase start` 的 `127.0.0.1:54322`。逐字反開脫：「我把 `PGSSLMODE` 設進 env 就好了」——那是 `pg` 的環境變數後路，繞過去之後你在 CI 裡對著**正式資料**跑 `entity_setup` 的 INSERT 與 dialect cleanup。
3. **NEVER 讓 `new Date()` 出現在 `server/` 的業務碼**。允許的位置只有 `server/utils/time-service.ts` 自己。
4. **NEVER 在 `.feature` 裡寫死時間再期待它穩定**——要固定時間就用 `time_control` 指令，它會打 `POST /test/time`。
5. **NEVER 把 `SPECFORMULA_TEST=1` 寫進 `.env.production*` 或任何 production deploy 設定**。

## Anti-pattern

| 反模式 | 為何錯 | 正解 |
| --- | --- | --- |
| `features/steps/*.ts` 手寫 `Given(/^準備一個(.+)/)` | 與 `isa.yml` 動態註冊的同句型撞成 ambiguous step | 在 `isa.yml` 的 `instructions[]` 加 / 改 `format` |
| `server/api/test/health.get.ts` | Nuxt 掛成 `/api/test/health`，契約要 `/test/health` | 放 `server/routes/test/health.get.ts` |
| 業務 handler 直接 `new Date()` | `POST /test/time` 對它零作用，時間相關 scenario 隨牆上時鐘飄 | `import { now } from '~/server/utils/time-service'` |
| `isa.yml` 的 `resource_path` 寫成相對 isa.yml 的路徑 | 三個 reader 全部相對 **cwd** 解析 | 從 repo root 跑 `test:bdd`，路徑寫 `specs/api` / `specs/data` |
| 兩個 operation 共用 `summary: 建立訂單` | `api_call` 反查 operation 撞名，靜默選錯一個 | summary 全 spec 唯一 |
| 只裝 `pg` 沒裝 `better-sqlite3` | `@specformula/node` index 靜態拉 `SqliteDataSource` → `ERR_MODULE_NOT_FOUND` | devDeps 補 `better-sqlite3` ＋ `onlyBuiltDependencies` |

## Reference signal（不 block）

`node scripts/audit-specformula-adoption.ts` 逐 consumer 印一列：`isa` / `features` 檔數 / `api` spec 檔數 / `ddl` 檔數 / `endpoints`（四端點到位幾個）/ `guard` / `test:bdd` script / `workspace` / `pin` / `orphans` / `new Date(` 殘留數（`server/utils/time-service.ts` 與 `server/routes/test/**` 豁免）。

四種 status：`N/A`（沒宣告 capability，**不等於落後**）、`PARTIAL`、`OK`、`DRIFT`。**`DRIFT` 優先於 `PARTIAL`**——鏡像的 `PIN.json` 與 clade 對不上、或有 `MANIFEST.json` 沒列的 orphan 檔時，其餘每一格量測的基準本身就不成立，先重跑 vendor 投影再讀那一列。**「還沒投影」不是 `DRIFT`**（`vendorPinMatches` 為 null），那是 `PARTIAL`——把兩者混起來會讓「還沒開始」看起來像「壞掉了」。

永遠 exit 0。**NEVER** 拿它擋 publish：落地工作在 consumer 自治區，擋 clade 自己的 publish 是錯的施力點。
