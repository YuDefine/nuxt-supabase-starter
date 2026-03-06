## Deployment

### Cloudflare

NuxtHub auto-generates `wrangler.json` from your hub config - no manual wrangler.jsonc required:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  hub: {
    db: {
      dialect: 'sqlite',
      driver: 'd1',
      connection: { databaseId: '<database-id>' },
    },
    kv: {
      driver: 'cloudflare-kv-binding',
      namespaceId: '<kv-namespace-id>',
    },
    cache: {
      driver: 'cloudflare-kv-binding',
      namespaceId: '<cache-namespace-id>',
    },
    blob: {
      driver: 'cloudflare-r2',
      bucketName: '<bucket-name>',
    },
  },
})
```

**Observability (recommended):** Enable logging for production deployments:

```jsonc
// wrangler.jsonc (optional)
{
  "observability": {
    "logs": {
      "enabled": true,
      "head_sampling_rate": 1,
      "invocation_logs": true,
      "persist": true,
    },
  },
}
```

Create resources via Cloudflare dashboard or CLI:

```bash
npx wrangler d1 create my-db              # Get database-id
npx wrangler kv namespace create KV       # Get kv-namespace-id
npx wrangler kv namespace create CACHE    # Get cache-namespace-id
npx wrangler r2 bucket create my-bucket   # Get bucket-name
```

Deploy: Create [Cloudflare Workers project](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create), link Git repo. Bindings auto-configured at build time.

**Environments:** Use `CLOUDFLARE_ENV=preview` for preview deployments.

See [wrangler-templates.md](wrangler-templates.md) for manual wrangler.jsonc patterns and [providers.md](providers.md) for all provider configurations.

### Other Providers

See [providers.md](providers.md) for detailed deployment patterns for:

- **Vercel:** Postgres, Turso, Vercel Blob, Vercel KV
- **Netlify:** External databases, S3, Upstash Redis
- **Deno Deploy:** Deno KV
- **AWS/Self-hosted:** S3, RDS, custom configs

### D1 over HTTP

Query D1 from non-Cloudflare hosts:

```ts
hub: {
  db: { dialect: 'sqlite', driver: 'd1-http' }
}
```

Requires: `NUXT_HUB_CLOUDFLARE_ACCOUNT_ID`, `NUXT_HUB_CLOUDFLARE_API_TOKEN`, `NUXT_HUB_CLOUDFLARE_DATABASE_ID`
