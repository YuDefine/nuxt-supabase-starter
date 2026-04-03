import { describe, it, expect } from 'vite-plus/test'
import {
  createPaginatedResponse,
  requireAuth,
  requireRole,
} from '../../../../server/utils/api-response'

describe('api-response', () => {
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
    it('should not throw when user has the required role', () => {
      const event = {
        context: {
          session: {
            user: { id: 'user-1', role: 'admin' },
          },
        },
      }

      expect(() => requireRole(event as any, ['admin'])).not.toThrow()
    })

    it('should not throw when user has one of the allowed roles', () => {
      const event = {
        context: {
          session: {
            user: { id: 'user-1', role: 'editor' },
          },
        },
      }

      expect(() => requireRole(event as any, ['admin', 'editor'])).not.toThrow()
    })

    it('should throw 403 when user role is not in allowed roles', () => {
      const event = {
        context: {
          session: {
            user: { id: 'user-1', role: 'viewer' },
          },
        },
      }

      expect(() => requireRole(event as any, ['admin'])).toThrow()
    })

    it('should throw 401 when session is missing', () => {
      const event = {
        context: {},
      }

      expect(() => requireRole(event as any, ['admin'])).toThrow()
    })

    it('should throw 401 when user is missing from session', () => {
      const event = {
        context: {
          session: {},
        },
      }

      expect(() => requireRole(event as any, ['admin'])).toThrow()
    })
  })
})
