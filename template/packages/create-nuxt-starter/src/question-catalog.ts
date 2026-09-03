/**
 * 新專案問題樹 SoT。
 *
 * CLI 互動模式逐題問這裡的 `prompt`。AI 不經 CLI、改用對話引導時，MUST 問
 * 同一組 `id`（適用條件 `when` 為真的才問），使用者訊息裡已經答過的可以跳過。
 * `--yes` 只代表「答案已齊、不要再出現 TTY prompt」，不是「用預設值略過沒問的題」。
 */
import { type DbHost, type DbStack } from './types'

export type { DbHost }

export type QuestionWhen = 'always' | 'supabase' | 'register'

export interface CatalogOption {
  value: string
  label: string
}

export interface CatalogQuestion {
  id: string
  prompt: string
  hint?: string
  when: QuestionWhen
  flag: string
  options?: CatalogOption[]
}

export const QUESTION_CATALOG: readonly CatalogQuestion[] = [
  {
    id: 'db-host',
    prompt: '開發時，資料庫要跑在哪裡？',
    hint: '專案模板名叫 supabase，不代表一定要在這台電腦再起一份資料庫。',
    when: 'supabase',
    flag: '--db-host',
    options: [
      {
        value: 'this-machine',
        label: '這台電腦（會用 Docker 裝一份，適合第一次試）',
      },
      {
        value: 'existing-server',
        label: '另一台已經在跑的伺服器（這台電腦只連過去，不要再起一份）',
      },
    ],
  },
  {
    id: 'register-fleet',
    prompt: '要不要把這個專案登記進共用名單（之後才能自動檢查、配開發網址）？',
    when: 'always',
    flag: '--register-consumer',
    options: [
      { value: 'yes', label: '要，這是要長期維護的專案' },
      { value: 'no', label: '先自己試，先不登記' },
    ],
  },
  {
    id: 'repo-id',
    prompt: 'GitHub 上這個專案叫什麼？（格式 owner/專案名）',
    hint: '還沒開 GitHub 倉庫可以先填之後要用的名字。',
    when: 'register',
    flag: '--repo-id',
  },
  {
    id: 'workflow-model',
    prompt: '改動要怎麼進正式版？',
    when: 'register',
    flag: '--workflow-model',
    options: [
      { value: 'trunk-based', label: '直接推到 main' },
      { value: 'pr-merge-based', label: '每個改動先開 Pull Request，合過再進 main' },
    ],
  },
  {
    id: 'business-activity',
    prompt: '這個專案現在處於哪個階段？',
    when: 'register',
    flag: '--business-activity',
    options: [
      { value: 'pre-production', label: '還沒給人用，還在做' },
      { value: 'active', label: '已經有人在用' },
      { value: 'maintenance', label: '維護中' },
      { value: 'paused', label: '暫停' },
    ],
  },
  {
    id: 'dev-port',
    prompt: '本機開發網址要用哪個 port？',
    when: 'register',
    flag: '--dev-port',
    options: [
      { value: 'auto', label: '幫我配一個沒被佔用的' },
      { value: 'custom', label: '我自己指定' },
    ],
  },
  {
    id: 'deploy-track',
    prompt: '上線後程式要怎麼部署？',
    when: 'register',
    flag: '--deploy-track',
    options: [
      { value: 'wrangler-action', label: 'Cloudflare 自動部署' },
      { value: 'void-cloud', label: 'void.cloud' },
      { value: 'node-server', label: '自己的 Node 伺服器' },
      { value: 'none', label: '這階段先不上線' },
    ],
  },
]

export function questionById(id: string): CatalogQuestion {
  const found = QUESTION_CATALOG.find((q) => q.id === id)
  if (!found) throw new Error(`unknown catalog question: ${id}`)
  return found
}

export function applicableQuestions(ctx: {
  hasSupabase: boolean
  register: boolean
}): CatalogQuestion[] {
  return QUESTION_CATALOG.filter((q) => {
    if (q.when === 'always') return true
    if (q.when === 'supabase') return ctx.hasSupabase
    if (q.when === 'register') return ctx.register
    return false
  })
}

export function usesSupabaseDatabase(
  dbStack: DbStack | string,
  features: readonly string[],
): boolean {
  return dbStack === 'supabase' && features.includes('database')
}
