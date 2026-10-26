// 🔒 LOCKED — managed by clade · Source: vendor/scripts/checks/td-priority-gate.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/checks/td-priority-gate.ts
// CLADE:VENDOR-SCRIPT
//
// td-priority-gate — 擋 `docs/tech-debt.md` 加回 TD 等級欄位（`**Priority**:` 行）的**唯一**判定式
//
// TD 不帶等級欄位，等級只看 fleet 看板 `td:<repo>:TD-n`（規約
// rules/core/follow-up-register.md § 等級只看 fleet 看板）。消費端共用這一份，NEVER 各寫一份判準：
//   - pre-commit：`scripts/pre-commit/checks/td-priority.sh` → 本檔 `--staged`
//   - CI：composite action `td-priority-gate` → 本檔 `--against <ref>`
//   - clade home：`.husky/pre-commit`（--staged）與 validate.yml（--against origin/main）
//   兩種模式的基準都是 merge-base(HEAD, <base>)：`--staged` 比 index（base＝origin/HEAD→origin/main→HEAD）、`--against` 比 HEAD。
//
// 判準：diff 中 `docs/tech-debt.md` **新增**的欄位行（行首可帶 `- `／`* ` 清單前綴的 `**Priority**:`）。
// 改寫既有值在 diff 裡是「刪一行、加一行」，加的那行照樣擋。刪除放行（遷移要走得出去）；
// 其他檔（含 `docs/archives/tech-debt-closed-*.md` 的歷史憑證）與散文裡提到這個詞都不判。
//
// 由 ~/clade vendor/scripts/checks/ 散播，請勿直接編輯 consumer 副本。

import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const REGISTER = 'docs/tech-debt.md'

const FIELD_LINE = /^\s*(?:[-*]\s+)?\*\*Priority\*\*\s*[:：]/u

export function isPriorityFieldLine(text: string): boolean {
  return FIELD_LINE.test(text)
}

export interface AddedLine {
  path: string
  line: number
  text: string
}

/** 吃 `git diff -U0` 輸出，回傳 register 新增的欄位行（行號是變更後檔案的行號）。 */
export function addedPriorityLines(diff: string): AddedLine[] {
  const out: AddedLine[] = []
  let path: string | null = null
  let lineNo = 0
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4).trim()
      path = p === '/dev/null' ? null : p.replace(/^b\//u, '')
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(raw)
    if (hunk) {
      lineNo = Number(hunk[1])
      continue
    }
    if (path !== REGISTER) continue
    if (raw.startsWith('+')) {
      const text = raw.slice(1)
      if (isPriorityFieldLine(text)) out.push({ path, line: lineNo, text })
      lineNo += 1
    } else if (raw.startsWith(' ')) {
      lineNo += 1
    }
  }
  return out
}

export function formatViolations(found: AddedLine[]): string {
  return [
    `td-priority-gate: ${found.length} 筆 TD 等級欄位被加回 ${REGISTER}`,
    ...found.map((f) => `  ✗ ${f.path}:${f.line} — ${f.text.trim()}`),
    '',
    '  TD 不帶等級欄位：刪掉這行，等級改在 fleet 看板設定（看板列 td:<repo>:TD-n，預設 P3）。',
    '  規約：rules/core/follow-up-register.md § 等級只看 fleet 看板',
  ].join('\n')
}

function gitDiff(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, 'diff', '-U0', '--no-color', ...args, '--', REGISTER], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  })
}

function mergeBase(root: string, ref: string): string {
  return execFileSync('git', ['-C', root, 'merge-base', 'HEAD', ref], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/**
 * `--staged` 比 index 與 merge-base(HEAD, origin/main)，與 CI 的 `--against origin/main` 同一基準：
 * branch 上先刪後還原成 main 的內容不是「加回」（把刪除拆到另一筆 commit 時就是這個形狀）。預設分支先看 origin/HEAD，
 * 再看 origin/main，都解不出才退回 HEAD。
 */
function stagedBase(root: string): string {
  for (const ref of ['origin/HEAD', 'origin/main']) {
    try {
      return mergeBase(root, ref)
    } catch {
      // 下一個候選
    }
  }
  return 'HEAD'
}

export function collect(root: string, mode: { staged: true } | { against: string }): AddedLine[] {
  if ('staged' in mode) return addedPriorityLines(gitDiff(root, ['--cached', stagedBase(root)]))
  return addedPriorityLines(gitDiff(root, [mergeBase(root, mode.against), 'HEAD']))
}

const USAGE = 'usage: td-priority-gate (--staged | --against <ref>) [--root <dir>]'

export function main(argv: string[], io = { stderr: process.stderr }): number {
  const rootIdx = argv.indexOf('--root')
  const againstIdx = argv.indexOf('--against')
  const mode = argv.includes('--staged')
    ? ({ staged: true } as const)
    : againstIdx >= 0 && argv[againstIdx + 1]
      ? { against: argv[againstIdx + 1]! }
      : null
  let root = rootIdx >= 0 ? (argv[rootIdx + 1] ?? '') : ''
  if (!root) {
    try {
      root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
    } catch {
      root = ''
    }
  }
  if (!mode || !root) {
    io.stderr.write(`${USAGE}\n`)
    return 2
  }
  const found = collect(root, mode)
  if (found.length > 0) {
    io.stderr.write(`${formatViolations(found)}\n`)
    return 1
  }
  return 0
}

function invokedAsCli(): boolean {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (invokedAsCli()) process.exit(main(process.argv.slice(2)))
