import { describe, it, expect, vi, beforeEach } from 'vite-plus/test'

vi.mock('../../../../../../server/utils/supabase', () => ({
  getAuthedSupabase: vi.fn(),
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
  profileListResponseSchema: {
    parse: vi.fn((value: unknown) => value),
  },
}))

vi.mock('h3', () => ({
  defineEventHandler: (handler: any) => handler,
  getQuery: vi.fn(),
  createError: (opts: any) => {
    const error = new Error(opts.statusMessage ?? opts.message) as any
    error.statusCode = opts.statusCode
    return error
  },
}))

import { getQuery } from 'h3'
import { createPaginatedResponse } from '../../../../../../server/utils/api-response'
import { getAuthedSupabase } from '../../../../../../server/utils/supabase'
import { validateQuery } from '../../../../../../server/utils/validation'
import handler from '../../../../../../server/api/v1/profiles/index.get'

// TD-026 D2：search 經 sanitizePostgrestSearch 後才能進 ilike。`%`、`_`、`,.( )`
// 等字元必須被移除，防止使用者輸入改變 PostgREST filter 語意。
describe('GET /api/v1/profiles — search sanitization', () => {
  const mockEvent = { context: {} } as any
  let mockIlike: ReturnType<typeof vi.fn>
  let mockCountIlike: ReturnType<typeof vi.fn>

  function givenSearch(search: string | undefined) {
    vi.mocked(validateQuery).mockReturnValue({ page: 1, perPage: 20, search })

    const dataQuery = {
      select: vi.fn().mockReturnThis(),
      ilike: mockIlike.mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    // count 查詢是 thenable：handler 會再對它叫 .ilike 才 await
    const countThenable = Object.assign(Promise.resolve({ count: 0, error: null }), {
      ilike: mockCountIlike,
    })
    mockCountIlike.mockReturnValue(countThenable)
    const countQuery = {
      select: vi.fn().mockReturnValue(countThenable),
    }

    const from = vi.fn().mockReturnValueOnce(countQuery).mockReturnValueOnce(dataQuery)
    vi.mocked(getAuthedSupabase).mockReturnValue({
      client: { from } as any,
      user: { id: 'user-1' },
    })
    vi.mocked(createPaginatedResponse).mockReturnValue({
      data: [],
      pagination: { page: 1, perPage: 20, total: 0, totalPages: 0 },
    } as never)
    return { countQuery, dataQuery }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockIlike = vi.fn()
    mockCountIlike = vi.fn()
    vi.stubGlobal('useLogger', () => ({ set: vi.fn(), error: vi.fn() }))
    vi.mocked(getQuery).mockReturnValue({})
  })

  it('strips ILIKE wildcards and PostgREST syntax chars before querying', async () => {
    givenSearch('a%,_b.c(d)e,f')

    await handler(mockEvent)

    expect(mockIlike).toHaveBeenCalledWith('display_name', '%abcdef%')
    expect(mockCountIlike).toHaveBeenCalledWith('display_name', '%abcdef%')
  })

  it('does not add an ilike filter when search sanitizes to empty', async () => {
    givenSearch('%,_')

    await handler(mockEvent)

    expect(mockIlike).not.toHaveBeenCalled()
    expect(mockCountIlike).not.toHaveBeenCalled()
  })

  it('keeps plain-text search unchanged', async () => {
    givenSearch('管理員')

    await handler(mockEvent)

    expect(mockIlike).toHaveBeenCalledWith('display_name', '%管理員%')
  })
})
