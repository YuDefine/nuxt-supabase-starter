## Build-time Hooks

```ts
// Extend schema
nuxt.hook('hub:db:schema:extend', async ({ dialect, paths }) => {
  paths.push(await resolvePath(`./schema/custom.${dialect}`))
})

// Add migration directories
nuxt.hook('hub:db:migrations:dirs', (dirs) => {
  dirs.push(resolve('./db-migrations'))
})

// Post-migration queries (idempotent)
nuxt.hook('hub:db:queries:paths', (paths, dialect) => {
  paths.push(resolve(`./seed.${dialect}.sql`))
})
```

## Type Sharing

```ts
// shared/types/db.ts
import type { users } from '~/server/db/schema'

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
```

## WebSocket / Realtime

Enable experimental WebSocket:

```ts
// nuxt.config.ts
nitro: {
  experimental: {
    websocket: true
  }
}
```

```ts
// server/routes/ws/chat.ts
export default defineWebSocketHandler({
  open(peer) {
    peer.subscribe('chat')
    peer.publish('chat', 'User joined')
  },
  message(peer, message) {
    peer.publish('chat', message.text())
  },
  close(peer) {
    peer.unsubscribe('chat')
  },
})
```

## Deprecated (v0.10)

Removed Cloudflare-specific features:

- `hubAI()` -> Use AI SDK with Workers AI Provider
- `hubBrowser()` -> Puppeteer
- `hubVectorize()` -> Vectorize
- NuxtHub Admin -> Sunset Dec 31, 2025
- `npx nuxthub deploy` -> Use wrangler deploy
