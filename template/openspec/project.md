# Project Context

## Purpose

This starter provides a baseline for Nuxt 4 + Supabase + AI-assisted development workflows.

## Stack

- Nuxt 4
- Vue 3 (Composition API + script setup)
- TypeScript
- Tailwind CSS
- Nuxt UI
- Pinia
- Supabase
- @onmax/nuxt-better-auth

## Conventions

- Client reads via useSupabaseClient().select()
- Server writes via /api/v1/\*
- Request/response contracts live in shared/schemas/_; shared/types/_ is compatibility only
- API handlers validate input and parse response payloads with shared schemas
- Request-scoped database access uses getSupabaseWithContext(event)
- getServerSupabaseClient() is reserved for privileged system tasks
- Follow TDD: Red -> Green -> Refactor
- Use migration workflow via Supabase CLI
