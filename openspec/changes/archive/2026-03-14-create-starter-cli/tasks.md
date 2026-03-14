## 1. Package Structure as Workspace Member

- [x] 1.1 Create `packages/create-nuxt-starter/` directory with `package.json` (bin entry, dependencies: citty, consola, giget, nypm, pathe)
- [x] 1.2 Update `pnpm-workspace.yaml` to include `packages/*`
- [x] 1.3 Setup TypeScript config and build tooling (tsdown) for the CLI package

## 2. Feature Module Registry — Feature Module Definition Format

- [x] 2.1 Define `FeatureModule` TypeScript interface for the feature module registry
- [x] 2.2 Implement authentication module (better-auth) definition with packages, envVars, templateDir, and dependencies
- [x] 2.3 Implement database module (Supabase) definition
- [x] 2.4 Implement UI module (Nuxt UI) definition
- [x] 2.5 Implement testing module definitions (vitest+playwright, vitest-only)
- [x] 2.6 Implement additional feature modules: charts, SEO, security, image optimization, state management, monitoring, code quality tools, git hooks
- [x] 2.7 Implement deployment target selection (cloudflare / vercel / node) as deployment module definitions

## 3. Base Template

- [x] 3.1 Create base template in `templates/base/` with minimal Nuxt 4 + TypeScript project files (nuxt.config.ts, package.json, tsconfig.json, app.vue, pages/index.vue, main.css, .gitignore, .env.example)
- [x] 3.2 Verify base template produces a working `pnpm dev` project

## 4. Feature Overlay Templates

- [x] 4.1 Create overlay template for authentication module (better-auth) — auth pages, config, middleware, composables
- [x] 4.2 Create overlay template for database module (Supabase) — config, migrations, server utils, API endpoints, shared types
- [x] 4.3 Create overlay template for UI module (Nuxt UI) — app.config.ts, layouts, app.vue with UApp
- [x] 4.4 Create overlay template for testing module — vitest.config.ts, playwright.config.ts, example tests
- [x] 4.5 Create overlay templates for additional feature modules (charts, SEO, security, image, pinia, monitoring, deployment, oxlint, husky)

## 5. Template Assembly Engine — Template Composition via File Overlay

- [x] 5.1 Implement feature overlay composition — copy base then apply feature overlays in dependency order
- [x] 5.2 Implement package.json generation with dependency merging (feature version takes precedence, scripts merging without overwrite)
- [x] 5.3 Implement nuxt.config.ts generation via EJS template with conditional module registration
- [x] 5.4 Implement .env.example generation by appending feature-specific environment variables with comments

## 6. CLI Entry Point — Interactive Prompts Using Citty + Consola

- [x] 6.1 Implement CLI entry point with citty — positional project name argument, `--yes` flag for non-interactive mode
- [x] 6.2 Implement interactive feature selection prompt flow using consola (project name → auth → database → UI → extras → state → testing → monitoring → deployment → quality → git hooks → confirm)
- [x] 6.3 Implement feature dependency enforcement (e.g., auth requires database)
- [x] 6.4 Implement confirmation summary display before scaffolding
- [x] 6.5 Implement directory validation — error and exit if target directory already exists and is not empty

## 7. Post-scaffold Pipeline

- [x] 7.1 Implement post-scaffold setup: dependency installation via nypm, git init with initial commit, next steps display
- [x] 7.2 Handle dependency installation failure gracefully (display error, suggest manual install, exit 0)

## 8. Integration Testing

- [x] 8.1 Test base-only scaffold (no features) produces a valid project
- [x] 8.2 Test scaffold with all features selected
- [x] 8.3 Test feature dependency enforcement (auth auto-enables database)
- [x] 8.4 Test non-interactive mode with `--yes` flag
- [x] 8.5 Test directory conflict handling (existing non-empty directory)
