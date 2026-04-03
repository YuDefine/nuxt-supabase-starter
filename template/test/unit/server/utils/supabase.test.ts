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
import { getServerSupabaseClient, getSupabaseWithContext } from '../../../../server/utils/supabase'

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
  })

  describe('getSupabaseWithContext', () => {
    it('should throw 401 when session is missing', async () => {
      const event = { context: {} } as any

      await expect(getSupabaseWithContext(event)).rejects.toThrow()
    })

    it('should throw 401 when user is missing from session', async () => {
      const event = { context: { session: {} } } as any

      await expect(getSupabaseWithContext(event)).rejects.toThrow()
    })

    it('should call RPC to set application context', async () => {
      mockRpc.mockResolvedValueOnce({ error: null })

      const event = {
        context: {
          session: {
            user: { id: 'user-123', role: 'admin' },
          },
        },
      } as any

      const result = await getSupabaseWithContext(event)

      expect(mockRpc).toHaveBeenCalledWith('set_app_context', {
        p_user_id: 'user-123',
        p_user_role: 'admin',
      })
      expect(result.client).toBeDefined()
      expect(result.user).toEqual({ id: 'user-123', role: 'admin' })
    })

    it('should throw when RPC fails', async () => {
      mockRpc.mockResolvedValueOnce({ error: { message: 'RPC failed' } })

      const event = {
        context: {
          session: {
            user: { id: 'user-123', role: 'admin' },
          },
        },
      } as any

      await expect(getSupabaseWithContext(event)).rejects.toThrow()
    })

    it('should default role to "user" when not present', async () => {
      mockRpc.mockResolvedValueOnce({ error: null })

      const event = {
        context: {
          session: {
            user: { id: 'user-456' },
          },
        },
      } as any

      const result = await getSupabaseWithContext(event)

      expect(mockRpc).toHaveBeenCalledWith('set_app_context', {
        p_user_id: 'user-456',
        p_user_role: 'user',
      })
      expect(result.user).toEqual({ id: 'user-456' })
    })
  })
})
