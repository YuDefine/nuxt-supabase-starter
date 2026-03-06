## KV Storage

Key-value storage. `kv` is auto-imported on server-side.

```ts
import { kv } from 'hub:kv'

await kv.set('key', { data: 'value' })
await kv.set('key', value, { ttl: 60 }) // TTL in seconds
const value = await kv.get('key')
const exists = await kv.has('key')
await kv.del('key')
const keys = await kv.keys('prefix:')
await kv.clear('prefix:')
```

Constraints: max value 25 MiB, max key 512 bytes.

### KV Providers

| Provider      | Package          | Env Vars                                             |
| ------------- | ---------------- | ---------------------------------------------------- |
| Upstash       | `@upstash/redis` | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| Redis         | `ioredis`        | `REDIS_URL`                                          |
| Cloudflare KV | -                | `KV` binding in wrangler.jsonc                       |
| Deno KV       | -                | Auto on Deno Deploy                                  |
| Vercel        | -                | `KV_REST_API_URL`, `KV_REST_API_TOKEN`               |
