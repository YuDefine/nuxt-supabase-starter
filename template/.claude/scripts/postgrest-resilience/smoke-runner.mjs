#!/usr/bin/env node

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=')
    return [key, value]
  })
)

const endpoints = process.argv
  .slice(2)
  .filter((arg) => arg.startsWith('--endpoint='))
  .map((arg) => arg.replace(/^--endpoint=/, ''))
  .map((entry) => {
    const separator = entry.indexOf('=')
    if (separator === -1) return { name: entry, url: entry }
    return { name: entry.slice(0, separator), url: entry.slice(separator + 1) }
  })

const seconds = Number(args.get('seconds') ?? 30)
const intervalMs = Number(args.get('interval-ms') ?? 250)
const deadline = Date.now() + seconds * 1000
const rows = []

if (endpoints.length === 0) {
  console.error(
    'Usage: smoke-runner.mjs --endpoint=name=https://example/rest/v1/table --seconds=30'
  )
  process.exit(2)
}

while (Date.now() < deadline) {
  await Promise.all(endpoints.map(runRequest))
  await new Promise((resolve) => setTimeout(resolve, intervalMs))
}

console.log(
  JSON.stringify({ generatedAt: new Date().toISOString(), rows, summary: summarize(rows) }, null, 2)
)

async function runRequest(endpoint) {
  const startedAt = Date.now()
  try {
    const response = await fetch(endpoint.url, { signal: AbortSignal.timeout(5000) })
    const body = await response.text()
    rows.push({
      ts: new Date().toISOString(),
      endpoint: endpoint.name,
      status: response.status,
      ok: response.ok,
      latencyMs: Date.now() - startedAt,
      retryAfter: response.headers.get('retry-after'),
      bodySample: body.slice(0, 160),
    })
  } catch (error) {
    rows.push({
      ts: new Date().toISOString(),
      endpoint: endpoint.name,
      status: 0,
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function summarize(items) {
  const groups = new Map()
  for (const item of items) {
    const group = groups.get(item.endpoint) ?? {
      endpoint: item.endpoint,
      total: 0,
      ok: 0,
      unexpected5xx: 0,
      retryAfter: 0,
      status: {},
      latencies: [],
    }
    group.total += 1
    if (item.ok) group.ok += 1
    if (item.status === 0 || item.status >= 500) group.unexpected5xx += 1
    if (item.retryAfter) group.retryAfter += 1
    group.status[item.status] = (group.status[item.status] ?? 0) + 1
    group.latencies.push(item.latencyMs)
    groups.set(item.endpoint, group)
  }

  return [...groups.values()].map((group) => ({
    endpoint: group.endpoint,
    total: group.total,
    ok: group.ok,
    okRate: Number((group.ok / group.total).toFixed(4)),
    status: group.status,
    unexpected5xx: group.unexpected5xx,
    retryAfter: group.retryAfter,
    maxLatencyMs: Math.max(...group.latencies),
    p95LatencyMs: percentile(group.latencies, 95),
  }))
}

function percentile(values, p) {
  const sorted = [...values].toSorted((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index] ?? 0
}
