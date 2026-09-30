#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/actions/evlog-map-gate/local.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/actions/evlog-map-gate/local.ts

/**
 * local.ts — 在本機跑與 CI 同一道 evlog map gate
 *
 * 讀 consumer `.github/workflows/*.yml` 裡每一個 `uses: ./…/evlog-map-gate` 步驟的 `with:`
 * （mode / cwd / baseline / min-score），設成同樣的 INPUT_* 後呼叫該 action 目錄的 run.sh。
 * CI 那一步跑的也是這支 run.sh，所以本機與 CI 只有一份判定：CI 用 ratchet 的 repo 本機也是
 * ratchet，layer monorepo 的多個 cwd 本機也照樣逐 layer 掃。
 *
 * 為什麼要有它：commit 0-E 與 CI 之間沒有任何會自己跑的東西。0-E 被跳過（<consumer-b> v1.268.0、
 * v1.277.0）或 CI 只在 tag 觸發時，覆蓋率缺口要到發版那一刻才浮現，deploy 當場被擋。
 * work-route 在 task 完成前、pre-push 在推出去前各叫一次本檔。
 *
 * 用法：
 *   node .github/actions/evlog-map-gate/local.ts [--repo <root>] [--base <ref>]
 *                                               [--committed-only] [--print-config]
 *
 *   --repo            repo 根（預設 git toplevel）；workflow 與 `uses: ./…` 都相對它解析
 *   --base            變更檔清單的比較基準（預設 origin/HEAD 指向的分支，抓不到用 origin/main）
 *   --committed-only  只算 <base>...HEAD。pre-push 用：推出去的是 commit，不是 working tree。
 *                     預設另併入未 commit 與 untracked 的檔（commit 之前跑時它們才是本次變更）
 *   --print-config    只印解析出的 gate 設定（JSON），不跑
 *
 * exit 0 = 通過，或 CI 沒有這道 gate（本機也就沒有對應判定）
 *      1 = gate 未通過（含 CI 上同樣會失敗的設定錯誤，例如 workflow 沒寫 mode）
 *      2 = 用法錯誤，或 workflow 寫法本機重現不了
 */

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface GateStep {
  /** workflow 檔（相對 repo 根）與 `uses:` 所在行號（1-based），給人回頭找 */
  workflow: string
  line: number
  /** `uses:` 的值，例如 `./.github/actions/evlog-map-gate` */
  uses: string
  /** `with:` 底下的鍵值；區塊字串（`cwd: |`）保留換行 */
  with: Record<string, string>
}

const USES_RE = /^(\s*)(-\s+)?uses:\s*(['"]?)(\.\/[^'"\s#]*evlog-map-gate)\3\s*(#.*)?$/
const BLOCK_SCALAR_RE = /^[|>][-+]?\s*(#.*)?$/

function indentOf(line: string) {
  return line.length - line.trimStart().length
}

function isContent(line: string) {
  const t = line.trim()
  return t !== '' && !t.startsWith('#')
}

/** 單行 scalar：去引號；未加引號的去掉行尾註解 */
function scalar(raw: string) {
  const v = raw.trim()
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) return v.slice(1, -1)
  const hash = v.search(/\s#/)
  return (hash === -1 ? v : v.slice(0, hash)).trim()
}

/**
 * 從 workflow 文字找出每一個 evlog-map-gate 步驟與它的 `with:`。
 *
 * 只做本 action 用得到的 YAML 子集（區塊 mapping、`|`／`>` 區塊字串、單行 scalar、註解）。
 * **NEVER** 放寬成「看不懂就略過」：`with:` 讀錯等於本機用錯的 mode 跑，那比不跑更糟 ——
 * 看不懂的寫法丟錯，由呼叫端以 exit 2 回報。
 */
export function parseGateSteps(text: string, workflow = '<workflow>'): GateStep[] {
  const lines = text.split(/\r?\n/)
  const steps: GateStep[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = USES_RE.exec(lines[i])
    if (!m) continue
    const keyIndent = m[1].length + (m[2]?.length ?? 0)

    // 步驟起點：`uses:` 自己帶 `- `，或往上找 `- ` 開頭、鍵對齊 keyIndent 的那一行
    let start = i
    if (!m[2]) {
      for (let j = i - 1; j >= 0; j--) {
        if (!isContent(lines[j])) continue
        const dash = /^(\s*)(-\s+)/.exec(lines[j])
        if (dash && dash[1].length + dash[2].length === keyIndent) {
          start = j
          break
        }
        if (indentOf(lines[j]) < keyIndent) break
      }
    }
    // 步驟終點：之後第一個縮排小於 keyIndent 的內容行（下一個 `- ` 或上一層的鍵）
    let end = lines.length
    for (let j = i + 1; j < lines.length; j++) {
      if (isContent(lines[j]) && indentOf(lines[j]) < keyIndent) {
        end = j
        break
      }
    }

    const withRe = new RegExp(
      `^(?:\\s{${keyIndent}}|\\s{${Math.max(keyIndent - 2, 0)}}-\\s+)with:\\s*(.*)$`,
    )
    const withAt = lines.slice(start, end).findIndex((l) => withRe.test(l))
    const values: Record<string, string> = {}
    if (withAt !== -1) {
      const withLine = start + withAt
      const rest = withRe.exec(lines[withLine])![1].trim()
      if (rest !== '' && !rest.startsWith('#')) {
        throw new Error(
          `${workflow}:${withLine + 1} 的 \`with:\` 不是區塊 mapping（${rest}）—— 本機重現不了，改成逐行 key: value`,
        )
      }
      let childIndent = -1
      for (let j = withLine + 1; j < end; j++) {
        const line = lines[j]
        if (!isContent(line)) continue
        const ind = indentOf(line)
        if (ind <= keyIndent) break
        if (childIndent === -1) childIndent = ind
        if (ind !== childIndent) continue
        const kv = /^\s*([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
        if (!kv) {
          throw new Error(`${workflow}:${j + 1} 看不懂的 \`with:\` 寫法：${line.trim()}`)
        }
        const [, key, raw] = kv
        if (BLOCK_SCALAR_RE.test(raw.trim())) {
          const body: string[] = []
          let bodyIndent = -1
          let k = j + 1
          for (; k < end; k++) {
            const bl = lines[k]
            if (bl.trim() === '') {
              body.push('')
              continue
            }
            const bi = indentOf(bl)
            if (bi <= childIndent) break
            if (bodyIndent === -1) bodyIndent = bi
            body.push(bl.slice(Math.min(bi, bodyIndent)))
          }
          while (body.length && body.at(-1) === '') body.pop()
          values[key] = body.join('\n')
          j = k - 1
        } else {
          values[key] = scalar(raw)
        }
      }
    }
    steps.push({ workflow, line: i + 1, uses: m[4], with: values })
  }
  return steps
}

/** 讀 repo 內所有 workflow 的 gate 步驟 */
export function findGateSteps(repoRoot: string): GateStep[] {
  const dir = join(repoRoot, '.github', 'workflows')
  if (!existsSync(dir)) return []
  const files = readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .toSorted()
  return files.flatMap((f) =>
    parseGateSteps(readFileSync(join(dir, f), 'utf8'), relative(repoRoot, join(dir, f))),
  )
}

export interface GateConfig {
  actionDir: string
  mode: string
  cwd: string
  baseline: string
  minScore: string
  sources: string[]
}

/** 本機求不了值的欄位（GitHub expression）。base-ref 不在內：本機一律自己決定比較基準 */
const LOCAL_FIELDS = ['mode', 'cwd', 'baseline', 'min-score'] as const

/**
 * 步驟 → 本機要跑的設定，同一組設定只跑一次。預設值與 action.yml 的 inputs 一致；
 * mode 沒有預設（空字串原樣交給 run.sh，由 gate.ts 以 exit 2 拒絕 —— CI 上也是這樣）。
 */
export function toConfigs(repoRoot: string, steps: GateStep[]): GateConfig[] {
  const byKey = new Map<string, GateConfig>()
  for (const s of steps) {
    for (const f of LOCAL_FIELDS) {
      if (s.with[f]?.includes('${{')) {
        throw new Error(
          `${s.workflow}:${s.line} 的 \`${f}\` 是 GitHub expression（${s.with[f]}）—— 本機求不了值`,
        )
      }
    }
    const cfg: GateConfig = {
      actionDir: resolve(repoRoot, s.uses),
      mode: s.with.mode ?? '',
      cwd: s.with.cwd ?? '.',
      baseline: s.with.baseline ?? 'evlog.map.json',
      minScore: s.with['min-score'] ?? '100',
      sources: [`${s.workflow}:${s.line}`],
    }
    const key = JSON.stringify([cfg.actionDir, cfg.mode, cfg.cwd, cfg.baseline, cfg.minScore])
    const seen = byKey.get(key)
    if (seen) seen.sources.push(...cfg.sources)
    else byKey.set(key, cfg)
  }
  return [...byKey.values()]
}

function git(repoRoot: string, args: string[]) {
  const r = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
  return r.status === 0 ? r.stdout : null
}

/** origin/HEAD 指向的分支（CI 的 base-ref 預設 origin/main；PR 則是 origin/<base>） */
function defaultBase(repoRoot: string) {
  const head = git(repoRoot, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])?.trim()
  return head ? head.replace(/^refs\/remotes\//, '') : 'origin/main'
}

/** commit 之前的本次變更：working tree 相對 HEAD 的改動 ＋ untracked */
function uncommittedPaths(repoRoot: string) {
  const tracked = git(repoRoot, ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']) ?? ''
  const untracked = git(repoRoot, ['ls-files', '--others', '--exclude-standard']) ?? ''
  return `${tracked}${untracked}`
}

function parseArgs(argv: string[]) {
  const out = { repo: '', base: '', committedOnly: false, printConfig: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--repo') out.repo = argv[++i]
    else if (a === '--base') out.base = argv[++i]
    else if (a === '--committed-only') out.committedOnly = true
    else if (a === '--print-config') out.printConfig = true
    else {
      process.stderr.write(`unknown flag: ${a}\n`)
      process.exit(2)
    }
  }
  return out
}

const TAG = '[evlog-map-gate local]'

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const repoRoot = resolve(
    opts.repo || git(process.cwd(), ['rev-parse', '--show-toplevel'])?.trim() || process.cwd(),
  )

  let configs: GateConfig[]
  try {
    configs = toConfigs(repoRoot, findGateSteps(repoRoot))
  } catch (err) {
    process.stderr.write(`${TAG} ${(err as Error).message}\n`)
    process.exit(2)
  }

  if (opts.printConfig) {
    process.stdout.write(`${JSON.stringify(configs, null, 2)}\n`)
    return
  }
  if (configs.length === 0) {
    process.stdout.write(
      `${TAG} CI workflow 沒有 evlog-map-gate 步驟 —— 沒有對應的 CI 判定，跳過\n`,
    )
    return
  }

  const base = opts.base || defaultBase(repoRoot)
  const scratch = mkdtempSync(join(tmpdir(), 'evlog-gate-local-'))
  let failed = 0
  try {
    const extra = join(scratch, 'uncommitted.txt')
    const dirty = uncommittedPaths(repoRoot)
    writeFileSync(extra, opts.committedOnly ? '' : dirty, 'utf8')
    // --committed-only 只縮小「本次觸及」的清單；evlog map 與 baseline 仍讀 working tree。
    // 有未 commit 的改動時判定可能與 CI（只看 commit）不同 —— 點名，NEVER 靜默。
    const dirtyPaths = dirty.split('\n').filter(Boolean)
    if (opts.committedOnly && dirtyPaths.length > 0) {
      process.stdout.write(
        `${TAG} 注意：working tree 有 ${dirtyPaths.length} 個未 commit 的檔（${dirtyPaths.slice(0, 3).join(', ')}` +
          `${dirtyPaths.length > 3 ? ' …' : ''}）—— evlog map 掃的是 working tree，判定可能與只看 commit 的 CI 不同\n`,
      )
    }

    for (const cfg of configs) {
      const cwdLabel = cfg.cwd.split('\n').filter(Boolean).join(',')
      process.stdout.write(
        `${TAG} ${cfg.sources.join(' ')} → mode=${cfg.mode || '（未寫）'} cwd=${cwdLabel} base=${base}` +
          `${opts.committedOnly ? '（只算已 commit）' : '（含未 commit）'}\n`,
      )
      if (cfg.mode === '') {
        process.stdout.write(
          `${TAG} workflow 沒寫 mode：CI 這一步同樣會 exit 2。修法是在 workflow 補 \`mode:\`（strict 或 ratchet），不是改插樁\n`,
        )
      }
      const runSh = join(cfg.actionDir, 'run.sh')
      if (!existsSync(runSh)) {
        process.stderr.write(
          `${TAG} ${relative(repoRoot, cfg.actionDir)} 沒有 run.sh —— 該 action 目錄與本檔不是同一版 clade 投影，先更新投影再跑\n`,
        )
        failed++
        continue
      }
      const r = spawnSync('bash', [runSh], {
        cwd: repoRoot,
        stdio: 'inherit',
        env: {
          ...process.env,
          GITHUB_ACTION_PATH: cfg.actionDir,
          INPUT_BASE_REF: base,
          INPUT_CWD: cfg.cwd,
          INPUT_BASELINE: cfg.baseline,
          INPUT_MODE: cfg.mode,
          INPUT_MIN_SCORE: cfg.minScore,
          EVLOG_GATE_EXTRA_CHANGED: extra,
        },
      })
      if (r.status !== 0) failed++
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }

  if (failed > 0) {
    process.stdout.write(
      `\n${TAG} ✗ ${failed}/${configs.length} 組 gate 未通過 —— CI 會以同樣的判定擋下。\n` +
        `  修法：對上面列出的每一個 entry point 跑 \`npx evlog map <檔案路徑> --no-write\`（MUST 帶 --no-write）看缺哪一條，\n` +
        `  補 useLogger(event) + log.set、catch 補 log.error、createError 補 why／fix；修完重跑本檔。\n` +
        `  判準與禁止事項：evlog-adoption 規約 § Coverage 維度（evlog map）；commit 時照 0-E 重產 evlog.map.json。\n`,
    )
    process.exit(1)
  }
}

// CLI 進入判定兩邊都 realpath：經 symlink 叫進來時 argv[1] 不會被 realpath 化（TD-460）
function invokedAsCli() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return entry === fileURLToPath(import.meta.url)
  }
}

if (invokedAsCli()) main()
