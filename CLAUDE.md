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

## Skill 持續累積

每次操作結束時，主動判斷是否需要建立或更新 skill：

1. **本次操作沒有對應 skill** → 建立新 skill，記錄操作流程、注意事項、踩過的坑
2. **本次操作基於某個 skill，但過程中做了修改或學到新知識** → 更新該 skill 內容

原則：

- 不必擔心新 skill 功能太少 — 小而具體優於沒有，未來可合併重構
- 建立前先確認沒有已存在的 skill 可以更新
- Skill 放在 `.claude/skills/`（專案內）

## Documentation

### docs/verify/ Purpose

Record **current state**, not iteration history. Use present tense, no timestamps.

### 積極更新 docs/

除錯、疑難排解、架構決策時，**MUST** 主動在 `docs/` 建立或更新文件，記錄：

- 問題描述
- 嘗試過的方向
- Root cause
- 最終解法（或目前進度）

即使問題尚未解決也要記錄當前狀態。目的：

1. 使用者能隨時從文件掌握進度，不用重新問
2. 避免日後（同專案或不同對話）重複探索繁瑣的除錯過程
3. 讓其他專案可以學習這些經驗
