import { describe, expect, it } from 'vite-plus/test'

import authConfigFactory from '../../../server/auth.config'

// TD-026 D1：Better Auth 預設 id 是 32 字元英數字串，寫不進 Postgres uuid 欄位。
// 本測試鎖定 generateId 設定為 'uuid'（由 crypto.randomUUID() 產 RFC 4122 id），
// 防止日後調整 auth config 時把這行改回去，造成 user.id 無法關聯 profiles。
describe('auth.config', () => {
  it('configures Better Auth to generate RFC 4122 UUID ids', () => {
    const config = authConfigFactory({} as never)

    expect(config.advanced?.database?.generateId).toBe('uuid')
  })
})
