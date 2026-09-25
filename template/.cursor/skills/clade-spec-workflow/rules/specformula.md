---
description: SpecFormula BDD/SDD 框架的 fleet 採用契約——spec-first 順序、embedded／PostgreSQL 資料源判定、framework-neutral HTTP／test-control seam、業務時鐘單一來源、hosted Supabase 的 SSL 阻斷
paths: ['features/**', 'specs/api/**', 'specs/data/**', 'isa.yml', 'cucumber.cjs', 'server/routes/test/**', 'server/utils/time-service.ts', 'packages/*/server/routes/test/**', 'packages/*/server/utils/time-service.ts']
---
<!-- Clade native rule; source: rules/core/specformula.md; edit canonical source -->

<!-- clade-targets: claude,codex,cursor -->

# SpecFormula 標準（fleet 唯一 SDD/BDD 框架）

> Upstream: <https://github.com/SpecFormula/specformula-dev-framework>。clade 端有兩份：`vendor/specformula/`（git submodule，完整上游）與 `vendor/specformula-ts/`（curated mirror，由 `scripts/sync-upstream-mirrors.ts` 依 `registry/upstream-submodules.json` 生成，帶 `PIN.json` / `MANIFEST.json`）。散播到 consumer 的是後者，落點同名 `vendor/specformula-ts/`。
>
> Cookbook（全部 template 與安裝 SOP）：`~/offline/clade/vendor/snippets/specformula/`
>
> Convention 定位與 variant：`docs/conventions/sdd-framework.md`
>
> Audit signal：`node scripts/audit-specformula-adoption.ts`

SpecFormula 的 step definition 由 `isa.yml` 的 regex 動態生成：OpenAPI `summary`、DDL、`.feature` 指令三者對得起來測試才跑得起來，失敗訊息指向 spec。

## 何時用 / 不用

| 可觀察 predicate | 採用 |
| --- | --- |
| consumer 的 `.claude/hub.json` 宣告 `capabilities: ["specformula"]` | ✅ 本檔全部條款生效 |
| Nuxt 4 + PostgreSQL（Supabase）且有 HTTP API 要驗收 | ✅ 適用對象；資料源用 `postgresql`，連線指向每個 repo 核准的隔離測試 DB |
| D1 或無資料庫服務（純 proxy、純靜態、純 CLI）且需要 API acceptance | ✅ 採用 `embedded`；以 API-only scenario 與 runtime 所需最小 fixture 驗證，不強造業務 entity |
| 未知或未確認的 DB 類型 | ⚠️ 保持 unresolved；不得默認成 `embedded` 或「無 DB」 |
| 需要對 **hosted** Supabase（`*.supabase.co`）跑 BDD | ❌ **目前不可行**，見下方 NEVER 第 2 條 |
| 既有 consumer 已跑 spectra（legacy SDD） | 併存，新增的 API operation 走 SpecFormula；遷移節奏由該 consumer 自己決定 |
| clade home 自身的行為（CLI／檔案系統／read model 折疊） | ✅ 走 § clade 驗收執行——同一個框架、clade 自己的 instruction adapter；沒有 HTTP API 與業務 DB 可捏造 |
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

**`@specformula/node` 的 index 靜態 import `better-sqlite3`**，所以 `db_type: postgresql` 的 consumer **也 MUST** 安裝它；裝法見下方 § Anti-pattern 最後一列。

### `/test/*` 控制面契約（四端點，缺一不可）

| 端點 | 回應 | 誰在用 |
| --- | --- | --- |
| `GET /test/health` | `{"status":"ok"}` | 起 server 後輪詢就緒 |
| `POST /test/token` body `{"userId":123}` | `{"token":"..."}` | `Authenticator.getToken` 換 bearer token |
| `POST /test/time` body `{"now":"2026-01-27T10:00:00"}` | `{"status":"ok","now":"..."}` | `time_control` 指令凍結業務時鐘 |
| `DELETE /test/time` | `{"status":"ok"}` | scenario 收尾解凍 |

四端點是 framework-neutral 的裸路徑契約。Nuxt 範本放 `server/routes/test/`（`server/api/**` 會多出 `/api/`）；其他 framework MUST 提供等價 adapter 與 guard 並記錄。需要登入的 scenario 才接 actor／token，業務讀取時間的 scenario 才接 freeze／restore；HTTP client MUST 打到實際處理被驗收 operation 的 server。

## Wiring

最小接線（bootstrap、authenticator、四個 test route、time-service、guard middleware、CI job）全部有 template，逐檔在 `vendor/snippets/specformula/README.md` 的 template 表；安裝 SOP 六步同檔。本節不複製那些程式碼——它們會漂。

## MUST

1. **spec-first**：**每一個**新增或修改的 API operation，都 MUST 先改 OpenAPI（`specs/api/`）與 `.feature`，再寫實作碼；只有 operation 會改變資料模型時才同步改 DDL（`specs/data/`）。API-only scenario 不得為了湊 entity 規格而捏造業務表。
2. **每一個** operation 的 OpenAPI `summary` MUST 在整份 spec 內唯一——`api_call` 與 `response_validate` 兩個指令都靠 `summary` 反查 operation，重複時查到哪一個由掃描順序決定。
3. **每一處**業務時間讀取 MUST 走 consumer 的唯一 clock service；`POST /test/time` 凍結的必須就是該 service，不能凍結未被業務碼讀取的測試 helper。
4. `/test/*` 四端點 MUST 由 framework 的 test-only guard 守住：明確 test flag **且**非 production 才放行，其餘一律 404。Nuxt recipe 的具體落點是 `server/middleware/00.test-routes-guard.ts`，其他 framework MUST 記錄等價 adapter 與 guard。
5. `features/support/environment.ts`（或等價 adapter）的 `loadSpecFormulaPlugins()` MUST 排在 `new IsaSpecReader().read()` **之前**——plugin 貢獻的 `instruction_type` 要先註冊，`isa.yml` 驗證才不會以 `SPEC_ISA_INSTRUCTION_TYPE_UNKNOWN` 拒絕它。

## NEVER

1. **NEVER 手寫 step definition 去接 `isa.yml` 已涵蓋的六個內建指令**（`time_control` / `entity_setup` / `api_call` / `response_validate` / `entity_validate` / `entity_non_existence_validate`）。要新句型就在 `isa.yml` 加 `format` regex，框架沒有的行為才用 `instruction_type: custom`；手寫的會撞成 ambiguous step。
2. **NEVER 讓 `isa.yml` 的 `db_type: postgresql` 指向 hosted Supabase**（`db.<ref>.supabase.co`、pooler endpoint、任何要求 TLS 的 endpoint）。`JdbcDataSourceConfig` **沒有 `ssl`、沒有 `connectionString`**，連線會直接被拒。PostgreSQL consumer MUST 使用每個 repo 實際核准的隔離測試 DB endpoint；`127.0.0.1:54322` 只能作為該 repo 已確認的 `supabase start` 設定範例，不能由 fleet 標準無條件覆寫。
3. **NEVER 讓業務碼繞過唯一 clock service 直接讀取系統時間**。Nuxt 範本把 `new Date()` 集中在 `server/utils/time-service.ts`；其他 framework 由已記錄的等價 clock service 承接。
4. **NEVER 在 `.feature` 裡寫死時間再期待它穩定**——要固定時間就用 `time_control` 指令，它會打 `POST /test/time`。
5. **NEVER 把 `SPECFORMULA_TEST=1` 寫進 `.env.production*` 或任何 production deploy 設定**。

## Anti-pattern

| 反模式 | 為何錯 | 正解 |
| --- | --- | --- |
| `server/api/test/health.get.ts` | Nuxt 掛成 `/api/test/health`，契約要 `/test/health` | 放 `server/routes/test/health.get.ts` |
| `isa.yml` 的 `resource_path` 寫成相對 isa.yml 的路徑 | 三個 reader 全部相對 **cwd** 解析 | 從 repo root 跑 `test:bdd`，路徑寫 `specs/api` / `specs/data` |
| 只裝 `pg` 沒裝 `better-sqlite3`，或在 consumer devDeps 補它 | index 靜態拉 `SqliteDataSource` → `ERR_MODULE_NOT_FOUND`；devDeps 那條看起來沒人用，下一次清依賴就被刪 | `pnpm-workspace.yaml` 的 `packageExtensions` 歸屬到 `@specformula/node`，條目上方註解理由與移除條件（[[code-style.toolchain]] § packageExtensions 條目契約）；`allowBuilds` 維持 `false`——只需套件存在 |

## Embedded fixture 的驗證邊界

非 PostgreSQL 路徑使用 `db_type: embedded`。範本實驗不證明另一個 Nuxt process 或 D1 應用程式共用該資料源：每個 consumer MUST 保存實際受測 server／fixture 的 receipt，並驗證 API 與 entity 指令的資料一致性，才可宣稱完成整合；D1 dialect 另行驗證。API-only scenario 的最小 schema 僅屬測試初始化，不作為持久化已驗收的證據。

## clade 驗收執行（CLI／檔案系統／投影）

clade 的公開邊界不是 HTTP API：是 CLI（`flow`、`wt-helper`、`herdr-session-handoff`、`publish`／`propagate`）、檔案系統（spine `events.jsonl`、`.clade/projections`、manifest）與 read model 折疊。內建六指令對它們零覆蓋，所以 clade 用**同一個框架的 plugin 機制**接自己的 instruction adapter：`vendor/specformula-clade/`（`SpecFormulaPlugin`，由 `loadSpecFormulaPlugins()` 載入，`isa.yml` 在 clade root）。指令族固定四類——**建暫存 repo 並用真 CLI 產出 spine**（Given）、**在暫存 repo 跑 CLI 並捕捉 JSON**（When）、**對 JSON 路徑斷言**（Then）、**檔案系統斷言／擾動**（Then／When，含「刪檔」「改成不可讀」）。實際 `instruction_type` 名稱與 payload 以 `vendor/specformula-clade/README.md` 為 SoT，本節不 inline。

| MUST | 為什麼 |
| --- | --- |
| Given 的資料由**真 CLI** 在 `mkdtemp` 暫存 repo 裡跑出來 | 手寫的 `events.jsonl` 是 fixture 對 fixture：spine 格式一改，場景還綠 |
| When 跑的是**同一支** production CLI／projector，NEVER 跑測試專用替身 | 替身通過證明的是替身 |
| Then 對**真輸出**斷言，失敗訊息指向 step 句子＋JSON 路徑＋期望／實際 | 訊息指向 spec 才修得到規格；指向測試碼會修錯地方 |
| **每一個**新 instruction 上線時附一次 mutation 證據：本地弄壞一個不變量、對應場景以預期理由紅、還原 | 從未紅過的場景證明不了任何東西 |
| cucumber JSON report 落到 plan 的 `evidence/`，讓 `vendor/scripts/flow/acceptance-verdicts.ts` 讀到 | 驗收結果不進 verdict 契約，close gate 就看不到它 |

clade home 的 `test:bdd` 包一層 `vendor/specformula-clade/bin/run-bdd.ts`（pnpm 會把裸 `--` 轉給 cucumber-js，吃掉 readiness 的 `--dry-run`）；consumer 端照 § API surface。

UI 層（review-gui-web 的頁面行為）仍由 playwright-bdd 執行，分界是「打到瀏覽器」——同一個 acceptance scenario 的 CLI／read model 部分精煉成 `specs/truth/features/cli/**`，頁面部分留在 `vendor/review-gui-web/features/`。**NEVER** 為了讓 CLI adapter 覆蓋 UI 場景去 mock 瀏覽器；也 **NEVER** 為了讓 playwright 覆蓋 CLI 場景去讀 UI 上的數字當 CLI 輸出。

## Reference signal（不 block）

`node scripts/audit-specformula-adoption.ts` 逐 consumer 印一列：`isa` / `features` 檔數 / `api` spec 檔數 / `ddl` 檔數 / `endpoints` / `guard` / `test:bdd` / `workspace` / `pin` / `orphans`。Nuxt 的時鐘檢查另列 `new Date(` 殘留數。DB 預期值來自有效 manifest 與 registry 的結構化 `tech_stack`；service 的 module `none` 只代表未套用該 DB module，不能據此認定沒有資料庫。設定未知或宣告衝突時保留 `UNKNOWN`；實際 runtime 與資料一致性仍由 consumer receipt 驗證。

| 訊號契約 | `db_type` |
| --- | --- |
| 觸發條件 | 已宣告 capability 時，缺設定／必要資源為 `MISSING`、已知設定不符為 `MISMATCH`、無法判定為 `UNKNOWN`；符合為 `OK`。未宣告 capability 才是 `N/A`。異常列為 WARN，不改 CLI exit 契約 |
| 消費端 | fleet 稽核主持者讀取具體 finding，交由該 consumer owner 修復並回傳 receipt |
| 載入路徑 | 本檔；依 frontmatter 的規格／設定路徑載入 |

四種 status：`N/A`（沒宣告 capability，**不等於落後**）、`PARTIAL`、`OK`、`DRIFT`。**`DRIFT` 優先於 `PARTIAL`**（`PIN.json` 對不上或有 orphan 檔時先重跑 vendor 投影）；「還沒投影」（`vendorPinMatches` 為 null）是 `PARTIAL` 不是 `DRIFT`。

永遠 exit 0，**NEVER** 拿它擋 publish。
