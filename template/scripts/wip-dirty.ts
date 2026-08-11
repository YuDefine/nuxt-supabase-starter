#!/usr/bin/env node
// wip-dirty.ts — 列出一個 repo working tree 內「user WIP」dirty paths，
// 即 git status --porcelain 過濾掉 clade-managed projection 後剩下的檔。
//
// Single source of projection filter: isLockedProjectionPath（locked-projection.ts），
// 與 wt-helper merge-back 共用，避免 Stop hook / drift-scan 各自重刻 projection pattern 漂移
// （2026-06-01 dev-session.ts 漏進 LOCKED_PROJECTION_RE 即此類 drift）。
//
// 程式用法（drift-scan Layer 2a）：
//   import { userDirtyPaths } from './wip-dirty.ts'
//   const wip = userDirtyPaths(worktreePath)  // → string[]（porcelain path，已剝 XY 狀態碼）
//
// CLI 用法（stop-wip-guard.sh Layer 0 warn）：
//   node wip-dirty.ts [repoRoot]
//   - stdout：每行一個 user WIP path（無則空）
//   - exit 1：有 user WIP；exit 0：乾淨 / 全 projection / 非 git repo（fail-open）

import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isLockedProjectionPathFor } from './locked-projection.ts'

/**
 * git status --porcelain 的一行剝出 path。porcelain v1 格式：
 *   `XY <path>` 或 rename `XY <old> -> <new>`（取 new）。
 */
function porcelainPath(line) {
  const body = line.slice(3) // 剝 2 char 狀態碼 + 1 space
  const arrow = body.indexOf(' -> ')
  return arrow >= 0 ? body.slice(arrow + 4) : body
}

/**
 * 回傳 repoRoot working tree 內非 clade-projection 的 dirty paths。
 * 非 git repo / git 失敗 → 回空陣列（fail-open，呼叫端不該因 infra 故障誤判）。
 */
export function userDirtyPaths(repoRoot) {
  let out
  try {
    out = execFileSync('git', ['status', '--porcelain'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return []
  }
  return (
    out
      .split('\n')
      .filter(Boolean)
      .map(porcelainPath)
      // repo-aware：clade home 的 `vendor/snippets/**` 等是源檔不是投影（TD-344）。
      .filter((p) => p && !isLockedProjectionPathFor(repoRoot, p))
  )
}

// CLI mode — 給 bash hook 用（exit code 表示有無 user WIP）。
// CLI 進入判定：兩邊都 realpath。node 預設把 import.meta.url realpath 化、
// process.argv[1] 則原樣保留，經 symlink 叫進去兩者不相等 → 整個 CLI 區塊被靜默
// 跳過且 exit 0，長相與「一切正常」無法區分（TD-460）。
function invokedAsCli() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return entry === fileURLToPath(import.meta.url)
  }
}

if (invokedAsCli()) {
  const repoRoot = process.argv[2] || process.cwd()
  const wip = userDirtyPaths(repoRoot)
  if (wip.length > 0) {
    process.stdout.write(`${wip.join('\n')}\n`)
    process.exit(1)
  }
  process.exit(0)
}
