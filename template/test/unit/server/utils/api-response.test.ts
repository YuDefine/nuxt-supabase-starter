import { describe, it, expect, vi, beforeEach } from 'vite-plus/test'

vi.mock('../../../../server/utils/supabase', () => ({
  getServerSupabaseClient: vi.fn(),
}))

import { getServerSupabaseClient } from '../../../../server/utils/supabase'
import {
  createPaginatedResponse,
  requireAuth,
  requireRole,
} from '../../../../server/utils/api-response'

describe('api-response', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createPaginatedResponse', () => {
    it('should create paginated response with correct structure', () => {
      const data = [{ id: 1 }, { id: 2 }]
      const result = createPaginatedResponse(data, { page: 1, perPage: 10, total: 25 })

      expect(result).toEqual({
        data: [{ id: 1 }, { id: 2 }],
        pagination: {
          page: 1,
          perPage: 10,
          total: 25,
          totalPages: 3,
        },
      })
    })

    it('should calculate totalPages correctly for exact division', () => {
      const result = createPaginatedResponse([], { page: 1, perPage: 10, total: 30 })

      expect(result.pagination.totalPages).toBe(3)
    })

    it('should calculate totalPages correctly for remainder', () => {
      const result = createPaginatedResponse([], { page: 1, perPage: 10, total: 31 })

      expect(result.pagination.totalPages).toBe(4)
    })

    it('should handle zero total', () => {
      const result = createPaginatedResponse([], { page: 1, perPage: 10, total: 0 })

      expect(result.pagination.totalPages).toBe(0)
      expect(result.data).toEqual([])
    })
  })

  describe('requireAuth', () => {
    it('should return user when session has valid user', () => {
      const event = {
        context: {
          session: {
            user: { id: 'user-1', role: 'admin', email: 'test@test.com' },
          },
        },
      }

      const user = requireAuth(event as any)
      expect(user.id).toBe('user-1')
    })

    it('should throw 401 when session is missing', () => {
      const event = { context: {} }
      expect(() => requireAuth(event as any)).toThrow()
    })

    it('should throw 401 when user has no id', () => {
      const event = {
        context: { session: { user: {} } },
      }
      expect(() => requireAuth(event as any)).toThrow()
    })
  })

  describe('requireRole', () => {
    const eventWithUser = (user: { id: string; role?: string }) => ({
      context: { session: { user } },
    })

    const mockDbRole = (result: { data?: { role: string } | null; error?: unknown }) => {
      const maybeSingle = vi.fn().mockResolvedValue(result)
      const eq = vi.fn().mockReturnValue({ maybeSingle })
      const select = vi.fn().mockReturnValue({ eq })
      const from = vi.fn().mockReturnValue({ select })
      vi.mocked(getServerSupabaseClient).mockReturnValue({ from } as never)
      return { from, eq }
    }

    it('should not throw when the DB role is allowed', async () => {
      // session 沒有 role 也沒關係：授權只看 DB profiles.role
      mockDbRole({ data: { role: 'admin' } })

      await expect(
        requireRole(eventWithUser({ id: 'user-1' }) as never, ['admin']),
      ).resolves.toBeUndefined()
    })

    it('should ignore a forged session role and read the DB role', async () => {
      // session.user.role 宣稱 admin 但 DB 是 user → 403
      mockDbRole({ data: { role: 'user' } })

      await expect(
        requireRole(eventWithUser({ id: 'user-1', role: 'admin' }) as never, ['admin']),
      ).rejects.toMatchObject({ statusCode: 403 })
    })

    it('should grant admin when the DB role is admin even if session has none', async () => {
      mockDbRole({ data: { role: 'admin' } })

      await expect(
        requireRole(eventWithUser({ id: 'user-1', role: 'user' }) as never, ['admin']),
      ).resolves.toBeUndefined()
    })

    it('should throw 403 when the profile row is missing', async () => {
      mockDbRole({ data: null })

      await expect(
        requireRole(eventWithUser({ id: 'user-1' }) as never, ['admin']),
      ).rejects.toMatchObject({ statusCode: 403 })
    })

    it('should throw 403 when DB role is not in allowed roles', async () => {
      mockDbRole({ data: { role: 'user' } })

      await expect(
        requireRole(eventWithUser({ id: 'user-1' }) as never, ['admin']),
      ).rejects.toMatchObject({ statusCode: 403 })
    })

    it('should not throw when DB role matches one of the allowed roles', async () => {
      mockDbRole({ data: { role: 'editor' } })

      await expect(
        requireRole(eventWithUser({ id: 'user-1' }) as never, ['admin', 'editor']),
      ).resolves.toBeUndefined()
    })

    it('should throw 500 when the role lookup fails', async () => {
      mockDbRole({ error: { code: '42P01', message: 'relation does not exist' } })

      await expect(
        requireRole(eventWithUser({ id: 'user-1' }) as never, ['admin']),
      ).rejects.toMatchObject({ statusCode: 500 })
    })

    it('should throw 401 when session is missing', async () => {
      await expect(requireRole({ context: {} } as never, ['admin'])).rejects.toMatchObject({
        statusCode: 401,
      })
    })
  })
})
