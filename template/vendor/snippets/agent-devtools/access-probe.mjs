// === agent-devtools: Cloudflare Access edge probe ===
// 對應規約：rules/core/dev-tunnel-convention.md § 6（層 3：dev tunnel 必須掛 CF Access）
//
// 同一份檔同時給兩端用（FR-012：判準只有一份）：
//   - consumer 的 nuxt.config.ts 從 repo 根的投影檔 `vendor/snippets/agent-devtools/access-probe.mjs`
//     存在才動態 import（缺檔不會讓 config 載不起來），dev server 啟動前探一次，結果不是 'access'
//     （含缺檔）就關 DevTools；
//   - clade 的 scripts/dev-port-audit.ts 從源檔 import，逐 consumer 稽核。
//
// 本檔投影給 PUBLIC repo：NEVER 寫進任何專案代號、zone 名或 hostname，只吃呼叫端給的 hostname。
// 無相依、不需編譯；NEVER throw——任何例外都收斂成 'unreachable'。
// =====================================

/** 兩條都要被導到 Access 登入頁才算有 Access：DevTools 端點＋站台根路徑。 */
export const PROBE_PATHS = ['/__devtools/__mcp', '/']

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308])

/**
 * 單條探測結果 → 'access' | 'no-access' | 'unreachable'。
 * @param {{ status?: number, location?: string | null, error?: unknown }} r
 */
export function classifyOne(r) {
  if (!r || r.error !== undefined || typeof r.status !== 'number') return 'unreachable'
  if (!REDIRECT_CODES.has(r.status) || !r.location) return 'no-access'
  try {
    const host = new URL(r.location).hostname.toLowerCase()
    return host.endsWith('.cloudflareaccess.com') ? 'access' : 'no-access'
  } catch {
    return 'no-access'
  }
}

/**
 * 合併兩條：都 'access' → 'access'；任一 'unreachable' → 'unreachable'；否則 'no-access'。
 * 只有 'access' 會開 DevTools／過稽核（探測不明一律當作沒有 Access）。
 * @param {Array<{ status?: number, location?: string | null, error?: unknown }>} results
 */
export function classifyProbe(results) {
  const each = results.map(classifyOne)
  if (each.length > 0 && each.every((v) => v === 'access')) return 'access'
  if (each.length === 0 || each.includes('unreachable')) return 'unreachable'
  return 'no-access'
}

/**
 * 不帶憑證、不跟轉址，對兩條路徑並行各發一個請求，合計逾時 timeoutMs。
 * @param {string} hostname 例：`<consumer-id>-dev.<zone>`（不含 scheme）
 * @param {{ timeoutMs?: number, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<'access' | 'no-access' | 'unreachable'>}
 */
export async function probeAccess(hostname, { timeoutMs = 3000, fetchImpl = globalThis.fetch } = {}) {
  if (!hostname || typeof fetchImpl !== 'function') return 'unreachable'
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const results = await Promise.all(
      PROBE_PATHS.map(async (path) => {
        try {
          const res = await fetchImpl(`https://${hostname}${path}`, {
            method: 'GET',
            redirect: 'manual',
            credentials: 'omit',
            signal: ac.signal,
          })
          return { status: res.status, location: res.headers.get('location') }
        } catch (error) {
          return { error }
        }
      }),
    )
    return classifyProbe(results)
  } catch {
    return 'unreachable'
  } finally {
    clearTimeout(timer)
  }
}
