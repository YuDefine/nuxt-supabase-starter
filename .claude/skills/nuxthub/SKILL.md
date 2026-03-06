---
name: nuxthub
description: Use when building NuxtHub v0.10.4 applications - provides database (Drizzle ORM with sqlite/postgresql/mysql), KV storage, blob storage, and cache APIs. Covers configuration, schema definition, migrations, multi-cloud deployment (Cloudflare, Vercel), and the new hub:db, hub:kv, hub:blob virtual module imports.
license: MIT
---

# NuxtHub v0.10.4

Full-stack Nuxt framework with database, KV, blob, and cache. Multi-cloud support.

**For Nuxt server patterns:** use `nuxt` skill
**For content with database:** use `nuxt-content` skill

## Installation

```bash
npx nuxi module add hub
```

## Configuration

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@nuxthub/core'],
  hub: {
    db: 'sqlite', // 'sqlite' | 'postgresql' | 'mysql'
    kv: true,
    blob: true,
    cache: true,
    dir: '.data',
    remote: false, // use production bindings in dev (v0.10.4+)
  },
})
```

## Quick Reference

| Feature  | Import                                | Key Methods                        |
| -------- | ------------------------------------- | ---------------------------------- |
| Database | `import { db, schema } from 'hub:db'` | `db.select()`, `db.insert()`, etc. |
| KV       | `import { kv } from 'hub:kv'`         | `kv.get()`, `kv.set()`, etc.       |
| Blob     | `import { blob } from 'hub:blob'`     | `blob.put()`, `blob.get()`, etc.   |

All are auto-imported on server-side.

## Available Guidance

| File                                                                 | Topics                                       |
| -------------------------------------------------------------------- | -------------------------------------------- |
| [references/database.md](references/database.md)                     | Schema, Drizzle API, migrations, providers   |
| [references/kv.md](references/kv.md)                                 | KV storage API, TTL, providers               |
| [references/blob.md](references/blob.md)                             | Blob API, upload helpers, Vue composables    |
| [references/cache.md](references/cache.md)                           | Route/function caching, invalidation         |
| [references/deployment.md](references/deployment.md)                 | Cloudflare, Vercel, Netlify, Deno deployment |
| [references/advanced.md](references/advanced.md)                     | Build hooks, type sharing, WebSocket         |
| [references/providers.md](references/providers.md)                   | All provider configurations                  |
| [references/wrangler-templates.md](references/wrangler-templates.md) | Manual wrangler.jsonc patterns               |

**Load based on context — DO NOT read all files at once.**

## Resources

- [Installation](https://hub.nuxt.com/docs/getting-started/installation)
- [Database](https://hub.nuxt.com/docs/database)
- [Blob](https://hub.nuxt.com/docs/blob)
- [KV](https://hub.nuxt.com/docs/kv)
- [Cache](https://hub.nuxt.com/docs/cache)
- [Deploy](https://hub.nuxt.com/docs/getting-started/deploy)
