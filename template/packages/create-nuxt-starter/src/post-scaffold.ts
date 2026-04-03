import { execFileSync } from 'node:child_process'
import { relative } from 'node:path'
import { consola } from 'consola'

export async function postScaffold(
  targetDir: string,
  projectName: string,
  invocationCwd: string,
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

  // 3. Display next steps
  consola.log('')
  consola.box(
    [
      `專案 ${projectName} 建立完成！`,
      `路徑：${targetDir}`,
      '',
      '接下來：',
      `  cd ${relativeTargetDir}`,
      '  編輯 .env               # 補齊必要環境變數',
      '  pnpm dev                # 啟動開發伺服器',
    ].join('\n')
  )
}
