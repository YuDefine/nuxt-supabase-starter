#!/usr/bin/env node
/* eslint-disable no-console */
/* oxlint-disable no-console */

/**
 * PreToolUse hook: 阻擋對受保護路徑的 Edit/Write 操作
 * 讀取 stdin JSON → 檢查 file_path → exit 0 (allow) 或 exit 2 (block)
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// 永久保護的 glob patterns
const PERMANENT_GUARDS = [
  /^supabase\/migrations\//,
  /^\.github\/workflows\//,
  /^\.env($|\.)/,
  /^wrangler\.(jsonc|toml)$/,
]

// 讀取自訂凍結路徑
function loadFrozenPaths() {
  try {
    const stateFile = resolve(process.env.CLAUDE_PROJECT_DIR || '.', '.claude', 'guard-state.json')
    const state = JSON.parse(readFileSync(stateFile, 'utf-8'))
    return state.frozen_paths || []
  } catch {
    return []
  }
}

// 從 stdin 讀取 tool input
let input = ''
process.stdin.setEncoding('utf-8')
process.stdin.on('data', (chunk) => (input += chunk))
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input)
    const filePath = data.tool_input?.file_path || data.tool_input?.command || ''

    // 取得相對路徑
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
    const relativePath = filePath.startsWith(projectDir)
      ? filePath.slice(projectDir.length + 1)
      : filePath

    // 檢查永久保護
    for (const pattern of PERMANENT_GUARDS) {
      if (pattern.test(relativePath)) {
        console.error(
          JSON.stringify({
            error: `🛡️ 此路徑受永久保護: ${relativePath}\n手動修改請直接編輯檔案，不要透過 Claude。`,
          })
        )
        process.exit(2)
      }
    }

    // 檢查自訂凍結
    const frozenPaths = loadFrozenPaths()
    for (const frozen of frozenPaths) {
      if (relativePath === frozen || relativePath.startsWith(frozen + '/')) {
        console.error(
          JSON.stringify({
            error: `🧊 此路徑已被凍結: ${relativePath}\n解凍: /unfreeze ${frozen}`,
          })
        )
        process.exit(2)
      }
    }

    // 允許
    process.exit(0)
  } catch {
    // Parse 失敗時允許通過（不要阻擋正常操作）
    process.exit(0)
  }
})
