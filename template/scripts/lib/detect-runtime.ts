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
type EnvKey = keyof NodeJS.ProcessEnv

/** 強訊號是 session/agent identity；弱訊號只能用來保留 runtime 分類相容性。 */
const SESSION_PROBES: ReadonlyArray<readonly [KnownRuntime, readonly EnvKey[]]> = [
  ['claude', ['CLAUDE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CONVERSATION_ID']],
  ['codex', ['CODEX_SESSION_ID', 'CODEX_THREAD_ID']],
  ['opencode', ['OPENCODE_SESSION_ID', 'OPENCODE_AGENT_ID']],
  ['copilot', ['COPILOT_AGENT_ID']],
  ['cursor', ['CURSOR_SESSION_ID', 'CURSOR_CONVERSATION_ID']],
]

const WEAK_PROBES: ReadonlyArray<readonly [KnownRuntime, readonly EnvKey[]]> = [
  ['claude', ['CLAUDE_PROJECT_DIR']],
  ['codex', ['CODEX_AGENT_NAME', 'CODEX_HOME']],
  ['opencode', ['OPENCODE_HOME']],
  ['copilot', ['GITHUB_COPILOT_CHAT']],
  ['cursor', ['CURSOR_TRACE_ID', 'CURSOR_AGENT']],
]

/** Session id 優先序只在已選定 runtime 內生效；禁止跨 runtime fallback。 */
const SESSION_ID_KEYS: Readonly<Record<KnownRuntime, readonly EnvKey[]>> = {
  claude: ['CLAUDE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CONVERSATION_ID'],
  codex: ['CODEX_SESSION_ID', 'CODEX_THREAD_ID'],
  opencode: ['OPENCODE_SESSION_ID', 'OPENCODE_AGENT_ID'],
  copilot: ['COPILOT_AGENT_ID'],
  cursor: ['CURSOR_SESSION_ID', 'CURSOR_CONVERSATION_ID'],
}

function isKnown(v: string): v is KnownRuntime {
  return (KNOWN_RUNTIMES as readonly string[]).includes(v)
}

type RuntimeSignals = {
  explicit: string | undefined
  strong: KnownRuntime[]
  weak: KnownRuntime[]
}

function runtimeSignals(env: NodeJS.ProcessEnv): RuntimeSignals {
  const explicit = env.CLADE_RUNTIME?.trim().toLowerCase() || undefined
  const strong = SESSION_PROBES.filter(([, keys]) =>
    keys.some((key) => Boolean(env[key]?.trim())),
  ).map(([runtime]) => runtime)
  const weak = WEAK_PROBES.filter(([, keys]) => keys.some((key) => Boolean(env[key]?.trim()))).map(
    ([runtime]) => runtime,
  )
  return { explicit, strong, weak }
}

/**
 * 判定當前 runtime。`CLADE_RUNTIME` 顯式覆寫優先於所有 env 探針。
 * 判不出來回 `'unknown'`（**NEVER** 預設成 claude —— 誤歸帳比記成 unknown 更難查）。
 */
export function detectRuntime(env: NodeJS.ProcessEnv = process.env): Runtime {
  const signals = runtimeSignals(env)
  if (signals.explicit) return isKnown(signals.explicit) ? signals.explicit : 'unknown'
  if (signals.strong.length === 1) return signals.strong[0]
  if (signals.strong.length > 1) return 'unknown'
  if (signals.weak.length === 1) return signals.weak[0]
  return 'unknown'
}

/**
 * lease / claim 沿用 explicit → strong → weak 的辨識優先序。
 * 只有全部無訊號才是 human；有訊號但無法唯一判定時拒絕建立 holder。
 */
export function detectHolderKind(env: NodeJS.ProcessEnv = process.env): HolderKind {
  const signals = runtimeSignals(env)

  if (signals.explicit) {
    if (!isKnown(signals.explicit))
      throw new Error(
        `cannot determine holder kind: invalid CLADE_RUNTIME=${JSON.stringify(signals.explicit)}`,
      )
    return signals.explicit
  }

  const runtimes = signals.strong.length ? signals.strong : signals.weak
  if (runtimes.length === 0) return 'human'
  if (runtimes.length > 1)
    throw new Error(
      `cannot determine holder kind: conflicting runtime identity signals (${runtimes.join(', ')})`,
    )
  return runtimes[0]
}

/** 只讀 selected runtime 的 session id；human/unknown/invalid runtime 一律回 null。 */
export function detectSessionId(
  env: NodeJS.ProcessEnv = process.env,
  runtime: Runtime | string = detectRuntime(env),
): string | null {
  if (!isKnown(runtime)) return null
  for (const key of SESSION_ID_KEYS[runtime]) {
    const v = env[key]?.trim()
    if (v) return v
  }
  return null
}

/** telemetry / ledger 的 executor 合法值（從詞彙表推導，不另外寫死）。 */
export function validExecutors(): Set<string> {
  return new Set<string>(KNOWN_RUNTIMES)
}
