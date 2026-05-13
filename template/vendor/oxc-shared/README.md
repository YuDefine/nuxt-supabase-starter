# oxc-shared — clade-governed lint + fmt preset

Importable baseline for `vite.config.ts` `lint` / `fmt` blocks. Replaces the
text-only MUST clauses in `rules/core/code-style.md` § so that changing the
baseline is one edit + `propagate`, not five hand-syncs.

## When to edit

- **Edit `preset.mjs` in clade** when a baseline rule needs adjusting across
  every consumer (e.g. oxlint patch upgrade flipped a default).
- **Do not edit the projected copy** in any consumer's `vendor/oxc-shared/` —
  it is overwritten on next `propagate`.

## Consumer usage

```ts
// <consumer>/vite.config.ts
import { defineConfig } from 'vite-plus'
import { lintBase, fmtBase } from './vendor/oxc-shared/preset.mjs'

export default defineConfig({
  resolve: {
    alias: [
      /* consumer build config */
    ],
  },

  lint: {
    ...lintBase,
    rules: {
      ...lintBase.rules,
      // business overrides only — anything that belongs in the baseline
      // should be added to preset.mjs instead.
      'unicorn/no-thenable': 'off', // supabase PostgREST mock builder chain
    },
    ignorePatterns: [
      ...lintBase.ignorePatterns,
      '.wrangler/', // consumer-specific build artifact
    ],
  },

  fmt: {
    ...fmtBase,
    // Tailwind stylesheet path differs per consumer → not in the baseline.
    experimentalTailwindcss: {
      stylesheet: './app/assets/css/main.css',
      attributes: ['class'],
    },
    ignorePatterns: [...fmtBase.ignorePatterns, 'AGENTS.md'],
  },
})
```

## What goes in `lintBase` vs business override

| Goes in `lintBase` (this file)                                                          | Stays as consumer override                                              |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| categories (correctness/suspicious/perf/etc.)                                           | business `unicorn/*` exemptions                                         |
| 4 plugins (typescript / unicorn / import / promise)                                     | per-consumer `experimentalTailwindcss.stylesheet` path                  |
| common rules (no-console/no-debugger/no-alert/eqeqeq/no-underscore-dangle/etc.)         | consumer build directories in `ignorePatterns` (`.wrangler/`, `local/`) |
| `env: { browser, node, es2024 }`                                                        |                                                                         |
| common ignore prefixes (`node_modules/`, `.nuxt/`, `.output/`, `.claude/skills/`, etc.) |                                                                         |

If you find yourself adding the same override to every consumer, **promote it
to `preset.mjs`** rather than letting it duplicate.

## Why not LOCKED project the whole `vite.config.ts`?

Each consumer's `vite.config.ts` also carries build config (`resolve.alias`,
plugins, dev server options, test setup). Wholesale LOCKED projection would
overwrite those. The preset approach keeps build config consumer-owned while
locking the lint/fmt portion to a single source.
