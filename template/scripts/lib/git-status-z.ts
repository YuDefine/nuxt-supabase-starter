// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/git-status-z.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/git-status-z.ts
/**
 * `git status --porcelain=v1 -z` 的執行與解析（propagate 解析、wip-dirty／wt-batch／census 執行＋解析）。
 *
 * 不帶 `-z` 時 `core.quotePath` 把非 ASCII 路徑寫成帶引號的八進位跳脫（`"\346\234\200…"`），
 * 拿去比對投影清單／當 pathspec 全落空：propagate 漏 commit 該路徑，WIP gate 把投影殘留當成 user WIP。
 * 呼叫端常以隔離 env（`GIT_CONFIG_GLOBAL=/dev/null`）跑 git，全域 `core.quotePath` 進不來，
 * **NEVER** 用 `-c core.quotepath=off` 單點繞過——呼叫端用 `readGitStatus` 直接拿 entries，
 * 拿不到原始字串，也就不會漏帶 `-z`。
 *
 * 本檔刻意零依賴：wip-dirty 是 hook 直接執行的 CLI，不能為了解析器拖進投影分類器那串 import。
 */
import { execFileSync } from 'node:child_process'

export type GitStatusEntry = { code: string; path: string; origPath?: string }

/**
 * `git status --porcelain=v1 -z` → `{ code, path, origPath? }`。rename／copy 在 `-z` 下是
 * 「`R  <new>`\0`<old>`」兩個欄位：`path` 取新路徑，舊路徑放 `origPath`。
 */
export function parseGitStatusZ(stdout: string): GitStatusEntry[] {
  const out: GitStatusEntry[] = []
  const fields = stdout.split('\0')
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]
    if (field.length < 4) continue
    const code = field.slice(0, 2)
    const entry: GitStatusEntry = { code, path: field.slice(3) }
    if (code.includes('R') || code.includes('C')) entry.origPath = fields[++i]
    out.push(entry)
  }
  return out
}

export type ReadGitStatusOptions = {
  /** 缺省 `process.env`；要隔離 `GIT_CONFIG_GLOBAL` 等的呼叫端自己帶。 */
  env?: NodeJS.ProcessEnv
  untracked?: 'normal' | 'all'
  /** 限縮到這些 pathspec（接在 `--` 之後）。 */
  pathspec?: readonly string[]
  /** 帶 `--no-renames`：rename 拆成 D＋A／??，不產生 `origPath`。 */
  noRenames?: boolean
  /** 帶 `--ignored=matching`：ignored 項目以 `!!` 列出。 */
  ignored?: boolean
  timeoutMs?: number
  /** 帶全域 `--no-optional-locks`：共享樹上的純讀快照不為 refresh index 拿 `index.lock`。 */
  noOptionalLocks?: boolean
}

/**
 * 在 `cwd` 跑 `git status --porcelain=v1 -z` 並解析。git 失敗時拋出（fail-open／closed 由呼叫端決定）。
 * `untracked: 'all'` 逐檔列 untracked——gate 用它防收合的 `?? dir/` 藏住真檔；
 * 熱路徑（Stop hook）用預設 `normal`，一個 untracked 目錄只算一筆。
 */
export function readGitStatus(cwd: string, opts: ReadGitStatusOptions = {}): GitStatusEntry[] {
  const args = [
    ...(opts.noOptionalLocks ? ['--no-optional-locks'] : []),
    'status',
    '--porcelain=v1',
    '-z',
    `--untracked-files=${opts.untracked ?? 'normal'}`,
  ]
  if (opts.noRenames) args.push('--no-renames')
  if (opts.ignored) args.push('--ignored=matching')
  if (opts.pathspec?.length) args.push('--', ...opts.pathspec)
  const stdout = execFileSync('git', args, {
    cwd,
    env: opts.env ?? process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
    ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
  })
  return parseGitStatusZ(stdout)
}

/**
 * entries → 不帶引號的 porcelain 風格列（`XY path`，rename 為 `XY old -> new`），一列一筆。
 * 給「整份快照字串逐列比對」的呼叫端用（squash 前後 drift、line-diff）：路徑原樣、不被 `core.quotePath` 跳脫。
 * **NEVER** 對這種字串再用 `' -> '` 以外的方式切路徑——含 ` -> ` 的真實檔名在這個格式下有歧義，要精確路徑改用 entries。
 */
export function renderGitStatusLines(entries: readonly GitStatusEntry[]): string {
  return entries
    .map((e) => `${e.code} ${e.origPath === undefined ? '' : `${e.origPath} -> `}${e.path}`)
    .join('\n')
}

/**
 * `git diff --stat` 等「人讀輸出」會把非 ASCII 路徑寫成 `"\346\234…"`（`core.quotePath`）。
 * 把這種帶引號的八進位跳脫還原成真路徑，好跟 `readGitStatus` 的路徑比對；沒有引號的原樣回傳。
 * 能用 `-z` 的地方 NEVER 靠這支——它只給拿不到 `-z` 的人讀輸出（如 `--stat`）。
 */
export function unquoteGitPath(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw
  const bytes: number[] = []
  const body = raw.slice(1, -1)
  const simple: Record<string, number> = {
    n: 10,
    t: 9,
    r: 13,
    a: 7,
    b: 8,
    f: 12,
    v: 11,
    '\\': 92,
    '"': 34,
  }
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'))
      continue
    }
    const oct = /^[0-7]{1,3}/.exec(body.slice(i + 1))
    if (oct) {
      bytes.push(Number.parseInt(oct[0], 8))
      i += oct[0].length
    } else if (body[i + 1] !== undefined && simple[body[i + 1]] !== undefined) {
      bytes.push(simple[body[i + 1]])
      i += 1
    } else bytes.push(92)
  }
  return Buffer.from(bytes).toString('utf8')
}
