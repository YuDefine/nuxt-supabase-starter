# nuxt-supabase-starter

Nuxt 4 全端應用程式 starter template，使用 Supabase 作為後端。

## Technology Stack

- **Framework**: Nuxt 4, Vue 3 (Composition API + `<script setup>`)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS, Nuxt UI
- **State**: Pinia, Pinia Colada
- **Database**: Supabase (PostgreSQL)
- **Auth**: @onmax/nuxt-better-auth
- **Testing**: Vitest, @nuxt/test-utils
- **Linting**: OXLint, OXFmt

## Conventions

### Database Access

- **Client**: READ only via `useSupabaseClient<Database>().select()`
- **Server**: ALL writes via `/api/v1/*` endpoints
- **NEVER** use `.insert()/.update()/.delete()/.upsert()` from client

### Authentication

- **USE** `useUserSession()` from `@onmax/nuxt-better-auth`
- **NEVER** use `useSupabaseUser()` or any Supabase Auth API directly

### Migration

- **MUST** use `supabase migration new <name>` to create migrations
- **MUST** `SET search_path = ''` in ALL database functions
- **NEVER** modify or delete applied migrations
- After migration: `supabase db reset` → `db lint` → `gen types`

### RLS Policy

API writes **MUST** include service_role bypass:

```sql
(SELECT auth.role()) = 'service_role' OR <user_condition>
```

### Code Style

- **TDD**: Red → Green → Refactor
- Tailwind classes only, no manual CSS
- Named exports only, no default exports
- Composition API + `<script setup>` only

## Directory Structure

```
app/
├── pages/           # File-based routing
├── components/      # Vue components
├── composables/     # Vue composables
├── stores/          # Pinia stores
├── queries/         # Pinia Colada queries
└── types/           # TypeScript types

server/
├── api/v1/          # Business API
├── api/auth/        # Auth API
└── utils/           # supabase, logger

test/
├── unit/            # Unit tests (*.test.ts)
└── nuxt/            # Nuxt env tests (*.nuxt.test.ts)

supabase/migrations/ # DB migrations (CLI only)
```

## Commands

```bash
pnpm dev             # Development server (already running)
pnpm check           # format → lint → typecheck → test
pnpm test            # All tests + coverage
pnpm typecheck       # Type check only
supabase db reset    # Reset + apply all migrations
supabase db lint --level warning  # Security check
```

## References

- Auth: `docs/verify/AUTH_INTEGRATION.md`
- Migration: `docs/verify/SUPABASE_MIGRATION_GUIDE.md`
- RLS: `docs/verify/RLS_BEST_PRACTICES.md`
- API: `docs/verify/API_DESIGN_GUIDE.md`
- Pinia: `docs/verify/PINIA_ARCHITECTURE.md`
