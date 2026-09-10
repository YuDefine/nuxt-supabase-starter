<!-- clade-owned: not mirrored from upstream; see vendor/snippets/specformula/README.md -->

# SpecFormula Nuxt 配置指南

Nuxt 4 + Supabase（PostgreSQL）consumer 的安裝指南。角色對應上游的 `java.md`，內容由 clade 維護。

規約：`.claude/rules/specformula.md`（clade 源檔 `rules/core/specformula.md`）
範本組：`~/offline/clade/vendor/snippets/specformula/`

## 依賴

packages 未發佈到 npm（全部 `private: true`），從原始碼消費。`exports` 直接指向 `src/index.ts`，**沒有 build 步驟**——`tsx` 在 runtime 轉譯。

```yaml
# pnpm-workspace.yaml
packages:
  - vendor/specformula-ts/packages/*
onlyBuiltDependencies:
  - better-sqlite3
  - cpu-features
  - esbuild
  - protobufjs
  - ssh2
```

```jsonc
// package.json
"devDependencies": {
  "@cucumber/cucumber": "^12.6.0",
  "@specformula/cucumber": "workspace:*",
  "@specformula/node": "workspace:*",
  "@specformula/core": "workspace:*",
  "better-sqlite3": "^12.9.0",   // 硬需求：@specformula/node 靜態 export SqliteDataSource
  "jose": "^6.0.0",
  "pg": "^8.16.0",
  "tsx": "^4.21.0"
},
"scripts": {
  "test:bdd": "NODE_OPTIONS='--import tsx' cucumber-js"
}
```

## 專案結構

```
<repo-root>/
├── isa.yml                                   # ISA 設定檔（放 repo root）
├── cucumber.cjs
├── specs/
│   ├── api/api-spec.yml                      # OpenAPI 3
│   └── data/
│       ├── schema.sql                        # DDL
│       └── entity_to_table_mapping.yml
├── features/
│   ├── <業務名>.feature
│   ├── support/{environment.ts,authenticator.ts}
│   └── steps/                                # 只放 instruction_type: custom
└── server/
    ├── utils/time-service.ts
    ├── middleware/00.test-routes-guard.ts
    └── routes/test/{health.get.ts,token.post.ts,time.post.ts,time.delete.ts}
```

上游 Java 版把這些放 `src/test/resources/`。Nuxt 版一律相對 repo root——`IsaSpecReader` / `EntityDdlReader` / `ApiSpecReader` 用 `node:fs` 相對 **cwd** 解析路徑，沒有 classpath 的概念。

## isa.yml 的 Nuxt 特定值

```yaml
config:
  api:
    resource_path: specs/api      # 相對 cwd，不是相對 isa.yml
    project_path: specs/api       # 單 repo 時同值
    time_format: iso
  data:
    permission: isolated
    reuse: false                  # Postgres 由 supabase start 起，framework 不管容器
    source:
      - name: default
        resource_path: specs/data
        project_path: specs/data
        db_type: postgresql
        schema: public            # ADR ts-0011：走 pg 的 -c search_path
```

連線參數不在 `isa.yml` 裡，由 `features/support/environment.ts` 傳給 `createPostgresDataSource`。

⚠️ `JdbcDataSourceConfig` 只有 host / port / database / username / password，**沒有 `ssl`、沒有 `connectionString`**。所以 `db_type: postgresql` 只能指本機 `supabase start` 的 `127.0.0.1:54322`（`postgres` / `postgres` / `postgres`），**NEVER** 指 hosted 專案。

`instructions[]` 的八條 zh-TW regex 直接抄 `templates/isa.template.yml`，欄位語義見上游 `SKILL.md`。

## 控制面：為什麼是 `server/routes/` 不是 `server/api/`

上游 `adapter-target-service` 契約要的是裸 `/test/health` / `/test/token` / `/test/time`。Nuxt 把 `server/api/**` 掛在 `/api/` 之下，所以這四個端點 MUST 放 `server/routes/test/`。

`POST /test/token` 簽的是 Supabase 相容的 HS256 JWT（`sub` / `role: authenticated` / `aud: authenticated` / `exp`），secret 讀 `SUPABASE_JWT_SECRET`。三個 claim 少一個，RLS 的行為就與 production 不同。

`server/middleware/00.test-routes-guard.ts` 以 `SPECFORMULA_TEST === '1'` **且**非 production 為條件放行，其餘回 404。

## 怎麼跑

```bash
supabase start
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f specs/data/schema.sql

SPECFORMULA_TEST=1 pnpm dev          # terminal 1
pnpm test:bdd                        # terminal 2，從 repo root
```

`environment.ts` 會先輪詢 `GET /test/health`（上限 120 秒）再開始。

環境變數覆寫：`SPECFORMULA_BASE_URL`、`SPECFORMULA_DB_HOST` / `_PORT` / `_NAME` / `_USER` / `_PASSWORD`。

CI 版本抄 `templates/ci-job.template.yml`。

## 最容易踩的三個

1. `environment.ts` 頂層的 `loadSpecFormulaPlugins()` → `IsaSpecReader().read()` → `StepDefinitionFactory.register()` 搬進 `BeforeAll` → 所有 step 變 undefined，而錯誤訊息會叫你去寫 step definition。
2. 沒裝 `better-sqlite3` → `ERR_MODULE_NOT_FOUND`，即使一行 SQLite 都不用。
3. 從 `features/` 底下跑 `cucumber-js` → 三個 reader 的相對路徑全部解錯。一律從 repo root 跑。
