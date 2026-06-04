#!/usr/bin/env node
// wip-dirty.mjs — 列出一個 repo working tree 內「user WIP」dirty paths，
// 即 git status --porcelain 過濾掉 clade-managed projection 後剩下的檔。
//
// Single source of projection filter: isLockedProjectionPath（locked-projection.mjs），
// 與 wt-helper merge-back 共用，避免 Stop hook / drift-scan 各自重刻 projection pattern 漂移
// （2026-06-01 dev-session.mjs 漏進 LOCKED_PROJECTION_RE 即此類 drift）。
//
// 程式用法（drift-scan Layer 2a）：
//   import { userDirtyPaths } from './wip-dirty.mjs'
//   const wip = userDirtyPaths(worktreePath)  // → string[]（porcelain path，已剝 XY 狀態碼）
//
// CLI 用法（stop-wip-guard.sh Layer 0 warn）：
//   node wip-dirty.mjs [repoRoot]
//   - stdout：每行一個 user WIP path（無則空）
//   - exit 1：有 user WIP；exit 0：乾淨 / 全 projection / 非 git repo（fail-open）

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isLockedProjectionPath } from './locked-projection.mjs'

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
  return out
    .split('\n')
    .filter(Boolean)
    .map(porcelainPath)
    .filter((p) => p && !isLockedProjectionPath(p))
}

// CLI mode — 給 bash hook 用（exit code 表示有無 user WIP）。
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const repoRoot = process.argv[2] || process.cwd()
  const wip = userDirtyPaths(repoRoot)
  if (wip.length > 0) {
    process.stdout.write(`${wip.join('\n')}\n`)
    process.exit(1)
  }
  process.exit(0)
}
