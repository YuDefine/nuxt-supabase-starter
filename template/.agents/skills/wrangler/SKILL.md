---
name: wrangler
description: Cloudflare Workers CLI for deploying, developing, and managing Workers, KV, R2, D1, Vectorize, Hyperdrive, Workers AI, Containers, Queues, Workflows, Pipelines, and Secrets Store. Load before running wrangler commands to ensure correct syntax and best practices. Biases towards retrieval from Cloudflare docs over pre-trained knowledge.
---

# Wrangler CLI

Your knowledge of Wrangler CLI flags, config fields, and subcommands may be outdated. Prefer retrieval over pre-training for Wrangler tasks.

## Retrieval Sources

Fetch the latest information before writing or reviewing Wrangler commands and config.

- Wrangler docs: `https://developers.cloudflare.com/workers/wrangler/`
- Cloudflare Workers docs: `https://developers.cloudflare.com/workers/`
- Local schema: `node_modules/wrangler/config-schema.json`

## First Step

Verify installation before use:

```bash
wrangler --version
```

If Wrangler is missing:

```bash
npm install -D wrangler@latest
```

## Key Guidelines

- Prefer `wrangler.jsonc` over TOML for newer configuration support.
- Set a recent `compatibility_date`.
- Run `wrangler types` after config changes.
- Run `wrangler check` before deploy.
- Use environments for staging and production.
