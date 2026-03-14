## Context

The nuxt-supabase-starter is a monolithic template with 10+ tightly integrated features. Users currently clone the full repo and manually strip unwanted modules — a tedious, error-prone process. We need a CLI scaffolding tool that generates a tailored project from user selections.

The UnJS ecosystem (citty, consola, giget, nypm, pathe) provides battle-tested primitives used by Nuxt's own `nuxi init`. We will follow the same patterns.

## Goals / Non-Goals

**Goals:**

- Interactive CLI with prompts for feature selection
- Composable template system: base + feature overlays
- Generated projects are self-contained — no runtime dependency on the CLI
- Publishable to npm as `create-nuxt-starter` (usable via `npx create-nuxt-starter`)
- Feature modules can depend on each other (e.g., auth requires database)

**Non-Goals:**

- GUI or web-based project creator
- Plugin system for third-party feature modules
- Monorepo scaffolding (single app only)
- Post-creation update/upgrade command
- Ejecting individual features after project creation

## Decisions

### Package structure as workspace member

The CLI lives in `packages/create-nuxt-starter/` as a pnpm workspace member. This keeps it co-located with the starter for easy template synchronization while being independently publishable.

**Alternative**: Separate repository — rejected because templates would drift out of sync with the starter.

### Template composition via file overlay

Use a layered file system approach:

1. **Base template** (`templates/base/`): Minimal Nuxt 4 + TypeScript project with `nuxt.config.ts`, `package.json`, `tsconfig.json`, `app.vue`, basic pages
2. **Feature overlays** (`templates/features/<name>/`): Each feature adds/patches files
3. **Composition order**: Base → features (in dependency order) → final cleanup

Files are merged using simple strategies:

- `package.json`: deep merge dependencies/devDependencies/scripts
- `nuxt.config.ts`: use a template with conditional blocks (EJS-style)
- `.env.example`: append feature-specific vars
- Other files: copy (overlay wins on conflict)

**Alternative**: Single template with conditionals everywhere — rejected because it becomes unmaintainable as features grow.

### Feature module definition format

Each feature module is a TypeScript object:

```typescript
interface FeatureModule {
  id: string
  name: string
  description: string
  default: boolean
  dependencies?: string[] // other feature IDs required
  incompatible?: string[] // other feature IDs that conflict
  packages: Record<string, string>
  devPackages?: Record<string, string>
  nuxtModules?: string[]
  envVars?: Record<string, string>
  templateDir: string // path to overlay files
}
```

This declarative format makes it easy to add new features without changing CLI logic.

### Interactive prompts using citty + consola

- `citty`: CLI framework with argument parsing and sub-commands
- `consola`: Styled prompts (confirm, select, multiselect) with consistent UX
- Prompt flow: project name → auth → database → UI → extras (multiselect) → testing → deployment → confirm

### nuxt.config.ts generation via EJS template

Instead of AST manipulation (complex, fragile), use an EJS template for `nuxt.config.ts` that conditionally includes module registrations and config blocks. This is simpler and more readable than code generation.

### Post-scaffold pipeline

After file assembly:

1. Install dependencies via `nypm` (auto-detects pnpm/npm/yarn)
2. Initialize git repo
3. Display next steps (env setup, database init, dev server)

## Risks / Trade-offs

- **[Template drift]** → Templates may diverge from the main starter over time. Mitigation: CI job that verifies templates compile and pass basic checks. Consider a `/validate-starter` script.
- **[Feature interaction complexity]** → Some feature combinations may produce broken configs. Mitigation: Integration tests for common feature combinations; dependency/incompatibility declarations in module definitions.
- **[EJS template maintainability]** → `nuxt.config.ts` EJS template could become complex. Mitigation: Keep config minimal per feature; let feature overlays contribute config fragments that get merged.
- **[Version pinning]** → Template package versions will become stale. Mitigation: Use `^` semver ranges; provide a version bump script.
