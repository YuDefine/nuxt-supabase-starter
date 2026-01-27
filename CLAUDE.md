# CLAUDE.md

## Language

**YOU MUST** respond in 繁體中文 (zh-TW). **NEVER** use 簡體中文 (zh-CN).

## Stack

Nuxt 4, Vue 3 (Composition API + `<script setup>`), TypeScript, Tailwind CSS, Nuxt UI, Pinia, Supabase (PostgreSQL), @onmax/nuxt-better-auth

## Commands

```bash
pnpm dev             # Already running. NEVER start
pnpm check           # format → lint → typecheck → test
pnpm test            # All tests + coverage
pnpm typecheck       # Type check only
supabase db reset    # Reset + apply all migrations
supabase db lint --level warning  # Security check
```

## Environment Variables

統一使用 **GitHub Secrets** 管理環境變數，透過 CI/CD 部署時注入。

**禁止**直接在 Cloudflare Dashboard 設定環境變數。

新增環境變數時：

1. 在 GitHub repo → Settings → Secrets and variables → Actions 新增
2. 確認 `.github/workflows/` 中的部署 workflow 有正確傳遞該變數

## CRITICAL RULES

### Auth - IMPORTANT

**USE** `useUserSession()` from `@onmax/nuxt-better-auth`
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

test/
├── unit/            # Unit tests (*.test.ts)
└── nuxt/            # Nuxt env tests (*.nuxt.test.ts)

supabase/migrations/ # DB migrations (CLI only)
```

## Automation Triggers

| Trigger           | Action                                             |
| ----------------- | -------------------------------------------------- |
| Code complete     | Run `pnpm check`                                   |
| Check pass        | Ask: commit?                                       |
| User confirms     | Group commits → version bump → tag                 |
| Migration created | `db reset` → `db lint` → `gen types` → `typecheck` |
| New feature       | TDD: Red → Green → Refactor                        |

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

## AI Skills

| Task                | Skill                     |
| ------------------- | ------------------------- |
| Vue components      | `vue`                     |
| Nuxt routing/server | `nuxt`                    |
| UI components       | `nuxt-ui`                 |
| VueUse              | `vueuse`                  |
| Postgres            | `postgres-best-practices` |
| 中大型功能規劃      | `spec-kit-workflow`       |

## docs/verify/ Purpose

Record **current state**, not iteration history. Use present tense, no timestamps.
