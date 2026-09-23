// 🔒 LOCKED — managed by clade · Source: vendor/scripts/pre-commit/staged-targets.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/pre-commit/staged-targets.ts
// CLADE:VENDOR-SCRIPT
//
// staged-targets — `checks/vp-staged.sh` 與 `vendor/oxc-shared/preset.ts` 之間的橋（TD-777）
//
// stdin：NUL 分隔的 staged 路徑（`git diff --cached --name-only -z`）
// stdout：NUL 分隔、**沒有**被 preset `isStagedExcluded` 排除的路徑
// exit 0：成功（輸出可能是空的——那代表全部被排除，是合法結果）
// exit 2：橋接失敗（找不到 preset / import 失敗 / 匯出形狀不對 / 排除清單是空的）
//
// 為什麼要這一層：bash 讀不到 TS 匯出。TD-777 之前 `vp-staged.sh` 自己手寫一份
// `CLADE_MANAGED_PREFIXES`，與 preset 的 `PROJECTION_EXCLUDES` 雙向漂移，而它才是 fleet
// 實際執行的那份。現在 shell 不再持有任何路徑清單，判定一律回到 preset。
//
// **失敗 MUST loud**：靜默拿到空清單＝整個過濾失效，而那在輸出上與「這次沒有投影檔要濾」
// 同形。所以任何一步不對都 exit 2，NEVER 退回「全部放行」或「全部排除」。
//
// preset 的位置用**本檔所在目錄**推，不用 git toplevel：consumer 端本檔在
// `scripts/pre-commit/`、preset 在 `vendor/oxc-shared/`；clade 源檔本檔在
// `vendor/scripts/pre-commit/`、preset 在 `vendor/oxc-shared/`。兩種版面各一個候選，
// 另外讓 `CLADE_STAGED_PRESET` 可以明確指定（測試與非標準版面用）。
//
// 由 ~/clade vendor/scripts/pre-commit/ 散播，請勿直接編輯 consumer 副本。

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function fail(message: string): never {
  process.stderr.write(`[clade pre-commit] staged-targets 橋接失敗：${message}\n`)
  process.stderr.write(
    '[clade pre-commit] 過濾清單拿不到就不跑 lint/fmt——NEVER 當成「沒有投影檔要濾」放行（TD-777）\n',
  )
  process.exit(2)
}

function locatePreset(): string {
  const explicit = process.env.CLADE_STAGED_PRESET
  if (explicit) {
    const p = resolve(explicit)
    if (!existsSync(p)) fail(`CLADE_STAGED_PRESET 指向不存在的檔：${p}`)
    return p
  }
  const candidates = [
    // consumer：scripts/pre-commit/ → vendor/oxc-shared/
    join(here, '..', '..', 'vendor', 'oxc-shared', 'preset.ts'),
    // clade 源檔：vendor/scripts/pre-commit/ → vendor/oxc-shared/
    join(here, '..', '..', 'oxc-shared', 'preset.ts'),
  ]
  const found = candidates.find((p) => existsSync(p))
  if (!found) fail(`找不到 vendor/oxc-shared/preset.ts（找過：${candidates.join('、')}）`)
  return found
}

const presetPath = locatePreset()

let preset: Record<string, unknown>
try {
  preset = (await import(pathToFileURL(presetPath).href)) as Record<string, unknown>
} catch (err) {
  fail(`import ${presetPath} 失敗：${err instanceof Error ? err.message : String(err)}`)
}

const isStagedExcluded = preset.isStagedExcluded
const projectionExcludes = preset.PROJECTION_EXCLUDES
if (typeof isStagedExcluded !== 'function') {
  fail(`${presetPath} 沒有匯出 isStagedExcluded(file)`)
}
if (!Array.isArray(projectionExcludes) || projectionExcludes.length === 0) {
  fail(`${presetPath} 的 PROJECTION_EXCLUDES 不是非空陣列`)
}

let input: string
try {
  input = readFileSync(0, 'utf8')
} catch (err) {
  fail(`讀 stdin 失敗：${err instanceof Error ? err.message : String(err)}`)
}

const kept = input
  .split('\0')
  .filter((f) => f.length > 0)
  .filter((f) => !(isStagedExcluded as (file: string) => boolean)(f))

process.stdout.write(kept.map((f) => `${f}\0`).join(''))
