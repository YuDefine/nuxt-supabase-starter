import { describe, it, expect, vi, beforeEach } from 'vite-plus/test'

// Mock h3
vi.mock('h3', () => ({
  defineEventHandler: (handler: any) => handler,
  createError: (opts: any) => {
    const error = new Error(opts.statusMessage ?? opts.message) as any
    error.statusCode = opts.statusCode
    error.statusMessage = opts.statusMessage
    return error
  },
}))

// Mock server utils
vi.mock('../../../../../../server/utils/api-response', () => ({
  requireAuth: vi.fn(() => ({ id: 'user-1', role: 'user' })),
}))

vi.mock('../../../../../../server/utils/supabase', () => ({
  getSupabaseWithContext: vi.fn(),
}))

vi.mock('../../../../../../shared/schemas/profiles', () => ({
  profileResponseSchema: {
    parse: vi.fn((value: unknown) => value),
  },
}))

import { requireAuth } from '../../../../../../server/utils/api-response'
import { profileResponseSchema } from '../../../../../../shared/schemas/profiles'
import { getSupabaseWithContext } from '../../../../../../server/utils/supabase'
import handler from '../../../../../../server/api/v1/profiles/me.get'

describe('GET /api/v1/profiles/me', () => {
  const mockProfile = {
    id: 'user-1',
    display_name: 'Alice',
    avatar_url: null,
    role: 'user',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('useLogger', () => ({
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    }))
  })

  it('should return the current user profile', async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockProfile, error: null }),
          }),
        }),
      }),
    }
    vi.mocked(getSupabaseWithContext).mockResolvedValue({
      client: mockClient as any,
      user: { id: 'user-1', role: 'user' },
    })

    const event = {
      context: {
        session: { user: { id: 'user-1' } },
      },
    } as any

    const result = await handler(event)

    expect(result).toEqual({ data: mockProfile })
    expect(mockClient.from).toHaveBeenCalledWith('profiles')
    expect(profileResponseSchema.parse).toHaveBeenCalledWith({ data: mockProfile })
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
    vi.mocked(getSupabaseWithContext).mockResolvedValue({
      client: mockClient as any,
      user: { id: 'user-999', role: 'user' },
    })

    const event = {
      context: { session: { user: { id: 'user-999' } } },
    } as any

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 404,
    })
  })
})
