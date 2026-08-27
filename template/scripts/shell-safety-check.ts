#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/shell-safety-check.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/shell-safety-check.ts

/**
 * shell-safety-check.ts — 單檔的 shell script 安全判定（fleet 共用 SoT）
 *
 * 對應 `rules/core/shell-script-safety.md`（consumer 端投影為
 * `.claude/rules/shell-script-safety.md`）與
 * `docs/pitfalls/2026-08-27-sudo-wrapping-self-elevating-script-breaks-user-toolchain.md`。
 *
 * ## 為什麼判定住在 vendor/（而不是 clade 的 scripts/）
 *
 * 這條命題的命中**多半在 consumer repo**（deploy / install 腳本），而義務發作的時刻是
 * 「有人剛寫完一支 `.sh`」——那一刻在 consumer 的 working tree 裡。判定若只存在 clade
 * 的 `scripts/`，consumer 端的 PostToolUse hook 就沒有東西可呼叫，訊號只能等某個人
 * 想到要在 clade 跑一次 fleet 掃描。**掃描高度高於規範高度時，命中永遠只能靠人轉述。**
 *
 * clade 的 `scripts/audit-sudo-euid-guard.ts`（fleet 掃描）import 本檔的 `classifyScript`，
 * 所以 fleet 掃描與 edit-time hook 判的是**同一份判準**，NEVER 兩份會漂的拷貝。
 *
 * ## 偵測什麼（三條件全中才報）
 *
 * 1. **內部呼叫 `sudo`**（註解行不算）—— 它自己在需要 root 的那幾步提權，整支的執行前提
 *    是「以一般使用者身分跑」
 * 2. **引用 user-level toolchain 路徑**（`mise exec` / `mise run` / `asdf` / `nvm use` /
 *    `$HOME/.local/bin` / `~/.local/bin`）—— 這類 toolchain 的狀態是 per-user 的
 * 3. **檔內找不到 EUID guard**（非註解行的 `EUID` 或 `id -u`）
 *
 * 三條齊備時，外面再包一層 `sudo` 會讓 toolchain 以 root 身分讀使用者的設定而失敗，
 * 而失敗訊息通常指不到真因。
 *
 * ## 已知不偵測（刻意）
 *
 * pitfall 機制 B（trap body 引用的變數在 trap 執行當下拿不拿得到值）**不在本檔內**。
 * 2026-08-27 實測 fleet 14 repo / 818 支 `.sh`：四條文字判準疊完之後真陽性 **0**、誤報 56。
 * 正確的攔截層是**出事那支腳本自己的回歸測試**，不是文字掃描。規約條文仍寫它
 * （人要知道怎麼寫 trap），但 **NEVER** 把它接成 detector —— 誤報多了整條 signal 就等於關掉。
 * **NEVER** 因為本檔全綠就推論機制 B 也過了。
 *
 * ## 豁免
 *
 * 檔內任一行寫 `sudo-euid-guard-exempt: <理由>` 即豁免整檔。**理由必填**，裸 marker 不生效。
 *
 * ## 用法
 *
 *   node scripts/shell-safety-check.ts <file>...    # 人讀；有命中 exit 1
 *   node scripts/shell-safety-check.ts --json <file>...
 *
 * 不存在 / 讀不到的檔一律跳過（exit 0）——呼叫端多半是 hook，檔案剛被刪掉不是違規。
 */

import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 內部呼叫 sudo：行首或非識別字元後的 `sudo `（避開 `nosudo`、`with-sudo` 之類的字串） */
export const SUDO_RE = /(^|[^\w.-])sudo\s/

/** user-level toolchain 路徑：狀態是 per-user 的，換身分執行就會失效 */
export const TOOLCHAIN_RE =
  /\bmise\s+(?:exec|run)\b|\basdf\s|\bnvm\s+use\b|(?:\$HOME|~)\/\.local\/bin/

/** EUID guard 的存在證據（本檔不驗 guard 寫得對不對，只驗有沒有） */
const GUARD_RE = /\bEUID\b|\bid\s+-u\b/

/** 檔案級豁免；理由必填 */
const EXEMPT_RE = /sudo-euid-guard-exempt:\s*(\S.*)/

/** 註解行不算「呼叫 sudo」——規約 / 用法說明常引述壞寫法 */
const COMMENT_RE = /^\s*#/

/** shell script 的 shebang（無副檔名的檔要靠它判） */
export const SHEBANG_RE = /^#!.*\b(?:ba|z|k)?sh\b/

export const GUARD_SNIPPET = `if [[ \${EUID:-$(id -u)} -eq 0 ]]; then
  echo "以一般使用者身分執行；需要 root 的步驟腳本會自己呼叫 sudo。" >&2
  exit 2
fi`

export type Verdict = 'hit' | 'guarded' | 'not-self-elevating' | 'exempt'

export interface Classification {
  verdict: Verdict
  /** 第一個非註解 `sudo ` 行號（0 = 沒有） */
  sudoLine: number
  /** 第一個 user-level toolchain 引用行號（0 = 沒有） */
  toolchainLine: number
  /** verdict === 'exempt' 時的豁免理由原文 */
  reason?: string
}

/**
 * 單檔判定 —— 全部判準都在這裡，掃描層與 hook 都只負責找檔。
 *
 * 順序是刻意的：`guarded` 先於 `exempt` 先於三條件。有 guard 的檔根本不需要豁免，
 * 而帶豁免 marker 的檔不必再算它命中幾條 —— 兩者對呼叫端都是「不報」，但理由不同，
 * 混在一起會讓豁免數量被 guard 掩蓋。
 */
export function classifyScript(content: string): Classification {
  // 全文粗篩先跑：`COMMENT_RE` 只會再**刪**候選行，所以「整份文字都沒有」蘊含
  // 「沒有非註解行有」。fleet 實測 876 支 `.sh` 只有 15 支通得過這一關。
  if (!SUDO_RE.test(content) || !TOOLCHAIN_RE.test(content))
    return { verdict: 'not-self-elevating', sudoLine: 0, toolchainLine: 0 }

  const lines = content.split(/\r?\n/)

  // guard 只認**非註解行**：規約條文與修法 snippet 常被整段引在註解裡，
  // 那不是 guard。用整份原文測會讓「引述過修法的檔」靜默判成已保護（false negative）。
  if (lines.some((l) => !COMMENT_RE.test(l) && GUARD_RE.test(l)))
    return { verdict: 'guarded', sudoLine: 0, toolchainLine: 0 }

  let sudoLine = 0
  let toolchainLine = 0
  for (const [idx, line] of lines.entries()) {
    if (COMMENT_RE.test(line)) continue
    if (!sudoLine && SUDO_RE.test(line)) sudoLine = idx + 1
    if (!toolchainLine && TOOLCHAIN_RE.test(line)) toolchainLine = idx + 1
    if (sudoLine && toolchainLine) break
  }
  if (!sudoLine || !toolchainLine) return { verdict: 'not-self-elevating', sudoLine, toolchainLine }

  for (const line of lines) {
    const m = EXEMPT_RE.exec(line)
    if (m) return { verdict: 'exempt', sudoLine, toolchainLine, reason: m[1].trim().slice(0, 120) }
  }
  return { verdict: 'hit', sudoLine, toolchainLine }
}

/** 檔名判定：`.sh` 為是；其他副檔名一律不是；無副檔名的要看內容首行 */
export function looksLikeShell(path: string, content: string): boolean {
  if (path.endsWith('.sh')) return true
  if (/\.[a-z0-9]+$/i.test(path)) return false
  return SHEBANG_RE.test(content)
}

interface FileHit {
  file: string
  sudoLine: number
  toolchainLine: number
}

function main(argv: string[]) {
  const asJson = argv.includes('--json')
  const files = argv.filter((a) => !a.startsWith('--'))
  const hits: FileHit[] = []
  for (const file of files) {
    let content: string
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue // 檔案剛被刪掉 / 讀不到，不是違規
    }
    if (!looksLikeShell(file, content)) continue
    const c = classifyScript(content)
    if (c.verdict === 'hit')
      hits.push({ file, sudoLine: c.sudoLine, toolchainLine: c.toolchainLine })
  }

  if (asJson) {
    console.log(JSON.stringify({ hitCount: hits.length, hits }, null, 2))
    return hits.length > 0 ? 1 : 0
  }
  if (hits.length === 0) return 0

  console.error(
    `\n⚠️  ${hits.length} 支腳本內部呼叫 sudo + 依賴 user-level toolchain，但缺 EUID guard\n`,
  )
  for (const h of hits)
    console.error(`  ${h.file}  (sudo:${h.sudoLine}, toolchain:${h.toolchainLine})`)
  console.error(`
外面再包一層 \`sudo\` 時，toolchain 會以 root 身分讀使用者的 per-user 設定而失敗，
而錯誤訊息通常指不到真因。修法：在 \`set -euo\` 之後、第一個實際動作之前加：

${GUARD_SNIPPET}

\`exit 2\` 不是 1：與「腳本正常執行但失敗」區分，讓呼叫端看得出是用法錯誤。
該腳本若確實設計成以 root 執行，檔內加 \`sudo-euid-guard-exempt: <理由>\`——理由必填。
判準全文見 .claude/rules/shell-script-safety.md。
`)
  return 1
}

function invokedAsCli(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return entry === fileURLToPath(import.meta.url)
  }
}

if (invokedAsCli()) process.exit(main(process.argv.slice(2)))
