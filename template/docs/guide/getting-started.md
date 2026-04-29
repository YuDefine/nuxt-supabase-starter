---
audience: both
applies-to: post-scaffold
---

# Getting Started

## Prerequisites

- Node.js 18+ (recommended: 24 LTS)
- pnpm
- Docker Desktop
- Supabase CLI

## Setup

Run the interactive setup script:

```bash
pnpm setup
```

This will:

1. Check prerequisites (Node.js, pnpm, Docker, Supabase CLI)
2. Ask you to choose an **auth provider** (Better Auth or nuxt-auth-utils)
3. Let you select optional features (OAuth, Sentry, Charts, etc.)
4. Install dependencies
5. Generate `.env` with your selections
6. Start local Supabase
7. Generate TypeScript types

## Development

```bash
pnpm dev    # Start dev server
```

## Available Commands

| Command          | Description                           |
| ---------------- | ------------------------------------- |
| `pnpm dev`       | Start development server              |
| `pnpm build`     | Build for production                  |
| `pnpm check`     | Run format + lint + typecheck + tests |
| `pnpm test`      | Run all tests with coverage           |
| `pnpm typecheck` | TypeScript type checking              |
| `pnpm db:reset`  | Reset database + apply migrations     |
| `pnpm db:types`  | Generate database TypeScript types    |
| `pnpm docs:dev`  | Start documentation site              |

## Project Structure

```
app/
├── pages/           # File-based routing
├── components/      # Vue components (AppPageShell, AppEmptyState, etc.)
├── composables/     # Vue composables (useListQueryState, useModalForm, etc.)
├── stores/          # Pinia stores
├── queries/         # Pinia Colada queries
└── types/           # TypeScript types

server/
├── api/v1/          # Business API endpoints
├── api/auth/        # Auth API
└── utils/           # Server utilities (supabase, audit, validation)

shared/              # Shared code (types, schemas)
supabase/migrations/ # Database migrations
docs/                # Documentation (this site)
```

## Next Steps

- [Authentication](./auth.md) — Understand the auth system
- [Database](./database.md) — Database access patterns and migrations
