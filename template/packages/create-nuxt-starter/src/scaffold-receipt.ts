import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * scaffold 首投影的認領憑證（clade `scripts/lib/scaffold-receipt-adoption.ts` 的 starter 半）。
 *
 * assemble 會把 starter 自己已渲染的 agent 目錄整包拷進新專案；新專案沒有 ownership state，
 * 第一次 `pnpm install` 的 postinstall（hub-sync）首投影看到內容不同的既有檔就以
 * `unowned file differs at first projection` 拒收。首投影時還沒 `git init`，沒有 commit 可當證據，
 * 唯一的正向證據是「這個檔的位元組就是 scaffold 自己寫的」——這份 receipt 就是那個證據。
 *
 * 路徑固定在 repo 根：scaffold-only 契約不得有 `.clade/`。
 * hash 與 clade 一致：sha256 over 以 UTF-8 讀出的字串。
 */
export const SCAFFOLD_RECEIPT_PATH = '.clade-scaffold-receipt.json'
export const SCAFFOLD_RECEIPT_PRODUCER = 'create-nuxt-starter'

/** 從 starter 整包拷進新專案、會被 clade 首投影碰到的 agent 目錄。 */
export const SCAFFOLD_RECEIPT_DIRS = ['.claude', '.cursor', '.agents', '.codex'] as const

export type ScaffoldReceipt = {
  schemaVersion: 1
  producer: typeof SCAFFOLD_RECEIPT_PRODUCER
  files: Record<string, string>
}

export function hashReceiptContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * 依磁碟當下位元組建 receipt。MUST 在所有 prune／placeholder 取代之後、init-consumer 與
 * `pnpm install` 之前呼叫；之後才改的檔不該被認領（clade 端會退回原本的拒收）。
 * symlink 不列：clade 以 lstat 判讀，receipt 只擔保 scaffold 寫出的一般檔。
 */
export function buildScaffoldReceipt(targetDir: string): ScaffoldReceipt {
  const files: Record<string, string> = {}
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(targetDir, rel), { withFileTypes: true })) {
      const childRel = `${rel}/${entry.name}`
      if (entry.isDirectory()) walk(childRel)
      else if (entry.isFile()) {
        files[childRel] = hashReceiptContent(readFileSync(join(targetDir, childRel), 'utf8'))
      }
    }
  }
  for (const dir of SCAFFOLD_RECEIPT_DIRS) {
    const abs = join(targetDir, dir)
    if (existsSync(abs) && lstatSync(abs).isDirectory()) walk(dir)
  }
  const entries = Object.entries(files)
  entries.sort(([a], [b]) => a.localeCompare(b))
  const sorted = Object.fromEntries(entries)
  return { schemaVersion: 1, producer: SCAFFOLD_RECEIPT_PRODUCER, files: sorted }
}

export function writeScaffoldReceipt(targetDir: string): ScaffoldReceipt {
  const receipt = buildScaffoldReceipt(targetDir)
  writeFileSync(join(targetDir, SCAFFOLD_RECEIPT_PATH), `${JSON.stringify(receipt, null, 2)}\n`)
  return receipt
}
