---
description: Runtime adapter fragment for verification-lease.spec.md
paths: ['.claude/consumer-meta.json', 'scripts/dev-session*', 'scripts/dev-singleton*', 'nuxt.config.*', 'packages/**/nuxt.config.*']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/verification-lease.spec.md; edit canonical source -->
<!-- clade-targets: claude -->

# Runtime adapter: Claude

Claude uses the portable lease toolchain with `--kind claude`: `node vendor/scripts/dev-session.ts [opts] -- <cmd...>` is the durable Herdr-backed entrypoint, and `node vendor/scripts/dev-singleton.ts --consumer-meta <path> -- <cmd...>` is the legacy wrapper. Reclaim uses the managed `dev-session.ts stop` / `start` takeover path. The browser carrier is `agent-browser --session <name>` with the selected profile directory.

`node vendor/scripts/db-lease.ts claim|release|status` protects the shared development database independently of the verification lease.
