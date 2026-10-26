#!/usr/bin/env node
/**
 * cloud-bash-allow.ts — cloud session 專用的 Bash 放行清單（PreToolUse `permissionDecision: "allow"`）。
 *
 * 為什麼存在：cloud session 的 permissionMode 恆為 `default`（`vendor/scripts/cloud-dispatch.ts` `launchCommand`
 * 註解），repo `.claude/settings.json` 的 allow 沒列到的指令一律停在權限框，派出的 session 沒人點就卡住。
 * settings 的 allow 本機與 cloud 共用，只在 cloud 生效的放行只能由 hook 給：外殼 `pre-bash-cloud-allow.sh`
 * 在 `CLAUDE_CODE_REMOTE` 為真時才呼叫本檔。cloud 會跑 repo 註冊的 PreToolUse hook、hook 的決定先於權限框：
 * `specs/plans/W-2026-10-13-cloud-no-permission-prompt/evidence/vm-probe-pretooluse.md`。
 *
 * 清單範圍：git 寫入與讀取、`node --test`、repo 內 `node <script>`、`pnpm` 驗證 script、`pnpm exec`／`npx` 的 JS 工具、
 * `uv run <repo>.py`、`go test`／`vet`／`build`、cloud-worker brief 的驗收慣用指令（含 `clade-gate run <gate> -- <指令>`）。
 * 對照表在 `test/cloud-bash-allow.test.ts`。
 *
 * threat model：防漂移，不防主動規避。本檔只「多放行」，判不出來就不表態——不表態＝回到原本的權限框，
 * 所以任何故障的方向都是「照舊卡框」而不是「多放行」。字串比對型：不承諾完整語意，只認下列常見形狀；
 * 談論指令的文字不會被誤放（只看 Bash 的 command 本身，且整條指令必須落在清單形狀內）。
 * 不承諾：清單內的 repo script（`node scripts/<x>.ts`、`pnpm test`）自己做什麼——放行的是呼叫，不是被呼叫檔的內容。
 * 唯一例外是 `SCRIPT_ARG_POLICY` 列名的 script（預設會寫、只有特定旗標才唯讀，如 `fleet-main-align.ts` 必帶 `--dry-run`）。
 *
 * 不放行（照舊走權限框，由 settings 或人決定）：
 * - shell 組合與展開：未加引號的 `; | & > < $ \` ( ) { } \ ~`、glob 的 `* ? [ ]`、換行、雙引號內的 `$`／反引號／`\`／`* ? [ ]`、
 *   `VAR=val cmd` 前綴（glob 展開後的檔名不經禁區比對，`cat .e*` 會讀到 `.env`）；
 *   唯一例外是 `cd <repo 內相對目錄> && <清單內指令>`（可包一層括號）——子目錄 go.mod 的 `(cd sub && go test ./...)`。
 * - 禁區：任一參數指到 `.claude/`、`.git/`（`.github/`、`.gitignore` 不算）、絕對路徑、`..`、secret 檔
 *   （`.env*`、`*.pem`／`*.key`／`*.p12`、含 secret／credential／`id_rsa` 的名字）。commit 訊息不算參數。
 *   `rev:path` 形式（`git show HEAD:.env`）的每個冒號後段也各自比對。
 * - 遞迴讀樹：`grep`／`diff`／`ls` 帶遞迴旗標（`-r`／`-R`／`--recursive`／`-d recurse`…），或 `grep`／`diff` 以目錄
 *   （含 `.`）為運算元——一遞迴就走進 `.claude/`、`.git/`、secret 檔，逐參數的禁區比對攔不到。
 * - prod 與寫入型：被執行的 script 名或任一旗標含 `prod`／`production`、`deploy`、`publish`、`release`、`propagate`，
 *   或旗標是 `--apply`、`--write`／`-w`、`--force`、`--delete`、`--fix`、`--update`／`-u`（例：`clade-home-runtime.ts --apply` 刻意只開 `--dry-run`）。
 * - 會轉執行別的指令的入口：`bin/clade-gate run <gate> -- <指令>` 只在 `--` 之後的指令自己也過本清單時放行
 *   （`-- bash -c …`、`-- git push --force …` 不放行）；`bin/` 下其餘無副檔名的 wrapper 只收 `bin/vp`。
 *   `ssh`、`scp`、`wrangler`、`supabase`、`curl` 等連線指令不在任何指令族裡，本來就不放行。
 * - 清單外的指令族一律不表態（`rm`、`mv`、`cp`、`gh`、`npm`、`claude -p` …）。
 *
 * 錯誤分支（全部倒向「不表態」，外殼 exit 0 無輸出）：
 *
 *   | # | 分支 | 位置 | 行為 |
 *   | - | --- | --- | --- |
 *   | E1 | `node` 不在 PATH | `.sh` | exit 0 無輸出（權限框照舊） |
 *   | E2 | 本檔不在 `.sh` 同目錄 | `.sh` | 同 E1 |
 *   | E3 | stdin 不是 JSON | `run()` | 不印任何東西 |
 *   | E4 | 不是 Bash 或沒有 command 字串 | `run()` | 同 E3 |
 *   | E5 | 判定丟例外 | `run()` | 同 E3 |
 *   | E6 | 行程非 0 退出、逾時 | `.sh`／harness | `.sh` 只在 exit 0 時轉印 stdout；逾時屬 non-blocking＝權限框照舊 |
 *
 * gate 型別：放行型（提示型的反面：只減少框、不擋任何東西）。與 `pre-tool-cloud-workdir-gate.sh` 同掛時，
 * 那支的 deny 優先（Claude Code 多個 hook 取最嚴的決定），本檔不會把它擋下的東西放出去。
 * 關閉：`CLADE_CLOUD_BASH_ALLOW_OFF=1`（外殼層，呼叫 node 之前）。
 */

import { readFileSync, statSync } from 'node:fs'
import { posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface CloudAllow {
  /** 命中的指令族（印進 permissionDecisionReason）。 */
  family: string
}

const UNQUOTED_META = new Set([
  ';',
  '|',
  '&',
  '>',
  '<',
  '$',
  '`',
  '(',
  ')',
  '{',
  '}',
  '\\',
  '~',
  '*',
  '?',
  '[',
  ']',
  '\n',
  '\r',
])
const DQUOTE_META = new Set(['$', '`', '\\', '*', '?', '[', ']'])

/** 依 shell 引號規則切詞；遇到不收的字元或未閉合引號回 null。 */
export function tokenize(command: string): string[] | null {
  const out: string[] = []
  let cur = ''
  let has = false
  let quote: '' | "'" | '"' = ''
  for (const c of command) {
    if (quote === "'") {
      if (c === "'") quote = ''
      else cur += c
      continue
    }
    if (quote === '"') {
      if (c === '"') quote = ''
      else if (DQUOTE_META.has(c)) return null
      else cur += c
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      has = true
      continue
    }
    if (c === ' ' || c === '\t') {
      if (has) out.push(cur)
      cur = ''
      has = false
      continue
    }
    if (UNQUOTED_META.has(c)) return null
    cur += c
    has = true
  }
  if (quote) return null
  if (has) out.push(cur)
  return out
}

const SECRET =
  /(^|[/=])\.env($|[.\-_])|\.(pem|key|p12|pfx)$|secret|credential|id_rsa|id_ed25519|\.netrc|\.npmrc/iu
const PROD = /(^|[^a-z])(prod|production)($|[^a-z])|deploy|publish|release|propagate/iu
const WRITE_FLAG = /^(--(apply|write|force|delete|fix[\w-]*|update|unsafe)|-w|-u)($|=)/u
// 讓被放行的指令改跑行內程式碼或 repo 外程式的旗標（node 的 -e／--import／--loader、go 的 -exec／-toolexec、
// rg 的 --pre）：清單裡沒有任何驗收需要它們。值落在 repo 內的 --config／--plugin 與跑 repo 測試同一層信任，照收
const EXEC_FLAG =
  /^(-e|-r|-C|--?(eval|print|import|require|loader|experimental-loader|env-file[\w-]*|inspect[\w-]*|test-reporter[\w-]*|exec|toolexec|vettool|overlay|modfile|ldflags|gcflags|asmflags|gccgoflags|compiler|pre))($|=)/u

/** 旗標正規化成 `-name`（去掉 `--`／`-` 前綴與 `=值`），給逐工具的旗標白名單比對。 */
const flagName = (x: string) => `-${x.replace(/^--?/u, '').split('=')[0]}`
// go 與 node --test 改用旗標白名單：兩者都有多條能換掉編譯器、測試執行器或載入模組的旗標
const GO_FLAGS = new Set([
  '-v',
  '-run',
  '-skip',
  '-count',
  '-race',
  '-short',
  '-timeout',
  '-tags',
  '-cover',
  '-failfast',
  '-json',
  '-bench',
  '-benchmem',
  '-p',
  '-parallel',
])
const NODE_TEST_FLAGS = new Set([
  '-test',
  '-test-name-pattern',
  '-test-skip-pattern',
  '-test-only',
  '-test-concurrency',
  '-test-timeout',
  '-experimental-strip-types',
  '-no-warnings',
])

/** 參數指到禁區（`.claude/`、`.git/`、clone 目錄外、secret 檔）就回 true。 */
export function zoneForbidden(token: string): boolean {
  const values = [token]
  // `rev:path`（`HEAD:.env`、`:.claude/x`）：path 段可再含冒號，所以每個冒號後段都比
  for (let i = token.indexOf(':'); i >= 0; i = token.indexOf(':', i + 1))
    values.push(token.slice(i + 1))
  if (token.startsWith('-')) {
    // 旗標夾帶的值：`--x=<v>`、短旗標黏值 `-o<v>`；旗標內任何位置提到 .claude／.git 也算
    if (token.includes('=')) values.push(token.slice(token.indexOf('=') + 1))
    if (/^-[A-Za-z]./u.test(token)) values.push(token.slice(2))
    if (/\.(claude|git)($|\/)/u.test(token)) return true
  }
  for (const v of values) {
    if (/(^|\/)\.claude($|\/)/u.test(v)) return true
    if (/(^|\/)\.git($|\/)/u.test(v)) return true
    if (v.startsWith('/')) return true
    if (/(^|\/)\.\.($|\/)/u.test(v)) return true
    if (SECRET.test(v)) return true
  }
  return false
}

/** 會碰 prod 或改寫狀態的字樣：只對「被執行的 script 名」與旗標判（測試檔名、commit message 不判）。 */
export function prodForbidden(token: string): boolean {
  return PROD.test(token) || WRITE_FLAG.test(token)
}

const REPO_REL = /^[\w.@+-][\w.@+/-]*$/u
const isRepoPath = (t: string) => REPO_REL.test(t) && !t.startsWith('-') && !zoneForbidden(t)

const CLOUD_BRANCH = /^(cloud|claude)\/[\w.-][\w./-]*$/u
const SCRIPT_NAME =
  /^(test|lint|typecheck|type-check|check|fmt|format|build|bdd|truth|verify)([:-][\w:.-]+)?$/u
const JS_TOOL = new Set(['vp', 'tsc', 'vue-tsc', 'vitest', 'oxlint', 'eslint', 'prettier'])
const SCRIPT_PATH =
  /^((scripts|vendor\/scripts|bin|tools|\.clade\/bin)\/[\w./-]+\.(ts|mts|mjs|js|cjs)|node_modules\/(typescript|typescript-native|vitest|oxlint)\/bin\/[\w.-]+)$/u
// 只收「任何旗標都不寫檔、不執行別的程式」的指令：rg（--pre）、sort（-o）、uniq（第二個檔名）、
// tree（-o）、file（-C）、find（-exec／-fprint*）不收
const GATE_WRAPPER = /^(bin|\.clade\/bin)\/clade-gate$/u
const VP_WRAPPER = /^(bin|\.clade\/bin)\/vp$/u
const GATE_LABELS = new Set(['test', 'lint', 'typecheck'])
const VP_SUBCOMMANDS = new Set(['check', 'lint', 'test'])
// git 讀取子指令裡會寫檔或跑 config 外部程式的長旗標（git 長旗標可縮寫，所以比前綴）
const GIT_UNSAFE_LONG = ['output', 'ext-diff', 'textconv']
const gitUnsafeFlag = (x: string) => {
  if (!x.startsWith('--')) return false
  const name = x.slice(2).split('=')[0]
  return name !== '' && GIT_UNSAFE_LONG.some((f) => f.startsWith(name))
}
const READ_ONLY = new Set([
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'grep',
  'jq',
  'diff',
  'pwd',
  'which',
  'stat',
])
// 會遞迴讀樹的唯讀指令：short＝短旗標串裡出現就算（`-rn`；寧可多擋 `-er`），long＝長旗標名（GNU 可縮寫，比前綴），
// dir＝目錄運算元也會讀進去（diff 比對目錄內同名檔；grep 一律擋，`.` 最常見）
const RECURSE: Record<string, { short: RegExp; long: string[]; dir: boolean }> = {
  grep: { short: /[rRd]/u, long: ['recursive', 'dereference-recursive', 'directories'], dir: true },
  diff: { short: /r/u, long: ['recursive', 'from-file', 'to-file'], dir: true },
  ls: { short: /R/u, long: ['recursive'], dir: false },
}
const isDir = (x: string, cwd: string) => {
  if (/^(\.\/*)+$/u.test(x) || x.endsWith('/')) return true
  try {
    return statSync(resolve(cwd, x), { throwIfNoEntry: false })?.isDirectory() ?? false
  } catch {
    return true
  }
}
function readsTree(cmd: string, args: string[], cwd: string): boolean {
  const r = RECURSE[cmd]
  if (!r) return false
  return args.some((x) => {
    if (x.startsWith('--')) {
      const name = x.slice(2).split('=')[0]
      return name !== '' && r.long.some((f) => f.startsWith(name))
    }
    if (x.startsWith('-') && x.length > 1) return r.short.test(x.slice(1))
    return r.dir && isDir(x, cwd)
  })
}

function gitAllow(rest: string[]): string | null {
  const [sub, ...a] = rest
  switch (sub) {
    case 'status':
    case 'diff':
    case 'log':
    case 'show':
    case 'rev-parse':
    case 'ls-files':
      return a.some(gitUnsafeFlag) ? null : 'git 讀取'
    case 'fetch':
      return a[0] === 'origin' &&
        a.slice(1).every((x) => /^[\w./-]+$/u.test(x) && !x.startsWith('-'))
        ? 'git 讀取'
        : null
    case 'checkout':
      return a.length === 2 && a[0] === '-b' && CLOUD_BRANCH.test(a[1])
        ? 'git 開 cloud branch'
        : null
    case 'switch':
      if (a.length === 2 && a[0] === '-c')
        return CLOUD_BRANCH.test(a[1]) ? 'git 開 cloud branch' : null
      return a.length === 1 && CLOUD_BRANCH.test(a[0]) ? 'git 開 cloud branch' : null
    case 'add':
      // `.`／`./` 會把 `.claude/` 一併 stage，繞過禁區，所以只收明確路徑
      return a.length > 0 && a.every((x) => x === '--' || (!/^(\.\/*)+$/u.test(x) && isRepoPath(x)))
        ? 'git add'
        : null
    case 'commit':
      // 只收 -m <msg>、-F -、--only、--、pathspec；--no-verify／-n／--amend／-a 等一律不收
      for (let i = 0; i < a.length; i++) {
        const x = a[i]
        if (x === '-m') {
          if (a[++i] === undefined) return null
        } else if (x === '-F') {
          if (a[++i] !== '-') return null
        } else if (x !== '--only' && x !== '--' && !isRepoPath(x)) return null
      }
      return 'git commit'
    case 'push': {
      const r = a[0] === '-u' ? a.slice(1) : a
      if (r.length !== 2 || r[0] !== 'origin') return null
      const ref = r[1].startsWith('HEAD:') ? r[1].slice(5) : r[1]
      return CLOUD_BRANCH.test(ref) ? 'git push cloud branch' : null
    }
    case 'merge':
      return a.length === 1 && /^origin\/[\w./-]+$/u.test(a[0]) ? 'git merge origin' : null
    default:
      return null
  }
}

/** 旗標不帶 prod／寫入字樣。 */
const flagsClean = (args: string[]) =>
  args.every((x) => !x.startsWith('-') || (!prodForbidden(x) && !EXEC_FLAG.test(x)))

/** `pnpm exec`／`npx` 後的工具與其引數：vp 另限子指令（run／exec／dlx 可跑任意 script 或程式），與 bin/vp 同一份清單。 */
const jsToolAllow = (tool: string | undefined, rest: string[]) =>
  tool !== undefined &&
  JS_TOOL.has(tool) &&
  (tool !== 'vp' || (rest[0] !== undefined && VP_SUBCOMMANDS.has(rest[0]))) &&
  flagsClean(rest)

function pnpmAllow(rest: string[]): string | null {
  const [sub, ...a] = rest
  if (sub === 'install' || sub === 'i')
    return a.every((x) =>
      ['--frozen-lockfile', '--prefer-offline', '--offline', '--ignore-scripts'].includes(x),
    )
      ? 'pnpm install'
      : null
  if (sub === 'exec') return jsToolAllow(a[0], a.slice(1)) ? 'pnpm exec 工具' : null
  const name = sub === 'run' ? a.shift() : sub
  return name !== undefined && SCRIPT_NAME.test(name) && !prodForbidden(name) && flagsClean(a)
    ? 'pnpm 驗證 script'
    : null
}

function nodeAllow(rest: string[], cwd: string): string | null {
  if (rest[0] === '--test')
    // test runner 以子行程跑每個檔，`invokedAsCli()` 為真且不帶旗標：SCRIPT_ARG_POLICY 列的腳本一律不收。
    // operand 相對於 `cd <dir> &&` 改過的 cwd、policy key 相對 repo root，而 hook 的 cwd 不保證是 repo root：以檔名比，寧可多擋同名檔
    return rest.every((x) =>
      x.startsWith('-') ? NODE_TEST_FLAGS.has(flagName(x)) : isRepoPath(x) && !isPolicyScript(x),
    ) && flagsClean(rest)
      ? 'node --test'
      : null
  const [script, ...a] = rest
  if (script === undefined || prodForbidden(script)) return null
  if (GATE_WRAPPER.test(script)) {
    // clade-gate 會執行 `--` 之後的一切：只在那段指令自己也過清單時放行
    const [sub, label, dash, ...inner] = a
    return sub === 'run' &&
      GATE_LABELS.has(label) &&
      dash === '--' &&
      judgeTokens(inner, cwd) !== null
      ? 'clade-gate run'
      : null
  }
  if (VP_WRAPPER.test(script))
    return a[0] !== undefined && VP_SUBCOMMANDS.has(a[0]) && flagsClean(a) ? 'vp shim' : null
  if (!SCRIPT_PATH.test(script)) return null
  // `scripts/./x.ts`、`scripts//x.ts` 與 `scripts/x.ts` 是同一支檔：政策以正規化後的路徑查，免得換寫法繞過
  const policy = SCRIPT_ARG_POLICY[posix.normalize(script)]
  if (policy && !policy(a)) return null
  return flagsClean(a) ? 'repo script' : null
}

/**
 * 預設會寫狀態、只有特定旗標才唯讀的 repo script：旗標組合綁死，不對時不表態。
 * `fleet-main-align.ts`：不帶 `--dry-run` 會 ff／reset／rescue-push 各 consumer 的 main 並寫 last.json（逐行核對：
 * `--dry-run` 只 fetch、量測、跑 `main-sync --check`／`dev-node self-heal --check`，不 push、不 reset、不寫 state）。
 */
const SCRIPT_ARG_POLICY: Record<string, (args: string[]) => boolean> = {
  'scripts/fleet-main-align.ts': (a) =>
    a.includes('--dry-run') && a.every((x) => x === '--dry-run' || x === '--json'),
}

/** operand 的檔名是否與 SCRIPT_ARG_POLICY 列管的腳本同名（不依賴 cwd 或 repo root 的猜測）。 */
const isPolicyScript = (operand: string) =>
  Object.keys(SCRIPT_ARG_POLICY).some((k) => posix.basename(k) === posix.basename(operand))

/** 單一指令（已去掉 `cd … &&` 前綴）的判定。 */
function judgeTokens(t: string[], cwd: string): string | null {
  if (t.length === 0) return null
  // `VAR=val cmd` 前綴可改寫 GIT_DIR、PATH 等，不收
  if (/^[A-Za-z_]\w*=/u.test(t[0])) return null
  const [cmd, ...args] = t
  // commit 訊息不是路徑，不做禁區比對
  const checked =
    cmd === 'git' && args[0] === 'commit' ? args.filter((_, i) => args[i - 1] !== '-m') : args
  if (checked.some(zoneForbidden)) return null
  switch (cmd) {
    case 'git':
      return gitAllow(args)
    case 'pnpm':
      return pnpmAllow(args)
    case 'npx':
      // 非 TTY 的 npx 預設 --yes：本地沒裝就會下載同名 registry 套件來跑，所以要求 --no-install
      return (args[0] === '--no-install' || args[0] === '--no') &&
        jsToolAllow(args[1], args.slice(2))
        ? 'npx 工具'
        : null
    case 'node':
      return nodeAllow(args, cwd)
    case 'go':
      return ['test', 'vet', 'build'].includes(args[0] ?? '') &&
        args.slice(1).every((x) => !x.startsWith('-') || GO_FLAGS.has(flagName(x))) &&
        flagsClean(args)
        ? 'go 驗證'
        : null
    case 'uv':
      return args[0] === 'run' &&
        args[1] !== undefined &&
        args[1].endsWith('.py') &&
        isRepoPath(args[1]) &&
        !prodForbidden(args[1]) &&
        flagsClean(args)
        ? 'uv run repo script'
        : null
    case 'mkdir':
      return args[0] === '-p' && args.length > 1 && args.slice(1).every(isRepoPath) ? 'mkdir' : null
    default:
      return READ_ONLY.has(cmd) && !readsTree(cmd, args, cwd) ? '唯讀' : null
  }
}

/** 主判定：命中清單回放行理由，否則 null（不表態）。cwd 給目錄運算元的判定用（hook 輸入的 `cwd`）。 */
export function cloudAllowFor(command: string, cwd = process.cwd()): CloudAllow | null {
  let cmd = command.trim()
  const sub = /^\(\s*(cd\s[\s\S]*)\)$/u.exec(cmd)
  if (sub) cmd = sub[1].trim()
  const cd = /^cd\s+([\w.@+/-]+)\s*&&\s*([\s\S]+)$/u.exec(cmd)
  if (cd) {
    if (!isRepoPath(cd[1])) return null
    cmd = cd[2]
    cwd = resolve(cwd, cd[1])
  }
  const tokens = tokenize(cmd)
  if (!tokens) return null
  const family = judgeTokens(tokens, cwd)
  return family ? { family } : null
}

export interface HookIo {
  stdin: string
  stdout: (text: string) => void
}

/** in-process 接縫：只在放行時印 JSON；其餘一律不印（不表態）。 */
export function run(io: HookIo): void {
  let command: unknown
  let cwd: unknown
  try {
    const input: unknown = JSON.parse(io.stdin)
    if (typeof input !== 'object' || input === null) return // E4
    if (!('tool_name' in input) || input.tool_name !== 'Bash') return // E4
    if (
      !('tool_input' in input) ||
      typeof input.tool_input !== 'object' ||
      input.tool_input === null
    )
      return
    command = 'command' in input.tool_input ? input.tool_input.command : undefined
    cwd = 'cwd' in input ? input.cwd : undefined
  } catch {
    return // E3
  }
  if (typeof command !== 'string' || !command) return // E4
  let hit: CloudAllow | null
  try {
    hit = typeof cwd === 'string' && cwd ? cloudAllowFor(command, cwd) : cloudAllowFor(command)
  } catch {
    return // E5
  }
  if (!hit) return
  io.stdout(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: `cloud allow（${hit.family}）`,
      },
    })}\n`,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  run({ stdin: readFileSync(0, 'utf8'), stdout: (text) => process.stdout.write(text) })
