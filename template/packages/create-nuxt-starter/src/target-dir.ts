import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'pathe'

/**
 * 起手檔白名單：一個「只有產品說明、還沒有 code」的 repo 會有的東西。
 *
 * 這些檔案 scaffold 不會產生（`templates/base/` 只有 `.gitignore` 一支跟它們重疊），
 * 所以就地 scaffold 不會覆蓋掉使用者已經寫好的內容。白名單刻意收緊 ——
 * `docs/`、`.github/`、`.vscode/` 都不列入：scaffold 會往那些位置寫檔，
 * 判成可就地展開就會靜默蓋掉使用者的東西。
 */
export const ADOPTABLE_SEED_ENTRIES: ReadonlySet<string> = new Set([
  '.git',
  '.gitignore',
  '.gitattributes',
  '.DS_Store',
  'README.md',
  'readme.md',
  'LICENSE',
  'LICENSE.md',
  'LICENCE',
  'CHANGELOG.md',
])

/** scaffold 會寫、且可能與既有起手檔衝突的檔案。目前只有 `.gitignore`。 */
export const MERGEABLE_SEED_ENTRIES: ReadonlySet<string> = new Set(['.gitignore'])

export type TargetDirKind =
  /** 目錄不存在 —— 標準的新專案路徑。 */
  | 'absent'
  /** 目錄存在但完全是空的。 */
  | 'empty'
  /** 目錄只含起手檔（典型：已開好 git repo + 寫好產品 README，還沒有 code）。 */
  | 'adoptable'
  /** 目錄含 scaffold 會覆蓋到的內容 —— 拒絕，並要求使用者選一條明確的路。 */
  | 'occupied'

export interface TargetDirState {
  kind: TargetDirKind
  /** 實際存在的起手檔（已排序）。 */
  seeds: string[]
  /** 使它變成 `occupied` 的項目（已排序）。目錄以尾綴 `/` 標示。 */
  blockers: string[]
  /** 目標目錄本身是否已經是 git repo（有 `.git`）。 */
  hasGitRepo: boolean
}

/**
 * 判定「能不能往這個目錄 scaffold」，以及該用哪一種方式。
 *
 * 純函式（只讀檔案系統），讓 CLI 的決策與訊息都可以直接測。
 */
export function classifyTargetDir(targetDir: string): TargetDirState {
  if (!existsSync(targetDir)) {
    return { kind: 'absent', seeds: [], blockers: [], hasGitRepo: false }
  }

  const entries = readdirSync(targetDir)
  const hasGitRepo = entries.includes('.git')

  if (entries.length === 0) {
    return { kind: 'empty', seeds: [], blockers: [], hasGitRepo: false }
  }

  const seeds: string[] = []
  const blockers: string[] = []

  for (const entry of entries) {
    if (ADOPTABLE_SEED_ENTRIES.has(entry)) {
      seeds.push(entry)
      continue
    }
    blockers.push(isDirectory(join(targetDir, entry)) ? `${entry}/` : entry)
  }

  seeds.sort()
  blockers.sort()

  return {
    kind: blockers.length > 0 ? 'occupied' : 'adoptable',
    seeds,
    blockers,
    hasGitRepo,
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * `adoptable` 時要告訴使用者「你的哪些檔會怎麼被處置」。
 *
 * 沉默地就地展開是最糟的行為 —— 使用者不知道 `.gitignore` 被動過、
 * 也不知道 git 歷史有沒有被重置。
 */
export function describeAdoption(state: TargetDirState): string[] {
  const lines: string[] = []
  const preserved = state.seeds.filter((entry) => !MERGEABLE_SEED_ENTRIES.has(entry))

  if (state.hasGitRepo) {
    lines.push('保留既有 git repo 與 commit 歷史（不會重新 git init）')
  }
  const preservedFiles = preserved.filter((entry) => entry !== '.git')
  if (preservedFiles.length > 0) {
    lines.push(`原封不動：${preservedFiles.join('、')}`)
  }
  for (const entry of state.seeds) {
    if (MERGEABLE_SEED_ENTRIES.has(entry)) {
      lines.push(`${entry} 會與 starter 的規則合併（你既有的行不會被刪掉）`)
    }
  }
  return lines
}

/**
 * `occupied` 時的錯誤訊息。
 *
 * 只講「不行」而不給下一步，等於把 debug 工作丟回給使用者 —— 這是本 CLI
 * 被 beginner 撞到最多次的一堵牆，所以訊息必須自帶三條可執行的出路。
 */
export function describeRejection(projectName: string, state: TargetDirState): string[] {
  const shown = state.blockers.slice(0, 10)
  const rest = state.blockers.length - shown.length

  const lines = [
    `目錄 "${projectName}" 已存在，且含有 scaffold 會覆蓋到的內容。`,
    '',
    '  擋住的項目：',
    `    ${shown.join('  ')}${rest > 0 ? `  …另有 ${rest} 項` : ''}`,
    '',
    '  可以就地展開的起手檔只有這些：',
    `    ${[...ADOPTABLE_SEED_ENTRIES].filter((e) => e !== '.DS_Store').join('  ')}`,
    '',
    '  三條路，挑一條：',
    `    1. 換個新目錄名重跑         create-nuxt-starter <新名字>`,
    '    2. 這已經是一個 Nuxt 專案 → 你要的是「把 starter 整合進既有專案」，',
    '       不是 scaffold。見 docs/INTEGRATION_GUIDE.md',
    '    3. 確定不要現有內容了 → 自己先清空該目錄再重跑',
    '       （CLI 不會替你刪檔，刪除一律由你決定）',
  ]
  return lines
}
