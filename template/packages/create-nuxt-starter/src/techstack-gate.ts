import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'pathe'

/**
 * tech stack 確認閘門（S4-b）：`--yes`／managed 路徑在寫第一個檔之前，先確認
 * Charles 的逐項確認紀錄通過 clade 的 check。
 *
 * 判準的 SSoT 在 clade（`vendor/scripts/techstack-confirmation.ts check`）——
 * 這裡 NEVER 另寫 parser，只負責「找得到 clade、呼叫它、把結果翻成拒絕理由」。
 * 找不到 clade 一律拒絕（fail-loud）：沒有判準就不能放行。
 */

export const TECHSTACK_RECORD_RELATIVE = 'docs/techstack-confirmation.md'

export type TechstackGateOutcome =
  | { status: 'ok'; recordPath: string }
  | { status: 'rejected'; code: string; reason: string }

export function techstackCheckScript(cladeRoot: string): string {
  return join(cladeRoot, 'vendor', 'scripts', 'techstack-confirmation.ts')
}

interface ExecFailure {
  status?: number | null
  stdout?: Buffer | string
  stderr?: Buffer | string
  message?: string
}

function outputOf(error: ExecFailure): string {
  return [error.stdout, error.stderr]
    .map((part) => (part ? part.toString().trim() : ''))
    .filter(Boolean)
    .join('\n')
}

export function checkTechstackRecord(
  cladeRoot: string | undefined,
  recordPath: string | undefined,
): TechstackGateOutcome {
  if (!recordPath) {
    return {
      status: 'rejected',
      code: 'TECHSTACK_RECORD_MISSING',
      reason:
        '沒有 tech stack 確認紀錄：--yes／managed 流程必須帶 --techstack-record <path>' +
        '（Charles 逐項確認過的 docs/techstack-confirmation.md；格式與清單見 ' +
        '`node vendor/scripts/techstack-confirmation.ts print --recommend --skeleton`）。',
    }
  }
  if (!existsSync(recordPath) || !statSync(recordPath).isFile()) {
    return {
      status: 'rejected',
      code: 'TECHSTACK_RECORD_MISSING',
      reason: `--techstack-record 指向的檔案不存在：${recordPath}`,
    }
  }
  if (!cladeRoot) {
    return {
      status: 'rejected',
      code: 'TECHSTACK_CLADE_UNAVAILABLE',
      reason:
        '找不到 clade 來源（CLADE_HOME / ~/clade / ~/offline/clade），無法驗證 tech stack 確認紀錄；' +
        '沒有判準就不放行（CLADE_HOME 已指定但不存在時不 fallback 真 home）。',
    }
  }
  const script = techstackCheckScript(cladeRoot)
  if (!existsSync(script)) {
    return {
      status: 'rejected',
      code: 'TECHSTACK_CLADE_UNAVAILABLE',
      reason: `clade 來源缺 ${script}（clade 版本過舊，需升級到含 tech stack 確認閘門的版本）。`,
    }
  }
  try {
    execFileSync('node', [script, 'check', '--record', recordPath], {
      cwd: cladeRoot,
      stdio: 'pipe',
    })
    return { status: 'ok', recordPath }
  } catch (error) {
    const failure = error as ExecFailure
    const detail = outputOf(failure) || failure.message || '（無輸出）'
    if (failure.status === 1) {
      return {
        status: 'rejected',
        code: 'TECHSTACK_RECORD_INCOMPLETE',
        reason: `tech stack 確認紀錄未通過 clade check，未建立任何檔案：\n${detail}`,
      }
    }
    return {
      status: 'rejected',
      code: 'TECHSTACK_CHECK_FAILED',
      reason: `clade 的 tech stack check 無法執行（exit ${failure.status ?? '?'}）：\n${detail}`,
    }
  }
}

/**
 * target 已有內容不同的紀錄時回傳衝突理由（寫任何檔之前就能問）——紀錄是追加式，
 * 舊列不能被另一份檔案蓋掉。沒有衝突回 undefined。
 */
export function techstackRecordConflict(recordPath: string, targetDir: string): string | undefined {
  const dest = join(targetDir, TECHSTACK_RECORD_RELATIVE)
  if (!existsSync(dest)) return undefined
  if (readFileSync(dest, 'utf-8') === readFileSync(recordPath, 'utf-8')) return undefined
  return (
    `target 已有不同的 ${TECHSTACK_RECORD_RELATIVE}：紀錄是追加式，不能被另一份蓋掉。` +
    '請改用 target 內那份當 --techstack-record（或先把新列追加進去）。'
  )
}

/** 把通過 check 的紀錄放進 target 的 `docs/techstack-confirmation.md`（已有相同內容則不動）。 */
export function installTechstackRecord(recordPath: string, targetDir: string): void {
  const dest = join(targetDir, TECHSTACK_RECORD_RELATIVE)
  if (existsSync(dest)) return
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(recordPath, dest)
}
