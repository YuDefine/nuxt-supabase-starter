#!/usr/bin/env node

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=')
    return [key, value]
  })
)

const urls = (args.get('url') ?? '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean)
const timeoutMs = Number(args.get('timeout-ms') ?? 60000)
const intervalMs = Number(args.get('interval-ms') ?? 500)

if (urls.length === 0) {
  console.error('Usage: ready-watch.mjs --url=http://host:port/ready[,http://host2:port/ready]')
  process.exit(2)
}

const deadline = Date.now() + timeoutMs
const evidence = []

while (Date.now() < deadline) {
  const results = await Promise.all(urls.map(checkReady))
  evidence.push({ ts: new Date().toISOString(), results })

  if (results.every((result) => result.ready)) {
    console.log(JSON.stringify({ status: 'ready', evidence }, null, 2))
    process.exit(0)
  }

  await new Promise((resolve) => setTimeout(resolve, intervalMs))
}

console.log(JSON.stringify({ status: 'timeout', evidence }, null, 2))
process.exit(1)

async function checkReady(url) {
  const startedAt = Date.now()
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(Math.min(intervalMs, 1000)) })
    return { url, ready: response.ok, status: response.status, latencyMs: Date.now() - startedAt }
  } catch (error) {
    return {
      url,
      ready: false,
      status: 0,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
