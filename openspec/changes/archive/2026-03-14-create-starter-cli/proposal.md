## Why

The nuxt-supabase-starter has grown into a full-featured template with 10+ optional modules (auth, Supabase, charts, monitoring, etc.), but users must clone the entire repo and manually remove unwanted features. A CLI tool with interactive prompts — similar to `create-t3-app` or `nuxi init` — would let users scaffold a tailored project by selecting only the features they need, dramatically improving onboarding and adoption.

## What Changes

- Create a standalone CLI package (`create-nuxt-starter`) publishable to npm
- Interactive prompts using UnJS ecosystem (citty + consola + giget)
- Template system with base template + feature overlays that compose based on user selections
- Dynamic `nuxt.config.ts`, `package.json`, and `.env.example` generation based on selected features
- Post-scaffold setup: install dependencies, initialize git, display next steps
- Feature modules are independently toggleable: auth, database, UI, charts, state management, testing, monitoring, SEO, security, deployment target, linting, git hooks

## Capabilities

### New Capabilities

- `cli-scaffold`: Core CLI entry point — argument parsing, interactive prompts, project directory creation, and orchestration of the scaffolding pipeline
- `template-assembly`: Template composition engine — base template plus feature overlay system that merges files, dependencies, and config based on user selections
- `feature-modules`: Feature module definitions — each module declares its files, dependencies, nuxt.config entries, env vars, and conditional logic for composing with other modules

### Modified Capabilities

(none)

## Impact

- New top-level directory: `packages/create-nuxt-starter/` (monorepo structure)
- New devDependencies: `citty`, `consola`, `giget`, `nypm`, `pathe`
- Workspace config: `pnpm-workspace.yaml` update
- Existing app code is NOT modified — templates are derived copies
- No migration required
- No API changes
