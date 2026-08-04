import { describe, it, expect, vi, beforeEach } from 'vite-plus/test'

// Mock h3
vi.mock('h3', () => ({
  defineEventHandler: (handler: any) => handler,
  getRouterParam: vi.fn(),
  createError: (opts: any) => {
    const error = new Error(opts.statusMessage ?? opts.message) as any
    error.statusCode = opts.statusCode
    error.statusMessage = opts.statusMessage
    return error
  },
}))

// Mock server utils
vi.mock('../../../../../../server/utils/supabase', () => ({
  getAuthedSupabase: vi.fn(),
}))

vi.mock('../../../../../../server/utils/api-response', () => ({
  requireAuth: vi.fn(() => ({ id: 'user-1', role: 'user' })),
}))

vi.mock('../../../../../../server/utils/validation', () => ({
  validateParam: vi.fn((data: any) => data),
}))

vi.mock('../../../../../../shared/schemas/profiles', () => ({
  profileIdParamSchema: {},
  profileResponseSchema: {
    parse: vi.fn((value: unknown) => value),
  },
}))

import { getRouterParam } from 'h3'
import { profileResponseSchema } from '../../../../../../shared/schemas/profiles'
import { requireAuth } from '../../../../../../server/utils/api-response'
import { getAuthedSupabase } from '../../../../../../server/utils/supabase'
import { validateParam } from '../../../../../../server/utils/validation'
import handler from '../../../../../../server/api/v1/profiles/[id].get'

describe('GET /api/v1/profiles/:id', () => {
  // 被查詢的 profile id，同時也是「擁有者」的 user id — server-mediated 模型下
  // handler 以 user.id === id 判定 ownership，兩者必須一致才是「查自己」。
  const TARGET_ID = '550e8400-e29b-41d4-a716-446655440000'
  const OTHER_USER = { id: 'user-1', role: 'user' }
  const OWNER = { id: TARGET_ID, role: 'user' }
  const ADMIN = { id: 'admin-1', role: 'admin' }

  const mockProfile = {
    id: TARGET_ID,
    display_name: 'Alice',
    avatar_url: null,
    role: 'user',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: null,
  }

  const mockEvent = {
    context: {
      session: { user: OWNER },
    },
  } as any

  /** 建一個回傳固定 { data, error } 的 supabase client mock，並回傳 from spy 供斷言。 */
  function mockClientReturning(result: { data: unknown; error: unknown }) {
    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue(result),
        }),
      }),
    })
    return { client: { from } as any, from }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('useLogger', () => ({
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    }))
    vi.mocked(getRouterParam).mockReturnValue(TARGET_ID)
    vi.mocked(validateParam).mockReturnValue({ id: TARGET_ID })
    vi.mocked(requireAuth).mockReturnValue(OWNER)
  })

  it('should return own profile', async () => {
    const { client } = mockClientReturning({ data: mockProfile, error: null })
    vi.mocked(getAuthedSupabase).mockReturnValue({ client, user: OWNER })

    const result = await handler(mockEvent)

    expect(result).toEqual({ data: mockProfile })
    expect(profileResponseSchema.parse).toHaveBeenCalledWith({ data: mockProfile })
  })

  it('should allow admin to read any profile', async () => {
    vi.mocked(requireAuth).mockReturnValue(ADMIN)
    const { client } = mockClientReturning({ data: mockProfile, error: null })
    vi.mocked(getAuthedSupabase).mockReturnValue({ client, user: ADMIN })

    const result = await handler(mockEvent)

    expect(result).toEqual({ data: mockProfile })
  })

  it("should throw 404 when reading another user's profile", async () => {
    vi.mocked(requireAuth).mockReturnValue(OTHER_USER)
    const { client } = mockClientReturning({ data: mockProfile, error: null })
    vi.mocked(getAuthedSupabase).mockReturnValue({ client, user: OTHER_USER })

    // 404 而非 403：403 會洩漏「這個 id 存在」，讓任何登入者可枚舉 profile 是否存在。
    await expect(handler(mockEvent)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('should not query the database when ownership check fails', async () => {
    vi.mocked(requireAuth).mockReturnValue(OTHER_USER)
    const { client, from } = mockClientReturning({ data: mockProfile, error: null })
    vi.mocked(getAuthedSupabase).mockReturnValue({ client, user: OTHER_USER })

    await expect(handler(mockEvent)).rejects.toMatchObject({ statusCode: 404 })
    // 授權失敗必須在打 DB 之前就擋掉 — 否則 service-role client 已經把資料撈出來了，
    // 只是沒回給呼叫端，任何後續的 log / error path 都可能把它洩出去。
    expect(from).not.toHaveBeenCalled()
  })

  it('should throw 401 when not logged in', async () => {
    const authError = new Error('未登入，請先登入') as any
    authError.statusCode = 401
    vi.mocked(requireAuth).mockImplementationOnce(() => {
      throw authError
    })

    const event = { context: {} } as any

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('should throw 404 when profile not found', async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: 'PGRST116', message: 'not found' },
            }),
          }),
        }),
      }),
    }
    vi.mocked(getAuthedSupabase).mockReturnValue({
      client: mockClient as any,
      user: { id: 'user-1', role: 'user' },
    })

    await expect(handler(mockEvent)).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('should throw 500 on database error', async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: '42P01', message: 'relation does not exist' },
            }),
          }),
        }),
      }),
    }
    vi.mocked(getAuthedSupabase).mockReturnValue({
      client: mockClient as any,
      user: { id: 'user-1', role: 'user' },
    })

    await expect(handler(mockEvent)).rejects.toMatchObject({
      statusCode: 500,
    })
  })
})
