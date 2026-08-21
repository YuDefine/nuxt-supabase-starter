// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/detect-runtime.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/detect-runtime.ts
// detect-runtime.ts — agent runtime 辨識的單一詞彙表與判定來源。
//
// 為什麼要抽出來：辨識邏輯原本散在五處各寫一份（`residency-classify.ts` 的
// `VALID_EXECUTORS`、`dev-session.ts` / `dev-singleton.ts` / `db-lease.ts` 的
// `holderKind` / `detectKind`、`claims-lib.ts` 的 `detectRuntime`），其中三處是
// `CLAUDE_SESSION_ID` / `CODEX_SESSION_ID` 二分。引入第三個 runtime 時，它跑掉的工作
// 會被歸成 unknown 或誤判成 claude —— 也就是**無從驗證分攤有沒有發生**（TD-377）。
//
// 這個失效形狀有先例：`rules/core/agent-routing.md` 記著「147 條 `(verified-ui:)`
// annotation 0 次走 codex、92 個 session 全部走 bypass 形狀」—— 規則在、實際 0 次，
// 靠事後 audit 才發現。沒有 executor 維度就是把同一個坑重挖一次。

/**
 * 已知 runtime 詞彙表。新增 runtime **MUST** 只改這裡 —— 消費端（`VALID_EXECUTORS`
 * 等）一律從本表推導，NEVER 各自維護一份字串集合。
 */
export const KNOWN_RUNTIMES = ['claude', 'codex', 'opencode', 'copilot', 'cursor'] as const

export type KnownRuntime = (typeof KNOWN_RUNTIMES)[number]
export type Runtime = KnownRuntime | 'unknown'
/** lease / claim 這類「誰持有」的場景多一個 human（非 agent 操作）。 */
export type HolderKind = KnownRuntime | 'human'

/**
 * env 探針。順序即優先序。
 *
 * ⚠️ `opencode` 那組是**未經實測**的推定變數名 —— opencode 主要以 OpenAI-compatible
 * provider 形式被別的 CLI 消費，未必匯出自己的 session env。所以 `CLADE_RUNTIME`
 * 顯式覆寫才是可靠路徑：包一層 wrapper export 它，不要指望自動偵測。
 */
const PROBES: ReadonlyArray<readonly [KnownRuntime, readonly string[]]> = [
  [
    'claude',
    ['CLAUDE_PROJECT_DIR', 'CLAUDE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CONVERSATION_ID'],
  ],
  ['codex', ['CODEX_SESSION_ID', 'CODEX_AGENT_NAME', 'CODEX_HOME']],
  ['opencode', ['OPENCODE_SESSION_ID', 'OPENCODE_AGENT_ID', 'OPENCODE_HOME']],
  ['copilot', ['COPILOT_AGENT_ID', 'GITHUB_COPILOT_CHAT']],
  ['cursor', ['CURSOR_SESSION_ID', 'CURSOR_TRACE_ID']],
]

/** session id 的取值順序（跨 runtime）。 */
const SESSION_ID_KEYS = [
  'CLAUDE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ID',
  'CODEX_SESSION_ID',
  'OPENCODE_SESSION_ID',
  'CURSOR_SESSION_ID',
] as const

function isKnown(v: string): v is KnownRuntime {
  return (KNOWN_RUNTIMES as readonly string[]).includes(v)
}

/**
 * 判定當前 runtime。`CLADE_RUNTIME` 顯式覆寫優先於所有 env 探針。
 * 判不出來回 `'unknown'`（**NEVER** 預設成 claude —— 誤歸帳比記成 unknown 更難查）。
 */
export function detectRuntime(env: NodeJS.ProcessEnv = process.env): Runtime {
  const explicit = env.CLADE_RUNTIME?.trim().toLowerCase()
  if (explicit && isKnown(explicit)) return explicit
  for (const [runtime, keys] of PROBES) {
    if (keys.some((k) => env[k])) return runtime
  }
  return 'unknown'
}

/**
 * lease / claim 用的持有者類型：判不出 runtime 時視為 human 操作，
 * 而不是 unknown —— 這些場景的「非 agent」是有意義的第三態。
 */
export function detectHolderKind(env: NodeJS.ProcessEnv = process.env): HolderKind {
  const r = detectRuntime(env)
  return r === 'unknown' ? 'human' : r
}

/** 跨 runtime 取 session id；沒有任何一個命中回 null。 */
export function detectSessionId(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const k of SESSION_ID_KEYS) {
    const v = env[k]
    if (v) return v
  }
  return null
}

/** telemetry / ledger 的 executor 合法值（從詞彙表推導，不另外寫死）。 */
export function validExecutors(): Set<string> {
  return new Set<string>(KNOWN_RUNTIMES)
}
