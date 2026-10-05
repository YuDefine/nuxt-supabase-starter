import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vite-plus/test'
import { z } from 'zod'

const SEED_SQL = readFileSync(join(import.meta.dirname, '../../../supabase/seed.sql'), 'utf8')
const uuidSchema = z.string().uuid()
const UUID_PATTERN = /'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'/gi

function extractIds(sql: string): string[] {
  return [...sql.matchAll(UUID_PATTERN)].map((match) => match[1])
}

// TD-026 D1：auth.users / auth.identities / public.profiles 三處引用的種子 id 必須是
// 合法 RFC 9562 UUID（zod uuid() 會檢查 version/variant bits），否則 scenarios 的
// uuid 驗證、profiles.id 的 schema parse 都會先失敗。
// 種子刻意用 v7 版型（`…-7xxx-8xxx-…`）：zod 收 v1–v8，而 starter-hygiene hook 的
// real-tenant-identifier 只掃 v1–v5 UUID 字面量；重複位元的 placeholder 形狀
// 本來就不可能是真實 tenant id，v7 讓 gate 與 schema 驗證同時成立。
describe('seed.sql', () => {
  it('contains only valid RFC 9562 UUID literals', () => {
    const ids = extractIds(SEED_SQL)

    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      expect(uuidSchema.safeParse(id).success, `invalid uuid: ${id}`).toBe(true)
    }
  })

  it('uses the same ids in auth.users and public.profiles', () => {
    const profilesSection = SEED_SQL.slice(SEED_SQL.indexOf('public.profiles'))
    const profileIds = new Set(extractIds(profilesSection))

    expect(profileIds.size).toBe(3)
    for (const id of profileIds) {
      // 同一 id 必須同時出現在 auth.users / auth.identities 區段（profiles 區段之前）
      expect(SEED_SQL.indexOf(`'${id}'`)).toBeLessThan(SEED_SQL.indexOf('public.profiles'))
    }
  })
})
