// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/host-config-refs.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/host-config-refs.ts
/**
 * 宿主常駐設定（systemd unit／drop-in、crontab）對某個路徑的引用 —— worktree 移除前的 gate（TD-1148）。
 *
 * 防的失敗類別：把 ExecStart／WorkingDirectory 指進 linked worktree 的 unit 或 drop-in，
 * 在那棵樹被 cleanup 的瞬間**靜默**失效——timer 照跑、service 每次 MODULE_NOT_FOUND／
 * No such file，沒有任何東西出聲。2026-09-22～24 同時有三個實例：
 *   - `clade-disk-hygiene.service.d/pre-landing-worktree.conf` → `clade-wt/disk-availability-automation`
 *   - `clade-cleanup-stale-tmp.service`（installer 以自身路徑渲染，從 worktree 跑 install）
 *     → `clade-wt/tmp-edquot-sweep-schedule`
 *   - `clade-gitnexus-autonomy.service` 的 WorkingDirectory → `clade-wt/gitnexus-autonomy`
 * 前兩個讓磁碟回收停擺一整天以上，compile cache 漲到 16G。
 *
 * 所以判定掛在**移除**這個保證會發生的事件上，不掛在「安裝的人記得之後改回來」。
 *
 * 讀不到使用者層設定（$HOME 底下）一律 fail closed（unknown）；系統層（/etc）讀不到的單檔
 * 略過——那是非特權行程的固有盲區，fail closed 會讓 cleanup 永遠過不了。
 */
import { spawnSync } from 'node:child_process'
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { type Observed, errorMessage, known, unknown } from './safety-observation.ts'

export interface HostConfigRef {
  /** 設定檔路徑，或 `crontab` */
  source: string
  /** 1-based；symlink 目標命中時為 0 */
  line: number
  text: string
}

export interface HostConfigScanOptions {
  /** 使用者層根目錄（讀不到 → unknown）。預設 ~/.config/systemd/user */
  userRoots?: string[]
  /** 系統層根目錄（讀不到的檔略過）。預設 /etc/systemd/system */
  systemRoots?: string[]
  /** crontab 內容；null = 無 crontab。預設跑 `crontab -l` */
  crontab?: () => Observed<string | null>
  home?: string
}

const MAX_FILE_BYTES = 1024 * 1024

function envList(name: string): string[] | undefined {
  const v = process.env[name]
  return v === undefined ? undefined : v.split(':').filter(Boolean)
}

function defaultCrontab(): Observed<string | null> {
  const file = process.env.CLADE_HOST_CONFIG_CRONTAB_FILE
  if (file !== undefined) {
    if (file === '') return known(null)
    try {
      return known(readFileSync(file, 'utf8'))
    } catch (e) {
      return unknown(`crontab fixture unreadable: ${errorMessage(e)}`)
    }
  }
  const r = spawnSync('crontab', ['-l'], { encoding: 'utf8', timeout: 5000 })
  if (r.error) {
    if ((r.error as NodeJS.ErrnoException).code === 'ENOENT') return known(null)
    return unknown(`crontab -l: ${errorMessage(r.error)}`)
  }
  if (r.status === 0) return known(r.stdout)
  if (/no crontab/i.test(r.stderr)) return known(null)
  return unknown(`crontab -l exit ${r.status}: ${r.stderr.trim()}`)
}

/** `%h`／`$HOME`／`${HOME}`／行首或空白後的 `~/` 展開成 home，讓 unit 的寫法不影響比對 */
export function normalizeHomeRefs(text: string, home: string): string {
  return text
    .replace(/(?<!%)%h/g, home) // `%%h` 是字面 %h，不是 home
    .replaceAll('${HOME}', home)
    .replace(/\$HOME(?![A-Za-z0-9_])/g, home)
    .replace(/(^|[\s='"])~\//g, `$1${home}/`)
}

/**
 * path 出現且兩側都不延續路徑名：`/foo-wt/a` 不命中 `/foo-wt/ab`，
 * 也不命中 `/mnt/foo-wt/a`（gate 沒有 flag 可繞過，誤報的代價是卡死 cleanup）
 */
export function lineReferencesPath(line: string, path: string): boolean {
  let from = 0
  for (;;) {
    const i = line.indexOf(path, from)
    if (i < 0) return false
    const prev = i === 0 ? undefined : line[i - 1]
    const next = line[i + path.length]
    const leftOk = prev === undefined || !/[A-Za-z0-9._/-]/.test(prev)
    const rightOk = next === undefined || !/[A-Za-z0-9._-]/.test(next)
    if (leftOk && rightOk) return true
    from = i + 1
  }
}

function candidatePaths(target: string): string[] {
  const abs = resolve(target)
  const out = new Set([abs])
  try {
    out.add(realpathSync(abs))
  } catch {
    // 樹已不在時只比對字面路徑
  }
  return [...out]
}

interface ScanState {
  paths: string[]
  home: string
  strict: boolean
  refs: HostConfigRef[]
  /** 已掃過的 realpath：.wants/ 指回本樹、或多條連結指到同一處時只讀一次 */
  seen: Set<string>
}

function scanFile(full: string, size: number, st: ScanState): string | null {
  if (size > MAX_FILE_BYTES)
    return st.strict ? `${full}: larger than ${MAX_FILE_BYTES} bytes, not scanned` : null
  let body: string
  try {
    body = readFileSync(full, 'utf8')
  } catch (e) {
    return st.strict ? `${full}: ${errorMessage(e)}` : null
  }
  body.split('\n').forEach((raw, i) => {
    if (st.paths.some((p) => lineReferencesPath(normalizeHomeRefs(raw, st.home), p)))
      st.refs.push({ source: full, line: i + 1, text: raw.trim() })
  })
  return null
}

function scanRoot(root: string, st: ScanState): string | null {
  const { paths, strict, refs } = st
  try {
    const real = realpathSync(root)
    if (st.seen.has(real)) return null
    st.seen.add(real)
  } catch {
    // 讀不到交給下面的 readdirSync 判
  }
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    return strict ? `${root}: ${errorMessage(e)}` : null
  }
  for (const name of entries) {
    const full = join(root, name)
    let lst
    try {
      lst = lstatSync(full)
    } catch (e) {
      if (strict) return `${full}: ${errorMessage(e)}`
      continue
    }
    if (lst.isSymbolicLink()) {
      // `systemctl link <worktree>/x.service` 與 .wants/ 內的連結：目標本身就是引用
      let dest: string
      try {
        dest = resolve(root, readlinkSync(full))
      } catch (e) {
        if (strict) return `${full}: ${errorMessage(e)}`
        continue
      }
      if (paths.some((p) => lineReferencesPath(dest, p))) {
        refs.push({ source: full, line: 0, text: `-> ${dest}` })
        continue
      }
      // 目標不在引用清單內：照樣跟進讀內容（dotfiles 連進來的 unit／drop-in 目錄），
      // 以 realpath 去重，.wants/ 指回本樹的連結因此不會把同一行報兩次
      let real: string
      let target
      try {
        real = realpathSync(full)
        target = statSync(real)
      } catch {
        continue // 懸空連結：目標不存在也不指進 worktree，與本 gate 無關
      }
      if (target.isDirectory()) {
        const err = scanRoot(real, st)
        if (err) return err
      } else if (target.isFile() && !st.seen.has(real)) {
        st.seen.add(real)
        const err = scanFile(real, target.size, st)
        if (err) return err
      }
      continue
    }
    if (lst.isDirectory()) {
      const err = scanRoot(full, st)
      if (err) return err
      continue
    }
    if (!lst.isFile()) continue
    let real = full
    try {
      real = realpathSync(full)
    } catch {
      // 用字面路徑
    }
    if (st.seen.has(real)) continue
    st.seen.add(real)
    const err = scanFile(full, lst.size, st)
    if (err) return err
  }
  return null
}

export function findHostConfigReferences(
  target: string,
  opts: HostConfigScanOptions = {},
): Observed<HostConfigRef[]> {
  const home = opts.home ?? homedir()
  const userRoots = opts.userRoots ??
    envList('CLADE_HOST_CONFIG_USER_ROOTS') ?? [join(home, '.config', 'systemd', 'user')]
  const systemRoots = opts.systemRoots ??
    envList('CLADE_HOST_CONFIG_SYSTEM_ROOTS') ?? ['/etc/systemd/system']
  const paths = candidatePaths(target)
  const refs: HostConfigRef[] = []
  const seen = new Set<string>()
  for (const root of userRoots) {
    const err = scanRoot(root, { paths, home, strict: true, refs, seen })
    if (err) return unknown(err)
  }
  for (const root of systemRoots) scanRoot(root, { paths, home, strict: false, refs, seen })
  const cron = (opts.crontab ?? defaultCrontab)()
  if (cron.status === 'unknown') return cron
  if (cron.value !== null) {
    cron.value.split('\n').forEach((raw, i) => {
      if (paths.some((p) => lineReferencesPath(normalizeHomeRefs(raw, home), p)))
        refs.push({ source: 'crontab', line: i + 1, text: raw.trim() })
    })
  }
  return known(refs)
}

export function formatHostConfigRefs(refs: HostConfigRef[], indent = '    '): string {
  return refs
    .map((r) => `${indent}${r.source}${r.line > 0 ? `:${r.line}` : ''}  ${r.text}`)
    .join('\n')
}

export const HOST_CONFIG_REMEDY =
  '先把這些設定改指 main checkout（在 ~/offline/<repo> 重跑該服務的 install）或刪掉那份 drop-in，' +
  '再重跑 cleanup。本 gate 沒有 flag 可繞過——移除後那些服務會靜默失效（TD-1148）。'

/** 命中或讀不到都丟例外；呼叫端的既有 catch 會把它轉成 retain／blocked */
export function assertNoHostConfigReferences(target: string, opts?: HostConfigScanOptions): void {
  const obs = findHostConfigReferences(target, opts)
  if (obs.status === 'unknown')
    throw new Error(`host config references unknown (${obs.reason}); retain worktree`)
  if (obs.value.length > 0)
    throw new Error(
      `host config still references ${target}; retain worktree:\n` +
        `${formatHostConfigRefs(obs.value)}\n${HOST_CONFIG_REMEDY}`,
    )
}
