import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { relative } from 'node:path'
import { consola } from 'consola'

export async function postScaffold(
  targetDir: string,
  projectName: string,
  invocationCwd: string,
  monorepoRoot?: string,
): Promise<void> {
  const relativeTargetDir = relative(invocationCwd, targetDir) || '.'

  // 1. Install dependencies
  consola.start('正在安裝依賴套件...')
  try {
    execFileSync('pnpm', ['install'], { cwd: targetDir, stdio: 'pipe' })
    consola.success('依賴套件安裝完成！')
  } catch {
    consola.warn('依賴套件安裝失敗，請手動執行：')
    consola.log(`  cd ${relativeTargetDir} && pnpm install`)
  }

  // 2. Initialize git
  consola.start('正在初始化 Git...')
  try {
    execFileSync('git', ['init'], { cwd: targetDir, stdio: 'pipe' })
    execFileSync('git', ['add', '-A'], { cwd: targetDir, stdio: 'pipe' })
    execFileSync('git', ['commit', '-m', 'chore: initial project scaffold'], {
      cwd: targetDir,
      stdio: 'pipe',
    })
    consola.success('Git 初始化完成！')
  } catch {
    consola.warn('Git 初始化失敗，請手動執行。')
  }

  // 3. Clean up monorepo clone (temp-starter)
  if (monorepoRoot) {
    consola.start('正在清除暫存的 starter repo...')
    try {
      rmSync(monorepoRoot, { recursive: true, force: true })
      consola.success('暫存 repo 已刪除')
    } catch {
      consola.warn(`無法自動刪除 ${monorepoRoot}，請手動刪除。`)
    }
  }

  // 4. Display next steps
  consola.log('')
  consola.box(
    [
      `專案 ${projectName} 建立完成！`,
      `路徑：${targetDir}`,
      '',
      '接下來：',
      `  cd ${relativeTargetDir}`,
      '  pnpm run setup           # 檢查環境 → 啟動 Supabase → 產生型別',
      '  pnpm dev                 # 啟動開發伺服器',
    ].join('\n')
  )
}
