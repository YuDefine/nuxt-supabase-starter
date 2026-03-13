import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock server utils
vi.mock('../../../../../../server/utils/supabase', () => ({
  getServerSupabaseClient: vi.fn(),
}))

vi.mock('../../../../../../server/utils/validation', () => ({
  validateQuery: vi.fn(),
}))

vi.mock('../../../../../../server/utils/api-response', () => ({
  requireRole: vi.fn(),
  createPaginatedResponse: vi.fn(),
}))

vi.mock('../../../../../../shared/schemas/profiles', () => ({
  profileListQuerySchema: {},
}))

// Mock h3
vi.mock('h3', () => ({
  defineEventHandler: (handler: any) => handler,
  getQuery: vi.fn(),
  createError: (opts: any) => {
    const error = new Error(opts.message) as any
    error.statusCode = opts.statusCode
    return error
  },
}))

import { getQuery } from 'h3'
import { getServerSupabaseClient } from '../../../../../../server/utils/supabase'
import { validateQuery } from '../../../../../../server/utils/validation'
import { requireRole, createPaginatedResponse } from '../../../../../../server/utils/api-response'

// Import the handler (after mocks)
import handler from '../../../../../../server/api/v1/profiles/index.get'

describe('GET /api/v1/profiles', () => {
  const mockEvent = {
    context: {
      session: { user: { id: 'user-1', role: 'admin' } },
    },
  } as any

  const mockProfiles = [
    {
      id: 'user-1',
      display_name: 'Alice',
      avatar_url: null,
      role: 'admin',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: null,
    },
  ]

  let mockSelectCount: any
  let mockSelect: any

  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(validateQuery).mockReturnValue({
      page: 1,
      perPage: 20,
      search: undefined,
    })

    vi.mocked(getQuery).mockReturnValue({})

    // count query: from().select() returns a promise
    mockSelectCount = {
      select: vi.fn().mockReturnValue(Promise.resolve({ count: 1, error: null })),
    }

    // data query chain
    mockSelect = {
      select: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnValue(Promise.resolve({ data: mockProfiles, error: null })),
    }

    const mockClient = {
      from: vi.fn().mockReturnValueOnce(mockSelectCount).mockReturnValueOnce(mockSelect),
    }

    vi.mocked(getServerSupabaseClient).mockReturnValue(mockClient as any)
    vi.mocked(createPaginatedResponse).mockReturnValue({
      data: mockProfiles,
      pagination: { page: 1, perPage: 20, total: 1, totalPages: 1 },
    })
  })

  it('should call requireRole with admin', async () => {
    await handler(mockEvent)

    expect(requireRole).toHaveBeenCalledWith(mockEvent, ['admin'])
  })

  it('should call validateQuery with query and schema', async () => {
    await handler(mockEvent)

    expect(validateQuery).toHaveBeenCalled()
  })

  it('should return paginated response', async () => {
    const result = await handler(mockEvent)

    expect(result).toEqual({
      data: mockProfiles,
      pagination: { page: 1, perPage: 20, total: 1, totalPages: 1 },
    })
  })

  it('should call createPaginatedResponse with correct params', async () => {
    await handler(mockEvent)

    expect(createPaginatedResponse).toHaveBeenCalledWith(mockProfiles, {
      page: 1,
      perPage: 20,
      total: 1,
    })
  })
})
