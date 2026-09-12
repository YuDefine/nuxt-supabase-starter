---
name: wrangler
description: "Use before running Wrangler commands for Cloudflare Workers or related resources."
---


# Wrangler CLI

Your knowledge of Wrangler CLI flags, config fields, and subcommands may be outdated. Prefer retrieval over pre-training for Wrangler tasks.

## Retrieval Sources

Fetch the latest information before writing or reviewing Wrangler commands and config.

- Wrangler docs: `https://developers.cloudflare.com/workers/wrangler/`
- Cloudflare Workers docs: `https://developers.cloudflare.com/workers/`
- Local schema: `node_modules/wrangler/config-schema.json`

## First Step

Use the project's package manager and locally installed Wrangler. Check `package.json`, the lockfile, and the deployment scripts, then query that binary's version and help (for a pnpm project: `pnpm exec wrangler --version`). If the declared dependency is not installed, restore the project dependencies. If no dependency is declared, select a compatible version through the project's dependency workflow before installing it.

## Key Guidelines

- Prefer `wrangler.jsonc` over TOML for newer configuration support.
- Keep the project’s tested `compatibility_date`; validate affected runtime behavior when changing it.
- Run `wrangler types` after config changes.
- Run the project’s typecheck/tests and `wrangler deploy --dry-run` with the intended config and environment before deploy. The [deploy dry run](https://developers.cloudflare.com/workers/wrangler/commands/workers/#deploy) compiles without deploying; live bindings and production behavior still need their own verification.
- Use environments for staging and production.
