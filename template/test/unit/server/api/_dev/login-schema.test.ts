import { describe, expect, it, vi } from 'vite-plus/test'

// 見 login.post.test.ts：handler 走 Nuxt auto-import，globals 必須在模組
// 載入前就位，只能放 vi.hoisted。
vi.hoisted(() => {
  const g = globalThis as any
  g.defineEventHandler = (handler: any) => handler
  g.createError = (opts: any) => {
    const error = new Error(opts.message ?? opts.statusMessage) as any
    error.statusCode = opts.statusCode
    return error
  }
})

import { bodySchema } from '../../../../../server/api/_dev/login.post'

// TD-026 D4：dev-login 刻意不接受 `id` —— id 一律由 Better Auth 簽發，
// fixture 別名綁定實際回傳的 user.id。本測試鎖定 schema 不含 id 欄位，
// 且即使塞入也會被 zod strip 而不會流進 signUp/signIn。
describe('dev-login bodySchema (TD-026 D4)', () => {
  it('has no id field', () => {
    expect(Object.keys(bodySchema.shape)).toEqual(['email', 'password', 'name', 'as'])
  })

  it('strips a caller-supplied id instead of accepting it', () => {
    const parsed = bodySchema.parse({
      email: 'fixture@test.local',
      id: '550e8400-e29b-41d4-a716-446655440000',
    }) as Record<string, unknown>

    expect(parsed).not.toHaveProperty('id')
  })
})
