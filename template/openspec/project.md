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
- Follow TDD: Red -> Green -> Refactor
- Use migration workflow via Supabase CLI
