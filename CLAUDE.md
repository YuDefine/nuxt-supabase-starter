<!-- SPECTRA:START v1.0.0 -->

# Spectra Instructions

This project uses Spectra for Spec-Driven Development(SDD). Specs live in `openspec/specs/`, change proposals in `openspec/changes/`.

## Use `/spectra:*` skills when:

- A discussion needs structure before coding → `/spectra:discuss`
- User wants to plan, propose, or design a change → `/spectra:propose`
- Tasks are ready to implement → `/spectra:apply`
- There's an in-progress change to continue → `/spectra:ingest`
- User asks about specs or how something works → `/spectra:ask`
- Implementation is done → `/spectra:verify` then `/spectra:archive`

## Workflow

discuss? → propose → apply ⇄ ingest → archive

- `discuss` is optional — skip if requirements are clear
- Requirements change mid-work? Plan mode → `ingest` → resume `apply`

<!-- SPECTRA:END -->

# CLAUDE.md

## Language

**YOU MUST** respond in 繁體中文 (zh-TW). **NEVER** use 簡體中文 (zh-CN).

## Stack

Nuxt 4, Vue 3 (Composition API + `<script setup>`), TypeScript, Tailwind CSS, Nuxt UI, Pinia, Supabase (PostgreSQL), nuxt-auth-utils 或 @onmax/nuxt-better-auth（二擇一）

## Commands

```bash
pnpm dev             # Already running. NEVER start
pnpm check           # vp check (lint + fmt + test) + typecheck
vp test              # All tests + coverage
vp lint              # Lint only
vp fmt               # Format only
pnpm typecheck       # Type check only
supabase db reset    # Reset + apply all migrations
supabase db lint --level warning  # Security check
```

## Environment Variables

統一使用 **GitHub Secrets** 管理環境變數，透過 CI/CD 部署時注入。

**禁止**直接在 Cloudflare Dashboard 設定環境變數。

新增環境變數時：

1. 在 GitHub repo → Settings → Secrets and variables → Actions 新增
2. 確認 `docs/templates/.github/workflows/` 中的部署 workflow 有正確傳遞該變數

## CRITICAL RULES

### Auth - IMPORTANT

**USE** `useUserSession()` — 來自 `nuxt-auth-utils` 或 `@onmax/nuxt-better-auth`（依專案選擇）
**NEVER** use `useSupabaseUser()` or any Supabase Auth API

### Database Access Pattern

- **Client**: READ only via `useSupabaseClient<Database>()` + `.select()`
- **Server**: ALL writes via `/api/v1/*` endpoints
- **NEVER** `.insert()/.update()/.delete()/.upsert()` from client

### Migration - CRITICAL

- **MUST** use `supabase migration new <name>` to create
- **NEVER** create .sql files manually or via Write tool
- **MUST** `SET search_path = ''` in ALL database functions
- **NEVER** modify or delete applied migrations
- After migration: `supabase db reset` → `db lint` → `gen types`

### MCP Remote Database - CRITICAL

- **NEVER** use `mcp__remote-supabase__apply_migration` to create tables/indexes
- **NEVER** use `mcp__remote-supabase__execute_sql` for DDL (CREATE/ALTER/DROP)
- MCP uses `supabase_admin` role → creates objects with wrong owner → CI/CD fails
- **ONLY** use remote MCP for: SELECT queries, debugging, checking table owners
- **ALL DDL must go through migration files + CI/CD**

### RLS Policy

API writes **MUST** include service_role bypass:

```sql
(SELECT auth.role()) = 'service_role' OR <user_condition>
```

### Development

- **ALWAYS** TDD: Red → Green → Refactor
- **NEVER** `.skip` or comment out tests
- **ALWAYS** Tailwind classes, NEVER manual CSS
- **ALWAYS** named exports, NEVER default exports
- **ALWAYS** Composition API + `<script setup>`, NEVER Options API

## Project Structure

```
app/
├── pages/           # File-based routing
├── components/      # Vue components
├── composables/     # Vue composables
├── stores/          # Pinia stores
├── queries/         # Pinia Colada queries
└── types/           # TypeScript types (database.types.ts)

server/
├── api/v1/          # Business API
├── api/auth/        # Auth API
└── utils/           # supabase, logger

shared/              # Shared code (cross app/server)
packages/            # Monorepo packages

test/
├── unit/            # Unit tests (*.test.ts)
└── nuxt/            # Nuxt env tests (*.nuxt.test.ts)

supabase/migrations/ # DB migrations (CLI only)
openspec/            # Spectra specs & changes
.spectra/            # Spectra config
```

## Automation Triggers

| Trigger            | Action                                             |
| ------------------ | -------------------------------------------------- |
| `/commit`          | Run `pnpm check` → commit                          |
| `/spectra:propose` | 建立變更提案                                       |
| `/spectra:apply`   | 執行任務                                           |
| `/spectra:archive` | 歸檔變更                                           |
| Migration created  | `db reset` → `db lint` → `gen types` → `typecheck` |
| New feature        | TDD: Red → Green → Refactor                        |

## 截圖調試（browser-use CLI）

- 使用 `browser-use` CLI 截圖，詳見 `browser-use-screenshot` skill
- 本專案的 root app 用 better-auth（email/password），browser-use 可直接填表登入
- 產出的新專案可能用 nuxt-auth-utils（OAuth only）或 better-auth（email+OAuth）
- Dev server 已經在跑，自己用 `ps aux` 找 port，不要問
- 截圖存 `temp/` 目錄
- 完成後 `browser-use close` 關閉瀏覽器

## Commit Format

See `commitlint.config.js` for types. Use `/commit` command.

## References

| Topic       | File                                      |
| ----------- | ----------------------------------------- |
| Auth        | `docs/verify/AUTH_INTEGRATION.md`         |
| Migration   | `docs/verify/SUPABASE_MIGRATION_GUIDE.md` |
| RLS         | `docs/verify/RLS_BEST_PRACTICES.md`       |
| API         | `docs/verify/API_DESIGN_GUIDE.md`         |
| Pinia       | `docs/verify/PINIA_ARCHITECTURE.md`       |
| Environment | `docs/verify/ENVIRONMENT_VARIABLES.md`    |
| Screenshot  | `docs/verify/SCREENSHOT_GUIDE.md`         |

## AI Skills

| Task                   | Skill                              |
| ---------------------- | ---------------------------------- |
| Vue components         | `vue`                              |
| Nuxt routing/server    | `nuxt`                             |
| UI components          | `nuxt-ui`                          |
| Auth (nuxt-auth-utils) | `nuxt-auth-utils`                  |
| Auth (better-auth)     | `nuxt-better-auth`                 |
| VueUse                 | `vueuse`                           |
| Postgres               | `supabase-postgres-best-practices` |
| TDD                    | `test-driven-development`          |
| 截圖調試               | `browser-use-screenshot`           |
| 中大型功能規劃         | `/spectra:propose`                 |
| UI 設計規劃/診斯       | `/design`                          |
| 建構前端介面           | `/frontend-design`                 |
| Subagent 驅動開發      | `subagent-dev`                     |

## Documentation

### docs/verify/ Purpose

Record **current state**, not iteration history. Use present tense, no timestamps.

## Code Knowledge Graph (code-review-graph)

MCP server 已註冊，提供程式碼結構知識圖譜。語意搜尋已啟用（本地向量嵌入）。

| 任務               | Tool                                                  |
| ------------------ | ----------------------------------------------------- |
| 變更影響範圍       | `get_impact_radius`（自動偵測 git diff）              |
| PR review 上下文   | `get_review_context`（子圖 + 原始碼 + 建議）          |
| 找呼叫者/被呼叫者  | `query_graph(pattern="callers_of/callees_of")`        |
| 找誰 import 了某檔 | `query_graph(pattern="importers_of")`                 |
| 找檔案結構         | `query_graph(pattern="file_summary/children_of")`     |
| 找測試             | `query_graph(pattern="tests_for")`                    |
| 語意搜尋           | `semantic_search_nodes(query="...", kind="Function")` |
| 找肥大 function    | `find_large_functions(min_lines=80)`                  |
| 增量更新圖譜       | `build_or_update_graph(full_rebuild=False)`           |
| 圖譜統計           | `list_graph_stats`                                    |
