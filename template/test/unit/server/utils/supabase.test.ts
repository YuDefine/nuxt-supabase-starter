import { describe, it, expect, vi, beforeEach } from 'vite-plus/test'

// Mock @supabase/supabase-js
const mockRpc = vi.fn()
const mockFrom = vi.fn()
const mockClient = {
  rpc: mockRpc,
  from: mockFrom,
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockClient),
}))

// Must import after mock
import { createClient } from '@supabase/supabase-js'
import { getServerSupabaseClient, getAuthedSupabase } from '../../../../server/utils/supabase'

describe('supabase utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Set required env vars
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SECRET_KEY = 'test-service-key'
  })

  describe('getServerSupabaseClient', () => {
    it('should return a SupabaseClient', () => {
      const client = getServerSupabaseClient()
      expect(client).toBeDefined()
    })

    it('should return the same singleton instance', () => {
      const client1 = getServerSupabaseClient()
      const client2 = getServerSupabaseClient()
      expect(client1).toBe(client2)
    })

    it('should build the client with the service-role key', async () => {
      // 重設 module 讓 singleton 重建，否則前面的 test 已經把 client 建好，
      // createClient 不會再被呼叫，這條斷言就永遠是空的。
      vi.resetModules()
      const { getServerSupabaseClient: fresh } = await import('../../../../server/utils/supabase')
      const { createClient: freshCreateClient } = await import('@supabase/supabase-js')

      fresh()

      // 「用哪一把 key」是本模組最關鍵的事實 — 它決定 RLS 生不生效。
      // 明確斷言，不留給默契。
      expect(freshCreateClient).toHaveBeenCalledWith(
        'https://test.supabase.co',
        'test-service-key',
        expect.anything(),
      )
    })
  })

  describe('getAuthedSupabase', () => {
    it('should throw 401 when session is missing', () => {
      const event = { context: {} } as any

      expect(() => getAuthedSupabase(event)).toThrow()
    })

    it('should throw 401 when user is missing from session', () => {
      const event = { context: { session: {} } } as any

      expect(() => getAuthedSupabase(event)).toThrow()
    })

    it('should return the client and user without calling any RPC', () => {
      const event = {
        context: {
          session: {
            user: { id: 'user-123', role: 'admin' },
          },
        },
      } as any

      const result = getAuthedSupabase(event)

      expect(result.client).toBeDefined()
      expect(result.user).toEqual({ id: 'user-123', role: 'admin' })
      // 這個 helper 曾經呼叫 set_app_context RPC 想讓 RLS 認得使用者。那機制在兩個
      // 層面都不成立（service-role 連線繞過 RLS；set_config 是 transaction-local，
      // 而 PostgREST 每個 request 獨立 transaction）。斷言「不呼叫任何 rpc」是為了
      // 讓它不會被無聲地加回來。
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it('should pass the user through untouched', () => {
      const event = {
        context: {
          session: {
            user: { id: 'user-456' },
          },
        },
      } as any

      const result = getAuthedSupabase(event)

      // 不再替 user 補 role 預設值 — 授權由 handler 判定，這裡不做任何加工，
      // 免得 handler 誤以為拿到的 role 是權威來源。
      expect(result.user).toEqual({ id: 'user-456' })
    })
  })
})
