## Cache

Response and function caching.

### Route Handler Caching

```ts
export default cachedEventHandler(
  (event) => {
    return { data: 'cached', date: new Date().toISOString() }
  },
  {
    maxAge: 60 * 60, // 1 hour
    getKey: (event) => event.path,
  }
)
```

### Function Caching

```ts
export const getStars = defineCachedFunction(
  async (event: H3Event, repo: string) => {
    const data = await $fetch(`https://api.github.com/repos/${repo}`)
    return data.stargazers_count
  },
  { maxAge: 3600, name: 'ghStars', getKey: (event, repo) => repo }
)
```

### Cache Invalidation

```ts
// Remove specific
await useStorage('cache').removeItem('nitro:functions:getStars:repo-name.json')

// Clear by prefix
await useStorage('cache').clear('nitro:handlers')
```

Cache key pattern: `${group}:${name}:${getKey(...args)}.json` (defaults: group='nitro', name='handlers'|'functions'|'routes')
